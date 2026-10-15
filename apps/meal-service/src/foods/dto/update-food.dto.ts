import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { NutrientVector } from '@life/nutrition';
import { FOOD_NAME_MAX, GRAMS_MAX, PORTIONS_MAX, ServingInputDto } from './create-food.dto';

/**
 * Body of `PATCH /api/foods/:id` — every field optional, so omitted fields are
 * untouched. `portions` replaces the pickable serving sizes wholesale (the
 * detach semantics note-service applies to `tagIds`), and changing the base
 * vector or `servingGrams` re-derives every serving's own vector.
 */
export class UpdateFoodDto {
  @IsOptional()
  @IsString()
  @MaxLength(FOOD_NAME_MAX)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(GRAMS_MAX)
  servingGrams?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PORTIONS_MAX)
  portions?: ServingInputDto[];

  // Same contract as the create body: complete vector or nothing (`content.ts`
  // owns the completeness rule).
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
