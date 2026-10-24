import 'server-only';
import { randomBytes } from 'crypto';
import { createBoundedRedisClient, type RedisSetOptions } from './redis-store';

/**
 * The cross-replica refresh lock — the distributed half of the "one refresh per
 * session" guarantee.
 *
 * Why this exists: the in-process single-flight map in `session.ts` dedupes
 * callers within ONE process. Two app replicas, both holding the same
 * near-expiry session, each have an empty map; both would present the *same*
 * rotating refresh token to the IdP, and rotation reuse detection revokes the
 * whole grant family (forcing every user to re-login). A `SET NX EX` on
 * `app:lock:refresh:<id>` makes those two replicas mutually exclusive: exactly
 * one of them refreshes, the rest wait for the rotated tokens.
 *
 * Tokens never pass through this module, but the client holds the connection
 * string, so it stays `server-only`.
 */

/**
 * The OIDC client's refresh abort bound: a refresh that has not completed by
 * this point is abandoned. The lock TTL MUST outlive it — if the lock could
 * expire while the winner is still inside this window, a second replica could
 * acquire the lock and present the same (now-rotated) token. Pinned by a test.
 */
export const OIDC_REFRESH_ABORT_MS = 30_000;

/**
 * Lock TTL, strictly greater than `OIDC_REFRESH_ABORT_MS` (decision 4). 35s
 * leaves a 5s margin over the 30s abort: a slow-but-alive winner keeps the lock
 * through its whole abort window, and a crashed winner releases it soon enough
 * that the next request retries without a stale lockout.
 */
export const REFRESH_LOCK_TTL_MS = 35_000;

/**
 * How often a lock loser re-reads the session record waiting for the winner's
 * rotated tokens. Small enough to return promptly, large enough not to hammer
 * Redis during the (bounded) wait.
 */
export const REFRESH_LOCK_POLL_INTERVAL_MS = 250;

/** Lock key prefix: `app:lock:refresh:<sessionId>`. */
export const REFRESH_LOCK_KEY_PREFIX = 'app:lock:refresh:';

/** The lock key for a session (shared by the Redis and in-process impls). */
export function refreshLockKey(sessionId: string): string {
  return `${REFRESH_LOCK_KEY_PREFIX}${sessionId}`;
}

/**
 * The exact client surface the lock depends on. Declared structurally so tests
 * can inject a fake with no real Redis, and so `createClient`/`createCluster`
 * both satisfy it (cluster-ready by construction).
 */
export interface RefreshLockClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface RefreshLockOptions {
  /** Override the lock TTL (tests shorten it; production uses the constant). */
  ttlMs?: number;
  /** Override the loser poll interval. */
  pollIntervalMs?: number;
  /**
   * Resolves once the client is connected OR the cold-connect watchdog has
   * elapsed (see `connectBounded`) — whichever comes first. node-redis opens no
   * socket until `connect()`, so the factory holds that one in-flight promise and
   * every command awaits it; because it always settles, an unreachable Redis
   * degrades the lock (see below) instead of hanging the refresh path. The bound
   * is only on our wait: node-redis keeps retrying in the background.
   */
  ready?: Promise<unknown>;
}

/**
 * The outcome of trying to take the lock:
 * - `acquired` — we are the one winner; the caller MUST `release()` when done.
 * - `busy` — another replica holds it; the caller must NOT refresh, it waits.
 * - `disabled` — no shared Redis configured (`REDIS_URL` unset): today's
 *   in-process-only behavior, the caller refreshes directly.
 * - `degraded` — Redis errored on the lock command: the caller refreshes
 *   directly, protected only by the in-process single-flight.
 */
export type AcquireResult =
  | { status: 'acquired'; release: () => Promise<void> }
  | { status: 'busy' }
  | { status: 'disabled' }
  | { status: 'degraded' };

export interface RefreshLock {
  /** TTL of the lock (also the loser's wait bound). */
  readonly ttlMs: number;
  /** Loser poll interval. */
  readonly pollIntervalMs: number;
  /**
   * False when there is no shared Redis (`REDIS_URL` unset). Checked
   * *synchronously* so the in-process-only path performs today's exact call
   * sequence — no extra `await`, no lock round-trip — keeping behavior and
   * timing byte-identical for dev/e2e.
   */
  readonly distributed: boolean;
  /** Attempts to take `app:lock:refresh:<sessionId>`. Never throws. */
  acquire(sessionId: string): Promise<AcquireResult>;
}

