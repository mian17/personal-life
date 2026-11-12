import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache.js';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Entry } from './entry.entity.js';
import { EntriesController } from './entries.controller.js';
import { EntriesCache } from './entries-cache.js';
import { EntriesService } from './entries.service.js';
import { OutboxModule } from '../outbox/outbox.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Entry]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    // A logged entry owes todo-service a tick; the producer lives with the
    // outbox it writes to, so this module imports it rather than the reverse.
    OutboxModule,
  ],
  controllers: [EntriesController],
  // Exported so the batch controller in `AppModule` can reach the same service
  // instance, whose write path the batch runs per item.
  exports: [EntriesService],
  providers: [
    // Composition, not a second client: the service's ONE adapter is provided
    // once per module that consumes it (Task 7's `MEAL_CACHE` token/factory),
    // so an entries write bumps the same single generation every other read key
    // embeds — foods, entries, targets, saved meals all share `meal:gen:<sub>`
    // (lessons 0011, 0016).
    {
      provide: MEAL_CACHE,
      useFactory: () => createMealCache(process.env.REDIS_URL),
    },
    EntriesCache,
    EntriesService,
  ],
})
export class EntriesModule {}
