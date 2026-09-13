import 'server-only';
import type { CreateNoteInput, Note, NotePage, Tag, UpdateNoteInput } from '@life/shared';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

function authHeaders(): HeadersInit {
  const token = process.env.API_TOKEN;
  if (!token) throw new Error('API_TOKEN is not set');
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
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
