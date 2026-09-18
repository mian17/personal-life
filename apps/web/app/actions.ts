'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteNote,
  deleteNotePermanently,
  emptyTrash,
  restoreNote,
} from '@/lib/api';

export async function deleteNoteAction(id: string) {
  await deleteNote(id);
  revalidatePath('/');
  revalidatePath('/trash');
}

export async function restoreNoteAction(id: string) {
  await restoreNote(id);
  revalidatePath('/');
  revalidatePath('/trash');
}

export async function deleteForeverAction(id: string) {
  await deleteNotePermanently(id);
  revalidatePath('/trash');
  revalidatePath('/');
}

export async function emptyTrashAction() {
  await emptyTrash();
  revalidatePath('/trash');
  revalidatePath('/');
}
