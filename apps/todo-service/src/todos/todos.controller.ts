import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { TagUsage } from '@life/shared';
import { Principal } from '../auth/principal';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { ListTodosQuery } from './dto/list-todos.query';
import { TodosService } from './todos.service';

/**
 * The todo HTTP surface (`SPEC-todo-service` API).
 *
 * Route declaration order matters: the literal `tags`/`trash` routes are
 * declared **before** any `:id` route so Nest does not shadow them (the
 * `GET`/`DELETE /api/todos/trash` verbs must not be read as an id), and the
 * `:id` suffix verbs (`restore`/`permanent`) before the plain `@Delete(':id')`.
 */
@Controller('api/todos')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateTodoDto) {
    return this.todos.create(principal.sub, dto);
  }

  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListTodosQuery) {
    return this.todos.findAll(principal.sub, query);
  }

  // Literal route declared before the `:id` route.
  @Get('tags')
  listTags(@Principal() principal: Principal): Promise<TagUsage[]> {
    return this.todos.listTagUsage(principal.sub);
  }

  // Literal routes declared before the `:id` route; only limit/cursor are read.
  @Get('trash')
  findTrash(@Principal() principal: Principal, @Query() query: ListTodosQuery) {
    return this.todos.findTrash(principal.sub, { limit: query.limit, cursor: query.cursor });
  }

  @Delete('trash')
  async emptyTrash(@Principal() principal: Principal) {
    return { ok: true, ...(await this.todos.emptyTrash(principal.sub)) };
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.todos.findOne(principal.sub, id);
  }

  @Patch(':id')
  update(@Principal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateTodoDto) {
    return this.todos.update(principal.sub, id, dto);
  }

  @Post(':id/restore')
  restore(@Principal() principal: Principal, @Param('id') id: string) {
    return this.todos.restore(principal.sub, id);
  }

  @Delete(':id/permanent')
  async removePermanent(@Principal() principal: Principal, @Param('id') id: string) {
    await this.todos.removePermanent(principal.sub, id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.todos.remove(principal.sub, id);
    return { ok: true };
  }
}
