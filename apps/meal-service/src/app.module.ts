import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Entry } from './entries/entry.entity.js';
import { EntriesModule } from './entries/entries.module.js';
import { Food } from './foods/food.entity.js';
import { FoodsModule } from './foods/foods.module.js';
import { Serving } from './foods/serving.entity.js';
import {
  AuditEntry,
  AuditModule,
  HealthModule,
  KeysModule,
  Outbox,
  UserKeys,
} from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config.js';
import { PhotoModule } from './photo/photo.module.js';
import { SavedMeal } from './saved-meals/saved-meal.entity.js';
import { SavedMealItem } from './saved-meals/saved-meal-item.entity.js';
import { SavedMealsModule } from './saved-meals/saved-meals.module.js';
import { MealBatchController } from './batch/meal-batch.controller.js';
import { MealTodoModule } from './meal-todo/meal-todo.module.js';
import { MealTodoToggle } from './meal-todo/meal-toggle.entity.js';
import { Target } from './targets/target.entity.js';
import { TargetModule } from './targets/target.module.js';
import { MealTodoController } from './meal-todo.controller.js';

/**
 * How long a writer waits for a locked SQLite file before giving up. The outbox
 * poller and the business writer share this one file, so the wait has to be
 * generous enough to cover a sweep's short immediate transaction (`db-primaries.md` §2).
 */
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [
        UserKeys,
        Target,
        Food,
        Serving,
        Entry,
        SavedMeal,
        SavedMealItem,
        AuditEntry,
        Outbox,
        MealTodoToggle,
      ],
      synchronize: true,
      // A busy file must make a writer wait, not fail: the outbox poller marks
      // rows on the same file the request path writes (`db-primaries.md` §2).
      prepareDatabase: (db: { pragma: (sql: string) => unknown }): void => {
        db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      },
    }),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    TargetModule,
    FoodsModule,
    EntriesModule,
    SavedMealsModule,
    PhotoModule,
    AuditModule.forRoot(),
    MealTodoModule,
  ],
  // All eight batch routes live on one prefix-less controller (`SPEC-meal-service`
  // §5), registered here so their literal paths resolve ahead of every imported
  // resource module's parameter route. The todo-integration switch rides here for
  // the same reason: it is a route this module owns, not a resource of its own.
  controllers: [MealBatchController, MealTodoController],
})
export class AppModule {}
