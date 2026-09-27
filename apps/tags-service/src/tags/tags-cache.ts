import { createClient } from 'redis';
import {
  CACHE_TTL_SECONDS,
  createCache,
  ReadThroughCache,
  type CacheClient,
  type CacheHitOptions,
  type CacheSetOptions,
} from '@life/cache';

/**
 * tags-service's adapter over the generic read-through cache (`@life/cache`,
 * `SPEC-service-kernel` "Shared primitives"). All generation-counter mechanics,
 * fail-open, stale-guard, TTL, and ciphertext-value discipline live in the shared
 * package; this module only pins the `tags` namespace and the single `<rest>`
 * this service ever uses.
 *
 * Key shape (`SPEC-tags-service` Cache Rules): `tags:<sub>:v<gen>:all` — the
 * owner's serialized **ciphertext** tag rows. One entry serves BOTH the list and
 * `resolve` (slice by id in memory after the hit); no request parameters enter
 * the key. The counter key is `tags:gen:<sub>` (shared Redis, disjoint from
 * `note:`/`todo:`).
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every tag key (and counter) carries on shared Redis. */
const SERVICE = 'tags';

/** The only `<rest>` this service caches: the owner's whole tag row-set. */
const ALL = 'all';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const TAGS_CACHE = Symbol('TAGS_CACHE');

export class TagsCache {
  private readonly inner: ReadThroughCache;

  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(client: CacheClient | null) {
    this.inner = createCache({ service: SERVICE, client });
  }

  /** Read-through the owner's single row-set entry; `loader` returns ciphertext rows. */
  async getThrough<T>(
    sub: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    return this.inner.getThrough(sub, ALL, loader, options);
  }

  /** Invalidate every one of this owner's reads after a successful write. */
  async bumpGeneration(sub: string): Promise<void> {
    await this.inner.bumpGeneration(sub);
  }
}

/**
 * Module-init selection: no `REDIS_URL` means the direct DB path (dev/e2e
 * unchanged). With a URL, connect in the background — boot must not block or
 * crash if Redis is briefly unreachable — and `disableOfflineQueue` makes
 * commands reject immediately while disconnected so reads fail open to the DB
 * instead of hanging on a queued command.
 */
export function createTagsCache(redisUrl: string | undefined): TagsCache {
  if (!redisUrl) return new TagsCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new TagsCache(client);
}
