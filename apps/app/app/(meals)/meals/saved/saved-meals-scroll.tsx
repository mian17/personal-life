'use client';

import { useState } from 'react';
import { AlertBanner, Button, EmptyState, List, ListItem, LoadMore, Section } from '@life/ui';
import { Trash2 } from 'lucide-react';
import { deleteSavedMealAction } from './actions';

/**
 * One saved-meal row as the server sends it: the link, the name, and the calorie figure
 * already formatted from the **stored** item vectors. `@life/nutrition` stays out of the
 * client bundle, so an appended page is formatted on the server too and crosses as a
 * plain string (the `CatalogRow` precedent).
 */
export interface SavedMealRow {
  id: string;
  name: string;
  /** The summed stored calories, formatted by the server. */
  meta: string;
}

/** One page of rows plus the cursor that continues it. */
export interface SavedMealRowsPage {
  rows: SavedMealRow[];
  nextCursor: string | null;
}

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more saved meals. Try again.";

/**
 * The body for the rows in hand: an empty state, or the list. It is a plain function, not
 * a component, so it holds no state — the island owns the cursor and hands the merged rows
 * down, and an appended row renders through the very same branch page 1 does.
 */
export function savedMealsBody(rows: SavedMealRow[]) {
  if (rows.length === 0) {
    return (
      <EmptyState body="No saved meals yet. Correct a meal and save it to re-log it in one tap." />
    );
  }

  return (
    <List>
      {rows.map((row) => (
        <ListItem
          key={row.id}
          href={`/meals/saved/${row.id}`}
          title={row.name}
          meta={row.meta}
          deleteAction={
            <form action={deleteSavedMealAction.bind(null, row.id)}>
              <Button type="submit" variant="danger" size="icon" aria-label={`Delete ${row.name}`}>
                <Trash2 size={18} aria-hidden />
              </Button>
            </form>
          }
        />
      ))}
    </List>
  );
}

/**
 * The saved-meals rows and the control that adds a page to them (`SPEC-load-more`).
 * Page 1 arrives server-rendered, so the screen opens on exactly the rows it always
 * did; this holds only what more pages add — the appended rows, the cursor they
 * continue from, and the one message a failure raises.
 */
export function SavedMealsScroll({
  rows: firstPage,
  nextCursor: firstCursor,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  rows: SavedMealRow[];
  /** Where page 1 ends; `null` is the whole history, and no load-more control renders. */
  nextCursor: string | null;
  /** Fetch the page after `cursor`, rows formatted before they cross — a server action. */
  loadPage: (cursor: string) => Promise<SavedMealRowsPage>;
}>) {
  const [appended, setAppended] = useState<SavedMealRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.rows]);
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
      {savedMealsBody(rows)}
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}
