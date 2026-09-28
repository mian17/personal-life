'use server';

import { revalidatePath } from 'next/cache';
import { deleteNote, deleteNotePermanently, emptyTrash, restoreNote } from '@/lib/api';
import { createOrGetTag, deleteTag, renameTag } from '@/lib/tags-api';

function revalidateNotes() {
  revalidatePath('/notes');
  revalidatePath('/trash');
}

export async function deleteNoteAction(id: string) {
  await deleteNote(id);
  revalidateNotes();
}

export async function restoreNoteAction(id: string) {
  await restoreNote(id);
  revalidateNotes();
}

export async function deleteForeverAction(id: string) {
  await deleteNotePermanently(id);
  revalidateNotes();
}

export async function emptyTrashAction() {
  await emptyTrash();
  revalidateNotes();
}

/**
 * Tag registry actions (used by `TagManager` from both `/notes` and `/todos`).
 * The registry is the single source of the vocabulary, so every mutation
 * revalidates both apps' routes — a rename/delete in one is visible in the other.
 */
const TAG_ROUTES = ['/notes', '/todos'] as const;

function revalidateTags() {
  for (const route of TAG_ROUTES) revalidatePath(route);
}

export async function createTagAction(name: string) {
  await createOrGetTag(name);
  revalidateTags();
}

export async function renameTagAction(id: number, name: string) {
  await renameTag(id, name);
  revalidateTags();
}

export async function deleteTagAction(id: number) {
  await deleteTag(id);
  revalidateTags();
}
