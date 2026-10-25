import { createClient } from 'redis';
import {
  CACHE_TTL_SECONDS,
  ReadThroughCache,
  type CacheClient,
  type CacheHitOptions,
  type CacheSetOptions,
} from '@life/cache';

/**
 * feedback-service's adapter over the generic read-through cache (`@life/cache`,
 * `SPEC-service-kernel` "Shared primitives" — AGENTS.md Contract 2 no-fork
 * rule). Generation-counter mechanics, fail-open, stale-guard, TTL, and the
 * ciphertext-value discipline all live in the shared package; this module only
 * pins the `feedback` namespace.
 *
 * Key shapes (`SPEC-feedback-service` Cache Rules):
 * - `feedback:<sub>:v<gen>:list` — the owner's full `feedback` row set
 *   serialized **as persisted** (`title` and `description` both `enc.v1.`
 *   envelopes). Filters and pagination never enter the key, so one entry serves
 *   every read.
 * - `feedback:gen:<sub>` — the per-owner counter, `INCR`ed after each write.
 *   60s TTL is the backstop; any client error fails open to the direct loader.
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every feedback key (and counter) carries on shared Redis. */
const SERVICE = 'feedback';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const FEEDBACK_CACHE = Symbol('FEEDBACK_CACHE');

export class FeedbackCache extends ReadThroughCache {
  constructor(client: CacheClient | null) {
    super({ service: SERVICE, client });
  }
}

/**
 * Module-init selection: no `REDIS_URL` means the direct DB path (dev/e2e
 * unchanged). With a URL, connect in the background — boot must not block or
 * crash if Redis is briefly unreachable — and `disableOfflineQueue` makes
 * commands reject immediately while disconnected so reads fail open to the DB
 * instead of hanging on a queued command.
 */
export function createFeedbackCache(redisUrl: string | undefined): FeedbackCache {
  if (!redisUrl) return new FeedbackCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new FeedbackCache(client);
}