/** `REDIS_URL` unset: no cross-process lock, in-process behavior unchanged. */
class NullRefreshLock implements RefreshLock {
  readonly ttlMs = REFRESH_LOCK_TTL_MS;
  readonly pollIntervalMs = REFRESH_LOCK_POLL_INTERVAL_MS;
  readonly distributed = false;

  async acquire(): Promise<AcquireResult> {
    return { status: 'disabled' };
  }
}

export class RedisRefreshLock implements RefreshLock {
  readonly ttlMs: number;
  readonly pollIntervalMs: number;
  readonly distributed = true;
  private readyPromise: Promise<unknown> | undefined;

  constructor(
    private readonly client: RefreshLockClient,
    private readonly options: RefreshLockOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? REFRESH_LOCK_TTL_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? REFRESH_LOCK_POLL_INTERVAL_MS;
  }

  /**
   * The connect promise, created on first use rather than in the constructor:
   * a constructor is synchronous, so the async hand-off happens where the lock
   * actually needs it. `??=` keeps it a single promise for the instance's life.
   */
  private get ready(): Promise<unknown> {
    return (this.readyPromise ??= this.options.ready ?? Promise.resolve());
  }

  async acquire(sessionId: string): Promise<AcquireResult> {
    // A random token identifies this holder: on release we only delete a lock
    // we still own (see `release`).
    const token = randomBytes(16).toString('base64url');
    const key = refreshLockKey(sessionId);
    let result: unknown;
    try {
      await this.ready;
      result = await this.client.set(key, token, { NX: true, EX: this.ttlSeconds() });
    } catch {
      // Redis error on the lock command is NOT a reason to fail the whole auth
      // path (that is the *session store*'s fail-closed rule). Degrade to the
      // in-process single-flight: within one replica it still dedupes, so this
      // never produces a double-refresh in-process. Across replicas we lose the
      // guarantee until Redis recovers — an accepted, temporary degradation.
      return { status: 'degraded' };
    }
    // node-redis `SET … NX` returns null when the key already exists.
    if (result == null) return { status: 'busy' };
    return { status: 'acquired', release: () => this.release(key, token) };
  }

  /**
   * Deletes the lock only if it is still ours. The GET→compare→DEL is not
   * atomic: between the compare and the DEL our TTL could lapse and another
   * replica could acquire the lock, and our DEL would then drop *its* lock.
   * The TTL bounds that window — it can only happen when our lock already
   * expired, and the new owner's own TTL keeps the mutual exclusion intact
   * (at worst one extra waiter proceeds and refreshes once more, which the
   * lock's TTL > abort margin makes astronomically unlikely). No LUA needed.
   */
  private async release(key: string, token: string): Promise<void> {
    try {
      await this.ready;
      if ((await this.client.get(key)) !== token) return;
      await this.client.del(key);
    } catch {
      // Best-effort: a failed release is not fatal — the TTL reaps the lock.
    }
  }

  /** Redis EXPIRE/SET EX are whole seconds; round up so the TTL is never short. */
  private ttlSeconds(): number {
    return Math.max(1, Math.ceil(this.ttlMs / 1000));
  }
}

/**
 * Selected once at module init: `REDIS_URL` set → the shared lock; unset → a
 * no-op whose `disabled` outcome keeps today's in-process-only behavior
 * byte-identical.
 */
export function createRefreshLock(): RefreshLock {
  const url = process.env.REDIS_URL;
  if (!url) return new NullRefreshLock();
  // Same bounded, fail-closed client as the session store: an unreachable Redis
  // must degrade the lock (acquire → `degraded`), never hang the refresh path.
  const { client, ready } = createBoundedRedisClient(url);
  return new RedisRefreshLock(client, { ready });
}

/**
 * The active lock, created lazily so importing this module never opens a socket
 * when no refresh runs. `setRefreshLockForTests` swaps it in specs.
 */
let activeLock: RefreshLock | undefined;

export function getRefreshLock(): RefreshLock {
  activeLock ??= createRefreshLock();
  return activeLock;
}

/** Test aid: inject a lock, or `undefined` to restore lazy production selection. */
export function setRefreshLockForTests(lock: RefreshLock | undefined): void {
  activeLock = lock;
}
