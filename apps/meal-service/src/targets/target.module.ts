import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache.js';
import { TargetController } from './target.controller.js';
import { Target } from './target.entity.js';
import { TargetService } from './target.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Target])],
  controllers: [TargetController],
  providers: [
    // Selection happens once at module init: `REDIS_URL` unset keeps the
    // direct-DB path (dev/e2e run Redis-free by design); set wires the
    // service's single namespace adapter. Reads stay DB-direct — only the
    // generation bump goes through this adapter (`SPEC-meal-service` Cache
    // Rules: invalidate on "target change").
    {
      provide: MEAL_CACHE,
      useFactory: () => createMealCache(process.env.REDIS_URL),
    },
    TargetService,
  ],
  // Exported so the todos producer can read the day's target through this one
  // service instance. `MEAL_CACHE` stays unexported: the adapter is composed by
  // each module that consumes it, never shared as a provider.
  exports: [TargetService],
})
export class TargetModule {}
