import 'server-only';
import { withQuery } from '@life/app-kit';
import { callService } from './client';

const TAGS_API_URL = process.env.TAGS_API_URL ?? 'http://127.0.0.1:3004';

/** The registry DTO (`SPEC-tags-service` API): `version` is the OCC counter. */
export interface RegistryTag {
  id: number;
  name: string;
  version: number;
  createdAt: string;
}

/** A resolved `{id, name}` pair (`POST /api/tags/resolve`). */
export interface ResolvedTag {
  id: number;
  name: string;
}

/**
 * One page of the registry vocabulary (`GET /api/tags`, `SPEC-pagination-seam` §4).
 * `RegistryTag` is service-local, so the page type is mirrored here too.
 */
export interface RegistryTagPage {
  tags: RegistryTag[];
  nextCursor: string | null;
}

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(TAGS_API_URL, path, init);
}

/**
 * `GET /api/tags?q=&limit=&cursor=` — one page of the owner's vocabulary,
 * name-sorted, narrowed by an optional name substring.
 *
 * `q` is filtered by the service **after** the cache hit, so it never enters the
 * cache key: one cached entry serves every search variant (Contract 2 Rule 3).
 */
export function fetchTagPage(
  opts: { q?: string; limit?: number; cursor?: string } = {},
): Promise<RegistryTagPage> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  return call<RegistryTagPage>(withQuery('/api/tags', params));
}

/**
 * The owner's **whole** vocabulary, walked page by page (`collectTodos`'s pattern).
 *
 * Every caller needs the complete set: the tag picker offers every tag, the
 * manager panel renames and deletes from the full vocabulary, and the note
 * composer resolves inline `#tag` names against it. One page would silently hide
 * tags past the boundary, so this walk is the only correct read for a screen.
 * `maxItems` is a safety bound, not an expected size.
 */
export async function listTags(maxItems = 1000): Promise<RegistryTag[]> {
  const collected: RegistryTag[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchTagPage({ cursor });
    collected.push(...page.tags);
    if (collected.length >= maxItems || !page.nextCursor) return collected.slice(0, maxItems);
    cursor = page.nextCursor;
  }
}

/**
 * `POST /api/tags {name}` — create-or-get, case-insensitive. The **only** way a
 * tag comes into existence; the note composer's inline `#tag` names flow through
 * here before the note write carries their ids (`SPEC-tags-extraction`).
 */
export function createOrGetTag(name: string): Promise<RegistryTag> {
  return call<RegistryTag>('/api/tags', { method: 'POST', body: JSON.stringify({ name }) });
}

/** `PATCH /api/tags/:id {name, expectedVersion?}` — ecosystem-wide rename. */
export function renameTag(id: number, name: string, expectedVersion?: number): Promise<RegistryTag> {
  return call<RegistryTag>(`/api/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }),
  });
}

/** `DELETE /api/tags/:id` — delete the vocabulary row; consumers detach. */
export function deleteTag(id: number): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/tags/${id}`, { method: 'DELETE' });
}

/**
 * `POST /api/tags/resolve {ids}` — `[{id, name}]` for the caller's own tags;
 * unknown/foreign ids are **omitted** (the kernel's detach signal — the BFF
 * excludes them from rendering *and* from subsequent writes).
 */
export function resolveTags(ids: number[]): Promise<ResolvedTag[]> {
  return call<ResolvedTag[]>('/api/tags/resolve', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
