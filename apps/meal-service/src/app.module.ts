import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Entry } from './entries/entry.entity.js';
import { EntriesModule } from './entries/entries.module.js';
import { Food } from './foods/food.entity.js';
import { FoodsModule } from './foods/foods.module.js';
import { Serving } from './foods/serving.entity.js';
import { AuditEntry, AuditModule, HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config.js';
import { PhotoModule } from './photo/photo.module.js';
import { SavedMeal } from './saved-meals/saved-meal.entity.js';
import { SavedMealItem } from './saved-meals/saved-meal-item.entity.js';
import { SavedMealsModule } from './saved-meals/saved-meals.module.js';
import { MealBatchController } from './batch/meal-batch.controller.js';
import { Target } from './targets/target.entity.js';
import { TargetModule } from './targets/target.module.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [UserKeys, Target, Food, Serving, Entry, SavedMeal, SavedMealItem, AuditEntry],
      synchronize: true,
    }),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    TargetModule,
    FoodsModule,
    EntriesModule,
    SavedMealsModule,
    PhotoModule,
    AuditModule.forRoot(),
  ],
  // All eight batch routes live on one prefix-less controller (`SPEC-meal-service`
  // §5), registered here so their literal paths resolve ahead of every imported
  // resource module's parameter route.
  controllers: [MealBatchController],
})
export class AppModule {}
