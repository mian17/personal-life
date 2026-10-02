import type { Todo, TodoCompletion } from '@life/shared';
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
  /** Done only: the latest logged completion per repeating todo (plain rows). */
  completions?: TodoCompletion[];
}

export function groupTodos(
  todos: readonly Todo[],
  today: string,
  completions: readonly TodoCompletion[] = [],
): TodoGroup[] {
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

  // The completed occurrence of a repeating todo: a live (open) todo whose
  // completion log has an entry. A done one-off is already shown as a struck
  // `TodoItem`, so its completion is skipped; a completion whose todo is not in
  // this fetch (deleted/filtered) is skipped too. One entry per todo — the log
  // is newest-first globally, so the first match is the latest occurrence.
  const doneIds = new Set(buckets.done.map((todo) => todo.id));
  const activeIds = new Set(todos.map((todo) => todo.id));
  const seen = new Set<string>();
  const doneCompletions: TodoCompletion[] = [];
  for (const completion of completions) {
    const { todoId } = completion;
    if (doneIds.has(todoId) || !activeIds.has(todoId) || seen.has(todoId)) continue;
    seen.add(todoId);
    doneCompletions.push(completion);
  }

  return TODO_GROUPS.map(({ key, label }) =>
    key === 'done'
      ? { key, label, todos: buckets.done, completions: doneCompletions }
      : { key, label, todos: buckets[key] },
  );
}
