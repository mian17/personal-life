import 'server-only';
import type {
  CreateNoteInput,
  Note,
  NotePage,
  TagUsage,
  TagUsagePage,
  UpdateNoteInput,
} from '@life/shared';
import { callService } from './client';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

export { ApiError } from './client';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(API_URL, path, init);
}

/**
 * `GET /api/notes` — filter by registry tag id (TagRef) and/or a content query, and
 * continue from `cursor`. Filters and pagination both stay out of the cache key
 * (Contract 2 Rule 3): the service filters after the hit and pages in memory, so one
 * cached entry serves every page of every filter.
 */
export function listNotes(tagId?: number, q?: string, cursor?: string): Promise<NotePage> {
  const params = new URLSearchParams();
  if (tagId !== undefined) params.set('tagId', String(tagId));
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  const query = qs ? `?${qs}` : '';
  return call<NotePage>(`/api/notes${query}`);
}

export function getNote(id: string): Promise<Note> {
  return call<Note>(`/api/notes/${id}`);
}

/**
 * `GET /api/tags?limit=&cursor=` on note-service — one page of the owner's tag
 * usage surface (`TagUsagePage`, `SPEC-tags-extraction`). Ids + counts only;
 * names are resolved through `tags-service` (`lib/tags-api.ts`, MAP M4).
 */
export function fetchNoteTagUsagePage(
  opts: { limit?: number; cursor?: string } = {},
): Promise<TagUsagePage> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return call<TagUsagePage>(`/api/tags${qs ? `?${qs}` : ''}`);
}

/**
 * The owner's **whole** tag usage surface, walked page by page.
 *
 * The filter row renders every used tag and the settings screen names every one of
 * them; a single page would hide the tags past the boundary, so the filter row
 * would silently drop a chip. Tag usage is bounded by the vocabulary, so the walk
 * is one request in practice; the loop is what keeps it correct either way.
 */
export async function listNoteTagUsage(maxItems = 1000): Promise<TagUsage[]> {
  const collected: TagUsage[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchNoteTagUsagePage({ cursor });
    collected.push(...page.tagUsages);
    if (collected.length >= maxItems || !page.nextCursor) return collected.slice(0, maxItems);
    cursor = page.nextCursor;
  }
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
