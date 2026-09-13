'use server';

import { revalidatePath } from 'next/cache';
import { createNote, deleteNote, updateNote } from '@/lib/api';

export async function addNote(formData: FormData) {
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;
  const tags = String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  await createNote({ body, tags });
  revalidatePath('/');
}

export async function editNote(formData: FormData) {
  const id = String(formData.get('id'));
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;
  const tags = String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  await updateNote(id, { body, tags });
  revalidatePath('/');
}

export async function removeNote(formData: FormData) {
  await deleteNote(String(formData.get('id')));
  revalidatePath('/');
}
