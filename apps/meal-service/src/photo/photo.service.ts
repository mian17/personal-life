import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { NutrientVector } from '@life/nutrition';
import { completeVector, zeroVector } from '../foods/content.js';
import { FoodsService, type FoodDto } from '../foods/foods.service.js';
import type { UsdaClient } from '../usda/usda.client.js';
import { USDA_CLIENT_FACTORY } from '../usda/usda.module.js';
import {
  GeminiClient,
  type PhotoFailureReason,
  type PhotoFoodSuggestion,
  type SearchFoodResult,
} from './gemini.client.js';

/**
 * DI token for the Gemini client factory.
 *
 * It lives here, not in `photo.module.ts`, on purpose: `PhotoModule` imports
 * this service, so a token defined there would be erased at runtime by the
 * circular import and every `PhotoService` would fail to resolve.
 *
 * The client is built from it on the first estimate, not at boot: the client's
 * env check is fail-closed by design (`SPEC-meal-service` Never: leak the key),
 * and boot must not depend on Gemini being configured for the rest of the
 * service to serve. Tests swap this token for a `FakeGemini`-backed factory
 * (`overrideProvider(GEMINI_CLIENT_FACTORY)`).
 */
export const GEMINI_CLIENT_FACTORY = Symbol('GEMINI_CLIENT_FACTORY');

/**
 * One item of the service's estimate response: the model's identity answer plus
 * the base and vector the **backend** resolved for it. The model never sees
 * these numbers — it names the food and weighs it; the vector and `servingGrams`
 * are attached here, after the identity answer comes back.
 *
 * The wire shape is fixed at these six fields: the answer's `searchQuery` is
 * consumed by resolution and never re-emitted, so the editor receives exactly
 * what it always did.
 *
 * `nutrients` is the resolved vector at the food's per-serving base, unscaled:
 * the editor multiplies it by the logged quantity, it is never scaled here.
 */
export interface PhotoEstimateItem {
  name: string;
  grams: number;
  foodId: string | null;
  fdcId: number | null;
  servingGrams: number;
  nutrients: NutrientVector;
}

/** The base and vector one identity suggestion resolved to. */
interface ResolvedVector {
  servingGrams: number;
  nutrients: NutrientVector;
}

/**
 * The photo estimate: image (+ optional hint) → Gemini → identity suggestion →
 * one vector resolved per food (`SPEC-meal-service` Photo → Gemini pipeline).
 *
 * The hard edges of this method are all `SPEC-meal-service` Boundaries:
 *
 * - It **never writes an entry.** The result is a suggestion for the editor's
 *   draft; the diary is written only when the BFF posts a *confirmed* entry to
 *   `POST /api/entries` (a different route, a different request).
 * - Image bytes are **never persisted and never logged.** They travel in one
 *   request body to the model and are dropped when it returns — not in the DB,
 *   not in Redis, not in a log line. The one line this service can emit is the
 *   USDA-unconfigured diagnosis; it carries no byte, prompt, or key.
 * - Estimate responses are **never cached.** A Gemini result is per-request and
 *   unconfirmed; this module provides no `MEAL_CACHE` token on purpose, so
 *   there is no cache it could even touch. Only a confirmed entry gets the
 *   read-through treatment, in the entries service.
 *
 * Resolution is by the id the model's answer carries — the tool loop already
 * matched our catalog or USDA, so nothing here re-searches by name. Each
 * suggestion takes one of three paths (`SPEC-photo-identity.md` § Resolution),
 * but only when the `search_food` query the answer names as its `searchQuery`
 * actually offered that id: an id another food's query offered, or one no query
 * offered, is treated as no id at all.
 *
 * 1. a catalog `foodId` reads that row's own stored vector through
 *    `FoodsService.findOne` — zero USDA calls;
 * 2. a bare `fdcId` fetches `usda-source`'s mapped vector for the wire only —
 *    every bare id one photo needs in a single batch request;
 * 3. neither id — or an id the named query did not offer, or a `foodId` that no
 *    longer resolves — yields `zeroVector()` ("no nutrient data"), so the food
 *    still logs and the person fills the numbers by hand.
 *
 * **Nothing is written here.** All three paths produce an on-the-wire vector
 * only — no `Food` row is created during an estimate; catalog creation is the
 * log-time path's (Task 11).
 */
