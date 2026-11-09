import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache.js';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { SavedMeal } from './saved-meal.entity.js';
import { SavedMealItem } from './saved-meal-item.entity.js';
import { SavedMealsController } from './saved-meals.controller.js';
import { SavedMealsCache } from './saved-meals-cache.js';
import { SavedMealsService } from './saved-meals.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedMeal, SavedMealItem]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
  controllers: [SavedMealsController],
  // Exported so the batch controller in `AppModule` can reach the same service
  // instance, whose write path the batch runs per item.
  exports: [SavedMealsService],
  providers: [
    // Composition, not a second client: the service's ONE adapter is provided
    // once per module that consumes it (Task 7's `MEAL_CACHE` token/factory),
    // so a saved-meal write bumps the same single generation every other read
    // key embeds (lessons 0011, 0016).
    {
      provide: MEAL_CACHE,
      useFactory: () => createMealCache(process.env.REDIS_URL),
    },
    SavedMealsCache,
    SavedMealsService,
  ],
})
export class SavedMealsModule {}
