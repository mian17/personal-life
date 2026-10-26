import type { Todo, TodoCompletion } from '@life/shared';
import { dueDateState } from '@life/ui';

/**
 * The `/todos` grouping semantics (`SPEC-todo-ui`): Overdue / Today / Done. A
 * done todo lands in Done regardless of due date; open todos bucket by the
 * `DueDatePill` state derivation but only `overdue` and `today` are shown —
 * `later` and undated todos stay hidden until they come due. Service order
 * within Overdue/Today is preserved (the todo-service already returns
 * due-ascending with undated last), so those groups never re-sort.
 *
 * A repeating todo's latest logged completion is a done occurrence with no
 * `Todo` row of its own (the live row advanced and stayed open). Done therefore
 * carries a derived `Todo` for it — the live row spread with `done: true` and
 * the satisfied `occurrence` as its due date — so every Done row renders through
 * the same `TodoItem` / `ListItem variant="todo"` (one row type, muted + struck),
 * never a bespoke completion component.
 *
 * Done is ordered by tick time, newest first: every Done row (derived occurrence
 * and done one-off alike) sorts by its latest logged completion's `completedAt`
 * DESC, tie-broken by that completion's `id` DESC to mirror the service's
 * `completedAt DESC, id DESC` log order. A Done row with no logged completion
 * (legacy data predating the log) has no tick time; it sinks below every timed
 * row while keeping its service order among the untimed rows.
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

  // Latest completion per todo, derived by max `completedAt` (tie: completion
  // `id` DESC, mirroring the service's `completedAt DESC, id DESC`) rather than
  // trusting the log's arrival order. One row per todo: the latest tick wins.
  const latestByTodo = new Map<string, TodoCompletion>();
  for (const completion of completions) {
    const current = latestByTodo.get(completion.todoId);
    if (
      !current ||
      completion.completedAt > current.completedAt ||
      (completion.completedAt === current.completedAt && completion.id > current.id)
    ) {
      latestByTodo.set(completion.todoId, completion);
    }
  }

  // The completed occurrence of a repeating todo: a live (open) todo whose
  // completion log has an entry. It is rendered as a done row — the live todo
  // spread with `done: true` and the satisfied `occurrence` as its due date — so
  // Done is one row type (`TodoItem`). A done one-off already has its own struck
  // row, so its completion is skipped (it still orders that row below); a
  // completion whose todo is not in this fetch (deleted/filtered) is skipped.
  const liveById = new Map(todos.map((todo) => [todo.id, todo]));
  const doneOccurrences: Todo[] = [];
  for (const [todoId, completion] of latestByTodo) {
    const live = liveById.get(todoId);
    if (!live || live.done) continue;
    doneOccurrences.push({ ...live, done: true, dueDate: completion.occurrence });
  }

  // Done by tick time, newest first (derived occurrence and done one-off alike);
  // ties by completion `id` DESC. Rows without a completion (legacy data) get no
  // tick time and sink below every timed row, stable in service order.
  const done = [...doneOccurrences, ...buckets.done];
  done.sort((a, b) => {
    const ca = latestByTodo.get(a.id);
    const cb = latestByTodo.get(b.id);
    if (ca && cb) {
      if (ca.completedAt !== cb.completedAt) return ca.completedAt < cb.completedAt ? 1 : -1;
      if (ca.id === cb.id) return 0;
      return ca.id < cb.id ? 1 : -1;
    }
    if (ca) return -1;
    if (cb) return 1;
    return 0;
  });

  return TODO_GROUPS.map(({ key, label }) =>
    key === 'done' ? { key, label, todos: done } : { key, label, todos: buckets[key] },
  );
}
