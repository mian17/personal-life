import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TargetModule } from '../targets/target.module.js';
import { MealTodoProducerService } from './producer/meal-todo-producer.service.js';
import { MealTodoToggle } from './producer/meal-toggle.entity.js';
import { createHttpDelivery, OUTBOX_DELIVERY } from './outbox-delivery.js';
import { OutboxPollerService } from './outbox-poller.service.js';
import { Outbox } from './outbox.entity.js';
import { OutboxService } from './outbox.service.js';

/**
 * The outbox wiring (`SPEC-meal-service`): the writer (`OutboxService`), the
 * relay (`OutboxPollerService`), and the producer that decides what this
 * service owes (`MealTodoProducerService`) over one table in this service's own
 * database. The delivery token is composed from the environment here — a test
 * overrides it with a fake, so no suite ever reaches the network.
 *
 * `TargetModule` is imported for `TargetService` (the producer reads the day's
 * calorie target through it) and not for its cache: `MEAL_CACHE` stays
 * unexported, so this service still has exactly one adapter instance per module
 * that composes it and never a second client.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Outbox, MealTodoToggle]), TargetModule],
  providers: [
    OutboxService,
    { provide: OUTBOX_DELIVERY, useFactory: () => createHttpDelivery() },
    OutboxPollerService,
    MealTodoProducerService,
  ],
  exports: [OutboxService, OutboxPollerService, MealTodoProducerService],
})
export class OutboxModule {}
