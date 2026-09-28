import 'server-only';
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

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(TAGS_API_URL, path, init);
}

/** `GET /api/tags` — the owner's whole vocabulary, name-sorted. */
export function listTags(): Promise<RegistryTag[]> {
  return call<RegistryTag[]>('/api/tags');
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
