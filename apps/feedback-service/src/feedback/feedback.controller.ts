import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto';
import { FeedbackService } from './feedback.service';

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

  /** `200` bare `FeedbackDto[]`, newest-first. */
  @Get()
  findAll(@Principal() principal: Principal) {
    return this.feedback.findAll(principal.sub);
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