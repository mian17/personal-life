'use client';

import type { List, ListPage } from '@life/shared';
import {
  AlertBanner,
  Card,
  EmptyState,
  ListManager,
  LoadMore,
  Section,
  SettingsRow,
  Switch,
  type TodoListOption,
} from '@life/ui';
import { useRef, useState } from 'react';
import { createListAction, deleteListAction, renameListAction } from './todo-actions';
import { TOGGLE_DEBOUNCE_MS, useDebouncedCallback } from '@/lib/use-debounced-callback';

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more lists. Try again.";

/**
 * Per-list "Important by default" switch: flips optimistically, then persists the
 * settled value once (rapid toggles coalesce; a toggle back to the server value
 * sends nothing).
 */
export function ImportantDefaultSwitch({
  id,
  name,
  importantDefault,
  version,
}: Readonly<{
  id: string;
  name: string;
  importantDefault: boolean | null;
  version?: number;
}>) {
  const [on, setOn] = useState(importantDefault ?? false);
  const persisted = useRef(importantDefault ?? false);
  const debouncedFlush = useDebouncedCallback(TOGGLE_DEBOUNCE_MS);

  return (
    <Switch
      label="Default important"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        debouncedFlush(() => {
          if (next === persisted.current) return;
          persisted.current = next;
          void renameListAction(id, name, next, version);
        });
      }}
    />
  );
}

/**
 * The extra settings row a managed list carries: its "Important by default"
 * switch. Hoisted out of `ListManagerPanel` so the row is a stable component
 * identity (and the switch keeps its state across re-renders of the panel).
 */
function ListRowExtra({
  id,
  name,
  list,
}: Readonly<{ id: string; name: string; list: List | undefined }>) {
  return (
    <SettingsRow
      label="Important by default"
      control={
        <ImportantDefaultSwitch
          id={id}
          name={name}
          importantDefault={list?.importantDefault ?? null}
          version={list?.version}
        />
      }
    />
  );
}

/**
 * Builds the `rowExtra` renderer once per panel render. It lives at module
 * scope, not inline in `ListManagerPanel`, so the JSX-returning arrow is not a
 * component definition nested inside a component (Sonar `S6478`) and the row
 * keeps a stable identity.
 */
function rowExtraFor(lists: List[]) {
  return (option: TodoListOption) => (
    <ListRowExtra
      id={option.id}
      name={option.name}
      list={lists.find((candidate) => candidate.id === option.id)}
    />
  );
}

/**
 * The todo-local list management surface (`ListManager` upstream primitive),
 * wired to todo-service through the shared server actions.
 *
 * Page 1 arrives server-rendered, so the screen opens on exactly the rows it
 * always did; this island holds only what more pages add — the appended lists,
 * the cursor they continue from, and the one message a failure raises.
 *
 * Rename and delete read from the **merged** rows, not from page 1: a row past
 * the first page is still a row the reader can act on, and its
 * `importantDefault`/`version` only exist in the page that delivered it. Nothing
 * here counts "remaining rows" or looks a row up by index, so a filtered,
 * partially-loaded list needs no guard.
 */
export function ListManagerPanel({
  lists: firstPage,
  nextCursor: firstCursor,
  isFiltered,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  lists: List[];
  /** Where page 1 ends; `null` is the whole set, and no load-more control renders. */
  nextCursor: string | null;
  /** True when the search narrowed the list, so no rows says the filter matched nothing. */
  isFiltered: boolean;
  /** Fetch the page after `cursor` for the active filter — a server action, so `q` stays the page's. */
  loadPage: (cursor: string) => Promise<ListPage>;
}>) {
  const [appended, setAppended] = useState<List[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const lists = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.lists]);
      setCursor(page.nextCursor);
      setFailure(null);
    } catch {
      // The rows on screen are still valid; only the next page failed. `LoadMore`
      // re-arms itself and this line says why nothing was added.
      setFailure(LOAD_FAILURE);
    }
  }

  return (
    <>
      {failure != null && <AlertBanner>{failure}</AlertBanner>}
      {isFiltered && lists.length === 0 && (
        <EmptyState heading="No matches." body="No list name contains that text." />
      )}
      <Card>
        <ListManager
          lists={lists.map((list) => ({ id: list.id, name: list.name }))}
          onCreate={(name) => void createListAction(name)}
          onRename={(id, name) => {
            const list = lists.find((candidate) => candidate.id === id);
            void renameListAction(id, name, list?.importantDefault ?? false, list?.version);
          }}
          onDelete={(id) => void deleteListAction(id)}
          rowExtra={rowExtraFor(lists)}
        />
      </Card>
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}