@Injectable()
export class PhotoService {
  private client?: GeminiClient;
  private usdaClient?: UsdaClient;

  constructor(
    @Inject(GEMINI_CLIENT_FACTORY) private readonly makeClient: () => GeminiClient,
    @Inject(USDA_CLIENT_FACTORY) private readonly makeUsdaClient: () => UsdaClient,
    private readonly foods: FoodsService,
  ) {}

  /**
   * Turn the model's identity answer into the estimate response. The only place
   * that builds `PhotoEstimateItem`: each suggestion keeps its name, grams, and
   * ids, and gains the base and vector its id resolves to.
   *
   * @param sub the caller's owner — the scope of every catalog read and of the
   *   search tool bound below.
   * @param imageBase64 raw image bytes, base64 — validated by the DTO, decoded
   *   here and handed straight to the model.
   * @param mimeType the client's image type; the model validates it against its
   *   documented allowlist (one owner, `GeminiClient`).
   * @param hint optional steering text — a hint, never a correction.
   */
  async estimate(
    sub: string,
    imageBase64: string,
    mimeType: string,
    hint?: string,
  ): Promise<
    { readable: true; items: PhotoEstimateItem[] } | { readable: false; reason: PhotoFailureReason }
  > {
    const offered = new OfferedIds();
    const read = await this.readPhoto(sub, imageBase64, mimeType, hint, offered);
    if (!read.readable) return read;
    return { readable: true, items: await this.resolveItems(sub, read.items, offered) };
  }

  /** Hand the photo to the model, with the catalog-first search tool bound to `sub`. */
  private async readPhoto(
    sub: string,
    imageBase64: string,
    mimeType: string,
    hint: string | undefined,
    offered: OfferedIds,
  ) {
    this.client ??= this.makeClient();
    return this.client.readPhoto(
      { mimeType, bytes: Buffer.from(imageBase64, 'base64') },
      hint,
      (query) => this.searchFoodAndRemember(sub, query, offered),
    );
  }

  private async resolveItems(
    sub: string,
    suggestions: PhotoFoodSuggestion[],
    offered: OfferedIds,
  ): Promise<PhotoEstimateItem[]> {
    const catalogVectors = await Promise.all(
      suggestions.map((suggestion) => this.resolveCatalogVector(sub, suggestion, offered)),
    );
    const usdaVectors = await this.fetchUsdaVectors(
      offeredFdcIdsToFetch(suggestions, catalogVectors, offered),
    );
    return suggestions.map((suggestion, index) =>
      toEstimateItem(suggestion, catalogVectors[index], usdaVectors, offered),
    );
  }

  /**
   * Path 1: the catalog's own stored vector when the answer names a `foodId`
   * the query it reports actually offered — null otherwise, so the item falls
   * through to the USDA path or the absent vector. The gate is unchanged: an id
   * another food's query offered, or a guessed id, is no id at all.
   */
  private async resolveCatalogVector(
    sub: string,
    suggestion: PhotoFoodSuggestion,
    offered: OfferedIds,
  ): Promise<ResolvedVector | null> {
    if (suggestion.foodId === null) return null;
    if (!offered.hasCatalogId(suggestion.searchQuery, suggestion.foodId)) return null;
    const catalogRow = await this.findCatalogRow(sub, suggestion.foodId);
    if (catalogRow === null) return null;
    return {
      servingGrams: catalogRow.servingGrams,
      nutrients: completeVector(catalogRow.nutrients),
    };
  }

