import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config';
import { Entry } from './entry.entity';
import { EntriesController } from './entries.controller';
import { EntriesCache } from './entries-cache';
import { EntriesService } from './entries.service';

@Module({
  imports: [TypeOrmModule.forFeature([Entry]), KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV })],
  controllers: [EntriesController],
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