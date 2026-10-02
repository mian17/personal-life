import type { Todo, TodoCompletion } from '@life/shared';
import { dueDateState } from '@life/ui';

/**
 * The `/todos` grouping semantics (`SPEC-todo-ui`): Overdue / Today / Done. A
 * done todo lands in Done regardless of due date; open todos bucket by the
 * `DueDatePill` state derivation but only `overdue` and `today` are shown —
 * `later` and undated todos stay hidden until they come due. Service order
 * within a group is preserved (the todo-service already returns due-ascending
 * with undated last), so grouping never re-sorts.
 *
 * A repeating todo's latest logged completion is a done occurrence with no
 * `Todo` row of its own (the live row advanced and stayed open). Done therefore
 * carries a derived `Todo` for it — the live row spread with `done: true` and
 * the satisfied `occurrence` as its due date — so every Done row renders through
 * the same `TodoItem` / `ListItem variant="todo"` (one row type, muted + struck),
 * never a bespoke completion component.
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
  // completion log has an entry. It is rendered as a done row — the live todo
  // spread with `done: true` and the satisfied `occurrence` as its due date — so
  // Done is one row type (`TodoItem`). A done one-off already has its own struck
  // row, so its completion is skipped; a completion whose todo is not in this
  // fetch (deleted/filtered) is skipped too. One row per todo — the log is
  // newest-first globally, so the first match is the latest occurrence.
  const liveById = new Map(todos.map((todo) => [todo.id, todo]));
  const seen = new Set<string>();
  const doneOccurrences: Todo[] = [];
  for (const completion of completions) {
    const live = liveById.get(completion.todoId);
    if (!live || live.done || seen.has(completion.todoId)) continue;
    seen.add(completion.todoId);
    doneOccurrences.push({ ...live, done: true, dueDate: completion.occurrence });
  }

  return TODO_GROUPS.map(({ key, label }) =>
    key === 'done'
      ? { key, label, todos: [...doneOccurrences, ...buckets.done] }
      : { key, label, todos: buckets[key] },
  );
}
