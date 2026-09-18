import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import type { Note } from '@life/shared';
import { deleteNoteAction } from './actions';
import { LocalTime } from './local-time';
import { splitBody } from './note-title';

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
                <Trash2 size={18} aria-hidden />
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
