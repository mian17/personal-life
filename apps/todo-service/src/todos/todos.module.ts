import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '../keys/keys.module';
import { TodoCacheModule } from '../cache/todo-cache.module';
import { ListsModule } from '../lists/lists.module';
import { Todo } from './todo.entity';
import { TodoTag } from './todo-tag.entity';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

/**
 * The todo domain module. `ListsModule` supplies `ListsService` so
 * `TodosService` can validate a `listId` against the caller's lists before a
 * write (a foreign id must be a byte-identical 404, not a raw FK failure).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Todo, TodoTag]), KeysModule, TodoCacheModule, ListsModule],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
