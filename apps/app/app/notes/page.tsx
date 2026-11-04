import { listNoteTagUsage, listNotes } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { NoteList } from '../note-list';
import { filterHref, parseTagId, PreservingSearchBox, settingsHref } from '@life/app-kit';
import { formatLongDate, IconLink, ListShell, Section, TagFilterNav, todayIso } from '@life/ui';
import { Plus, SlidersHorizontal } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function NotesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tag?: string; q?: string }>;
}>) {
  const { tag, q } = await searchParams;
  const tagId = parseTagId(tag);
  const [{ notes }, usage] = await Promise.all([listNotes(tagId, q), listNoteTagUsage()]);
  // Usage ids resolve to names through the registry; ids the registry no longer
  // returns are detached and never rendered (kernel detach semantics).
  const namedTags = await resolveTagUsage(usage);
  const tagNames: Record<number, string> = Object.fromEntries(
    namedTags.map((tag) => [tag.tagId, tag.name]),
  );

  const current = { tag, q };
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

  return (
    <ListShell
      title="Notes"
      subtitle={formatLongDate(todayIso())}
      navTrailing={
        <IconLink href={settingsHref('/notes')} label="Settings" variant="bare">
          <SlidersHorizontal size={20} aria-hidden />
        </IconLink>
      }
      search={<PreservingSearchBox path="/notes" q={q} params={{ tag }} label="Search notes" />}
      filters={
        namedTags.length > 0 ? (
          <TagFilterNav aria-label="Tags" pinned={allFilter} items={tagFilters} />
        ) : undefined
      }
      body={
        <Section label="Recent" count={notes.length === 1 ? '1 note' : `${notes.length} notes`}>
          <NoteList notes={notes} tagNames={tagNames} />
        </Section>
      }
      fabHref="/notes/new"
      fabLabel="New note"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
