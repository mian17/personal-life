'use client';

import { useState } from 'react';
import { AlertBanner, EmptyState, List, ListItem, LoadMore, Section } from '@life/ui';

/**
 * One catalog row as the server sends it: the link, the name, and the per-100 facts
 * already formatted. `@life/nutrition` stays out of the client bundle (plan Task 14), so
 * an appended page is formatted on the server too and crosses as plain strings.
 */
export interface CatalogRow {
  id: string;
  name: string;
  /** `per 100 <unit> · <calories>`, built by the server. */
  meta: string;
}

/** One page of rows plus the cursor that continues it. */
export interface CatalogPage {
  rows: CatalogRow[];
  nextCursor: string | null;
}

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more foods. Try again.";

/**
 * The catalog's rows and the control that adds a page to them (`SPEC-load-more`).
 * Page 1 arrives server-rendered, so the screen opens on exactly the rows it always
 * did; this holds only what more pages add — the appended rows, the cursor they
 * continue from, and the one message a failure raises.
 *
 * `q` is carried into every appended request: a page of the *unfiltered* catalog under
 * a search would append rows the search excludes. A changed `q` mounts a fresh shell
 * instead (`key={q ?? ''}` at the page), and that mount is the reset — a cursor taken
 * from the old result set must never continue a different query's pages.
 */
export function FoodCatalog({
  rows: firstPage,
  nextCursor: firstCursor,
  query,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  rows: CatalogRow[];
  /** Where page 1 ends; `null` is the whole result, and no load-more control renders. */
  nextCursor: string | null;
  /** The active `q`, sent with every appended page. */
  query?: string;
  /** Fetch the page after `cursor` for `query` — a server action, so the token stays server-side. */
  loadPage: (query: string | undefined, cursor: string) => Promise<CatalogPage>;
}>) {
  const [appended, setAppended] = useState<CatalogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(query, cursor);
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
      {rows.length === 0 ? (
        <FoodListEmpty query={query} />
      ) : (
        <List>
          {rows.map((row) => (
            <ListItem
              key={row.id}
              href={`/meals/foods/${row.id}`}
              title={row.name}
              meta={row.meta}
            />
          ))}
        </List>
      )}
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}

/** An empty search says so; an empty catalog invites the first food. */
function FoodListEmpty({ query }: Readonly<{ query?: string }>) {
  if (query) return <EmptyState heading="No matches." body="No food name contains that text." />;

  return <EmptyState heading="No foods yet." body="Foods you add are saved here to log in one tap." />;
}
