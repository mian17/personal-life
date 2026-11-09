import { Inject, Injectable } from '@nestjs/common';
import { ENC_PREFIX } from '@life/crypto';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache.js';
import type { Entry } from './entry.entity.js';

/**
 * meal-service's entries read-through cache (`SPEC-meal-service` Cache Rules).
 *
 * Composition, not a second cache: keys go through the service's single
 * `MEAL_CACHE` adapter (`src/cache/meal-cache.ts`), so the final key is
 * `meal:<sub>:v<gen>:entries:<date>` with the owner's `<sub>` segment always
 * present, and the generation counter is the service's shared `meal:gen:<sub>`.
 * There is no second Redis client and no forked `@life/cache` (lessons 0011,
 * 0016; Contract 2 Rule 4).
 *
 * This module owns the cached *value* shape: the serialized row is the row
 * **as persisted** — `nutrients` stays an `enc.v1.` envelope — so decrypt and
 * every filter always run after every hit, and Redis (AOF-persistent) never
 * holds plaintext.
 */

/** An entry row as persisted (ciphertext), dates as ISO. */
export interface CachedEntryRow {
  id: string;
  ownerSub: string | null;
  date: string;
  mealGroup: string;
  foodId: string;
  quantity: number;
  /** The sealed confirmed snapshot vector. */
  nutrients: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toCachedEntryRow(row: Entry): CachedEntryRow {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    date: row.date,
    mealGroup: row.mealGroup,
    foodId: row.foodId,
    quantity: row.quantity,
    nutrients: row.nutrients,
    version: row.version,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * True when the serialized row's snapshot is an `enc.v1.` envelope, so the
 * populate may touch Redis. A pre-backfill legacy plaintext row is refused
 * (`cacheable` on `getThrough`) and served straight from the DB instead, so no
 * plaintext ever lands in an AOF-persistent store (dual-read, `SPEC-notes-at-rest`).
 */
export function isCiphertextEntryRow(row: CachedEntryRow): boolean {
  return typeof row?.nutrients === 'string' && row.nutrients.startsWith(ENC_PREFIX);
}

/** Reject a hit whose serialized row is not `enc.v1.` ciphertext content. */
export function decodeCiphertextEntryRow(raw: unknown): CachedEntryRow {
  const row = raw as CachedEntryRow;
  if (!isCiphertextEntryRow(row)) throw new Error('cache entry is not ciphertext');
  return row;
}

export function decodeCiphertextEntryList(raw: unknown): CachedEntryRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextEntryRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

@Injectable()
export class EntriesCache {
  constructor(@Inject(MEAL_CACHE) private readonly cache: MealCache) {}

  /**
   * The owner's non-trashed entry set for one date. Key
   * `meal:<sub>:v<gen>:entries:<date>`. The date is part of the fetch identity
   * (one entry set per day per owner); the meal-group filter is applied after
   * the hit and never enters the key, so one entry serves every filter variant.
   */
  day(
    sub: string,
    date: string,
    loader: () => Promise<CachedEntryRow[]>,
  ): Promise<CachedEntryRow[]> {
    return this.cache.getThrough(sub, `meal:entries:${date}`, loader, {
      decode: decodeCiphertextEntryList,
      cacheable: (rows) => rows.every(isCiphertextEntryRow),
    });
  }

  /** One entry by id. Key `meal:<sub>:v<gen>:entry:<id>`. */
  one(sub: string, id: string, loader: () => Promise<CachedEntryRow>): Promise<CachedEntryRow> {
    return this.cache.getThrough(sub, `meal:entry:${id}`, loader, {
      decode: decodeCiphertextEntryRow,
      cacheable: isCiphertextEntryRow,
    });
  }

  /**
   * Invalidate everything cached for this owner. Called *after* the DB write, so
   * a write that throws never bumps and the cache keeps serving a view of a
   * write that did not happen; a bump that fails never blocks the write
   * (fail-open, `@life/cache`).
   */
  bump(sub: string): Promise<void> {
    return this.cache.bumpGeneration(sub);
  }
}
