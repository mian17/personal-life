import Link from 'next/link';
import type { Note } from '@life/shared';
import { removeNote } from './actions';
import { NoteEditor } from './note-editor';
import { LocalTime } from './local-time';

export function NoteList({ notes, activeTag }: { notes: Note[]; activeTag?: string }) {
  if (notes.length === 0) {
    return <p className="empty">No notes yet.</p>;
  }
  return (
    <ul className="notes">
      {notes.map((note) => (
        <li key={note.id} className="note">
          <p className="body">{note.body}</p>
          <div className="meta">
            {note.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/?tag=${encodeURIComponent(tag.name)}`}
                className={`chip${activeTag === tag.name ? ' active' : ''}`}
              >
                {tag.name}
              </Link>
            ))}
            <LocalTime iso={note.createdAt} />
            <form action={removeNote}>
              <input type="hidden" name="id" value={note.id} />
              <button type="submit" className="danger">
                Delete
              </button>
            </form>
          </div>
          <NoteEditor note={note} />
        </li>
      ))}
    </ul>
  );
}
