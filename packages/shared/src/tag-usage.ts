import type { TagUsage } from './index';

/**
 * The `<domain>:tags` caches hold **metadata only** (ids + counts, no names). A hit
 * is valid when every row carries numeric `tagId`/`count` fields.
 */
export function isTagUsageRow(row: TagUsage): boolean {
  return (
    typeof row?.tagId === 'number' &&
    Number.isInteger(row.tagId) &&
    typeof row?.count === 'number' &&
    Number.isInteger(row.count) &&
    row.count >= 0
  );
}

/** Rehydrate a cached tag-usage payload, or throw when the shape is wrong. */
export function decodeTagUsage(raw: unknown): TagUsage[] {
  if (!Array.isArray(raw) || !raw.every(isTagUsageRow)) {
    throw new Error('cache entry is not tag usage');
  }
  return raw.map((row) => ({ tagId: row.tagId, count: row.count }));
}

/**
 * Deduplicate the `tagIds` a write carries, preserving first-seen order. The
 * result is the association set stored for the entity (TagRef semantics,
 * `SPEC-service-kernel`): each content service stores exactly the ids it is
 * given — no registry validation, no name resolution (names live in
 * `tags-service`).
 */
export function normalizeTagIds(tagIds: number[] | undefined): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of tagIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a - b);
}
