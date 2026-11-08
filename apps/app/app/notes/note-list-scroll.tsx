'use client';

import { useState } from 'react';
import type { Note, NotePage } from '@life/shared';
import { AlertBanner, LoadMore, Section } from '@life/ui';
import { NoteList } from '../note-list';

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more notes. Try again.";

/** §8's `.slabel__count` for the Recent group: the merged row count, so an append updates it. */
function noteCountLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}

/**
 * The notes index rows and the control that adds a page to them (`SPEC-load-more`).
 * Page 1 arrives server-rendered, so the screen opens on exactly the rows it always
 * did and every frozen row locator still finds its row; this holds only what more
 * pages add — the appended notes, the cursor they continue from, and the one message
 * a failure raises.
 *
 * The tag filter and the search are carried into every appended request because
 * `loadPage` closes over them on the server; a changed filter mounts a fresh shell
 * instead (`key` at the page), and that mount is the reset — a cursor taken from the
 * old result set must never continue a different filter's pages.
 */
export function NoteListScroll({
  notes: firstPage,
  nextCursor,
  tagNames,
  isFiltered,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  notes: Note[];
  /** Where page 1 ends; `null` is the whole result, and no load-more control renders. */
  nextCursor: string | null;
  /** Registry names for the row meta suffix; ids the registry dropped are absent. */
  tagNames: Record<number, string>;
  /** True when the page is narrowed, so an empty list says the filters matched nothing. */
  isFiltered: boolean;
  /** Fetch the page after `cursor` for the page's tag/query — a server action, so the token stays server-side. */
  loadPage: (cursor: string) => Promise<NotePage>;
}>) {
  const [appended, setAppended] = useState<Note[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const notes = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.notes]);
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
      <Section label="Recent" count={noteCountLabel(notes.length)}>
        <NoteList notes={notes} tagNames={tagNames} isFiltered={isFiltered} />
      </Section>
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}
