'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { List, Todo, TodoCompletion, TodoPage } from '@life/shared';
import { AlertBanner, ListShell, LoadMore, Section, type TagOption } from '@life/ui';
import { Plus } from 'lucide-react';
import { groupTodos, type TodoGroup } from '@/lib/todo-groups';
import { TodoList } from '../todo-list';

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more todos. Try again.";

/**
 * §8's `.phead__sub` for `/todos`, over the rows in hand plus the envelope's `total`: how many
 * of the list's todos have loaded, then how those loaded rows split between still-open and done.
 * `total` counts todos, so it can only be the denominator of the loaded figure — pairing it with
 * `open` would put two axes (todos, open rows) inside one number. Both row counts are group
 * lengths of the very `groups` this screen renders, so the line can never disagree with the list,
 * and it grows as pages append. Counts stay literal (no pluralisation), like the reference's
 * "3 open · 2 done".
 */
export function describeTodosHeader(groups: TodoGroup[], loaded: number, total: number): string {
  const openCount = groups
    .filter((group) => group.key !== 'done')
    .reduce((count, group) => count + group.todos.length, 0);
  const doneCount = groups.find((group) => group.key === 'done')?.todos.length ?? 0;
  return `${loaded} of ${total} todos · ${openCount} open · ${doneCount} done`;
}

/**
 * The `/todos` screen and the control that adds a page to its rows (`SPEC-load-more`). Page 1
 * arrives server-rendered, so the screen opens on exactly the rows it always did; this holds
 * only what more pages add — the appended todos, the cursor they continue from, and the one
 * message a failure raises.
 *
 * The header lives here because its count reads the loaded rows: only a value this island
 * re-derives on append can grow with them. The chrome (title, nav, tabs, fab) is still the
 * page's, handed down as slots.
 *
 * The completion log crosses complete (never paged) and is re-bucketed through `groupTodos` over
 * the merged rows on every render, so a repeating todo's done-or-open state is a function of the
 * todo itself — the same on page 1 as on page 4 — instead of depending on how far the list has
 * been scrolled. Bucket order and every empty state stay `TodoList`'s.
 */
export function TodosScroll({
  todos: firstPage,
  nextCursor: firstCursor,
  total,
  completions,
  today,
  lists,
  availableTags,
  navTrailing,
  tabs,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  todos: Todo[];
  /** Where page 1 ends; `null` is the whole list, and no load-more control renders. */
  nextCursor: string | null;
  /** How many todos the whole filtered list holds — never this page's length. */
  total: number;
  /** The owner's whole completion log, walked on the server; `groupTodos` reads it as a lookup. */
  completions: TodoCompletion[];
  /** The app's current day, for the due-date buckets. */
  today: string;
  /** The list vocabulary every row's list name resolves through. */
  lists: List[];
  /** The tag registry options, for a row's tag chips. */
  availableTags: TagOption[];
  /** The page's toolbar controls, built on the server. */
  navTrailing: ReactNode;
  /** The view tabs, or nothing when the matrix opt-in is off. */
  tabs: ReactNode;
  /** Fetch the page after `cursor` — a server action, so the token stays server-side. */
  loadPage: (cursor: string) => Promise<TodoPage>;
}>) {
  const [appended, setAppended] = useState<Todo[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const todos = [...firstPage, ...appended];
  const groups = groupTodos(todos, today, completions);

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.todos]);
      setCursor(page.nextCursor);
      setFailure(null);
    } catch {
      // The rows on screen are still valid; only the next page failed. `LoadMore`
      // re-arms itself and this line says why nothing was added.
      setFailure(LOAD_FAILURE);
    }
  }

  return (
    <ListShell
      title="Today"
      subtitle={describeTodosHeader(groups, todos.length, total)}
      navTrailing={navTrailing}
      tabs={tabs}
      body={
        <>
          {failure != null && <AlertBanner>{failure}</AlertBanner>}
          <TodoList
            groups={groups}
            today={today}
            lists={lists}
            availableTags={availableTags}
          />
          {cursor !== null && (
            <Section>
              <LoadMore onLoadMore={loadNextPage} />
            </Section>
          )}
        </>
      }
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
