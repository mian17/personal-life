import type { Todo } from '@life/shared';
import { dueDateState } from '@life/ui';

/**
 * The `/todos` grouping semantics (`SPEC-todo-ui`): Overdue / Today / Done. A
 * done todo lands in Done regardless of due date; open todos bucket by the
 * `DueDatePill` state derivation but only `overdue` and `today` are shown —
 * `later` and undated todos stay hidden until they come due. Service order
 * within a group is preserved (the todo-service already returns due-ascending
 * with undated last), so grouping never re-sorts.
 */

export type TodoGroupKey = 'overdue' | 'today' | 'done';

export const TODO_GROUPS: ReadonlyArray<{ key: TodoGroupKey; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'done', label: 'Done' },
];

export interface TodoGroup {
  key: TodoGroupKey;
  label: string;
  todos: Todo[];
}

export function groupTodos(todos: readonly Todo[], today: string): TodoGroup[] {
  const buckets: Record<TodoGroupKey, Todo[]> = {
    overdue: [],
    today: [],
    done: [],
  };
  for (const todo of todos) {
    if (todo.done) {
      buckets.done.push(todo);
      continue;
    }
    const state = dueDateState(todo.dueDate, today);
    if (state === 'overdue' || state === 'today') buckets[state].push(todo);
  }
  return TODO_GROUPS.map(({ key, label }) => ({ key, label, todos: buckets[key] }));
}
