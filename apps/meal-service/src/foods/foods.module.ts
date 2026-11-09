import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache.js';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Food } from './food.entity.js';
import { Serving } from './serving.entity.js';
import { FoodsController } from './foods.controller.js';
import { FoodsCache } from './foods-cache.js';
import { FoodsService } from './foods.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Food, Serving]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
  controllers: [FoodsController],
  exports: [FoodsService],
  providers: [
    // Composition, not a second client: the service's ONE adapter is provided
    // once per module that consumes it (Task 7's `MEAL_CACHE` token/factory),
    // so a foods write bumps the same single generation every other read key
    // embeds (lessons 0011, 0016).
    {
      provide: MEAL_CACHE,
      useFactory: () => createMealCache(process.env.REDIS_URL),
    },
    FoodsCache,
    FoodsService,
  ],
})
export class FoodsModule {}
