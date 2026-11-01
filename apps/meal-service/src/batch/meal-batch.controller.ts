import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import {
  BatchCreateEntriesDto,
  BatchCreateFoodsDto,
  BatchCreateSavedMealsDto,
  BatchDeleteEntriesDto,
  BatchDeleteFoodsDto,
  BatchDeleteSavedMealsDto,
  BatchUpdateEntriesDto,
  BatchUpdateFoodsDto,
} from './dto/batch-meal.dto';
import { EntriesService } from '../entries/entries.service';
import { FoodsService } from '../foods/foods.service';
import { SavedMealsService } from '../saved-meals/saved-meals.service';

/**
 * The eight meal-service batch routes (`SPEC-meal-service.md` §5).
 *
 * Prefix-less controller with full, colon-escaped method paths. Nest joins the
 * controller and method paths with a slash, so `@Post(':batchCreate')` on a
 * prefixed controller could only ever register the parameter route
 * `/api/entries/:batchCreate` — never the literal AIP URI. There is no
 * `saved-meals:batchUpdate`: no singular `PATCH /api/saved-meals/:id` exists to
 * mirror, and a frozen snapshot is created and deleted, never edited.
 */
@Controller()
export class MealBatchController {
  constructor(
    private readonly entries: EntriesService,
    private readonly foods: FoodsService,
    private readonly savedMeals: SavedMealsService,
  ) {}

  @Post('api/entries\\:batchCreate')
  @HttpCode(201)
  createEntries(@Principal() principal: Principal, @Body() dto: BatchCreateEntriesDto) {
    return this.entries.createMany(principal.sub, dto.items);
  }

  @Post('api/entries\\:batchUpdate')
  @HttpCode(200)
  updateEntries(@Principal() principal: Principal, @Body() dto: BatchUpdateEntriesDto) {
    return this.entries.updateMany(principal.sub, dto.items);
  }

  @Post('api/entries\\:batchDelete')
  @HttpCode(200)
  deleteEntries(@Principal() principal: Principal, @Body() dto: BatchDeleteEntriesDto) {
    return this.entries.removeMany(principal.sub, dto.items);
  }

  @Post('api/foods\\:batchCreate')
  @HttpCode(201)
  createFoods(@Principal() principal: Principal, @Body() dto: BatchCreateFoodsDto) {
    return this.foods.createMany(principal.sub, dto.items);
  }

  @Post('api/foods\\:batchUpdate')
  @HttpCode(200)
  updateFoods(@Principal() principal: Principal, @Body() dto: BatchUpdateFoodsDto) {
    return this.foods.updateMany(principal.sub, dto.items);
  }

  @Post('api/foods\\:batchDelete')
  @HttpCode(200)
  deleteFoods(@Principal() principal: Principal, @Body() dto: BatchDeleteFoodsDto) {
    return this.foods.removeMany(principal.sub, dto.items);
  }

  @Post('api/saved-meals\\:batchCreate')
  @HttpCode(201)
  createSavedMeals(@Principal() principal: Principal, @Body() dto: BatchCreateSavedMealsDto) {
    return this.savedMeals.createMany(principal.sub, dto.items);
  }

  @Post('api/saved-meals\\:batchDelete')
  @HttpCode(200)
  deleteSavedMeals(@Principal() principal: Principal, @Body() dto: BatchDeleteSavedMealsDto) {
    return this.savedMeals.removeMany(principal.sub, dto.items);
  }
}
