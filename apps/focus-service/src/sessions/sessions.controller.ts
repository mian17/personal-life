import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { ListSessionsQuery } from './dto/list-sessions.query.js';
import { SessionsService } from './sessions.service.js';

/**
 * Session routes (`SPEC-focus-service` §1). `ownerSub` always comes from
 * `@Principal()`, never the body.
 *
 * Only `POST` and `GET`, and no update or delete route: a block is inserted once and
 * never revised. The one thing written afterwards is the owner's answer to the
 * "done?" question, which is its own `POST` sub-route rather than a `PATCH` on the
 * row — the minutes, the day and the task id stay immutable by construction.
 */
@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /**
   * `POST /api/sessions` — one recorded block, optionally naming the task it worked on.
   *
   * The caller's own `Authorization` header is forwarded to the task-id check rather
   * than a service credential being minted: the read grant is keyed to the owner and
   * the client that token names, so a token this service invented would name the wrong
   * grant — or none.
   */
  @Post()
  create(
    @Principal() principal: Principal,
    @Body() dto: CreateSessionDto,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.sessions.create(principal.sub, dto, authorization);
  }

  /**
   * `POST /api/sessions/:id/answer` — the owner answered (either way) the question this
   * block's task raised.
   *
   * It records the answer and nothing else. Ticking the task is **not** here: that is
   * the owner's own `PATCH /api/todos/:id`, made by the app with the owner's own token,
   * because the owner is the actor. This route would need a write grant to touch a
   * todo, and it has none — by design.
   */
  @Post(':id/answer')
  answer(@Principal() principal: Principal, @Param('id') id: string) {
    return this.sessions.answer(principal.sub, id);
  }

  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListSessionsQuery) {
    return this.sessions.findAll(principal.sub, query);
  }
}
