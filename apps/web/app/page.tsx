import { addNote } from './actions';
import { listNotes, listTags } from '@/lib/api';
import { NoteList } from './note-list';
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
      </header>

      <form action={addNote} className="capture">
        <textarea
          name="body"
          placeholder="What's on your mind?"
          rows={4}
          autoFocus
          required
        />
        <input name="tags" placeholder="tags, comma separated" enterKeyHint="done" />
        <button type="submit">Save</button>
      </form>

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

      <NoteList notes={notes} activeTag={tag} />
    </main>
  );
}
