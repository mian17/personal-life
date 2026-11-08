import { listTodos, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { collectTodoCompletions } from '@/lib/todo-query';
import type { TodoPage } from '@life/shared';
import { Tab, TabBar } from '@life/ui';
import { readPref } from '@/lib/preferences';
import { getToday } from '@/lib/today';
import { TodosNav } from '../todos-nav';
import { TodosScroll } from './todos-scroll';

export const dynamic = 'force-dynamic';

/**
 * The `/todos` screen: it frames and names the view and reads page 1, never more. The rows, the
 * header count and the load-more control belong to `TodosScroll`, the one client island here,
 * because appending a page and re-counting it both happen after first paint.
 *
 * `collectTodos` keeps its one caller — `/todos/matrix`, which reads the whole set to draw its
 * grid — so it stays in `lib/todo-query.ts`; this render path no longer walks the todo cursor.
 */
export default async function TodosPage() {
  const [lists, registry, day] = await Promise.all([listLists(), listTags(), getToday()]);
  // Two reads of the todo set on purpose, for two different jobs. `listTodos` takes page 1 —
  // the only part that pages. The completion log is walked WHOLE by `collectTodoCompletions`
  // (`lib/todo-query.ts`), and that walk is load-bearing: `groupTodos` pairs a completion with
  // the live todo it belongs to, so a repeating todo ticked long ago sits far down the log. Page
  // the log and that todo would read OPEN until later pages arrived, flipping to DONE as the
  // user scrolls. The walk feeds a non-rendering lookup, never a list, so its completeness is
  // the correctness condition — not an optimisation to defer.
  const [page, completions] = await Promise.all([
    listTodos(),
    collectTodoCompletions((cursor) => listTodoCompletions({ cursor })),
  ]);
  const availableTags = registry.map((t) => ({ id: t.id, name: t.name }));
  const matrixEnabled = await readPref('matrix');

  /**
   * The page after `cursor`, todos as the service returned them. A server action, so the
   * owner's token never leaves the server; the completion lookup is not re-read here because
   * it is already complete and the browser holds it for the whole scroll.
   */
  async function loadPage(cursor: string): Promise<TodoPage> {
    'use server';
    return listTodos({ cursor });
  }

  return (
    <TodosScroll
      todos={page.todos}
      nextCursor={page.nextCursor}
      total={page.total}
      completions={completions}
      today={day}
      lists={lists}
      availableTags={availableTags}
      navTrailing={<TodosNav />}
      tabs={
        matrixEnabled ? (
          <TabBar aria-label="Todos views">
            <Tab href="/todos" active>
              Today
            </Tab>
            <Tab href="/todos/matrix">Matrix</Tab>
          </TabBar>
        ) : undefined
      }
      loadPage={loadPage}
    />
  );
}
