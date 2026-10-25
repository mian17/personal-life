import { createClient } from 'redis';
import {
  CACHE_TTL_SECONDS,
  ReadThroughCache,
  type CacheClient,
  type CacheHitOptions,
  type CacheSetOptions,
} from '@life/cache';

/**
 * note-service's adapter over the generic read-through cache (`@life/cache`,
 * `SPEC-service-kernel` "Shared primitives"). Generation-counter mechanics,
 * fail-open, stale-guard, TTL, and ciphertext-value discipline live in the shared
 * package; this module only pins the `note` namespace, and keeps the service's
 * existing import surface (`NotesCache`, `NOTES_CACHE`, `createNotesCache`,
 * `generationKey`, `CACHE_TTL_SECONDS`) source-compatible.
 *
 * Key shape is unchanged: `<rest>` (minus the `note:` prefix call sites carry) is
 * composed into `note:<sub>:v<gen>:<rest>`, and the counter key is
 * `note:gen:<sub>` — so every notes-cache assertion stays byte-identical.
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every note key (and counter) carries on shared Redis. */
const SERVICE = 'note';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const NOTES_CACHE = Symbol('NOTES_CACHE');

export class NotesCache extends ReadThroughCache {
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
export function createNotesCache(redisUrl: string | undefined): NotesCache {
  if (!redisUrl) return new NotesCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new NotesCache(client);
}
