import type { Todo } from '@life/shared';
import { dueDateState, type DueDateState } from '@life/ui';

/**
 * `/todos` query helpers. The service applies every filter (tag/list/status/q)
 * server-side; the app only needs the full filtered set so the four due-date
 * buckets are complete, hence a small cursor walk.
 */

/** A page fetcher bound to the current filters (cursor in, page out). */
export type TodoPageFetcher = (
  cursor?: string,
) => Promise<{ todos: Todo[]; nextCursor: string | null }>;

/**
 * Follow the service cursor until exhausted (or `maxItems`, a safety bound for a
 * pathological owner). The service's stable order is preserved across pages.
 */
export async function collectTodos(
  fetchPage: TodoPageFetcher,
  maxItems = 1000,
): Promise<Todo[]> {
  const collected: Todo[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    collected.push(...page.todos);
    if (collected.length >= maxItems || !page.nextCursor) {
      return collected.slice(0, maxItems);
    }
    cursor = page.nextCursor;
  }
}

/** The `DueDatePill` state for a todo (grouping + display share one derivation). */
export function dueStateOf(todo: Todo, today: string): DueDateState {
  return dueDateState(todo.dueDate, today);
}
