import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { List } from './lists/list.entity';
import { ListsModule } from './lists/lists.module';
import { TodosModule } from './todos/todos.module';
import { Todo } from './todos/todo.entity';
import { TodoTag } from './todos/todo-tag.entity';
import { TodoCompletion } from './todos/todo-completion.entity';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';
import { PushSubscription } from './push/push-subscription.entity';
import { PushModule } from './push/push.module';
import { RemindersModule } from './reminders/reminders.module';

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
