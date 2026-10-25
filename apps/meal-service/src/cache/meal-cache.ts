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
 * meal-service's single namespace adapter over the generic read-through cache
 * (`@life/cache`, `SPEC-meal-service` Cache Rules, Contract 2 Rule 4). The
 * generation-counter mechanics, fail-open, stale-guard, TTL, and ciphertext
 * discipline all live in the shared package; this module only pins the `meal`
 * service namespace. Keys compose as `meal:<sub>:v<gen>:<rest>` and the counter
 * is `meal:gen:<sub>` — never built by hand here.
 *
 * There is exactly ONE adapter for the whole service (no per-domain cache
 * module): every write path bumps the owner's single generation, invalidating
 * all of that owner's reads at once.
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every meal key (and counter) carries. */
const SERVICE = 'meal';

/** The per-user counter every one of that user's read keys embeds; bumped once per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const MEAL_CACHE = Symbol('MEAL_CACHE');

export class MealCache {
  private readonly inner: ReadThroughCache;

  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(client: CacheClient | null) {
    this.inner = createCache({ service: SERVICE, client });
  }

  getThrough<T>(
    sub: string,
    baseKey: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    // Call sites pass `meal:`-prefixed keys; the generic layer composes the
    // prefix itself, so strip it to keep the final key byte-identical.
    const prefix = `${SERVICE}:`;
    const rest = baseKey.startsWith(prefix) ? baseKey.slice(prefix.length) : baseKey;
    return this.inner.getThrough(sub, rest, loader, options);
  }

  async bumpGeneration(sub: string): Promise<void> {
    await this.inner.bumpGeneration(sub);
  }
}

/**
 * Module-init selection: no `REDIS_URL` means today's direct-DB path (dev/e2e
 * unchanged — `REDIS_URL` is unset there by design). With a URL, connect in the
 * background — boot must not block or crash if Redis is briefly unreachable —
 * and `disableOfflineQueue` makes commands reject immediately while
 * disconnected so reads fail open to the DB instead of hanging.
 */
export function createMealCache(redisUrl: string | undefined): MealCache {
  if (!redisUrl) return new MealCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new MealCache(client);
}
