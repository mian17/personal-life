import { createClient } from 'redis';

/**
 * Read-through cache for `NotesService` reads, invalidated by a *per-user
 * generation counter* (`INCR note:gen:<sub>`) rather than per-key deletes.
 *
 * Why generation-bump over per-key invalidation: a single write can invalidate
 * an unbounded number of read keys (the list scope, the trash scope, the tag
 * list, one note). Tracking which keys exist would need `KEYS`/`SCAN` (O(N) and
 * cluster-hostile) or a parallel bookkeeping structure that can drift. Bumping
 * one integer moves every subsequent read onto a new key namespace; the old keys
 * are simply unreachable and age out via the 60s TTL. One atomic op per write,
 * cluster-safe, and impossible to leave partially invalidated.
 *
 * Final key shape (`<rest>` after the `note:<sub>:v<gen>:` prefix):
 *   - `list`        → the owner's non-trashed ciphertext rows (scope = all)
 *   - `trash`       → the owner's trashed ciphertext rows (scope = trash)
 *   - `one:<id>`    → one note's ciphertext row
 *   - `tags`        → the owner's ciphertext tag rows
 * `q`/`tag`/`limit`/`cursor` are deliberately **not** in the key: the cached
 * value is the whole metadata-scoped row set, and filtering/pagination run in
 * memory after every hit, so one entry serves every search/filter variant.
 *
 * Every cached value is serialized **ciphertext** rows (`SPEC-notes-at-rest`
 * Cache Rules): the service decrypts only after a hit/miss, never before the
 * populate. Redis here is AOF-persistent, so plaintext at this layer would
 * defeat the chapter. `cacheable` on `getThrough` is the tripwire that refuses
 * to persist a legacy plaintext (dual-read) value.
 *
 * Every key embeds the owner `sub`, and each user has their own counter, so one
 * user's keys are unreachable from another user's namespace and one user's
 * writes neither invalidate nor populate another user's entries. The sub
 * component is leak prevention at the cache layer, not access control — the
 * service layer still enforces ownership on the DB query.
 *
 * Fail-open is the contract: every Redis path is wrapped so an error degrades to
 * the DB. Cache loss is never a correctness problem — only a performance one.
 */

/** The per-user counter every one of that user's read keys embeds; bumped once per write. */
export function generationKey(sub: string): string {
  return `note:gen:${sub}`;
}

/** TTL ceiling (spec: note bodies are 60s-fresh at most). */
export const CACHE_TTL_SECONDS = 60;

/** Nest DI token for the module-init cache selection. */
export const NOTES_CACHE = Symbol('NOTES_CACHE');

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
  connect(): Promise<unknown>;
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

export class NotesCache {
  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(private readonly client: CacheClient | null) {}

  /**
   * Read-through with the stale-guard, scoped to one owner. The generation is
   * captured *before* the loader runs and re-read *after* it: if a write bumped
   * this user's counter while the DB query was in flight, the freshly-queried
   * value is now stale, so it is never written under the new generation (which
   * would mask that write for the TTL). The next read misses and observes the
   * write.
   *
   * `loader` must return the **ciphertext row** form (never a decrypted DTO):
   * the same value is both returned to the caller (who decrypts it) and, when
   * `cacheable` allows, stored under `baseKey`.
   */
  async getThrough<T>(
    sub: string,
    baseKey: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    const client = this.client;
    if (!client) return loader();

    let genBefore: number | null = null;
    try {
      genBefore = await this.readGeneration(client, sub);
      const cached = await client.get(this.key(sub, baseKey, genBefore));
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
        await client.set(this.key(sub, baseKey, genBefore), JSON.stringify(value), {
          EX: CACHE_TTL_SECONDS,
        });
      }
    } catch {
      /* fail open: the populate is best-effort; response is already computed */
    }

    return value;
  }

  /**
   * One `INCR note:gen:<sub>` invalidates every one of that user's reads. Called
   * *after* each write's DB mutation (review finding 2026-09-25). Bump-after
   * closes a stale window that bump-before leaves open: a read landing between
   * the bump and the mutation would see the new generation, query the DB
   * mid-write (pre-mutation state), find the generation still new, and cache that
   * stale value under the new generation for the TTL — the stale-guard only
   * covers bumps that land *during* the query. Emitting the bump only once the
   * new state is durable guarantees every entry that can hold pre-mutation state
   * was born under the old generation and dies on this bump. It also means a
   * mutation that throws (e.g. the optimistic-lock `ConflictException`) never
   * bumps, so the cache keeps serving a consistent view of a write that did not
   * happen.
   *
   * Only the caller's own namespace is affected: another user's counter and
   * entries are untouched.
   *
   * The DB is the source of truth, so even the tiny ordering gap is safe: a read
   * concurrent with the mutation either sees old state (which the bump then
   * retires) or new state. A Redis error here must never block the write — fail
   * open.
   */
  async bumpGeneration(sub: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.incr(generationKey(sub));
    } catch {
      /* fail open: the write still proceeds; reads stay DB-served while down */
    }
  }

  private async readGeneration(client: CacheClient, sub: string): Promise<number> {
    const raw = await client.get(generationKey(sub));
    if (raw === null) return 0; // fresh cache: generation 0 until the first write
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private key(sub: string, baseKey: string, generation: number): string {
    const rest = baseKey.startsWith('note:') ? baseKey.slice('note:'.length) : baseKey;
    return `note:${sub}:v${generation}:${rest}`;
  }
}

/**
 * Module-init selection: no `REDIS_URL` means today's direct DB path (dev/e2e
 * unchanged). With a URL, connect in the background — boot must not block or
 * crash if Redis is briefly unreachable — and `disableOfflineQueue` makes
 * commands reject immediately while disconnected so reads fail open to the DB
 * instead of hanging on a queued command.
 */
export function createNotesCache(redisUrl: string | undefined): NotesCache {
  if (!redisUrl) return new NotesCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new NotesCache(client);
}
