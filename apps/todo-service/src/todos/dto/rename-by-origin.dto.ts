import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TODO_TITLE_MAX } from '@life/shared';

/**
 * `POST /api/todos/origin/:originId/rename` body — the title a producer wants an
 * open todo to carry (`SPEC-todo-origin` §9.15 follow-up).
 *
 * A rename has no day and no occurrence: unlike the tick, it touches one row and
 * nothing about when it is due. The title is required rather than optional — a
 * rename with no title is a request that does nothing, which the caller can only
 * be making by mistake — and it carries the same `TODO_TITLE_MAX` bound as every
 * other title on this surface, so the rule lives in one constant.
 */
export class RenameByOriginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_TITLE_MAX)
  title: string;
}
