/**
 * Parse a `tag` search param into a numeric id. Returns `undefined` when the
 * value is absent or not a non-negative integer string (`/^\d+$/`), matching the
 * guarded `Number(tag)` used by both list pages.
 */
export function parseTagId(raw: string | undefined): number | undefined {
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
}
