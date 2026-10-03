import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache';
import { KeysModule } from '../keys/keys.module';
import { Food } from './food.entity';
import { Serving } from './serving.entity';
import { FoodsController } from './foods.controller';
import { FoodsCache } from './foods-cache';
import { FoodsService } from './foods.service';

@Module({
  imports: [TypeOrmModule.forFeature([Food, Serving]), KeysModule],
  controllers: [FoodsController],
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
