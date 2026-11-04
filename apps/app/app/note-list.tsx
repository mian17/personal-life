import { ChevronRight } from 'lucide-react';
import type { Note } from '@life/shared';
import { EmptyState, formatNoteMeta, List, ListItem } from '@life/ui';
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
            meta={formatNoteMeta(note.createdAt)}
            snippet={snippet || undefined}
            trailing={<ChevronRight size={18} aria-hidden className="text-ink-3" />}
          />
        );
      })}
    </List>
  );
}
