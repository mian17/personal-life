import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateListDto } from './dto/create-list.dto';
import { ListListsQuery } from './dto/list-lists.query';
import { UpdateListDto } from './dto/update-list.dto';
import { ListsService } from './lists.service';

/** The todo-local list HTTP surface (`SPEC-todo-service` API). */
@Controller('api/lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateListDto) {
    return this.lists.create(principal.sub, dto.name, dto.importantDefault ?? null);
  }

  /**
   * `200 ListPage` — `{ lists, nextCursor }` in `byName` order — or `400` for a
   * `limit`/`cursor` the query DTO rejects. Lists are a named vocabulary (tens),
   * so the window is the shared list contract, not a bounded scan.
   */
  @Get()
  list(@Principal() principal: Principal, @Query() query: ListListsQuery) {
    return this.lists.page(principal.sub, query);
  }

  @Patch(':id')
  update(@Principal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateListDto) {
    return this.lists.update(principal.sub, id, dto.name, dto.importantDefault, dto.expectedVersion);
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.lists.remove(principal.sub, id);
    return { ok: true };
  }
}
