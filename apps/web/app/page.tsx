import { listNotes, listTags } from '@/lib/api';
import { NoteList } from './note-list';
import { ThemeToggle } from './theme-toggle';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag } = await searchParams;
  const [{ notes }, tags] = await Promise.all([listNotes(tag), listTags()]);

  return (
    <main>
      <header>
        <h1>Notes</h1>
        <div className="header-actions">
          <ThemeToggle />
          <Link href="/notes/new" className="add-note" aria-label="New note">
            +
          </Link>
        </div>
      </header>

      {tags.length > 0 && (
        <nav className="filters">
          {tag && <Link href="/">All</Link>}
          {tags.map((t) => (
            <Link
              key={t.id}
              href={`/?tag=${encodeURIComponent(t.name)}`}
              className={tag === t.name ? 'active' : ''}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      <NoteList notes={notes} />
    </main>
  );
}
