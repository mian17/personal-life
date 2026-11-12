import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Principal } from '@life/service-kit';
import { OUTBOX_SWEEP_BATCH } from './outbox/outbox-poller.service.js';
import { OutboxService, type PendingIntent } from './outbox/outbox.service.js';
import { MealTodoProducerService } from './outbox/producer/meal-todo-producer.service.js';
import { MealTodoStateDto } from './outbox/producer/meal-todo-state.dto.js';
import { MEAL_ORIGIN_SERVICE, ORIGIN_GRANT_PATH } from './outbox/producer/todo-intents.js';
import { TODOS_API_URL_ENV } from './outbox/outbox-delivery.js';

/** `YYYY-MM-DD`, the wire form of the client's day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body of `POST /api/meal-todo/published` — what became of the intents the caller
 * was handed by `GET /api/meal-todo/pending`.
 *
 * One body carries both outcomes on purpose: a batch whose rows partly succeeded
 * takes one round trip, and a row that failed learns *why* in the same write that
 * leaves it pending. A publish-only route would leave a stuck row with no reason to
 * diagnose it by — the silent-failure shape this codebase refuses.
 *
 * The cap is the pending read's own batch constant, so no caller can be asked to
 * report on more rows than one read can have handed it.
 */
export class OutboxOutcomesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(OUTBOX_SWEEP_BATCH)
  @ValidateNested({ each: true })
  @Type(() => OutboxOutcomeDto)
  records: OutboxOutcomeDto[];
}

/**
 * One row's outcome. `id` is this service's delivery id, never a todo id.
 *
 * `published: false` means the caller attempted delivery and it did not take: the row
 * stays pending with `lastError` as the reason. A reason longer than the column's bound
 * is flattened and cut to it by the writer (`oneLine`), never refused: a caller
 * reporting a noisy upstream error must still be able to close its batch.
 */
export class OutboxOutcomeDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsBoolean()
  published: boolean;

  @IsOptional()
  @IsString()
  lastError?: string;
}

/**
 * The meals settings switch (`SPEC-todo-origin` assumption 12).
 *
 * Turning the integration on is one act in three steps: this service records that
 * the user agreed (its own toggle row, with the sentence verbatim), grants itself
 * the origin in todo-service — the only place a producer's write is authorized —
 * and seeds the day's three tasks, so the switch's effect is visible on the todos
 * screen in the same request rather than on a later sweep.
 *
 * **POST is idempotent set-state.** `{enabled: true}` on an owner already enabled
 * refreshes the consent row and re-enqueues the day's creates, which is harmless:
 * the producer ids are stable per group, so todo-service answers a duplicate as a
 * no-op. `{enabled: false}` revokes, which is exactly what `DELETE` does — DELETE is
 * the explicit revoke spelling for a caller with no body to send, not a different
 * outcome.
 *
 * `date` is a **required query**, never this service's clock: the day a task is owed
 * for is the client's (lesson 0019), the same reason `CreateEntryDto.date` and
 * `GET /api/target?date=` are required. A missing or malformed day is a 400 rather
 * than a guess, because a guess enqueues tasks for a day the user is not on.
 */
@Controller('api/meal-todo')
export class MealTodoController {
  private readonly logger = new Logger(MealTodoController.name);

