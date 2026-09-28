import 'server-only';
import type {
  CreateNoteInput,
  Note,
  NotePage,
  TagUsage,
  UpdateNoteInput,
} from '@life/shared';
import { callService } from './client';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

export { ApiError } from './client';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(API_URL, path, init);
}

/**
 * `GET /api/notes` — filter by registry tag id (TagRef) and/or a content query.
 */
export function listNotes(tagId?: number, q?: string): Promise<NotePage> {
  const params = new URLSearchParams();
  if (tagId !== undefined) params.set('tagId', String(tagId));
  if (q) params.set('q', q);
  const qs = params.toString();
  return call<NotePage>(`/api/notes${qs ? `?${qs}` : ''}`);
}

export function getNote(id: string): Promise<Note> {
  return call<Note>(`/api/notes/${id}`);
}

/**
 * `GET /api/tags` on note-service — the owner's tag usage surface
 * (`[{tagId, count}]`, `SPEC-tags-extraction`). Ids + counts only; names are
 * resolved through `tags-service` (`lib/tags-api.ts`, MAP M4).
 */
export function listNoteTagUsage(): Promise<TagUsage[]> {
  return call<TagUsage[]>('/api/tags');
}

export function createNote(input: CreateNoteInput): Promise<Note> {
  return call<Note>('/api/notes', { method: 'POST', body: JSON.stringify(input) });
}

export function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return call<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteNote(id: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' });
}

export function listTrash(): Promise<NotePage> {
  return call<NotePage>('/api/notes/trash');
}

export function restoreNote(id: string): Promise<Note> {
  return call<Note>(`/api/notes/${id}/restore`, { method: 'POST' });
}

export function deleteNotePermanently(id: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/notes/${id}/permanent`, { method: 'DELETE' });
}

export function emptyTrash(): Promise<{ ok: boolean; count: number }> {
  return call<{ ok: boolean; count: number }>('/api/notes/trash', { method: 'DELETE' });
}
