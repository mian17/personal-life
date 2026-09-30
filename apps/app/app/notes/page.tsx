import { listNoteTagUsage, listNotes } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { NoteList } from '../note-list';
import { SearchBox } from '../search-box';
import { FabLink, IconLink, NavBar, PageShell, PageTitle, TagFilterNav, ThemeToggle } from '@life/ui';
import { ListTodo, Plus, Tags, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Build a `/notes` href preserving the current search query. */
function filterHref(q: string | undefined, tagId: number | undefined): string {
  const params = new URLSearchParams();
  if (tagId !== undefined) params.set('tag', String(tagId));
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/notes?${qs}` : '/notes';
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { tag, q } = await searchParams;
  const tagId = tag !== undefined && /^\d+$/.test(tag) ? Number(tag) : undefined;
  const [{ notes }, usage] = await Promise.all([listNotes(tagId, q), listNoteTagUsage()]);
  // Usage ids resolve to names through the registry; ids the registry no longer
  // returns are detached and never rendered (kernel detach semantics).
  const namedTags = await resolveTagUsage(usage);

  const filterItems = [
    ...(tagId !== undefined
      ? [{ name: 'All', href: filterHref(q, undefined), active: false }]
      : []),
    ...namedTags.map((t) => ({
      name: t.name,
      href: filterHref(q, t.tagId),
      active: tagId === t.tagId,
    })),
  ];

  return (
    <PageShell>
      <NavBar
        trailing={
          <>
            <IconLink href="/todos" label="Todos">
              <ListTodo size={20} aria-hidden />
            </IconLink>
            <IconLink href="/notes/tags" label="Manage tags">
              <Tags size={20} aria-hidden />
            </IconLink>
            <IconLink href="/notes/trash" label="Trash">
              <Trash2 size={20} aria-hidden />
            </IconLink>
            <ThemeToggle />
          </>
        }
      />

      <PageTitle>Notes</PageTitle>

      <SearchBox q={q} tag={tag} />

      {namedTags.length > 0 && <TagFilterNav label="Tags" items={filterItems} />}

      <NoteList notes={notes} />

      <FabLink href="/notes/new" label="New note">
        <Plus size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </PageShell>
  );
}
