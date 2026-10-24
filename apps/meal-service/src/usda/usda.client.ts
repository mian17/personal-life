import { type NutrientVector } from '@life/nutrition';
import { mapUsdaNutrients, type UsdaNutrientRow } from './mapping';

/**
 * The USDA FoodData Central client — `usda-source`'s only HTTP boundary
 * (`docs/specs/SPEC-usda-source.md`, `docs/research/usda-fdc-api.md`).
 *
 * Two calls, one shape of failure:
 *
 * 1. `usda_search` lists candidate foods by name — names and USDA ids only,
 *    never a nutrient amount (the identity model picks one, Task 8). Search's
 *    `foodNutrients[]` is never read and never leaves this module.
 * 2. `fetchByFdcIds` fetches many foods in one request per 20 ids and maps each
 *    nested `foodNutrients[]` into our per-100 g vector through `mapping.ts` —
 *    the one place a vector is made. `fetchByFdcId` is its one-id convenience.
 *
 * Every failure collapses to one typed reason (`not-found`, `unmapped`,
 * `rate-limited`, `unavailable`), so the caller has exactly one path to "we
 * could not resolve this" and fails open. A `429` is `rate-limited` and is
 * never retried: an exceeded key is blocked for an hour, so a retry storm only
 * extends the outage. The rate-limit headers are read by nobody — no cache or
 * scheduler lives here, and dedup-by-name keeps call volume far under the
 * limit; only a `429` is actionable, and it is not retried.
 *
 * The key rides in the query string (`ApiKeyAuth: in: query`), unlike Gemini's
 * header, so any logged URL would be a leaked key — and data.gov deactivates
 * keys it finds published. This module therefore writes nothing to a log, and
 * no result or error message it returns carries the key or the URL.
 */

/** Why a USDA lookup produced no vector or no candidates. */
export type UsdaFailureReason = 'not-found' | 'unmapped' | 'rate-limited' | 'unavailable';

type UsdaFailure = { ok: false; reason: UsdaFailureReason };

/** `fetchByFdcId`'s result — a complete per-100 g vector, or the typed reason we have none. */
export type UsdaResult = { ok: true; vector: NutrientVector } | UsdaFailure;

/** One search hit: a food's name and its USDA id — no nutrient amounts. */
export interface UsdaCandidate {
  name: string;
  fdcId: number;
}

/** `usda_search`'s result — matching candidates, or the typed reason we have none. */
export type UsdaSearchResult = { ok: true; candidates: UsdaCandidate[] } | UsdaFailure;

/** Injected in tests; `fetch` in production (Node 18+ global, no SDK). */
export type UsdaTransport = typeof fetch;

const DEFAULT_BASE = 'https://api.nal.usda.gov/fdc';

/** The batch endpoint's one hard limit: at most 20 `fdcIds` per request. */
const MAX_FDC_IDS_PER_REQUEST = 20;

/**
 * `value` without its trailing slashes, so a configured base never doubles the
 * join's slash. A linear scan rather than `/\/+$/`, which backtracks.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

const NOT_FOUND: UsdaFailure = { ok: false, reason: 'not-found' };
const RATE_LIMITED: UsdaFailure = { ok: false, reason: 'rate-limited' };
const UNAVAILABLE: UsdaFailure = { ok: false, reason: 'unavailable' };

export class UsdaClient {
  private readonly base: string;
  private readonly key: string;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly transport: UsdaTransport = fetch,
    /** ponytail: one fixed deadline for every request; make it per-call only if a real lookup needs longer. */
    private readonly timeoutMs = 15_000,
  ) {
    const key = env.USDA_API_KEY;
    // Fail closed at construction, like the Gemini client: a missing key is a
    // deployment error, not a food we could not resolve. The message names the
    // variable, never its value.
    if (!key) {
      throw new Error('USDA is not configured: USDA_API_KEY must be set');
    }
    this.key = key;
    this.base = withoutTrailingSlashes(env.USDA_API_BASE ?? DEFAULT_BASE);
  }

  /**
   * The candidate foods matching a name. The caller supplies the `dataType`
   * pair, which rides out as one plain `dataType` param per value — the
   * array-style `dataType[]` the old spelling sent is rejected with a 400. The
   * restriction to whole ingredients stays the caller's choice, not a constant
   * in here.
   */
  async usda_search(
    query: string,
    dataType: readonly ['Foundation', 'SR Legacy'],
  ): Promise<UsdaSearchResult> {
    const url = this.urlFor('/v1/foods/search', { query, dataType: [...dataType] });
    try {
      const response = await this.send(url);
      if (response.status === 429) return RATE_LIMITED;
      if (!response.ok) return UNAVAILABLE;
      const candidates = readCandidates(await response.json());
      return candidates === null ? UNAVAILABLE : { ok: true, candidates };
    } catch {
      return UNAVAILABLE;
    }
  }

  /**
   * Many foods' nutrient vectors, per 100 g, already through `completeVector`,
   * in one request per 20 ids. Every requested id appears in the result: a food
   * USDA omits (invalid ids are silently skipped) or one whose rows map to
   * nothing holds `null` — never a throw, never a missing key. Any transport or
   * HTTP failure holds `null` for that request's whole set: the single-fetch
   * semantics stay consistent with it, and an estimate must never fail because
   * of it.
   */
  async fetchByFdcIds(fdcIds: readonly number[]): Promise<Map<number, NutrientVector | null>> {
    const vectors = absentVectors(fdcIds);
    for (const chunk of chunkByCap(fdcIds)) {
      const found = await this.fetchBatch(chunk);
      for (const [fdcId, vector] of found) vectors.set(fdcId, vector);
    }
    return vectors;
  }

  /**
   * One food's nutrient vector, per 100 g, already through `completeVector`.
   * `404` is `not-found`; a `429` is `rate-limited` and is not retried; every
   * other failure — non-2xx, malformed body, timeout, network error — is one
   * `unavailable`, and a body that maps nothing is the mapper's `unmapped`.
   */
  async fetchByFdcId(fdcId: number): Promise<UsdaResult> {
    const url = this.urlFor(`/v1/food/${fdcId}`, {});
    try {
      const response = await this.send(url);
      if (response.status === 429) return RATE_LIMITED;
      if (response.status === 404) return NOT_FOUND;
      if (!response.ok) return UNAVAILABLE;
      const rows = readNutrientRows(await response.json());
      if (rows === null) return UNAVAILABLE;
      return mapUsdaNutrients(rows);
    } catch {
      return UNAVAILABLE;
    }
  }

  /**
   * One batch request's outcomes for up to 20 ids: each requested id is a
   * mapped vector or `null`. A failed request, a body that is not the list
   * envelope, and an omitted id all leave the id `null` — the caller never
   * special-cases a missing key.
   */
  private async fetchBatch(fdcIds: readonly number[]): Promise<Map<number, NutrientVector | null>> {
    const vectors = absentVectors(fdcIds);
    const url = this.urlFor('/v1/foods', { fdcIds: fdcIds.map(String) });
    try {
      const response = await this.send(url);
      if (!response.ok) return vectors;
      const foods = readFoodList(await response.json());
      if (foods === null) return vectors;
      for (const food of foods) {
        const mapped = mapListedFood(food);
        if (mapped) vectors.set(mapped.fdcId, mapped.vector);
      }
    } catch {
      return vectors;
    }
    return vectors;
  }

  /**
   * The signed URL for one call. The key is a query param because the API
   * demands it, so this string is never logged and never thrown.
   */
  private urlFor(path: string, extra: Record<string, string | string[]>): string {
    const params = new URLSearchParams({ api_key: this.key });
    for (const [name, value] of Object.entries(extra)) {
      if (Array.isArray(value)) {
        for (const one of value) params.append(name, one);
      } else {
        params.set(name, value);
      }
    }
    return `${this.base}${path}?${params.toString()}`;
  }

  private async send(url: string): Promise<Response> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('usda request timed out')), this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.transport(url, { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs) }),
        expiry,
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
}

