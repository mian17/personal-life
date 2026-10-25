import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config';
import { TodoCacheModule } from '../cache/todo-cache.module';
import { ListsModule } from '../lists/lists.module';
import { Todo } from './todo.entity';
import { TodoTag } from './todo-tag.entity';
import { TodoCompletion } from './todo-completion.entity';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

/**
 * The todo domain module. `ListsModule` supplies `ListsService` so
 * `TodosService` can validate a `listId` against the caller's lists before a
 * write (a foreign id must be a byte-identical 404, not a raw FK failure).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Todo, TodoTag, TodoCompletion]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    TodoCacheModule,
    ListsModule,
  ],
  controllers: [TodosController],
  providers: [TodosService],
  // Exported so the reminders sweep can inject the `markReminded` clear seam.
  exports: [TodosService],
})
export class TodosModule {}
