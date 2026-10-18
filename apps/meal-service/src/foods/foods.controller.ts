import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { CreateFoodDto } from './dto/create-food.dto';
import { ListFoodsQuery } from './dto/list-foods.query';
import { UpdateFoodDto } from './dto/update-food.dto';
import { FoodsService } from './foods.service';

/**
 * Food routes. `ownerSub` always comes from `@Principal()`, never the body
 * (`SPEC-meal-service` Code Style). Every query is owner-scoped inside the
 * service, so a foreign id reads exactly like a missing one (404).
 */
@Controller('api/foods')
export class FoodsController {
  constructor(private readonly foods: FoodsService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateFoodDto) {
    return this.foods.create(principal.sub, dto);
  }

  /** The owner's foods; `q` filters decrypted names in memory, never in SQL.
   * `?includeDeleted=1` adds the soft-deleted rows (same DTO, same owner
   * scoping) so past entries and saved-meal items keep resolving the dish name. */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListFoodsQuery) {
    return this.foods.findAll(principal.sub, query.q, query.includeDeleted ?? false);
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.foods.findOne(principal.sub, id);
  }

  @Patch(':id')
  update(@Principal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateFoodDto) {
    return this.foods.update(principal.sub, id, dto);
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.foods.remove(principal.sub, id);
    return { ok: true };
  }
}