import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { Entry } from './entries/entry.entity';
import { EntriesModule } from './entries/entries.module';
import { Food } from './foods/food.entity';
import { FoodsModule } from './foods/foods.module';
import { Serving } from './foods/serving.entity';
import { HealthModule } from './health/health.module';
import { KeysModule } from './keys/keys.module';
import { UserKeys } from './keys/user-keys.entity';
import { SavedMeal } from './saved-meals/saved-meal.entity';
import { SavedMealItem } from './saved-meals/saved-meal-item.entity';
import { SavedMealsModule } from './saved-meals/saved-meals.module';
import { Target } from './targets/target.entity';
import { TargetModule } from './targets/target.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [UserKeys, Target, Food, Serving, Entry, SavedMeal, SavedMealItem],
      synchronize: true,
    }),
    KeysModule,
    HealthModule,
    TargetModule,
    FoodsModule,
    EntriesModule,
    SavedMealsModule,
  ],
})
export class AppModule {}