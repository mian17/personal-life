import { LocalTime, TrashBlock } from '@life/ui';
import { listTrash } from '@/lib/api';
import { splitBody } from '../../note-title';
import { deleteForeverAction, emptyTrashAction, restoreNoteAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const { notes } = await listTrash();

  return (
    <TrashBlock
      title="Trash"
      backHref="/notes/settings"
      items={notes.map((note) => {
        const { title, snippet } = splitBody(note.body);
        return {
          id: note.id,
          title,
          meta: note.deletedAt ? <LocalTime dateTime={note.deletedAt} /> : undefined,
          snippet: snippet || undefined,
        };
      })}
      emptyMessage="Trash is empty."
      restoreAction={(id) => restoreNoteAction.bind(null, id)}
      deleteForeverAction={(id) => deleteForeverAction.bind(null, id)}
      deleteForeverMessage={() => 'Delete this note forever? This cannot be undone.'}
      emptyTrashAction={emptyTrashAction}
      emptyTrashMessage="Permanently delete all notes in trash? This cannot be undone."
    />
  );
}
