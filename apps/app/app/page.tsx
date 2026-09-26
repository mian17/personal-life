import { listNotes, listTags } from '@/lib/api';
import { NoteList } from './note-list';
import { SearchBox } from './search-box';
import { FabLink, IconLink, NavBar, PageShell, PageTitle, TagFilterNav, ThemeToggle } from '@life/ui';
import { Plus, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function filterHref(q?: string, tag?: string): string {
  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { tag, q } = await searchParams;
  const [{ notes }, tags] = await Promise.all([listNotes(tag, q), listTags()]);

  const filterItems = [
    ...(tag ? [{ name: 'All', href: filterHref(q), active: false }] : []),
    ...tags.map((t) => ({ name: t.name, href: filterHref(q, t.name), active: tag === t.name })),
  ];

  return (
    <PageShell>
      <NavBar
        trailing={
          <>
            <IconLink href="/trash" label="Trash">
              <Trash2 size={20} aria-hidden />
            </IconLink>
            <ThemeToggle />
          </>
        }
      />

      <PageTitle>Notes</PageTitle>

      <SearchBox q={q} tag={tag} />

      {tags.length > 0 && <TagFilterNav items={filterItems} />}

      <NoteList notes={notes} />

      <FabLink href="/notes/new" label="New note">
        <Plus size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </PageShell>
  );
}
