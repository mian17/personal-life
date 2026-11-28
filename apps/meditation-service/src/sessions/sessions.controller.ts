import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateSittingDto, ListDaysQuery, ListSittingsQuery } from './sessions.dto.js';
import { SessionsService } from './sessions.service.js';

/**
 * Sitting routes (`SPEC-meditation-app` §1, §5). `ownerSub` always comes from
 * `@Principal()`, never the body.
 *
 * There is no update route and no restore route: a sitting is recorded once, and a delete
 * is the one stamp it ever takes (`SPEC-meditation-app` §10.1). An abandoned sitting has
 * no route either — nothing is sent for it, so nothing is written.
 */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Record one finished sitting; the server decides the minutes it holds. */
  @Post()
  record(@Principal() principal: Principal, @Body() dto: CreateSittingDto) {
    return this.sessions.record(principal.sub, dto);
  }

  /** One page of the owner's live sittings, newest first. */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListSittingsQuery) {
    return this.sessions.findAll(principal.sub, query);
  }

  /** Every day of the window, measured against the goal as it stands at this read. */
  @Get('days')
  daysDone(@Principal() principal: Principal, @Query() window: ListDaysQuery) {
    return this.sessions.daysDone(principal.sub, window);
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.sessions.findOne(principal.sub, id);
  }

  /** A delete is a `deletedAt` stamp: the sitting leaves every read and stays in the file. */
  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.sessions.remove(principal.sub, id);
    return { ok: true };
  }
}
