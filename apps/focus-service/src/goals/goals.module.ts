import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FOCUS_CACHE, createFocusCache } from '../cache/focus-cache.js';
import { Goal } from './goal.entity.js';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Goal])],
  controllers: [GoalsController],
  providers: [
    // Selection happens once at module init: no `REDIS_URL` keeps the direct-DB
    // path, a URL wires the service's single read-through adapter. `KeysModule` is
    // deliberately absent — goal rows are numbers and dates, so nothing is sealed
    // (`## Cache Rules` deviation).
    {
      provide: FOCUS_CACHE,
      useFactory: () => createFocusCache(process.env.REDIS_URL),
    },
    GoalsService,
  ],
})
export class GoalsModule {}
