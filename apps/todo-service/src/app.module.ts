import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { List } from './lists/list.entity.js';
import { ListsModule } from './lists/lists.module.js';
import { TodosModule } from './todos/todos.module.js';
import { Todo } from './todos/todo.entity.js';
import { TodoTag } from './todos/todo-tag.entity.js';
import { TodoCompletion } from './todos/todo-completion.entity.js';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config.js';
import { PushSubscription } from './push/push-subscription.entity.js';
import { PushModule } from './push/push.module.js';
import { RemindersModule } from './reminders/reminders.module.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      // `DB_PATH` is read inline; scripts resolve their own vars via
      // `@life/shared`'s `resolveDbPath` (note-service's split).
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'todo.db'),
      entities: [Todo, TodoTag, TodoCompletion, List, UserKeys, PushSubscription],
      synchronize: true,
    }),
    TodosModule,
    ListsModule,
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    PushModule,
    RemindersModule,
  ],
})
export class AppModule {}
