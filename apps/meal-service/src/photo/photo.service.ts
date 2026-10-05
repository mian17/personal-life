import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NutrientVector } from '@life/nutrition';
import { completeVector, zeroVector } from '../foods/content';
import { FoodsService, type FoodDto } from '../foods/foods.service';
import type { UsdaClient } from '../usda/usda.client';
import { USDA_CLIENT_FACTORY } from '../usda/usda.module';
import {
  COULD_NOT_READ,
  GeminiClient,
  type PhotoFoodSuggestion,
  type SearchFood,
  type SearchFoodResult,
} from './gemini.client';

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
 * `nutrients` is the resolved vector at the food's per-serving base, unscaled:
 * the editor multiplies it by the logged quantity, it is never scaled here.
 */
export interface PhotoEstimateItem extends PhotoFoodSuggestion {
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
 *   not in Redis, not in a log line. This service emits no log at all, so byte,
 *   prompt, or key leakage has nowhere to hide.
 * - Estimate responses are **never cached.** A Gemini result is per-request and
 *   unconfirmed; this module provides no `MEAL_CACHE` token on purpose, so
 *   there is no cache it could even touch. Only a confirmed entry gets the
 *   read-through treatment, in the entries service.
 *
 * Resolution is by the id the model's answer carries — the tool loop already
 * matched our catalog or USDA, so nothing here re-searches by name. Each
 * suggestion takes one of three paths (`SPEC-photo-identity.md` § Resolution):
 *
 * 1. a catalog `foodId` reads that row's own stored vector through
 *    `FoodsService.findOne` — zero USDA calls;
 * 2. a bare `fdcId` fetches `usda-source`'s mapped vector for the wire only;
 * 3. neither id — or a `foodId` that no longer resolves — yields `zeroVector()`
 *    ("no nutrient data"), so a stale id fails open instead of failing the
 *    estimate.
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
    { readable: true; items: PhotoEstimateItem[] } | { readable: false; reason: typeof COULD_NOT_READ }
  > {
    const read = await this.readPhoto(sub, imageBase64, mimeType, hint);
    if (!read.readable) return read;
    return { readable: true, items: await this.resolveItems(sub, read.items) };
  }

  /** Hand the photo to the model, with the catalog-first search tool bound to `sub`. */
  private async readPhoto(sub: string, imageBase64: string, mimeType: string, hint?: string) {
    this.client ??= this.makeClient();
    return this.client.readPhoto(
      { mimeType, bytes: Buffer.from(imageBase64, 'base64') },
      hint,
      (query) => this.searchFood(sub, query),
    );
  }

  private resolveItems(sub: string, suggestions: PhotoFoodSuggestion[]): Promise<PhotoEstimateItem[]> {
    return Promise.all(suggestions.map((suggestion) => this.resolveItem(sub, suggestion)));
  }

  private async resolveItem(
    sub: string,
    suggestion: PhotoFoodSuggestion,
  ): Promise<PhotoEstimateItem> {
    const resolved = await this.resolveVector(sub, suggestion);
    return {
      name: suggestion.name,
      grams: suggestion.grams,
      foodId: suggestion.foodId,
      fdcId: suggestion.fdcId,
      servingGrams: resolved.servingGrams,
      nutrients: resolved.nutrients,
    };
  }

  /** Path by the id the answer carries: catalog first, then USDA, then the absent vector. */
  private async resolveVector(
    sub: string,
    suggestion: PhotoFoodSuggestion,
  ): Promise<ResolvedVector> {
    if (suggestion.foodId !== null) {
      const catalogRow = await this.findCatalogRow(sub, suggestion.foodId);
      if (catalogRow) {
        return {
          servingGrams: catalogRow.servingGrams,
          nutrients: completeVector(catalogRow.nutrients),
        };
      }
    }
    if (suggestion.fdcId !== null) {
      const vector = await this.fetchUsdaVector(suggestion.fdcId);
      if (vector) return { servingGrams: 100, nutrients: vector };
    }
    return { servingGrams: 100, nutrients: zeroVector() };
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

  /** Path 2: the USDA vector for the model's id, per 100 g, written nowhere. */
  private async fetchUsdaVector(fdcId: number): Promise<NutrientVector | null> {
    const result = await this.usda().fetchByFdcId(fdcId);
    return result.ok ? completeVector(result.vector) : null;
  }

  /**
   * The catalog-first `search_food` closure the model calls: our own catalog
   * first, USDA only when nothing matched, so a repeat food costs zero API
   * calls (`SPEC-photo-identity.md` § The tool loop). The payload carries names
   * and ids — a `servingGrams` base at most — never a nutrient amount.
   */
  private async searchFood(sub: string, query: string): Promise<SearchFoodResult> {
    const catalog = await this.foods.findAll(sub, query);
    if (catalog.length > 0) {
      return { catalog: catalog.map(toCatalogHit), usda: [] };
    }
    return { catalog: [], usda: await this.usdaCandidates(query) };
  }

  /** USDA candidates for a name, or none when the lookup failed — never a throw. */
  private async usdaCandidates(query: string): Promise<SearchFoodResult['usda']> {
    const found = await this.usda().usda_search(query, ['Foundation', 'SR Legacy']);
    return found.ok ? found.candidates : [];
  }

  /**
   * The one USDA client, built on first lookup rather than at boot: the factory
   * is a thunk (`USDA_CLIENT_FACTORY`), so a missing `USDA_API_KEY` fails the
   * lookup, never the service's construction.
   */
  private usda(): UsdaClient {
    return (this.usdaClient ??= this.makeUsdaClient());
  }
}

/** A catalog row as the tool payload sees it: id, name, and base — never a vector. */
function toCatalogHit(food: FoodDto): SearchFoodResult['catalog'][number] {
  return { id: food.id, name: food.name, servingGrams: food.servingGrams };
}
