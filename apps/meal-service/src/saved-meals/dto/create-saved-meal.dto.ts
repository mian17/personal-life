import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { NutrientVector } from '@life/nutrition';
import { FOOD_ID_MAX, MEAL_GROUPS, type MealGroup, QUANTITY_MAX } from '../../entries/dto/create-entry.dto';

/**
 * Body of `POST /api/saved-meals` — one frozen meal snapshot.
 *
 * Every field is a corrected value **the client already confirmed**: the
 * service copies them into sealed item rows and never re-derives a nutrient,
 * never reads a food, and never calls Gemini (`SPEC-meal-service` Photo →
 * Gemini pipeline: only a *confirmed* value is persisted). The 27-field
 * completeness rule is owned by `completeVector()` in `foods/content.ts`, so a
 * partial vector is a 400 rather than a silently wrong snapshot.
 *
 * `ownerSub` is deliberately absent (the global `forbidNonWhitelisted` pipe
 * rejects a body carrying it): it comes from `@Principal()` only
 * (`SPEC-meal-service` Code Style).
 */

/** How many frozen items one saved meal may hold. */
export const SAVED_MEAL_ITEMS_MAX = 50;

/** Wire bound for the saved meal's name (mirrors the food name bound). */
export const SAVED_MEAL_NAME_MAX = 120;

export class CreateSavedMealDto {
  @IsString()
  @MaxLength(SAVED_MEAL_NAME_MAX)
  name: string;

  /** The meal of the day this snapshot re-logs into (one owner for the vocabulary). */
  @IsIn(MEAL_GROUPS)
  mealGroup: MealGroup;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SAVED_MEAL_ITEMS_MAX)
  items: SavedMealItemInputDto[];
}

/**
 * One frozen item. `foodId` is optional metadata — a saved meal may hold a dish
 * that was never catalogued — so the vector and quantity are the whole truth.
 */
export class SavedMealItemInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(FOOD_ID_MAX)
  foodId?: string;

  @IsNumber()
  @Min(0)
  @Max(QUANTITY_MAX)
  quantity: number;

  @IsObject()
  nutrients: NutrientVector;
}