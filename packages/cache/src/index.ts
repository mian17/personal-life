/**
 * `@life/cache` — the generic read-through cache shared by every domain service
 * (`SPEC-service-kernel` "Shared primitives", AGENTS.md Contract 2 no-fork rule).
 *
 * Extracted from `apps/note-service/src/notes/notes-cache.ts`, generalizing the
 * hard-coded `note:` prefix into a constructor `service` component so all three
 * services can share one Redis instance without cross-invalidation.
 *
 * Design (byte-exact kernel contract):
 * - Keys compose as `<service>:<sub>:v<gen>:<rest>`; the generation-counter key
 *   is service-prefixed too — `<service>:gen:<sub>`.
 * - A per-owner generation counter invalidates every one of that owner's read
 *   keys with a single `INCR`; the old keys are simply unreachable and age out
 *   via the TTL. No `DEL` exists on the client surface (cluster-safe, and
 *   impossible to leave a namespace partially invalidated).
 * - Values are always serialized rows **as persisted** — ciphertext for content.
 *   The cache is inside the at-rest boundary; `decode`/`cacheable` let the
 *   service keep plaintext out (Redis is AOF-persistent).
 * - Fail-open is the contract: any client error degrades to the direct loader.
 *   The fallback path never writes and never throws.
 * - Zero third-party dependencies: the node-redis-shaped client is injected.
 */

/** Only the node-redis options this helper needs; keeps the seam testable. */
export interface CacheSetOptions {
  EX?: number;
}

/**
 * The slice of the node-redis v6 client surface the cache depends on. Declaring
 * it narrowly (instead of importing the full generic client) lets tests inject a
 * tiny fake and makes the exact Redis dependency auditable. Note `DEL` is
 * deliberately absent: generation keys make per-key deletion unnecessary.
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: CacheSetOptions): Promise<unknown>;
  incr(key: string): Promise<number>;
}

/**
 * Hit-handling hooks for `getThrough`.
 *
 * - `decode` turns the raw parsed cache value into `T`, and must **throw** when
 *   the entry is unusable (a legacy/plaintext entry written before this contract,
 *   or corruption). A throw is treated exactly like a miss: the DB loader runs
 *   and its fresh value is written back under the same generation.
 * - `cacheable` decides whether the loader's value may be persisted at all. The
 *   transparent dual-read path can surface a legacy plaintext row (no `enc.v1.`
 *   envelope); returning false leaves Redis untouched so no plaintext ever lands
 *   in an AOF-persistent store.
 */
export interface CacheHitOptions<T> {
  decode?: (raw: unknown) => T;
  cacheable?: (value: T) => boolean;
}

/** TTL ceiling (spec: content is 60s-fresh at most). */
export const CACHE_TTL_SECONDS = 60;

export interface CacheOptions {
  /** Namespace prefix; one per service (`note`, `tags`, `todo`). */
  service: string;
  /** `null` client = Redis not configured; every call runs the loader directly. */
  client: CacheClient | null;
  /** TTL backstop in seconds (default 60). */
  ttlSeconds?: number;
}

export class ReadThroughCache {
  private readonly service: string;
  private readonly client: CacheClient | null;
  private readonly ttlSeconds: number;

  constructor({ service, client, ttlSeconds = CACHE_TTL_SECONDS }: CacheOptions) {
    this.service = service;
    this.client = client;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Read-through with the stale-guard, scoped to one owner. The generation is
   * captured *before* the loader runs and re-read *after* it: if a write bumped
   * this owner's counter while the DB query was in flight, the freshly-queried
   * value is now stale, so it is never written under the new generation (which
   * would mask that write for the TTL). The next read misses and observes the
   * write.
   *
   * `loader` must return the **serialized row** form (never a decrypted DTO):
   * the same value is both returned to the caller (who decodes it) and, when
   * `cacheable` allows, stored under the generation-scoped key.
   */
  async getThrough<T>(
    sub: string,
    rest: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    const client = this.client;
    if (!client) return loader();

    let genBefore: number | null = null;
    try {
      genBefore = await this.readGeneration(client, sub);
      const cached = await client.get(this.key(sub, rest, genBefore));
      if (cached !== null) {
        const raw = JSON.parse(cached) as unknown;
        return options.decode ? options.decode(raw) : (raw as T);
      }
    } catch {
      /* cache read error or unusable entry: fall through to the DB loader */
    }

    const value = await loader();

    try {
      if (genBefore === null) return value; // generation unknown: populate nothing
      const genAfter = await this.readGeneration(client, sub);
      if (genAfter === genBefore && (options.cacheable?.(value) ?? true)) {
        await client.set(this.key(sub, rest, genBefore), JSON.stringify(value), {
          EX: this.ttlSeconds,
        });
      }
    } catch {
      /* fail open: the populate is best-effort; response is already computed */
    }

    return value;
  }

  /**
   * One `INCR <service>:gen:<sub>` invalidates every one of that owner's reads.
   * Called *after* each write's DB mutation: bump-after closes the window that
   * bump-before leaves open (a read landing between a bump and the mutation would
   * cache pre-mutation state under the new generation for the TTL). A mutation
   * that throws never bumps, so the cache keeps serving a consistent view of a
   * write that did not happen.
   *
   * Only the caller's own namespace is affected; another owner's counter and
   * entries are untouched. A client error here must never block the write —
   * fail open.
   */
  async bumpGeneration(sub: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.incr(this.generationKey(sub));
    } catch {
      /* fail open: the write still proceeds; reads stay DB-served while down */
    }
  }

  private async readGeneration(client: CacheClient, sub: string): Promise<number> {
    const raw = await client.get(this.generationKey(sub));
    if (raw === null) return 0; // fresh cache: generation 0 until the first write
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private generationKey(sub: string): string {
    return `${this.service}:gen:${sub}`;
  }

  private key(sub: string, rest: string, generation: number): string {
    return `${this.service}:${sub}:v${generation}:${rest}`;
  }
}

/** Construct the generic read-through cache for one service. */
export function createCache(options: CacheOptions): ReadThroughCache {
  return new ReadThroughCache(options);
}
