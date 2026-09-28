import { notFound } from 'next/navigation';
import type { Note } from '@life/shared';
import { ApiError, getNote } from '@/lib/api';
import { listTags } from '@/lib/tags-api';
import { NoteEditor } from '../../note-editor';

export const dynamic = 'force-dynamic';

async function loadNote(id: string): Promise<Note> {
  try {
    return await getNote(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [note, tags] = await Promise.all([loadNote(id), listTags()]);

  return (
    <NoteEditor
      note={note}
      availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
    />
  );
}
