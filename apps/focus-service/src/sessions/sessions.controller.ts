import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { ListSessionsQuery } from './dto/list-sessions.query.js';
import { SessionsService } from './sessions.service.js';

/**
 * Session routes (`SPEC-focus-service` §1). `ownerSub` always comes from
 * `@Principal()`, never the body.
 *
 * Deliberately only `POST` and `GET`: a recorded block is never revised or deleted,
 * so no update or delete route exists anywhere in this service.
 */
@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateSessionDto) {
    return this.sessions.create(principal.sub, dto);
  }

  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListSessionsQuery) {
    return this.sessions.findAll(principal.sub, query);
  }
}
