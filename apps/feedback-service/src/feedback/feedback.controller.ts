import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { CreateFeedbackDto } from './dto/create-feedback.dto.js';
import { ListFeedbackQuery } from './dto/list-feedback.query.js';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto.js';
import { FeedbackService } from './feedback.service.js';

/**
 * Owner-scoped feedback API. The owner always comes from `principal.sub`
 * (never the body), so one token writes and reads only its own rows
 * (`SPEC-feedback-service` API / DTO contract).
 */
@Controller('api/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** `201 { id }` — insert or idempotent no-op; `404` for a foreign id. */
  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(principal.sub, dto);
  }

  /**
   * `200 FeedbackPage` — `{ feedback, nextCursor }`, newest-first — or `400` for a
   * `limit`/`cursor` the query DTO rejects. A `limit` the request omits gets the
   * seam's default (50); the cap (200) is the seam's constant, not a literal here.
   */
  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListFeedbackQuery) {
    return this.feedback.findAll(principal.sub, query);
  }

  /** `200 { id, status }`; `404` for a foreign or missing id, `400` a bad status or id. */
  @Patch(':id')
  updateStatus(
    @Principal() principal: Principal,
    // Same UUID rule `POST`'s `@IsUUID('4')` enforces (`SPEC-feedback-status` §4:
    // `400` is the only validation status): a malformed id must never reach the
    // driver, where Postgres 22P02 on the uuid column would surface as a 500.
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateFeedbackStatusDto,
  ) {
    return this.feedback.updateStatus(principal.sub, id, dto.status);
  }
}
