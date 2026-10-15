import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { NutrientVector } from '@life/nutrition';
import { DATE_ONLY } from '../../targets/dto/update-profile.dto';
import { ENTRY_DATE_MAX, MEAL_GROUPS, type MealGroup, QUANTITY_MAX } from './create-entry.dto';

/**
 * Body of `PATCH /api/entries/:id` — every field optional, so omitted fields
 * are untouched. Moving `date`/`mealGroup` re-files the entry.
 *
 * A snapshot change is the editor's "correct and save": `nutrients` carries the
 * corrected confirmed vector. Changing `quantity` requires a corrected
 * `nutrients` too (the service rejects the write otherwise) so the stored
 * snapshot can never disagree with the quantity it was scaled by — the entry
 * keeps no live food row to re-derive from.
 */
export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_DATE_MAX)
  @Matches(DATE_ONLY)
  date?: string;

  @IsOptional()
  @IsIn(MEAL_GROUPS)
  mealGroup?: MealGroup;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(QUANTITY_MAX)
  quantity?: number;

  // Same contract as the create body: a complete vector or nothing. The
  // 27-field completeness rule is owned by `completeVector()` in
  // `foods/content.ts`, so a partial or unknown nutrient is a 400, never a
  // silently coerced day total.
  @IsOptional()
  @IsObject()
  nutrients?: NutrientVector;

  /** Optimistic-concurrency check, mirroring note-service's `expectedVersion`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}