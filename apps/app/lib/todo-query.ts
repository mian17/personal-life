import type { Todo, TodoCompletion } from '@life/shared';
import { dueDateState, type DueDateState } from '@life/ui';

/**
 * `/todos` query helpers. The service applies every filter (tag/list/status/q) server-side, so a
 * caller only has to decide whether it needs one page or the whole filtered set.
 *
 * Two callers, two answers: `/todos` takes page 1 (`listTodos`) and pages the rest by cursor in
 * its client shell, because the row list is the part that scrolls; `/todos/matrix` draws a grid
 * whose quadrants are only truthful over the full set, so it counts as `collectTodos`'s caller —
 * the walk below is that view's, not the index's.
 */

/** A page fetcher bound to the current filters (cursor in, page out). */
export type TodoPageFetcher = (
  cursor?: string,
) => Promise<{ todos: Todo[]; nextCursor: string | null }>;

/** A page fetcher for the completion log (cursor in, page out). */
export type CompletionPageFetcher = (
  cursor?: string,
) => Promise<{ completions: TodoCompletion[]; nextCursor: string | null }>;

/**
 * Follow the todo cursor until exhausted (or `maxItems`, a safety bound for a pathological
 * owner) — the whole-set read `/todos/matrix` needs. The service's stable order is preserved
 * across pages.
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

/**
 * Follow the completion-log cursor until exhausted (or `maxItems`). The service returns
 * newest-first globally, so the collected order is newest-first too.
 *
 * The caller is `/todos/page.tsx`, and its walk is load-bearing: `groupTodos` pairs a completion
 * with the live todo it belongs to, so a repeating todo ticked long ago sits far down this log.
 * Page it and that todo would read OPEN until later pages arrived, flipping to DONE mid-scroll.
 * The walk therefore feeds a non-rendering lookup whose correctness is its completeness — never
 * a list, and never a figure that could be approximated from the rows on screen.
 */
export async function collectTodoCompletions(
  fetchPage: CompletionPageFetcher,
  maxItems = 1000,
): Promise<TodoCompletion[]> {
  const collected: TodoCompletion[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    collected.push(...page.completions);
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
