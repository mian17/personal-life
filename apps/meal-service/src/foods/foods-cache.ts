import { Inject, Injectable } from '@nestjs/common';
import { ENC_PREFIX } from '@life/crypto';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache';
import type { Food } from './food.entity';
import type { Serving } from './serving.entity';
import type { StoredVector } from './content';

/**
 * meal-service's foods read-through cache (`SPEC-meal-service` Cache Rules).
 *
 * Composition, not a second cache: keys go through the service's single
 * `MEAL_CACHE` adapter (`src/cache/meal-cache.ts`), so the final key is
 * `meal:<sub>:v<gen>:food:<rest>` with the owner's `<sub>` segment always
 * present, and the generation counter is the service's shared `meal:gen:<sub>`.
 * There is no second Redis client and no forked `@life/cache` (lessons 0011,
 * 0016; Contract 2 Rule 4).
 *
 * This module is also the one owner of the cached *value* shape: the serialized
 * row is the row **as persisted** — `name`, `nutrients`, and each serving's
 * `label`/`nutrients` stay `enc.v1.` envelopes — so decrypt, search, and DTO
 * assembly always run after every hit, and Redis (AOF-persistent) never holds
 * plaintext.
 */

/** A serving row as persisted (ciphertext), dates as ISO. */
export interface CachedServingRow {
  id: string;
  ownerSub: string | null;
  foodId: string;
  label: string;
  grams: number;
  nutrients: string;
  createdAt: string;
  updatedAt: string;
}

/** A food row as persisted (ciphertext), dates as ISO. */
export interface CachedFoodRow {
  id: string;
  ownerSub: string | null;
  name: string;
  servingGrams: number;
  /** The sealed base vector, or null meaning "no nutrient data for this food". */
  nutrients: StoredVector;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  servings: CachedServingRow[];
}

export function toCachedServing(row: Serving): CachedServingRow {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    foodId: row.foodId,
    label: row.label,
    grams: row.grams,
    nutrients: row.nutrients,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCachedFoodRow(row: Food): CachedFoodRow {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    name: row.name,
    servingGrams: row.servingGrams,
    nutrients: row.nutrients,
    version: row.version,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    servings: (row.servings ?? []).map(toCachedServing),
  };
}

/**
 * True when every content field of a row is sealed. A food with no nutrient data
 * is still cacheable (null is a legitimate vector), but a pre-backfill plaintext
 * row is refused: `cacheable` leaves Redis untouched so no plaintext ever lands
 * in an AOF-persistent store (dual-read, `SPEC-notes-at-rest`).
 */
export function isCiphertextFoodRow(row: CachedFoodRow): boolean {
  const nameSealed = typeof row?.name === 'string' && row.name.startsWith(ENC_PREFIX);
  const baseSealed = row?.nutrients === null || row?.nutrients?.startsWith(ENC_PREFIX) === true;
  const servingsSealed =
    Array.isArray(row?.servings) &&
    row.servings.every(
      (s) =>
        typeof s?.label === 'string' &&
        s.label.startsWith(ENC_PREFIX) &&
        typeof s.nutrients === 'string' &&
        s.nutrients.startsWith(ENC_PREFIX),
    );
  return nameSealed && baseSealed && servingsSealed;
}

/** Reject a hit whose serialized row is not fully sealed content. */
export function decodeCiphertextFoodRow(raw: unknown): CachedFoodRow {
  const row = raw as CachedFoodRow;
  if (!isCiphertextFoodRow(row)) throw new Error('cache entry is not ciphertext');
  return row;
}

export function decodeCiphertextFoodList(raw: unknown): CachedFoodRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextFoodRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

@Injectable()
export class FoodsCache {
  constructor(@Inject(MEAL_CACHE) private readonly cache: MealCache) {}

  /**
   * The owner's whole non-trashed food set.
   * Key `meal:<sub>:v<gen>:food:list`. Content filters (`q`) and pagination are
   * applied after the hit and never enter the key, so one entry serves every
   * search variant.
   */
  list(sub: string, loader: () => Promise<CachedFoodRow[]>): Promise<CachedFoodRow[]> {
    return this.cache.getThrough(sub, 'meal:food:list', loader, {
      decode: decodeCiphertextFoodList,
      cacheable: (rows) => rows.every(isCiphertextFoodRow),
    });
  }

  /**
   * One food by id. Key `meal:<sub>:v<gen>:food:one:<id>`.
   */
  one(sub: string, id: string, loader: () => Promise<CachedFoodRow>): Promise<CachedFoodRow> {
    return this.cache.getThrough(sub, `meal:food:one:${id}`, loader, {
      decode: decodeCiphertextFoodRow,
      cacheable: isCiphertextFoodRow,
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