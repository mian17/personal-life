import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_PAGE_LIMIT, paginate } from '@life/service-kit';
import { FOCUS_CACHE, type FocusCache } from '../cache/focus-cache';
import { DATE_ONLY } from '../sessions/dto/session-rules';
import type { ListGoalsQuery } from './dto/list-goals.query';
import type { SetGoalDto } from './dto/set-goal.dto';
import { Goal } from './goal.entity';

/**
 * A goal row as persisted, which is also the row as served: the wire shape locked
 * in `SPEC-focus-service` §1 and the cached shape locked in its `## Cache Rules`
 * are the same two fields, so a cache hit needs no reassembly.
 */
export interface GoalRow {
  validFrom: string;
  minutes: number;
}

/**
 * One page of the owner's goal history plus the cursor that continues it
 * (`SPEC-pagination-seam` §4: plural entity key, `GoalRow` → `goals`).
 */
export interface GoalPage {
  goals: GoalRow[];
  nextCursor: string | null;
  /** How many rows the whole filtered set holds — never this page's length. */
  total: number;
}

/**
 * The list's strictly-after test: `validFrom ASC`, the order `loadAll` reads in and
 * the order `resolveGoal` requires. `validFrom` is unique per owner (the table's
 * unique index), so the day alone is a complete key — no tie-breaker is needed and
 * the caret below proofs that nothing is skipped.
 *
 * Rows arrive oldest first, and lexically comparable `YYYY-MM-DD` days make the
 * comparison exactly calendar order.
 */
function afterListPosition(row: GoalRow, at: string[]): boolean {
  const [validFrom] = at;
  return row.validFrom > validFrom;
}

/**
 * The locked day→goal rule (`SPEC-focus-service` §1): for a day, the goal is the
 * minutes of the newest row that took effect on or before it. A day preceding every
 * row has no goal at all — `null`, never a fallback value.
 *
 * Rows arrive oldest first (`GET /api/goal` and the loader both order by
 * `validFrom`), so the scan keeps the last row that applies. Text days compare
 * lexically, which `YYYY-MM-DD` makes exactly calendar order.
 */
export function resolveGoal(rows: GoalRow[], day: string): number | null {
  let applicable: number | null = null;
  for (const row of rows) {
    if (row.validFrom <= day) applicable = row.minutes;
  }
  return applicable;
}

/**
 * The client's own day, or a 400. The service never reads its own clock for
 * "today", so a missing or impossible day is refused rather than defaulted. A
 * shape-valid day that is not a real calendar day (`2026-02-31`) is impossible too:
 * the round trip through UTC shows it did not survive.
 */
function requireDay(date: string | undefined): string {
  if (date === undefined) throw new BadRequestException('date is required (YYYY-MM-DD)');
  if (!DATE_ONLY.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');

  const asUtc = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException('date must be a real calendar day');
  }
  return date;
}

function toGoalRow(goal: Goal): GoalRow {
  return { validFrom: goal.validFrom, minutes: goal.minutes };
}

/**
 * Owner-scoped daily-goal history (`SPEC-focus-service` §1).
 *
 * Setting a goal for a day replaces only that day's row; every other day's row is
 * left untouched, so a past day keeps the goal it was measured against. Reads go
 * through the read-through cache under the one per-owner `goal` key — the whole
 * list, because it is tiny and carries no fetch parameters of its own.
 */
@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    @Inject(FOCUS_CACHE) private readonly cache: FocusCache,
  ) {}

  /** Upsert the goal for exactly `dto.date`; the owner's cached goal list dies after the write. */
  async setGoal(sub: string, dto: SetGoalDto): Promise<GoalRow> {
    const goal = { validFrom: requireDay(dto.date), minutes: dto.minutes };

    // The unique `(ownerSub, validFrom)` index turns this into "replace that day's
    // row, touch no other", in one statement — no read-then-write race.
    await this.goals.upsert({ ownerSub: sub, ...goal }, ['ownerSub', 'validFrom']);

    // Bump AFTER the write: a read landing during it must not repopulate the new
    // generation with pre-write rows, and a thrown write never bumps.
    await this.cache.bumpGeneration(sub);
    return goal;
  }

  /**
   * One page of the owner's goal history, oldest first, through the read-through
   * cache under the one per-owner `goal` key — the whole list, because it is tiny
   * and carries no fetch parameters of its own. `limit`/`cursor` stay out of the key:
   * paging is a projection over the whole cached history, so one entry serves every
   * page of it (Contract 2 Rule 3).
   */
  async findAll(sub: string, query: ListGoalsQuery = {}): Promise<GoalPage> {
    const rows = await this.cache.getThrough(sub, 'focus:goal', () => this.loadAll(sub));

    const page = paginate(rows, {
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
      keyOf: (row) => [row.validFrom],
      after: afterListPosition,
    });
    return { goals: page.rows, nextCursor: page.nextCursor, total: page.total };
  }

  /** Whole-list load, owner-scoped; lives inside the cache's loader and nowhere else. */
  private async loadAll(sub: string): Promise<GoalRow[]> {
    const found = await this.goals.find({
      where: { ownerSub: sub },
      order: { validFrom: 'ASC' },
    });
    return found.map(toGoalRow);
  }
}
