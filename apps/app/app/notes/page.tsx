import { listNoteTagUsage, listNotes } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { NoteListScroll } from './note-list-scroll';
import { filterHref, navActions, parseTagId, PreservingSearchBox } from '@life/app-kit';
import { formatLongDate, ListShell, TagFilterNav, todayIso } from '@life/ui';
import type { NotePage } from '@life/shared';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function NotesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tag?: string; q?: string }>;
}>) {
  const { tag, q } = await searchParams;
  const tagId = parseTagId(tag);
  const [{ notes, nextCursor }, usage] = await Promise.all([listNotes(tagId, q), listNoteTagUsage()]);
  // Usage ids resolve to names through the registry; ids the registry no longer
  // returns are detached and never rendered (kernel detach semantics).
  const namedTags = await resolveTagUsage(usage);
  const tagNames: Record<number, string> = Object.fromEntries(
    namedTags.map((tag) => [tag.tagId, tag.name]),
  );

  const current = { tag, q };
  // Whether the page is narrowed at all decides which empty state an empty result gets.
  const narrowed = Boolean(q?.trim()) || tagId !== undefined;
  // The `All` chip is always the row's first option and is active whenever no tag filter is
  // applied, so the row always shows the unfiltered state it can return to.
  const allFilter = {
    name: 'All',
    href: filterHref({ path: '/notes', current, overrides: { tag: undefined } }),
    active: tagId === undefined,
  };
  const tagFilters = namedTags.map((t) => ({
    name: t.name,
    href: filterHref({ path: '/notes', current, overrides: { tag: String(t.tagId) } }),
    active: tagId === t.tagId,
  }));
  // The `All` chip is pinned outside the scrolling strip so it stays reachable however far the
  // tag chips scroll; only the tags themselves scroll under it.

  /**
   * The page after `cursor` for this page's tag and query. A server action, so the browser asks
   * for notes and the owner's token never leaves the server.
   */
  async function loadPage(cursor: string): Promise<NotePage> {
    'use server';
    return listNotes(tagId, q, cursor);
  }

  return (
    <ListShell
      title="Notes"
      subtitle={formatLongDate(todayIso())}
      navTrailing={navActions('notes')}
      search={<PreservingSearchBox path="/notes" q={q} params={{ tag }} label="Search notes" />}
      filters={
        namedTags.length > 0 ? (
          <TagFilterNav aria-label="Tags" pinned={allFilter} items={tagFilters} />
        ) : undefined
      }
      body={
        // A changed tag or query mounts a fresh shell: the old cursor belongs to the old result
        // set, so it must never continue this one's pages.
        <NoteListScroll
          key={`${tagId ?? ''}|${q ?? ''}`}
          notes={notes}
          nextCursor={nextCursor}
          tagNames={tagNames}
          isFiltered={narrowed}
          loadPage={loadPage}
        />
      }
      fabHref="/notes/new"
      fabLabel="New note"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
