import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DAILY_GOAL_RANGE, DATE_ONLY, SESSION_DATE_MAX } from '../../sessions/dto/session-rules';

/**
 * Body of `PUT /api/goal`: a whole-minute daily goal plus the client's own day it
 * takes effect on. `ownerSub` is deliberately absent, so the global
 * `forbidNonWhitelisted` pipe rejects a body that carries it — ownership comes from
 * `@Principal()` only.
 *
 * The minutes bound is `DAILY_GOAL_RANGE`, not the `MINUTES_RANGE` a recorded block is held
 * to: a goal is a day's total focus, so one block's ceiling is not its ceiling.
 */
export class SetGoalDto {
  /** The client-local day this goal takes effect on; never derived from a service clock. */
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  date: string;

  /** Whole minutes inside `DAILY_GOAL_RANGE`, both bounds inclusive. */
  @IsInt()
  @Min(DAILY_GOAL_RANGE.min)
  @Max(DAILY_GOAL_RANGE.max)
  minutes: number;
}
