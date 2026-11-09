import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { CreateEntryDto } from '../../entries/dto/create-entry.dto.js';
import { UpdateEntryDto } from '../../entries/dto/update-entry.dto.js';
import { CreateFoodDto } from '../../foods/dto/create-food.dto.js';
import { UpdateFoodDto } from '../../foods/dto/update-food.dto.js';
import { CreateSavedMealDto } from '../../saved-meals/dto/create-saved-meal.dto.js';

/**
 * Batch request bodies (`SPEC-meal-service.md` §5): one body per
 * resource-and-kind, each holding an `items` array whose items are the singular
 * DTO's shape, so a batch accepts exactly what its singular twin accepts.
 *
 * No count rule appears here on purpose. `MAX_BATCH_ITEMS` lives in the batch
 * kernel, which rejects an out-of-range count before any transaction opens — a
 * duplicate limit would be a second place for the cap to drift.
 *
 * There is no `saved-meals:batchUpdate` because no singular
 * `PATCH /api/saved-meals/:id` exists: a frozen snapshot is created and deleted,
 * never edited.
 */

export class BatchUpdateEntryItem extends UpdateEntryDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchDeleteEntryItem {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchUpdateFoodItem extends UpdateFoodDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchDeleteFoodItem {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchDeleteSavedMealItem {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchCreateEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEntryDto)
  items: CreateEntryDto[];
}

export class BatchUpdateEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateEntryItem)
  items: BatchUpdateEntryItem[];
}

export class BatchDeleteEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchDeleteEntryItem)
  items: BatchDeleteEntryItem[];
}

export class BatchCreateFoodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFoodDto)
  items: CreateFoodDto[];
}

export class BatchUpdateFoodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateFoodItem)
  items: BatchUpdateFoodItem[];
}

export class BatchDeleteFoodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchDeleteFoodItem)
  items: BatchDeleteFoodItem[];
}

export class BatchCreateSavedMealsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSavedMealDto)
  items: CreateSavedMealDto[];
}

export class BatchDeleteSavedMealsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchDeleteSavedMealItem)
  items: BatchDeleteSavedMealItem[];
}
