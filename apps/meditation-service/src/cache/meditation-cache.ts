import { createClient } from 'redis';
import { ReadThroughCache, type CacheClient } from '@life/cache';

/**
 * meditation-service's single namespace adapter over the generic read-through
 * cache (`@life/cache`, `SPEC-meditation-app` "Cache Rules", AGENTS.md Contract 2
 * Rule 4).
 *
 * The generation-counter mechanics, fail-open, stale-guard, TTL, and
 * rows-as-persisted discipline all live in the shared package; this module pins the
 * `meditation` namespace and nothing else. The shared key builder composes
 * `meditation:<sub>:v<gen>:settings`, `meditation:<sub>:v<gen>:sessions:<from>:<to>`,
 * `meditation:<sub>:v<gen>:sessions:list` and `meditation:<sub>:v<gen>:session:<id>`,
 * and the counter is `meditation:gen:<sub>` — never built by hand here.
 *
 * There is exactly ONE adapter for the whole service (no per-domain cache module):
 * every write path bumps the owner's single generation, invalidating all of that
 * owner's reads at once.
 */
const SERVICE = 'meditation';

export { CACHE_TTL_SECONDS } from '@life/cache';
export type { CacheClient, CacheHitOptions, CacheSetOptions } from '@life/cache';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const MEDITATION_CACHE = Symbol('MEDITATION_CACHE');

export class MeditationCache extends ReadThroughCache {
  constructor(client: CacheClient | null) {
    super({ service: SERVICE, client });
  }
}

/**
 * Module-init selection: no `REDIS_URL` means the direct DB path (dev/e2e
 * unchanged). With a URL, connect in the background — boot must not block or crash
 * if Redis is briefly unreachable — and `disableOfflineQueue` makes commands reject
 * immediately while disconnected, so reads fail open to the DB instead of hanging
 * on a queued command.
 */
export function createMeditationCache(redisUrl: string | undefined): MeditationCache {
  if (!redisUrl) return new MeditationCache(null);

  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new MeditationCache(client);
}
