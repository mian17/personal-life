import { IsBoolean } from 'class-validator';

/**
 * Body of `POST /api/meal-todo` (`SPEC-todo-origin` assumption 12).
 *
 * One field: the state the user asked for. `ownerSub` is absent (and the global
 * `forbidNonWhitelisted` pipe rejects a body carrying it) because it comes from
 * `@Principal()` only, and the day is a required query rather than a body field so
 * it reads the same way as `GET /api/target?date=`.
 */
export class MealTodoStateDto {
  /** `true` turns the integration on, `false` revokes it — the same outcome as DELETE. */
  @IsBoolean()
  enabled: boolean;
}
