'use server';

import { revalidatePath } from 'next/cache';
import { deleteNote } from '@/lib/api';

export async function deleteNoteAction(id: string) {
  await deleteNote(id);
  revalidatePath('/');
}
