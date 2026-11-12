import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule, createHttpDelivery } from '@life/service-kit';
import { TargetModule } from '../targets/target.module.js';
import { MealTodoProducerService } from './meal-todo-producer.service.js';
import { MealTodoToggle } from './meal-toggle.entity.js';

/**
 * What meal-service owes todo-service (`SPEC-todo-origin` §7): the producer that
 * decides which intents an owner is owed, over the kit's shared outbox and this
 * service's own `meal_todo_toggle` consent row.
 *
 * The outbox itself is not this module's — it is `OutboxModule.forRoot()` from
 * `@life/service-kit`, which brings the writer (`OutboxService`) and the relay
 * (`OutboxPollerService`) over one `outbox` table in this service's own database.
 * The delivery token is composed from the environment here, so a service that
 * later holds a real credential swaps one factory argument and nothing else; a
 * test overrides it with a fake, so no suite ever reaches the network.
 *
 * `TargetModule` is imported for `TargetService` (the producer reads the day's
 * calorie target through it) and not for its cache: `MEAL_CACHE` stays
 * unexported, so this service still has exactly one adapter instance per module
 * that composes it and never a second client.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MealTodoToggle]),
    OutboxModule.forRoot({ delivery: createHttpDelivery() }),
    TargetModule,
  ],
  providers: [MealTodoProducerService],
  // `OutboxModule` is re-exported, not just imported: the routes that serve the
  // drain leg sit on `MealTodoController` in `AppModule`, and it injects
  // `OutboxService`. Re-exporting the module reuses this one instance — a second
  // `forRoot()` elsewhere would start a second poller on a second timer.
  exports: [MealTodoProducerService, OutboxModule],
})
export class MealTodoModule {}
