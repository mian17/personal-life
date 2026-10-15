import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MEAL_CACHE, createMealCache } from '../cache/meal-cache';
import { KeysModule } from '../keys/keys.module';
import { SavedMeal } from './saved-meal.entity';
import { SavedMealItem } from './saved-meal-item.entity';
import { SavedMealsController } from './saved-meals.controller';
import { SavedMealsCache } from './saved-meals-cache';
import { SavedMealsService } from './saved-meals.service';

@Module({
  imports: [TypeOrmModule.forFeature([SavedMeal, SavedMealItem]), KeysModule],
  controllers: [SavedMealsController],
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
