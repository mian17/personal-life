import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache';
import { DATE_ONLY, type UpdateProfileDto } from './dto/update-profile.dto';
import { calculateTarget, type Goal } from './target';
import type { ActivityLevel, Sex } from './target-calculator';
import { Target } from './target.entity';

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
  constructor(
    @InjectRepository(Target) private readonly targets: Repository<Target>,
    @Inject(MEAL_CACHE) private readonly cache: MealCache,
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
    return toDto(saved);
  }
}
