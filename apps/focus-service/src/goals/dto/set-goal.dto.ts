import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DATE_ONLY, MINUTES_RANGE, SESSION_DATE_MAX } from '../../sessions/dto/session-rules.js';

/**
 * Body of `PUT /api/goal`: a whole-minute daily goal plus the client's own day it
 * takes effect on. `ownerSub` is deliberately absent, so the global
 * `forbidNonWhitelisted` pipe rejects a body that carries it — ownership comes from
 * `@Principal()` only.
 *
 * The minutes bound is the same `MINUTES_RANGE` a recorded block is held to: one
 * rule, imported rather than restated.
 */
export class SetGoalDto {
  /** The client-local day this goal takes effect on; never derived from a service clock. */
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  date: string;

  /** Whole minutes inside `MINUTES_RANGE`, both bounds inclusive. */
  @IsInt()
  @Min(MINUTES_RANGE.min)
  @Max(MINUTES_RANGE.max)
  minutes: number;
}
