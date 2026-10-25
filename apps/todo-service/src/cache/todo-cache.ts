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
 * todo-service's adapter over the generic read-through cache (`@life/cache`,
 * `SPEC-service-kernel` "Shared primitives"). Generation-counter mechanics,
 * fail-open, stale-guard, TTL, and the ciphertext-value discipline live in the
 * shared package; this module only pins the `todo` namespace and the four
 * `<rest>` values this service ever uses.
 *
 * Key shapes (`SPEC-todo-service` Cache Rules): `todo:<sub>:v<gen>:all` (the
 * owner's full serialized **ciphertext** todo row-set, each row carrying its
 * `tagIds`), `todo:<sub>:v<gen>:lists` (list rows),
 * `todo:<sub>:v<gen>:tags` (tag-usage metadata: ids + counts only), and
 * `todo:<sub>:v<gen>:completions` (the completion log row-set). One `all`
 * entry serves every filter/page variant (`q`/`tagId`/`listId`/`done`/`due*`/
 * cursor/limit never enter the key). The counter key is `todo:gen:<sub>` (shared
 * Redis, disjoint from `note:`/`tags:`).
 *
 * Todos and lists are one service with one generation counter: a list write can
 * move `todo.listId` (`ON DELETE SET NULL`), so bumping the single counter
 * invalidates both shapes together — coarser than strictly needed, and correct.
 */

export { CACHE_TTL_SECONDS };
export type { CacheClient, CacheHitOptions, CacheSetOptions };

/** The namespace prefix every todo key (and counter) carries on shared Redis. */
const SERVICE = 'todo';

/** `<rest>` values: the owner's todo row-set, its lists, tag usage, and completions. */
export const TODO_ALL = 'all';
export const TODO_LISTS = 'lists';
export const TODO_TAGS = 'tags';
export const TODO_TRASH = 'trash';
export const TODO_COMPLETIONS = 'completions';

/** The per-user counter every one of that user's read keys embeds; bumped per write. */
export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

/** Nest DI token for the module-init cache selection. */
export const TODO_CACHE = Symbol('TODO_CACHE');

export class TodosCache {
  private readonly inner: ReadThroughCache;

  /** `null` client = Redis not configured; every call runs the loader directly. */
  constructor(client: CacheClient | null) {
    this.inner = createCache({ service: SERVICE, client });
  }

  /** Read-through one of the owner's four entries; `loader` returns stored rows. */
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
 * Module-init selection: no `REDIS_URL` means the direct DB path (dev/e2e
 * unchanged). With a URL, connect in the background — boot must not block or
 * crash if Redis is briefly unreachable — and `disableOfflineQueue` makes
 * commands reject immediately while disconnected so reads fail open to the DB
 * instead of hanging on a queued command.
 */
export function createTodosCache(redisUrl: string | undefined): TodosCache {
  if (!redisUrl) return new TodosCache(null);
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  // An unhandled 'error' event would crash the process; we degrade instead.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return new TodosCache(client);
}
