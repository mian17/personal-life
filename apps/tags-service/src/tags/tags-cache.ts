import { createClient } from 'redis';
import {
  CACHE_TTL_SECONDS,
  ReadThroughCache,
  type CacheClient,
  type CacheHitOptions,
  type CacheSetOptions,
} from '@life/cache';

/**
 * tags-service's adapter over the generic read-through cache (`@life/cache`,
 * `SPEC-service-kernel` "Shared primitives"). All generation-counter mechanics,
 * fail-open, stale-guard, TTL, and ciphertext-value discipline live in the shared
 * package; this module only pins the `tags` namespace.
 *
 * Key shape (`SPEC-tags-service` Cache Rules): `tags:<sub>:v<gen>:all` — the
 * owner's serialized **ciphertext** tag rows. One entry serves BOTH the list and
 * `resolve` (slice by id in memory after the hit); no request parameters enter
 * the key. The counter key is `tags:gen:<sub>` (shared Redis, disjoint from
 * `note:`/`todo:`).
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every tags key (and counter) carries on shared Redis. */
const SERVICE = 'tags';

/** The only `<rest>` this service caches: the owner's whole tag row-set. */
const ALL = 'all';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const TAGS_CACHE = Symbol('TAGS_CACHE');

/**
 * Read-through the owner's single row-set entry; `loader` returns ciphertext rows.
 * Named apart from the inherited generic `getThrough` because this service only
 * ever caches one `<rest>` value, so the key is not a caller concern.
 */
export class TagsCache extends ReadThroughCache {
  constructor(client: CacheClient | null) {
    super({ service: SERVICE, client });
  }

  getAllThrough<T>(
    sub: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    return super.getThrough(sub, ALL, loader, options);
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
