/**
 * The one cursor-paging seam (`SPEC-pagination-seam` §3–§5). Every list endpoint
 * pages through this module, so the mechanics — opaque cursor codec, limit
 * clamp, slice, `hasMore`/`nextCursor` assembly — exist once instead of once per
 * service (Contract 2's no-fork rule, the reason `@life/cache` was extracted).
 *
 * What stays per service is the *order*: the stable sort key and its strictly-
 * after test. No shared comparator can express the todo order (`~`-undated
 * first, then date buckets) without tricks cleverer than the code it replaces,
 * so `paginate` takes those two functions from each caller.
 *
 * This module decrypts nothing and sorts nothing. Services hand it rows already
 * decoded, filtered and ordered (Contract 2 Rule 2: plaintext lives in the
 * request path, and the cache stores whole ciphertext row sets).
 *
 * ponytail: `hasMore` is a length check, which is correct only because the whole
 * row set is already in memory after a cache hit. A service that pages in SQL
 * instead must over-fetch `limit + 1` rows and keep the same `Page<T>` contract;
 * this in-memory slice is the ceiling for the current goal.
 */
import { BadRequestException } from '@nestjs/common';

/** The page size a request gets when it names none (`limit ?? DEFAULT_PAGE_LIMIT`). */
export const DEFAULT_PAGE_LIMIT = 50;

/** The largest page any list endpoint will serve; every query DTO caps here. */
export const MAX_PAGE_LIMIT = 200;

/** One page of an ordered list plus the cursor that continues it. */
export interface Page<T> {
  rows: T[];
  /** The key of the page's last row, or `null` when this page ends the list. */
  nextCursor: string | null;
  /**
   * How many rows the whole ordered, filtered set holds — the set this page was
   * sliced from, never the page's own length. A screen renders "loaded of
   * total", so the number has to describe the list, not the window.
   */
  total: number;
}

/**
 * Seal a row's stable sort key — id last, so unique — into the opaque cursor a
 * client passes back untouched. Opaque by contract: clients never parse it, and
 * only `decodeCursor` here knows the wire format.
 *
 * The payload is the key array as JSON, so each part is quoted: a key part may
 * hold any character (the `|` a tag name carries, for one) and may be empty,
 * and the key's width survives the round trip. A joined-string format cannot say
 * that — any separator it picks is a character some key could contain.
 */
export function encodeCursor(key: readonly string[]): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

/**
 * Open a cursor `encodeCursor` produced: canonical base64 over a non-empty JSON
 * array of string key parts. Anything else is a `400` — a cursor is either
 * something this seam issued or a client bug, and guessing at a mis-decoded key
 * would page from an arbitrary position instead of saying so.
 *
 * Part *content* is never inspected: an empty part and a part holding `|` are
 * ordinary keys, because the JSON envelope already says where each part ends.
 */
export function decodeCursor(cursor: string): string[] {
  const bytes = Buffer.from(cursor, 'base64');
  // Re-encoding catches non-base64 input: Node decodes junk to bytes and back to
  // a *different* base64 string, so round-trip equality is the format test.
  if (bytes.toString('base64') !== cursor) throw notOurCursor();
  return parseKeyPayload(bytes.toString());
}

/**
 * The payload half of `decodeCursor`: a JSON key array of at least one string.
 * A cursor minted by a different list decodes fine here — its width is the
 * caller's `after` test to judge, not this codec's.
 */
function parseKeyPayload(payload: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw notOurCursor();
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isString)) {
    throw notOurCursor();
  }
  return parsed;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function notOurCursor(): BadRequestException {
  return new BadRequestException('cursor is not a page cursor this service issued');
}

/**
 * Page an already-ordered, already-decoded list. `keyOf` must return a key that
 * is unique per row (id last) and `after` must be that same order's
 * strictly-after test; together they guarantee a page boundary neither repeats
 * nor skips a row, even when the row the cursor names has since been deleted —
 * the boundary is the key, not the row.
 *
 * An absent or empty cursor means the first page; `limit` is clamped into
 * `[1, MAX_PAGE_LIMIT]` so no caller can widen a page past the cap.
 *
 * A cursor minted by a *different* list decodes fine but carries the wrong key
 * width for this one's `after`, which then rejects every row — an empty page,
 * exactly what a crossed cursor did before the seam existed. Catching that
 * would mean the seam inspecting per-service key shapes, which is the order
 * half it deliberately does not own.
 */
export function paginate<T>(
  ordered: T[],
  opts: {
    limit: number;
    cursor?: string;
    keyOf: (row: T) => readonly string[];
    after: (row: T, at: string[]) => boolean;
  },
): Page<T> {
  const limit = clampLimit(opts.limit);
  // Empty string means "no cursor", matching what both converted services did
  // before the seam existed (a `?cursor=` with no value is the first page).
  const at = opts.cursor ? decodeCursor(opts.cursor) : null;

  const rest = at === null ? ordered : ordered.filter((row) => opts.after(row, at));
  const hasMore = rest.length > limit;
  const rows = hasMore ? rest.slice(0, limit) : rest;
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: hasMore && last !== undefined ? encodeCursor(opts.keyOf(last)) : null,
    // The count of the ordered set the caller handed in, so it matches the rows
    // exactly — a second count query could disagree with them.
    total: ordered.length,
  };
}

/**
 * A limit coming off a query string is an untrusted number: clamp it into the
 * cap rather than slice by it. A non-finite value falls back to the default
 * instead of silently matching every row (`length > NaN` is always false).
 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT);
}
