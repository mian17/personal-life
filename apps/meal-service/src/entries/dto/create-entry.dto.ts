import { IsIn, IsNumber, IsObject, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { NutrientVector } from '@life/nutrition';
import { DATE_ONLY } from '../../targets/dto/update-profile.dto';

/**
 * The meal a diary entry belongs to (`docs/intent/meal-nutrition.md`:
 * "Diary entry = food × quantity, in a meal group, on a date"). One owner for
 * the vocabulary: the same list validates the write, and `@IsIn` rejects
 * anything outside it before the service sees a body (lesson 0016 — a rule
 * written once and imported, never re-spelled at call sites).
 */
export const MEAL_GROUPS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealGroup = (typeof MEAL_GROUPS)[number];

export const ENTRY_DATE_MAX = 10;
export const FOOD_ID_MAX = 64;
export const QUANTITY_MAX = 100;

/**
 * Body of `POST /api/entries`.
 *
 * The entry carries the client's confirmed snapshot: `foodId`/`quantity` are
 * metadata copied verbatim, and `nutrients` is the complete vector the client
 * confirmed (the shared `@life/nutrition` model `scale()`d it before the
 * confirm step). The service never re-derives it from the food, so editing a
 * food later cannot rewrite history, and a saved meal re-logs its stored
 * snapshot rather than a fresh guess (Task 11). `ownerSub` is deliberately
 * absent (and the global `forbidNonWhitelisted` pipe rejects a body carrying
 * it): it comes from `@Principal()` only (`SPEC-meal-service` Code Style).
 */
export class CreateEntryDto {
  /**
   * Client-local `YYYY-MM-DD`. Required: the day belongs to the client
   * (lesson 0019), so the service never defaults it from its own clock.
   */
  @IsString()
  @MaxLength(ENTRY_DATE_MAX)
  @Matches(DATE_ONLY)
  date: string;

  @IsIn(MEAL_GROUPS)
  mealGroup: MealGroup;

  /** The catalog food the entry was logged from. */
  @IsString()
  @MaxLength(FOOD_ID_MAX)
  foodId: string;

  /** Servings logged — the `quantity` the confirmed snapshot was scaled by. */
  @IsNumber()
  @Min(0)
  @Max(QUANTITY_MAX)
  quantity: number;

  /**
   * The confirmed, complete per-entry vector (`SPEC-meal-service` Nutrient
   * semantics: missing data is `0` with no "unknown" state). `@IsObject()` only
   * carries the field past the global whitelist; the 27-field completeness rule
   * is owned by `completeVector()` in `foods/content.ts`, which rejects a
   * partial or unknown nutrient instead of silently coercing it.
   */
  @IsObject()
  nutrients: NutrientVector;
}