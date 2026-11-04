import { ChevronRight } from 'lucide-react';
import type { Note } from '@life/shared';
import { EmptyState, formatNoteMeta, List, ListItem } from '@life/ui';
import { splitBody } from './note-title';

/**
 * The suffix a row shows after its time: the name of the note's first tag the registry still
 * resolves. Ids the registry no longer returns are detached, so a row whose tags all detached
 * (or that carries none) gets no suffix rather than a dangling id.
 */
function firstTagName(note: Note, tagNames: Record<number, string>): string | undefined {
  return note.tagIds.map((tagId) => tagNames[tagId]).find((name) => name != null);
}

export function NoteList({
  notes,
  tagNames,
}: Readonly<{ notes: Note[]; tagNames: Record<number, string> }>) {
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
            meta={formatNoteMeta(note.createdAt, firstTagName(note, tagNames))}
            snippet={snippet || undefined}
            trailing={<ChevronRight size={18} aria-hidden className="text-ink-3" />}
          />
        );
      })}
    </List>
  );
}
