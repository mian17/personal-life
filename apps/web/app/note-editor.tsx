import type { Note } from '@life/shared';
import { editNote } from './actions';

export function NoteEditor({ note }: { note: Note }) {
  return (
    <details className="editor">
      <summary>Edit</summary>
      <form action={editNote}>
        <input type="hidden" name="id" value={note.id} />
        <textarea name="body" defaultValue={note.body} rows={4} required />
        <input
          name="tags"
          defaultValue={note.tags.map((t) => t.name).join(', ')}
          placeholder="tags, comma separated"
        />
        <button type="submit">Save changes</button>
      </form>
    </details>
  );
}
