import type { Todo } from '@life/shared';
import { dueDateState, type DueDateState } from '@life/ui';

/**
 * The `/todos` grouping semantics (`SPEC-todo-ui`): Overdue / Today / Later /
 * No date, driven by `DueDatePill`'s state derivation. Service order within a
 * group is preserved (the todo-service already returns due-ascending with
 * undated last), so grouping never re-sorts.
 */

export type TodoGroupKey = DueDateState;

export const TODO_GROUPS: ReadonlyArray<{ key: TodoGroupKey; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
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
    later: [],
    none: [],
  };
  for (const todo of todos) {
    buckets[dueDateState(todo.dueDate, today)].push(todo);
  }
  return TODO_GROUPS.map(({ key, label }) => ({ key, label, todos: buckets[key] }));
}
