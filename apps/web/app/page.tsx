import { listNotes, listTags } from '@/lib/api';
import { NoteList } from './note-list';
import { SearchBox } from './search-box';
import { ThemeToggle } from './theme-toggle';
import Link from 'next/link';

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

  return (
    <main>
      <header>
        <h1>Notes</h1>
        <ThemeToggle />
      </header>

      <SearchBox q={q} tag={tag} />

      {tags.length > 0 && (
        <nav className="filters">
          {tag && <Link href={filterHref(q)}>All</Link>}
          {tags.map((t) => (
            <Link
              key={t.id}
              href={filterHref(q, t.name)}
              className={tag === t.name ? 'active' : ''}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      <NoteList notes={notes} />

      <Link href="/notes/new" className="add-note" aria-label="New note" />
    </main>
  );
}
