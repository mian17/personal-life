'use server';

import { revalidatePath } from 'next/cache';
import type { Note } from '@life/shared';
import { createNote, deleteNote, updateNote } from '@/lib/api';

export async function saveNote(id: string, body: string, tags: string[]): Promise<boolean> {
  if (!body.trim()) return false;
  await updateNote(id, { body, tags });
  revalidatePath('/');
  return true;
}

export async function createNoteAction(body: string, tags: string[]): Promise<Note> {
  if (!body.trim()) throw new Error('body is required');
  const note = await createNote({ body, tags });
  revalidatePath('/');
  return note;
}

export async function deleteNoteAction(id: string) {
  await deleteNote(id);
  revalidatePath('/');
}
