import { Body, Controller, Get, Post } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
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
}