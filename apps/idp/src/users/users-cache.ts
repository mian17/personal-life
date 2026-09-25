import type { OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';
import type { User } from './user.entity';

/**
 * Read-through cache in front of the users table. Exactly one hot read is served
 * from it (`UsersService.findByUsername`, hit by every login attempt). Rotating
 * OIDC state (sessions/grants/interactions) is deliberately NOT cached — it
 * revokes or rotates on each use, so a stale value would be a security bug and
 * the hit rate is ~0. This module therefore never imports from `src/oidc/**`.
 */

/** DI token for the selected cache implementation (`UsersCacheLike`). */
export const USERS_CACHE = Symbol('USERS_CACHE');

/** Positive TTL ceiling from the spec: a user row may be at most 300s stale. */
export const USERS_CACHE_TTL_SECONDS = 300;

/** Unknown usernames cache a short-lived sentinel to blunt brute-force DB reads. */
export const USERS_NEGATIVE_TTL_SECONDS = 30;

/**
 * Sentinel stored for a known-absent username. A cached user row always starts
 * with `{` (JSON object), so this bare token is unambiguous.
 */
const NEGATIVE_SENTINEL = '__idp_user_absent__';

/** Key layout: `idp:user:<username>` — the username is the only identifier stored. */
export function userCacheKey(username: string): string {
  return `idp:user:${username}`;
}

/**
 * Minimal structural surface the cache needs. The real node-redis client and
 * the test doubles both satisfy it; typing it here keeps the helper free of the
 * client's generic machinery.
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  close?(): Promise<void>;
}

/** The cache seam the service depends on (thin: get-through + invalidate). */
export interface UsersCacheLike {
  getThrough(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<User | null>,
  ): Promise<User | null>;
  invalidate(key: string): Promise<void>;
}

/** `REDIS_URL` unset: no cache, every read goes straight to the DB (today's path). */
export class PassthroughCache implements UsersCacheLike {
  getThrough(
    _key: string,
    _ttlSeconds: number,
    loader: () => Promise<User | null>,
  ): Promise<User | null> {
    return loader();
  }

  async invalidate(_key: string): Promise<void> {
    // Nothing cached; no-op.
  }
}

/** Serializes the full row, including the argon2 hash `verifyPassword` needs. */
function encodeUser(user: User): string {
  return JSON.stringify(user);
}

/** Revives the row; `createdAt` round-trips as an ISO string, so restore the Date. */
function decodeUser(raw: string): User | null {
  const parsed = JSON.parse(raw) as Partial<User>;
  if (
    typeof parsed?.id !== 'string' ||
    typeof parsed?.username !== 'string' ||
    typeof parsed?.passwordHash !== 'string' ||
    typeof parsed?.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: parsed.id,
    username: parsed.username,
    passwordHash: parsed.passwordHash,
    createdAt: new Date(parsed.createdAt),
  } as User;
}

/**
 * Redis-backed read-through cache. Fail-open is the hard rule: any cache error
 * (read, write, or invalidate) falls through to the DB, so a Redis outage only
 * costs latency, never correctness. The cached value is never logged.
 */
export class RedisUsersCache implements UsersCacheLike, OnModuleDestroy {
  constructor(private readonly client: CacheClient) {}

  async getThrough(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<User | null>,
  ): Promise<User | null> {
    try {
      const cached = await this.client.get(key);
      if (cached !== null) {
        if (cached === NEGATIVE_SENTINEL) return null;
        const user = decodeUser(cached);
        // A corrupt or foreign value is treated as a miss and re-populated below.
        if (user) return user;
      }
    } catch {
      // Redis unreachable → fall through to the DB (degraded, never wrong).
    }

    const user = await loader();
    try {
      await this.client.set(
        key,
        user ? encodeUser(user) : NEGATIVE_SENTINEL,
        // Unknown usernames get the short sentinel TTL from the spec.
        { EX: user ? ttlSeconds : USERS_NEGATIVE_TTL_SECONDS },
      );
    } catch {
      // A failed population costs a future miss, not correctness.
    }
    return user;
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      // A write raced an outage; the entry still expires within its TTL.
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.close?.();
    } catch {
      // A close failure during shutdown must never surface; the process is going away.
    }
  }
}

/**
 * One decision at module init: `REDIS_URL` set → cached wrapper, unset → the
 * plain DB path. The connection is established in the background and never
 * blocks boot; commands issued before ready reject fast (`disableOfflineQueue`)
 * and fall open to the DB, then the client reconnects on its own.
 */
export function createUsersCache(redisUrl: string | undefined): UsersCacheLike {
  if (!redisUrl) return new PassthroughCache();

  const client = createClient({
    url: redisUrl,
    // Reject instead of queueing while the socket is not ready → immediate fail-open.
    disableOfflineQueue: true,
    socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
  });
  // node-redis emits `error` with no listener → EventEmitter throws. Sink it; the
  // URL may carry credentials and cached values are never logged, so stay quiet.
  client.on('error', () => undefined);
  void client.connect().catch(() => undefined);

  return new RedisUsersCache(client as unknown as CacheClient);
}
