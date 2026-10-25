import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateEntryDto } from './dto/create-entry.dto';
import { ListEntriesQuery } from './dto/list-entries.query';
import { UpdateEntryDto } from './dto/update-entry.dto';
import { EntriesService } from './entries.service';

/**
 * Diary-entry routes (`SPEC-meal-service` entries). `ownerSub` always comes
 * from `@Principal()`, never the body (`SPEC-meal-service` Code Style). Every
 * query is owner-scoped inside the service, so a foreign id reads exactly like
 * a missing one (404).
 *
 * `GET /api/entries?date=` takes the client's resolved day: this service never
 * derives a day from its own clock (lesson 0019).
 */
@Controller('api/entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateEntryDto) {
    return this.entries.create(principal.sub, dto);
  }

  /** The owner's entries for `date`; `meal` filters decrypted rows in memory. */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListEntriesQuery) {
    return this.entries.findAll(principal.sub, query.date, query.meal);
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