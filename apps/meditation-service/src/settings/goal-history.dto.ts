import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { PLANNED_MAX_MINUTES, PLANNED_MIN_MINUTES } from './goal.js';

/**
 * Client-local day, `YYYY-MM-DD` and nothing else — the shape a goal row is keyed by, stated
 * here because a service never imports another service's source (arch-check RULE 5).
 *
 * An ISO-8601 check alone accepts `2026-11` and `2026-11-14T06:00:00Z`; `validFrom` compares
 * lexically, so either of those would be a row no day ever resolves to.
 */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body of `PUT /settings/goals`: a whole-minute goal plus the client's own day it takes effect
 * on. `ownerSub` is deliberately absent, so the global `forbidNonWhitelisted` pipe rejects a
 * body carrying it — ownership comes from `@Principal()` only.
 *
 * The minutes bound is a sitting day's own range (a minute to a day), imported rather than
 * restated. A shape-valid day that is not a real calendar day is refused by the service's
 * round-trip check, because no validator here can see the calendar.
 */
export class SetGoalDto {
  /** The client-local day this goal takes effect on; never derived from a service clock. */
  @IsString()
  @Matches(DATE_ONLY)
  date: string;

  /** Whole minutes inside the day's range, both bounds inclusive. */
  @IsInt()
  @Min(PLANNED_MIN_MINUTES)
  @Max(PLANNED_MAX_MINUTES)
  minutes: number;
}
