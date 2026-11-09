import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DATE_ONLY, MINUTES_RANGE, SESSION_DATE_MAX } from './session-rules.js';

/**
 * Body of `POST /api/sessions`: one recorded focus block.
 *
 * `ownerSub` is deliberately absent, and the global `forbidNonWhitelisted` pipe
 * rejects a body that carries it — ownership comes from `@Principal()` only.
 */
export class CreateSessionDto {
  /** The client's own day: this service never derives one from its process clock. */
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  date: string;

  /** Whole minutes already floored by the client, inside `MINUTES_RANGE`. */
  @IsInt()
  @Min(MINUTES_RANGE.min)
  @Max(MINUTES_RANGE.max)
  minutes: number;
}
