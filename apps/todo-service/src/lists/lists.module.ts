import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '../keys/keys.module';
import { TodoCacheModule } from '../cache/todo-cache.module';
import { List } from './list.entity';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';

/**
 * The todo-local list module (`SPEC-todo-service` API). Exports `ListsService`
 * for `TodosModule` (listId validation on todo writes) and shares the one
 * `TODO_CACHE` instance via `TodoCacheModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([List]), KeysModule, TodoCacheModule],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
