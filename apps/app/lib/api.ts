import 'server-only';
import type { CreateNoteInput, Note, NotePage, Tag, UpdateNoteInput } from '@life/shared';
import { requireSession } from './auth/require-session';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The BFF authenticates to `note-service` with the caller's IdP access token
 * (Task 10 — JWT-only). The token comes from the server-side session, refreshed
 * when near expiry; a refresh failure means "re-login" (the session is destroyed
 * and `requireSession` redirects to `/auth/login`). The browser never sees it.
 *
 * `requireSession` is the single choke point: every data call from a page, action,
 * or route handler degrades to a login redirect when there is no session, rather
 * than throwing an error page.
 */
async function authHeaders(): Promise<HeadersInit> {
  const session = await requireSession();
  return { Authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `API ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

export function listNotes(tag?: string, q?: string): Promise<NotePage> {
  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  const qs = params.toString();
  return call<NotePage>(`/api/notes${qs ? `?${qs}` : ''}`);
}

export function getNote(id: string): Promise<Note> {
  return call<Note>(`/api/notes/${id}`);
}

export function listTags(): Promise<Tag[]> {
  return call<Tag[]>('/api/tags');
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
