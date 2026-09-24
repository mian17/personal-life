import { notFound } from 'next/navigation';
import type { Note } from '@life/shared';
import { ApiError, getNote } from '@/lib/api';
import { NoteEditor } from '../../note-editor';

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
  const note = await loadNote(id);

  return <NoteEditor note={note} />;
}