  constructor(
    private readonly producer: MealTodoProducerService,
    private readonly outbox: OutboxService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** `GET /api/meal-todo` — whether this owner has the integration on. */
  @Get()
  async get(@Principal() principal: Principal): Promise<{ enabled: boolean }> {
    return { enabled: await this.producer.isEnabledFor(principal.sub, this.dataSource.manager) };
  }

  /**
   * `POST /api/meal-todo?date=` — set this owner's state.
   *
   * The grant is written before any intent is enqueued: the other order would owe
   * todo-service creates it is about to refuse, which the delivery layer reads as a
   * retryable failure and would retry indefinitely.
   */
  @Post()
  async set(
    @Principal() principal: Principal,
    @Body() dto: MealTodoStateDto,
    @Query('date') date: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ enabled: boolean }> {
    const day = requireDay(date);
    if (!dto.enabled) {
      await this.producer.revoke(principal.sub, this.dataSource.manager);
      return { enabled: false };
    }
    await this.producer.recordConsent(principal.sub, this.dataSource.manager);
    await this.grantOwnOrigin(authorization);
    await this.producer.ensureDailyTasks(principal.sub, day, this.dataSource.manager);
    return { enabled: true };
  }

  /** `DELETE /api/meal-todo` — the explicit revoke spelling of `{enabled: false}`. */
  @Delete()
  async revoke(@Principal() principal: Principal): Promise<{ enabled: false }> {
    await this.producer.revoke(principal.sub, this.dataSource.manager);
    return { enabled: false };
  }

  /**
   * `GET /api/meal-todo/pending` — the intents this owner still owes, oldest first.
   *
   * This is the delivery leg's read. The BFF drains it with the user's own token,
   * which is the only credential a grant names (`origin_grant` is keyed
   * `(ownerSub, clientId)` and that token's `client_id` is `app`), so no service ever
   * needs to hold a user credential to deliver.
   *
   * `payload` is the exact JSON body todo-service accepts, unreshaped — the deliverer
   * forwards it as it stands. Owner-scoped from `@Principal()`, never a parameter, so
   * one owner's queue can never be read by another.
   *
   * Declared before the parameterless `GET /api/meal-todo`? Nest matches by path
   * segment, not declaration order, and there is no `:id` route on this controller at
   * all — so `pending` and `published` can never be mistaken for an id here.
   */
  @Get('pending')
  async pending(@Principal() principal: Principal): Promise<{ intents: PendingIntent[] }> {
    return { intents: await this.outbox.pendingFor(principal.sub, OUTBOX_SWEEP_BATCH) };
  }

  /**
   * `POST /api/meal-todo/published` — record what became of a batch of intents.
   *
   * One call per batch, carrying both outcomes: a published row closes
   * (`publishedAt = now`, `lastError = null`), a failed one stays pending with its
   * reason on `lastError` and its `attempts` counter bumped. `attempts` is a
   * diagnostic counter, never a retry limit — the poller and the BFF both retry
   * indefinitely by design, and a case that must stop retrying is closed by
   * publishing it with a reason (a todo-service 403, say).
   *
   * Every write is owner-scoped, so an id belonging to someone else is silently
   * ignored rather than reported: whether that row exists is not this caller's
   * business. Nothing but these three fields is writable through this route.
   */
  @Post('published')
  async recordOutcomes(
    @Principal() principal: Principal,
    @Body() dto: OutboxOutcomesDto,
  ): Promise<{ updated: number }> {
    return { updated: await this.outbox.recordOutcomes(principal.sub, dto.records) };
  }

  /**
   * Ask todo-service for this service's origin on the caller's behalf, forwarding the
   * caller's own bearer token rather than minting a service credential.
   *
   * The grant is keyed to the client that token names — `app` for the BFF — and that
   * is the correct grantee, because the BFF is what holds that token when intents are
   * later delivered. A token with no `client_id` is refused by todo-service (403).
   *
   * A refusal here is **not** degraded: the user asked for the integration and it
   * cannot work without the grant, so the failure surfaces (502) instead of leaving a
   * switch that reports on and produces nothing.
   */
  private async grantOwnOrigin(authorization: string | undefined): Promise<void> {
    const response = await fetch(`${this.todosBaseUrl()}${ORIGIN_GRANT_PATH}`, {
      method: 'POST',
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ originService: MEAL_ORIGIN_SERVICE }),
    });
    if (!response.ok) {
      this.logger.warn(`origin grant refused: ${response.status}`);
      throw new BadGatewayException(`todo-service refused the origin grant: ${response.status}`);
    }
  }

  /**
   * The todo-service base URL this service calls. `MEAL_TODOS_API_URL` is the same
   * knob the outbox's delivery sender reads, so one variable points this service at
   * one todo-service; the loopback default matches the dev stack's port.
   */
  private todosBaseUrl(): string {
    return process.env[TODOS_API_URL_ENV] ?? 'http://127.0.0.1:3005';
  }
}

/** The client's day from the query, or a 400 naming the expected shape. */
function requireDay(date: string | undefined): string {
  if (date === undefined || !DATE_ONLY.test(date)) {
    throw new BadRequestException('date is required as YYYY-MM-DD');
  }
  return date;
}
