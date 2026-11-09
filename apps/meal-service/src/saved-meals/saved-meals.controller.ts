import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateSavedMealDto } from './dto/create-saved-meal.dto.js';
import { ListSavedMealsQuery } from './dto/list-saved-meals.query.js';
import { SavedMealsService } from './saved-meals.service.js';

/**
 * Saved-meal routes (`SPEC-meal-service` saved meals). `ownerSub` always comes
 * from `@Principal()`, never the body. Every query is owner-scoped inside the
 * service, so a foreign id reads exactly like a missing one (404).
 *
 * `POST /api/saved-meals` freezes the client's corrected values;
 * `GET /api/saved-meals` is the list Task 18 renders; `GET /api/saved-meals/:id`
 * is what the BFF re-log composes with `POST /api/entries` — this service never
 * calls Gemini on a re-log.
 */
@Controller('api/saved-meals')
export class SavedMealsController {
  constructor(private readonly savedMeals: SavedMealsService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateSavedMealDto) {
    return this.savedMeals.create(principal.sub, dto);
  }

  /** One page of the owner's saved meals, newest-first. The paging window is
   * applied after the cache hit, so it never enters the key. */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListSavedMealsQuery) {
    return this.savedMeals.findAll(principal.sub, query);
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.savedMeals.findOne(principal.sub, id);
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.savedMeals.remove(principal.sub, id);
    return { ok: true };
  }
}
