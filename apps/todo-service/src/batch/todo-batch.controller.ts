import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import {
  BatchCreateListsDto,
  BatchCreateTodosDto,
  BatchDeleteTodosDto,
  BatchUpdateListsDto,
  BatchUpdateTodosDto,
} from './dto/batch-todos.dto.js';
import { TodosService } from '../todos/todos.service.js';
import { ListsService } from '../lists/lists.service.js';

/**
 * The `todos` and `lists` batch routes (`SPEC-todo-service.md` §5).
 *
 * Prefix-less controller with full, colon-escaped method paths. Nest joins the
 * controller and method paths with a slash, so `@Post(':batchCreate')` on a
 * prefixed controller could only ever register the parameter route
 * `/api/todos/:batchCreate` — never the literal AIP URI. There is no
 * `:batchDelete` for `lists`: the intent excludes it (§8).
 */
@Controller()
export class TodoBatchController {
  constructor(
    private readonly todos: TodosService,
    private readonly lists: ListsService,
  ) {}

  @Post(String.raw`api/todos\:batchCreate`)
  @HttpCode(201)
  createTodos(@Principal() principal: Principal, @Body() dto: BatchCreateTodosDto) {
    return this.todos.createMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/todos\:batchUpdate`)
  @HttpCode(200)
  updateTodos(@Principal() principal: Principal, @Body() dto: BatchUpdateTodosDto) {
    return this.todos.updateMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/todos\:batchDelete`)
  @HttpCode(200)
  deleteTodos(@Principal() principal: Principal, @Body() dto: BatchDeleteTodosDto) {
    return this.todos.removeMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/lists\:batchCreate`)
  @HttpCode(201)
  createLists(@Principal() principal: Principal, @Body() dto: BatchCreateListsDto) {
    return this.lists.createMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/lists\:batchUpdate`)
  @HttpCode(200)
  updateLists(@Principal() principal: Principal, @Body() dto: BatchUpdateListsDto) {
    return this.lists.updateMany(principal.sub, dto.items);
  }
}
