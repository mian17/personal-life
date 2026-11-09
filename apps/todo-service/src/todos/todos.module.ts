import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { TodoCacheModule } from '../cache/todo-cache.module.js';
import { ListsModule } from '../lists/lists.module.js';
import { TodoBatchController } from '../batch/todo-batch.controller.js';
import { Todo } from './todo.entity.js';
import { TodoTag } from './todo-tag.entity.js';
import { TodoCompletion } from './todo-completion.entity.js';
import { TodosController } from './todos.controller.js';
import { TodosService } from './todos.service.js';

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
  // The batch controller is listed first on purpose: its routes are literal
  // (`/api/todos:batchCreate`), and registration order is what keeps a parameter
  // route from claiming a path that only looks parameterised.
  controllers: [TodoBatchController, TodosController],
  providers: [TodosService],
  // Exported so the reminders sweep can inject the `markReminded` clear seam.
  exports: [TodosService],
})
export class TodosModule {}
