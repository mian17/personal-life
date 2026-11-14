import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DATE_ONLY,
  MINUTES_RANGE,
  SESSION_DATE_MAX,
  SESSION_TODO_ID_MAX,
} from './session-rules.js';

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

  /**
   * The task this block worked on — todo-service's id, and only the id.
   *
   * Optional because a session with no task is the ordinary case. The shape check
   * here is only a bound; whether the caller's read grant actually covers this id is
   * decided by `SessionsService.create`, which asks todo-service with the caller's
   * own token. A bounded-string check alone would store an arbitrary value.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SESSION_TODO_ID_MAX)
  todoId?: string;
}
