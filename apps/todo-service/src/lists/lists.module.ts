import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { TodoCacheModule } from '../cache/todo-cache.module.js';
import { List } from './list.entity.js';
import { ListsController } from './lists.controller.js';
import { ListsService } from './lists.service.js';

/**
 * The todo-local list module (`SPEC-todo-service` API). Exports `ListsService`
 * for `TodosModule` (listId validation on todo writes) and shares the one
 * `TODO_CACHE` instance via `TodoCacheModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([List]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    TodoCacheModule,
  ],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
