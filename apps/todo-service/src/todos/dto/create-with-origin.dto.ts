import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CreateTodoDto } from './create-todo.dto.js';

/** The producer's own id for a todo it creates — opaque to this service. */
export const ORIGIN_ID_MAX = 128;

/**
 * `POST /api/todos/origin` — a `CreateTodoDto` plus the one origin value a
 * request may supply (`SPEC-todo-origin` §7). `originService` comes from the
 * grant row of the token's verified `client_id` and `ownerSub` from the token's
 * `sub`, so neither has a field here: a body that declares its own origin is
 * rejected as an unknown field rather than trusted.
 */
export class CreateWithOriginDto extends CreateTodoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORIGIN_ID_MAX)
  originId: string;
}
