import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { listTrash } from '@/lib/api';
import { LocalTime } from '../local-time';
import { splitBody } from '../note-title';
import { ConfirmSubmit } from '../confirm-submit';
import { deleteForeverAction, emptyTrashAction, restoreNoteAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const { notes } = await listTrash();

  return (
    <main>
      <div className="nav-bar">
        <Link href="/" className="header-icon" aria-label="Back">
          <ArrowLeft size={20} aria-hidden />
        </Link>
      </div>

      <h1 className="page-title">Trash</h1>

      {notes.length === 0 ? (
        <div className="empty">
          <p>Trash is empty.</p>
        </div>
      ) : (
        <>
          <ul className="notes">
            {notes.map((note) => {
              const { title, snippet } = splitBody(note.body);
              return (
                <li key={note.id} className="note">
                  <span className="note-link">
                    <span className="note-text">
                      <span className="note-title">{title}</span>
                      <span className="note-sub">
                        {note.deletedAt && <LocalTime iso={note.deletedAt} />}
                        {snippet && (
                          <>
                            <span className="note-sep">|</span>
                            <span className="note-snippet">{snippet}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                  <form action={restoreNoteAction.bind(null, note.id)}>
                    <button
                      type="submit"
                      className="trash-restore"
                      aria-label={`Restore ${title}`}
                    >
                      Restore
                    </button>
                  </form>
                  <form action={deleteForeverAction.bind(null, note.id)}>
                    <ConfirmSubmit
                      className="trash-delete"
                      message="Delete this note forever? This cannot be undone."
                    >
                      <Trash2 size={18} aria-hidden />
                    </ConfirmSubmit>
                  </form>
                </li>
              );
            })}
          </ul>
          <div className="trash-actions">
            <form action={emptyTrashAction}>
              <ConfirmSubmit
                className="trash-empty"
                message="Permanently delete all notes in trash? This cannot be undone."
              >
                Empty Trash
              </ConfirmSubmit>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
