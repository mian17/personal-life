import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Todo } from './todo.entity';

/**
 * Association-only join row for the todo domain (`SPEC-todo-service` Data
 * model): a todo stores **only** the integer `tagId`s a write carried
 * (`TagRef`, `SPEC-service-kernel`) — no tag names (M1). `todoId` keeps its
 * `ON DELETE CASCADE` FK to `todo` (deleting a todo removes its associations);
 * `tagId` is a plain integer with **no FK** — the referenced vocabulary is
 * external (`tags-service`), so dangling ids are dropped by the next write
 * (kernel detach semantics, no registry validation, no prune pass).
 */
@Entity('todo_tag')
export class TodoTag {
  @PrimaryColumn({ type: 'varchar' })
  todoId: string;

  @PrimaryColumn({ type: 'integer' })
  tagId: number;

  @ManyToOne(() => Todo, (todo) => todo.todoTags, {
    onDelete: 'CASCADE',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'todoId' })
  todo: Todo;
}
