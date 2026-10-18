import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { NutrientVector } from '@life/nutrition';
import { FOOD_UNITS, type FoodUnit } from '../food.entity';

/** Wire bounds for the food catalog. */
export const FOOD_NAME_MAX = 120;
export const SERVING_LABEL_MAX = 60;
export const PORTIONS_MAX = 20;
export const GRAMS_MAX = 5000;

/**
 * One pickable measure of a food ("1 carton", "1 tbsp") and how much of the
 * food's canonical unit it is. The amount is explicit at creation — there is no
 * g↔ml conversion anywhere (`docs/intent/meal-food-management.md`): an ml food's
 * measures carry ml, a g food's measures carry g. Its nutrient vector is NOT
 * client input — it is derived from the food's base vector with `scale()`
 * (`SPEC-meal-service` Nutrient semantics), so a client can never disagree with
 * the stored numbers.
 */
export class ServingInputDto {
  @IsString()
  @MaxLength(SERVING_LABEL_MAX)
  label: string;

  /** Amount in the food's canonical unit (`Food.unit`). */
  @IsNumber()
  @Min(1)
  @Max(GRAMS_MAX)
  amount: number;
}

/**
 * Body of `POST /api/foods`. `ownerSub` is deliberately absent (and the global
 * `forbidNonWhitelisted` pipe rejects a body that carries it): it comes from
 * `@Principal()` only (`SPEC-meal-service` Code Style).
 */
export class CreateFoodDto {
  @IsString()
  @MaxLength(FOOD_NAME_MAX)
  name: string;

  /**
   * The food's one canonical unit, chosen here and immutable after: an edit
   * carrying it is a 400 because `UpdateFoodDto` has no such field and the
   * global pipe forbids non-whitelisted keys. Omitted means `'g'`.
   */
  @IsOptional()
  @IsIn(FOOD_UNITS)
  unit?: FoodUnit;

  @IsNumber()
  @Min(1)
  @Max(GRAMS_MAX)
  servingGrams: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PORTIONS_MAX)
  portions: ServingInputDto[] = [];

  /**
   * The base per-serving vector, complete or absent (`SPEC-meal-service`:
   * "missing data is 0 with no unknown state"). `@IsObject()` only carries the
   * field past the global whitelist; the 27-field completeness rule is owned by
   * `completeVector()` in `content.ts`, which rejects a partial or unknown
   * nutrient instead of silently coercing it.
   */
  @IsOptional()
  @IsObject()
  nutrients?: NutrientVector;
}
