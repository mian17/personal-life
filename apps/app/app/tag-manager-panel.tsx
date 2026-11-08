'use client';

import type { TagOption } from '@life/ui';
import { AlertBanner, Card, EmptyState, LoadMore, Section, TagManager } from '@life/ui';import { useState } from 'react';
import { createTagAction, deleteTagAction, renameTagAction } from './actions';

/** One page of manager rows plus the cursor that continues it. */
export interface TagRowsPage {
  tags: TagOption[];
  nextCursor: string | null;
}

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more tags. Try again.";

/**
 * The registry management surface, used from `/notes` and `/todos`. Every
 * mutation goes through the shared server actions, so a rename or delete here is
 * the single vocabulary and shows up in the other app immediately.
 *
 * Page 1 arrives server-rendered; this island holds only what more pages add —
 * the appended tags, the cursor they continue from, and the one message a failure
 * raises. Every row carries its own id into the rename/delete action, so acting on
 * a row of a filtered, partially-loaded page needs no view of the whole set.
 */
export function TagManagerPanel({
  tags: firstPage,
  nextCursor: firstCursor,
  isFiltered,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  tags: TagOption[];
  /** Where page 1 ends; `null` is the whole vocabulary, and no load-more control renders. */
  nextCursor: string | null;
  /** True when the search narrowed the vocabulary, so no rows says the filter matched nothing. */
  isFiltered: boolean;
  /** Fetch the page after `cursor` for the active filter — a server action. */
  loadPage: (cursor: string) => Promise<TagRowsPage>;
}>) {
  const [appended, setAppended] = useState<TagOption[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const tags = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.tags]);
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
      {isFiltered && tags.length === 0 && (
        <EmptyState heading="No matches." body="No tag name contains that text." />
      )}
      <Card>
        <TagManager
          tags={tags}
          onCreate={(name) => void createTagAction(name)}
          onRename={(id, name) => void renameTagAction(id, name)}
          onDelete={(id) => void deleteTagAction(id)}
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
