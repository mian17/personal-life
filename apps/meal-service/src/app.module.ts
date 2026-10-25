import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Entry } from './entries/entry.entity';
import { EntriesModule } from './entries/entries.module';
import { Food } from './foods/food.entity';
import { FoodsModule } from './foods/foods.module';
import { Serving } from './foods/serving.entity';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';
import { PhotoModule } from './photo/photo.module';
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
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    TargetModule,
    FoodsModule,
    EntriesModule,
    SavedMealsModule,
    PhotoModule,
  ],
})
export class AppModule {}