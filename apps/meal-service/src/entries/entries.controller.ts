import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateEntryDto } from './dto/create-entry.dto.js';
import { ListEntriesQuery } from './dto/list-entries.query.js';
import { UpdateEntryDto } from './dto/update-entry.dto.js';
import { EntriesService } from './entries.service.js';

/**
 * Diary-entry routes (`SPEC-meal-service` entries). `ownerSub` always comes
 * from `@Principal()`, never the body (`SPEC-meal-service` Code Style). Every
 * query is owner-scoped inside the service, so a foreign id reads exactly like
 * a missing one (404).
 *
 * `GET /api/entries?date=` takes the client's resolved day: this service never
 * derives a day from its own clock (lesson 0019).
 *
 * `GET /api/entries` returns one page (`EntryPage`) rather than a bare array.
 * The bound is structural — the required `date` is the fetch identity — so the
 * cursor is a uniform list surface, not a performance claim.
 */
@Controller('api/entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateEntryDto) {
    return this.entries.create(principal.sub, dto);
  }

  /** One page of the owner's entries for `date`; `meal` filters decrypted rows
   * in memory, and the paging window is applied after the cache hit. */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListEntriesQuery) {
    return this.entries.findAll(principal.sub, query);
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.entries.findOne(principal.sub, id);
  }

  @Patch(':id')
  update(@Principal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateEntryDto) {
    return this.entries.update(principal.sub, id, dto);
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.entries.remove(principal.sub, id);
    return { ok: true };
  }
}
