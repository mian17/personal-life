import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TODO_TITLE_MAX } from '@life/shared';
import { ISO_DUE } from '../due-time.js';

/**
 * `POST /api/todos/origin/:originId/complete` body — an optional refresh of the
 * title, so a producer can carry a changed target (a calorie goal, say) on the
 * tick instead of leaving the user a stale number (`SPEC-todo-origin` §9.15).
 * Omitting the body leaves the stored title untouched.
 */
export class CompleteByOriginDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_TITLE_MAX)
  title?: string;

  /**
   * The occurrence this tick means, in the same shape a due date is written
   * (`ISO_DUE`). A producer should always send it: a redelivery from an outbox
   * after a crash then names the occurrence it already logged, which is a true
   * no-op (`SPEC-todo-origin` §9.16). Omitting it keeps the app's own unpinned
   * behaviour — tick whatever is currently due, so a repeat call advances again.
   */
  @IsOptional()
  @IsString()
  @Matches(ISO_DUE)
  occurrence?: string;
}
