import { Trash2 } from 'lucide-react';
import type { Note } from '@life/shared';
import { Button, EmptyState, List, ListItem, LocalTime } from '@life/ui';
import { deleteNoteAction } from './actions';
import { splitBody } from './note-title';

export function NoteList({ notes }: Readonly<{ notes: Note[] }>) {
  if (notes.length === 0) {
    return <EmptyState heading="No notes yet." body="Tap + to write your first note." />;
  }
  return (
    <List>
      {notes.map((note) => {
        const { title, snippet } = splitBody(note.body);
        return (
          <ListItem
            key={note.id}
            href={`/notes/${note.id}`}
            title={title}
            meta={<LocalTime dateTime={note.createdAt} />}
            snippet={snippet || undefined}
            deleteAction={
              <form action={deleteNoteAction.bind(null, note.id)}>
                <Button
                  type="submit"
                  variant="danger"
                  size="icon"
                  className="note-delete"
                  aria-label={`Delete ${title}`}
                >
                  <Trash2 size={18} aria-hidden />
                </Button>
              </form>
            }
          />
        );
      })}
    </List>
  );
}
