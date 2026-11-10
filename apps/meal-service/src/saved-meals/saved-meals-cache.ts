import { Inject, Injectable } from '@nestjs/common';
import { ENC_PREFIX } from '@life/crypto';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache.js';
import type { SavedMeal } from './saved-meal.entity.js';
import type { SavedMealItem } from './saved-meal-item.entity.js';

/**
 * meal-service's saved-meals read-through cache (`SPEC-meal-service` Cache
 * Rules).
 *
 * Composition, not a second cache: keys go through the service's single
 * `MEAL_CACHE` adapter (`src/cache/meal-cache.ts`), so the final key is
 * `meal:<sub>:v<gen>:saved:<rest>` with the owner's `<sub>` segment always
 * present, and the generation counter is the service's shared `meal:gen:<sub>`
 * (lessons 0011, 0016; Contract 2 Rule 3). No second Redis client, no forked
 * `@life/cache`.
 *
 * This module owns the cached *value* shape: the serialized row is the row
 * **as persisted** — `name` and every item's `nutrients` stay `enc.v1.`
 * envelopes — so decrypt and every filter always run after every hit, and Redis
 * (AOF-persistent) never holds plaintext.
 */

/** A saved-meal item row as persisted (ciphertext), dates as ISO. */
export interface CachedSavedMealItemRow {
  id: string;
  ownerSub: string | null;
  savedMealId: string;
  foodId: string | null;
  quantity: number;
  /** The sealed frozen per-item nutrient vector. */
  nutrients: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved-meal row as persisted (ciphertext) with its frozen items, dates as ISO. */
export interface CachedSavedMealRow {
  id: string;
  ownerSub: string | null;
  name: string;
  mealGroup: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: CachedSavedMealItemRow[];
}

export function toCachedSavedMealItem(row: SavedMealItem): CachedSavedMealItemRow {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    savedMealId: row.savedMealId,
    foodId: row.foodId,
    quantity: row.quantity,
    nutrients: row.nutrients,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCachedSavedMealRow(row: SavedMeal, items: SavedMealItem[]): CachedSavedMealRow {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    name: row.name,
    mealGroup: row.mealGroup,
    version: row.version,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: items.map(toCachedSavedMealItem),
  };
}

/**
 * True when the row's name and every item's frozen vector are `enc.v1.`
 * envelopes. A pre-backfill plaintext row is refused (`cacheable` on
 * `getThrough`) and served straight from the DB instead, so no plaintext ever
 * lands in an AOF-persistent store (dual-read, `SPEC-notes-at-rest`).
 */
export function isCiphertextSavedMealRow(row: CachedSavedMealRow): boolean {
  const nameSealed = typeof row?.name === 'string' && row.name.startsWith(ENC_PREFIX);
  const itemsSealed =
    Array.isArray(row?.items) &&
    row.items.every(
      (item) => typeof item?.nutrients === 'string' && item.nutrients.startsWith(ENC_PREFIX),
    );
  return nameSealed && itemsSealed;
}

/** Reject a hit whose serialized row is not `enc.v1.` ciphertext content. */
export function decodeCiphertextSavedMealRow(raw: unknown): CachedSavedMealRow {
  const row = raw as CachedSavedMealRow;
  if (!isCiphertextSavedMealRow(row)) throw new Error('cache entry is not ciphertext');
  return row;
}

export function decodeCiphertextSavedMealList(raw: unknown): CachedSavedMealRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextSavedMealRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

@Injectable()
export class SavedMealsCache {
  constructor(@Inject(MEAL_CACHE) private readonly cache: MealCache) {}

  /**
   * The owner's whole non-trashed saved-meal set with items.
   * Key `meal:<sub>:v<gen>:saved:list`. This list is the re-log source: there
   * is no content filter, so one entry serves every list read.
   */
  list(sub: string, loader: () => Promise<CachedSavedMealRow[]>): Promise<CachedSavedMealRow[]> {
    return this.cache.getThrough(sub, 'meal:saved:list', loader, {
      decode: decodeCiphertextSavedMealList,
      cacheable: (rows) => rows.every(isCiphertextSavedMealRow),
    });
  }

  /** One saved meal by id. Key `meal:<sub>:v<gen>:saved:one:<id>`. */
  one(
    sub: string,
    id: string,
    loader: () => Promise<CachedSavedMealRow>,
  ): Promise<CachedSavedMealRow> {
    return this.cache.getThrough(sub, `meal:saved:one:${id}`, loader, {
      decode: decodeCiphertextSavedMealRow,
      cacheable: isCiphertextSavedMealRow,
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
