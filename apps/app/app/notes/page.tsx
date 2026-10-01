import { listNoteTagUsage, listNotes } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { NoteList } from '../note-list';
import { filterHref, parseTagId, PreservingSearchBox } from '@life/app-kit';
import { IconLink, ListShell, TagFilterNav, ThemeToggle } from '@life/ui';
import { ListTodo, Plus, Tags, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { tag, q } = await searchParams;
  const tagId = parseTagId(tag);
  const [{ notes }, usage] = await Promise.all([listNotes(tagId, q), listNoteTagUsage()]);
  // Usage ids resolve to names through the registry; ids the registry no longer
  // returns are detached and never rendered (kernel detach semantics).
  const namedTags = await resolveTagUsage(usage);

  const current = { tag, q };
  const filterItems = [
    ...(tagId !== undefined
      ? [
          {
            name: 'All',
            href: filterHref({ path: '/notes', current, overrides: { tag: undefined } }),
            active: false,
          },
        ]
      : []),
    ...namedTags.map((t) => ({
      name: t.name,
      href: filterHref({ path: '/notes', current, overrides: { tag: String(t.tagId) } }),
      active: tagId === t.tagId,
    })),
  ];

  return (
    <ListShell
      title="Notes"
      navTrailing={
        <>
          <IconLink href="/notes/tags" label="Manage tags">
            <Tags size={20} aria-hidden />
          </IconLink>
          <IconLink href="/notes/trash" label="Trash">
            <Trash2 size={20} aria-hidden />
          </IconLink>
          <ThemeToggle />
        </>
      }
      search={<PreservingSearchBox path="/notes" q={q} params={{ tag }} label="Search notes" />}
      filters={namedTags.length > 0 ? <TagFilterNav label="Tags" items={filterItems} /> : undefined}
      body={<NoteList notes={notes} />}
      fabHref="/notes/new"
      fabLabel="New note"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