  /**
   * Path 2, batched: one USDA request for every offered `fdcId` the catalog
   * could not resolve, however many foods the photo holds. A client that is
   * unconfigured, a factory that throws, or a request that fails leaves every
   * id `null` — each item degrades to the absent vector, never the estimate.
   */
  private async fetchUsdaVectors(
    fdcIds: readonly number[],
  ): Promise<Map<number, NutrientVector | null>> {
    const vectors = new Map<number, NutrientVector | null>();
    for (const fdcId of fdcIds) vectors.set(fdcId, null);
    if (fdcIds.length === 0) return vectors;
    const usda = this.usda();
    if (!usda) return vectors;
    const found = await usda.fetchByFdcIds(fdcIds);
    for (const fdcId of fdcIds) {
      const vector = found.get(fdcId) ?? null;
      vectors.set(fdcId, vector === null ? null : completeVector(vector));
    }
    return vectors;
  }

  /**
   * Path 1: the referenced catalog row, through the read-through cache. A row
   * the owner no longer has throws the same `NotFoundException` a direct read
   * gives; that is the one failure treated as "no catalog food" (path 3), so a
   * stale id fails open. Any other error stays an error.
   */
  private async findCatalogRow(sub: string, foodId: string): Promise<FoodDto | null> {
    try {
      return await this.foods.findOne(sub, foodId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  /**
   * The catalog-first `search_food` closure the model calls: our own catalog
   * first, USDA only when nothing matched, so a repeat food costs zero API
   * calls (`SPEC-photo-identity.md` § The tool loop). The payload carries names
   * and ids — a `servingGrams` base at most — never a nutrient amount. Every id
   * the result offers is remembered against the query that returned it, so
   * resolution trusts only what the answer's `searchQuery` was shown.
   */
  private async searchFoodAndRemember(
    sub: string,
    query: string,
    offered: OfferedIds,
  ): Promise<SearchFoodResult> {
    const result = await this.searchFood(sub, query);
    offered.keep(query, result);
    return result;
  }

  private async searchFood(sub: string, query: string): Promise<SearchFoodResult> {
    // `findMatching`, not `findAll`: the resolve ranks every catalog match, so a
    // single page would narrow the model's search silently.
    const catalog = await this.foods.findMatching(sub, query);
    if (catalog.length > 0) {
      return { catalog: catalog.map(toCatalogHit), usda: [] };
    }
    return { catalog: [], usda: await this.usdaCandidates(query) };
  }

  /** USDA candidates for a name, or none when the lookup failed — never a throw. */
  private async usdaCandidates(query: string): Promise<SearchFoodResult['usda']> {
    const usda = this.usda();
    if (!usda) return [];
    const found = await usda.usda_search(query, ['Foundation', 'SR Legacy']);
    return found.ok ? found.candidates : [];
  }

  /**
   * The one USDA client, built on first lookup rather than at boot: the factory
   * is a thunk (`USDA_CLIENT_FACTORY`), so a missing `USDA_API_KEY` fails a
   * lookup, never the service's construction.
   *
   * A factory that throws means "no USDA here" — the lookup degrades to the
   * absent vector, the estimate still answers. This is the one place USDA
   * availability is decided; both call sites take the null and move on
   * (`SPEC-usda-source.md` § Cache Rules, failure mode).
   */
  private usda(): UsdaClient | null {
    try {
      // Build once, then reuse: one place decides whether USDA is available.
      this.usdaClient ??= this.makeUsdaClient();
      return this.usdaClient;
    } catch {
      warnUsdaUnconfiguredOnce();
      return null;
    }
  }
}

/** The USDA-unconfigured diagnosis, logged once per process. A class only — never the URL. */
const logger = new Logger(PhotoService.name);
let warnedUsdaUnconfigured = false;

function warnUsdaUnconfiguredOnce(): void {
  if (warnedUsdaUnconfigured) return;
  warnedUsdaUnconfigured = true;
  logger.error('USDA lookup skipped: client is not configured (USDA_API_KEY must be set)');
}

/**
 * The distinct `fdcId`s to fetch: each answer's own offered `fdcId` —
 * an id another food's query offered, or a guessed id, never enters — once,
 * and only when the catalog did not already resolve that food.
 */
function offeredFdcIdsToFetch(
  suggestions: PhotoFoodSuggestion[],
  catalogVectors: readonly (ResolvedVector | null)[],
  offered: OfferedIds,
): number[] {
  const fdcIds: number[] = [];
  const seen = new Set<number>();
  for (const [index, suggestion] of suggestions.entries()) {
    if (catalogVectors[index] !== null) continue;
    if (suggestion.fdcId === null) continue;
    if (!offered.hasFdcId(suggestion.searchQuery, suggestion.fdcId)) continue;
    if (seen.has(suggestion.fdcId)) continue;
    seen.add(suggestion.fdcId);
    fdcIds.push(suggestion.fdcId);
  }
  return fdcIds;
}

/** One suggestion plus its resolved base and vector: the estimate response's item. */
function toEstimateItem(
  suggestion: PhotoFoodSuggestion,
  catalogVector: ResolvedVector | null,
  usdaVectors: Map<number, NutrientVector | null>,
  offered: OfferedIds,
): PhotoEstimateItem {
  if (catalogVector !== null) {
    return {
      name: suggestion.name,
      grams: suggestion.grams,
      foodId: suggestion.foodId,
      fdcId: suggestion.fdcId,
      servingGrams: catalogVector.servingGrams,
      nutrients: catalogVector.nutrients,
    };
  }
  // The gate is re-checked at assembly, not only at collection: an id another
  // food's query offered never enters the batch, and never attaches here either.
  const usdaVector =
    suggestion.fdcId === null || !offered.hasFdcId(suggestion.searchQuery, suggestion.fdcId)
      ? null
      : (usdaVectors.get(suggestion.fdcId) ?? null);
  if (usdaVector !== null) {
    return {
      name: suggestion.name,
      grams: suggestion.grams,
      foodId: suggestion.foodId,
      fdcId: suggestion.fdcId,
      servingGrams: 100,
      nutrients: usdaVector,
    };
  }
  return {
    name: suggestion.name,
    grams: suggestion.grams,
    foodId: suggestion.foodId,
    fdcId: suggestion.fdcId,
    servingGrams: 100,
    nutrients: zeroVector(),
  };
}

/** A catalog row as the tool payload sees it: id, name, and base — never a vector. */
function toCatalogHit(food: FoodDto): SearchFoodResult['catalog'][number] {
  return { id: food.id, name: food.name, servingGrams: food.servingGrams };
}

/**
 * The ids each `search_food` query offered, so resolution trusts an id only
 * when the query the answer names as its `searchQuery` returned it — one food's
 * search cannot vouch for another food's id. Built per `estimate` call and
 * threaded down — never a field on the service, because concurrent estimates
 * must not share one pool.
 */
class OfferedIds {
  private readonly idsByQuery = new Map<string, OfferedIdsForQuery>();

  keep(query: string, result: SearchFoodResult): void {
    const offered = this.idsFor(query);
    for (const food of result.catalog) offered.catalogIds.add(food.id);
    for (const candidate of result.usda) offered.fdcIds.add(candidate.fdcId);
  }

  hasCatalogId(query: string | null, foodId: string): boolean {
    if (query === null) return false;
    return this.idsByQuery.get(query)?.catalogIds.has(foodId) ?? false;
  }

  hasFdcId(query: string | null, fdcId: number): boolean {
    if (query === null) return false;
    return this.idsByQuery.get(query)?.fdcIds.has(fdcId) ?? false;
  }

  private idsFor(query: string): OfferedIdsForQuery {
    const existing = this.idsByQuery.get(query);
    if (existing) return existing;
    const created: OfferedIdsForQuery = {
      catalogIds: new Set<string>(),
      fdcIds: new Set<number>(),
    };
    this.idsByQuery.set(query, created);
    return created;
  }
}

/** The ids one `search_food` query returned: catalog string ids and USDA fdc ids. */
interface OfferedIdsForQuery {
  catalogIds: Set<string>;
  fdcIds: Set<number>;
}
