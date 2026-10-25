import { createClient } from 'redis';
import { createCache, ReadThroughCache, type CacheClient, type CacheHitOptions } from '@life/cache';

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
const SERVICE = 'feedback';

/** Nest DI token for the module-init cache selection. */
export const FEEDBACK_CACHE = Symbol('FEEDBACK_CACHE');

export class FeedbackCache {
  private readonly inner: ReadThroughCache;

  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(client: CacheClient | null) {
    this.inner = createCache({ service: SERVICE, client });
  }

  /** Read-through one of this owner's entries; `loader` returns stored rows. */
  getThrough<T>(
    sub: string,
    rest: string,
    loader: () => Promise<T>,
    options: CacheHitOptions<T> = {},
  ): Promise<T> {
    return this.inner.getThrough(sub, rest, loader, options);
  }

  /** Invalidate every one of this owner's reads after a successful write. */
  async bumpGeneration(sub: string): Promise<void> {
    await this.inner.bumpGeneration(sub);
  }
}

/**
 * Module-init selection: no `REDIS_URL` means the direct DB path (dev/e2e).
 * With a URL, connect in the background — boot must not block or crash if Redis
 * is briefly unreachable — and `disableOfflineQueue` makes commands reject
 * immediately while disconnected so reads fail open to the DB instead of
 * hanging on a queued command.
 */
export function createFeedbackCache(redisUrl: string | undefined): FeedbackCache {
  if (!redisUrl) return new FeedbackCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new FeedbackCache(client);
}