/**
 * The search body's candidates as `{ name, fdcId }`, or null for a body that
 * is not the documented envelope. `description` is the name; `foodNutrients[]`
 * is dropped on purpose — a search result carries no amounts.
 */
function readCandidates(payload: unknown): UsdaCandidate[] | null {
  const foods = record(payload)?.foods;
  if (!Array.isArray(foods)) return null;
  const candidates: UsdaCandidate[] = [];
  for (const food of foods) {
    const row = record(food);
    const name = row?.description;
    const fdcId = row?.fdcId;
    if (typeof name !== 'string' || name.trim() === '') return null;
    if (typeof fdcId !== 'number' || !Number.isInteger(fdcId)) return null;
    candidates.push({ name, fdcId });
  }
  return candidates;
}

/**
 * The fetch-by-id body's `foodNutrients[]` rows, or null for a body that is not
 * the documented envelope. Each row keeps only what the mapper reads — the
 * nested number and unit, and the top-level amount when it is a number. A group
 * row's missing amount is left off, and the mapper skips it structurally.
 */
function readNutrientRows(payload: unknown): UsdaNutrientRow[] | null {
  const foodNutrients = record(payload)?.foodNutrients;
  if (!Array.isArray(foodNutrients)) return null;
  const rows: UsdaNutrientRow[] = [];
  for (const entry of foodNutrients) {
    const row = record(entry);
    const nutrient = record(row?.nutrient);
    const number = nutrient?.number;
    const unitName = nutrient?.unitName;
    if (typeof number !== 'string' || typeof unitName !== 'string') return null;
    const amount = row?.amount;
    rows.push({
      nutrient: { number, unitName },
      amount: typeof amount === 'number' ? amount : undefined,
    });
  }
  return rows;
}

/**
 * The batch body's foods, or null for a body that is not the documented list.
 * The list carries one food object per id, each with the same nested rows the
 * fetch-by-id body has — so both endpoints reach the mapper through
 * `readNutrientRows`, and the mapping path is one path.
 */
function readFoodList(payload: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(payload)) return null;
  const foods: Record<string, unknown>[] = [];
  for (const food of payload) {
    const row = record(food);
    if (!row) return null;
    foods.push(row);
  }
  return foods;
}

/** One listed food mapped to its id and vector, or null for a row we cannot attribute or map. */
function mapListedFood(
  food: Record<string, unknown>,
): { fdcId: number; vector: NutrientVector } | null {
  const fdcId = food.fdcId;
  if (typeof fdcId !== 'number' || !Number.isInteger(fdcId)) return null;
  const rows = readNutrientRows(food);
  if (rows === null) return null;
  const mapped = mapUsdaNutrients(rows);
  return mapped.ok ? { fdcId, vector: mapped.vector } : null;
}

/** Every requested id, absent — the shape a failed or partial batch starts from. */
function absentVectors(fdcIds: readonly number[]): Map<number, NutrientVector | null> {
  return new Map(fdcIds.map((fdcId) => [fdcId, null]));
}

/** `fdcIds` split into runs no longer than the batch endpoint's 20-id cap. */
function chunkByCap(fdcIds: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start < fdcIds.length; start += MAX_FDC_IDS_PER_REQUEST) {
    chunks.push(fdcIds.slice(start, start + MAX_FDC_IDS_PER_REQUEST));
  }
  return chunks;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
