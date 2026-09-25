import { createHash } from 'crypto';
import { createClient } from 'redis';

/**
 * Read-through cache for `NotesService` reads, invalidated by a *generation
 * counter* (`INCR note:gen`) rather than per-key deletes.
 *
 * Why generation-bump over per-key invalidation: a single write can invalidate
 * an unbounded number of read keys (every `findAll` filter/cursor combination,
 * the trash page, the tag list, one note). Tracking which keys exist would need
 * `KEYS`/`SCAN` (O(N) and cluster-hostile) or a parallel bookkeeping structure
 * that can drift. Bumping one integer moves every subsequent read onto a new key
 * namespace; the old keys are simply unreachable and age out via the 60s TTL.
 * One atomic op per write, cluster-safe, and impossible to leave partially
 * invalidated.
 *
 * Fail-open is the contract: every Redis path is wrapped so an error degrades to
 * the DB. Cache loss is never a correctness problem — only a performance one.
 */

/** The single counter every read key embeds; bumped once per write. */
export const GENERATION_KEY = 'note:gen';

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

/** Stable, collision-resistant hash of a request's option shape. */
export function hashOptions(opts: Record<string, unknown>): string {
  return createHash('sha1').update(stableStringify(opts)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export class NotesCache {
  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(private readonly client: CacheClient | null) {}

  /**
   * Read-through with the stale-guard. The generation is captured *before* the
   * loader runs and re-read *after* it: if a write bumped the counter while the
   * DB query was in flight, the freshly-queried value is now stale, so it is
   * never written under the new generation (which would mask that write for the
   * TTL). The next read misses and observes the write.
   */
  async getThrough<T>(baseKey: string, loader: () => Promise<T>): Promise<T> {
    const client = this.client;
    if (!client) return loader();

    let genBefore: number;
    try {
      genBefore = await this.readGeneration(client);
      const cached = await client.get(this.key(baseKey, genBefore));
      if (cached !== null) return JSON.parse(cached) as T;
    } catch {
      return loader(); // any cache error: correct, degraded DB path
    }

    const value = await loader();

    try {
      const genAfter = await this.readGeneration(client);
      if (genAfter === genBefore) {
        await client.set(this.key(baseKey, genBefore), JSON.stringify(value), {
          EX: CACHE_TTL_SECONDS,
        });
      }
    } catch {
      /* fail open: the populate is best-effort; response is already computed */
    }

    return value;
  }

  /**
   * One `INCR` invalidates every read. Called *after* each write's DB mutation
   * (review finding 2026-09-25). Bump-after closes a stale window that
   * bump-before leaves open: a read landing between the bump and the mutation
   * would see the new generation, query the DB mid-write (pre-mutation state),
   * find the generation still new, and cache that stale value under the new
   * generation for the TTL — the stale-guard only covers bumps that land *during*
   * the query. Emitting the bump only once the new state is durable guarantees
   * every entry that can hold pre-mutation state was born under the old
   * generation and dies on this bump. It also means a mutation that throws
   * (e.g. the optimistic-lock `ConflictException`) never bumps, so the cache
   * keeps serving a consistent view of a write that did not happen.
   *
   * The DB is the source of truth, so even the tiny ordering gap is safe: a read
   * concurrent with the mutation either sees old state (which the bump then
   * retires) or new state. A Redis error here must never block the write — fail
   * open.
   */
  async bumpGeneration(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.incr(GENERATION_KEY);
    } catch {
      /* fail open: the write still proceeds; reads stay DB-served while down */
    }
  }

  private async readGeneration(client: CacheClient): Promise<number> {
    const raw = await client.get(GENERATION_KEY);
    if (raw === null) return 0; // fresh cache: generation 0 until the first write
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private key(baseKey: string, generation: number): string {
    const rest = baseKey.startsWith('note:') ? baseKey.slice('note:'.length) : baseKey;
    return `note:v${generation}:${rest}`;
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
