import Link from 'next/link';
import type { Note } from '@life/shared';
import { deleteNoteAction } from './actions';
import { LocalTime } from './local-time';

function splitBody(body: string): { title: string; snippet: string } {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  const newline = normalized.indexOf('\n');
  if (newline === -1) {
    return { title: normalized, snippet: '' };
  }
  return {
    title: normalized.slice(0, newline).trim(),
    snippet: normalized.slice(newline + 1).trim(),
  };
}

export function NoteList({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return (
      <div className="empty">
        <p>No notes yet.</p>
        <p>Tap + to write your first note.</p>
      </div>
    );
  }
  return (
    <ul className="notes">
      {notes.map((note) => {
        const { title, snippet } = splitBody(note.body);
        return (
          <li key={note.id} className="note">
            <Link href={`/notes/${note.id}`} className="note-link">
              <span className="note-text">
                <span className="note-title">{title}</span>
                <span className="note-sub">
                  <LocalTime iso={note.createdAt} />
                  {snippet && (
                    <>
                      <span className="note-sep">|</span>
                      <span className="note-snippet">{snippet}</span>
                    </>
                  )}
                </span>
              </span>
            </Link>
            <form action={deleteNoteAction.bind(null, note.id)}>
              <button type="submit" className="note-delete" aria-label={`Delete ${title}`}>
                ×
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
