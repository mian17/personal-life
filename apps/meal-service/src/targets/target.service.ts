import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache.js';
import { TODOS_RENAME_PRODUCER, type TodoTitleRefresher } from '../meal-todo/todo-intents.js';
import { DATE_ONLY, type UpdateProfileDto } from './dto/update-profile.dto.js';
import { calculateTarget, type Goal } from './target.js';
import type { ActivityLevel, Sex } from './target-calculator.js';
import { Target } from './target.entity.js';

/**
 * The wire shape of a target row: profile inputs (reproducible) + computed
 * outputs (cheap reads). `ownerSub` is deliberately absent — ownership is never
 * echoed back to the client.
 */
export interface TargetDto {
  id: string;
  validFrom: string;
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: Goal;
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: Target): TargetDto {
  return {
    id: row.id,
    validFrom: row.validFrom,
    age: row.age,
    sex: row.sex as Sex,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    activity: row.activity as ActivityLevel,
    goal: row.goal as Goal,
    bmr: row.bmr,
    tdee: row.tdee,
    calories: row.calories,
    proteinG: row.proteinG,
    fatG: row.fatG,
    carbG: row.carbG,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validate a wire date. The day is always the client's (`date` on PUT,
 * `?date=` on GET) — the service never reads its own clock for "today"
 * (lesson 0019), so a missing or malformed date is a 400, never a default.
 */
function requireDay(date: string | undefined): string {
  if (date === undefined) throw new BadRequestException('date is required (YYYY-MM-DD)');
  if (!DATE_ONLY.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
  return date;
}

/**
 * Versioned target rows (`SPEC-target-onboarding`): a profile change INSERTS a
 * new row and never mutates a prior one, so a past date re-renders against the
 * row that applied then.
 *
 * Reads are deliberately **uncached** — no `target` row exists in
 * `SPEC-meal-service.md`'s cache key table, so `GET /api/target?date=` queries
 * the DB directly and never writes Redis. Writes still bump the owner's
 * generation through the `MEAL_CACHE` adapter (spec `Cache Rules`: invalidate
 * on "target change"), AFTER the insert so a thrown save never bumps.
 */
@Injectable()
export class TargetService {
  private readonly logger = new Logger(TargetService.name);

  constructor(
    @InjectRepository(Target) private readonly targets: Repository<Target>,
    @Inject(MEAL_CACHE) private readonly cache: MealCache,
    /**
     * The todo producer the rename intents go through, reached by token rather than
     * by class: the producer injects this service, so importing its class here would
     * be a module cycle `emitDecoratorMetadata` turns into a boot-time reference
     * error. `forwardRef` around the token closes the DI edge the token itself makes
     * (token → producer → this service → token).
     *
     * Optional only so a hand-built service in a unit suite still constructs;
     * `MealTodoModule` provides the token and `TargetModule` imports that module, so
     * the shipped graph always resolves it. `@Optional()` keeps an absent token from
     * failing boot, and `refreshTaskTitles` then warns **by token name** — so the gap
     * is visible in the log and the owner's target save still succeeds.
     */
    @Optional()
    @Inject(forwardRef(() => TODOS_RENAME_PRODUCER))
    private readonly todoProducer?: TodoTitleRefresher,
  ) {}

  /**
   * The row applicable to `date`: the most recent `validFrom <= date`, falling
   * back to the oldest row for a date that precedes the first profile.
   * Owner-scoped and read straight from the DB.
   */
  async getTarget(sub: string, date?: string): Promise<TargetDto> {
    const day = requireDay(date);
    const rows = await this.targets.find({
      where: { ownerSub: sub },
      order: { validFrom: 'ASC' },
    });
    if (rows.length === 0) throw new NotFoundException('No target profile set');

    // Ascending scan: `applicable` ends on the newest row at or before `day`;
    // if `day` precedes every row it stays on the oldest one (the fallback).
    let applicable = rows[0];
    for (const row of rows) {
      if (row.validFrom <= day) applicable = row;
    }
    return toDto(applicable);
  }

  /**
   * Insert a new versioned row for a profile change. The client supplies only
   * the inputs — the kcal/BMR/TDEE/macro outputs are derived server-side, so a
   * body carrying computed values is rejected by the global
   * `forbidNonWhitelisted` pipe before this runs.
   */
  async updateProfile(sub: string, dto: UpdateProfileDto): Promise<TargetDto> {
    const profile = {
      age: dto.age,
      sex: dto.sex,
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      activity: dto.activity,
    };
    const computed = calculateTarget(profile, dto.goal);

    const row = this.targets.create({
      id: randomUUID(),
      ownerSub: sub,
      validFrom: requireDay(dto.date),
      ...profile,
      goal: dto.goal,
      bmr: computed.bmr,
      tdee: computed.tdee,
      calories: computed.calories,
      proteinG: computed.proteinG,
      fatG: computed.fatG,
      carbG: computed.carbG,
    });
    const saved = await this.targets.save(row);

    // Bump AFTER the insert: pre-mutation reads were born under the old
    // generation and die here. A thrown save never bumps (cache stays honest),
    // and a bump error never blocks the write (fail open, `@life/cache`).
    await this.cache.bumpGeneration(sub);
    // The open tasks still carry the old number, so the new target is not done
    // until they are re-titled. The day handed over is the row's own `validFrom`:
    // that is the date the new number applies from, so the read resolves to the row
    // just saved and never to an older one (and no clock is read — lesson 0019).
    await this.refreshTaskTitles(sub, saved.validFrom);
    return toDto(saved);
  }

  /**
   * Tell the todo producer the target moved, in this service's own manager scope.
   *
   * Matched to `entries.service`'s `noteTick`: the producer is handed
   * `this.targets.manager` (the same repository manager a singular entry write
   * passes, not an enclosing transaction), and this seam keeps a guard of its own.
   * The producer guards its own decides; this guard covers the seam itself — a
   * producer that throws before its guard runs must still never fail the owner's
   * target save. No transaction of this one's is needed because the row the
   * intents describe is already committed, and each intent commits with the
   * outbox write the producer issues.
   *
   * Neither failure is silent. An absent producer means the token went unprovided —
   * a wiring bug, never a mode — and the warn names the token so the log says which
   * one. A throwing producer is degraded, and the warn carries its message: a live
   * run once saved a target with `?.` over an unprovided token and enqueued nothing,
   * with no line anywhere to show it.
   */
  private async refreshTaskTitles(sub: string, today: string): Promise<void> {
    const producer = this.todoProducer;
    if (producer === undefined) {
      this.logger.warn(
        `todo title refresh skipped for ${sub}/${today}: TODOS_RENAME_PRODUCER is not provided`,
      );
      return;
    }
    try {
      await producer.refreshTitles(sub, today, this.targets.manager);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`todo title refresh failed for ${sub}/${today}: ${message}`);
    }
  }
}
