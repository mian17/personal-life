import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { List } from './lists/list.entity';
import { ListsModule } from './lists/lists.module';
import { TodosModule } from './todos/todos.module';
import { Todo } from './todos/todo.entity';
import { TodoTag } from './todos/todo-tag.entity';
import { UserKeys } from './keys/user-keys.entity';
import { KeysModule } from './keys/keys.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      // `DB_PATH` is read inline; scripts resolve their own vars via
      // `@life/shared`'s `resolveDbPath` (note-service's split).
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'todo.db'),
      entities: [Todo, TodoTag, List, UserKeys],
      synchronize: true,
    }),
    TodosModule,
    ListsModule,
    KeysModule,
    HealthModule,
  ],
})
export class AppModule {}
