import { createSession, getValidSession, clearInFlightRefreshes } from '@/lib/auth/session';
import { SESSION_TTL_MS, REFRESH_SKEW_MS } from '@/lib/auth/session-store';
import { RedisSessionStore } from '@/lib/auth/redis-store';
import {
  OIDC_REFRESH_ABORT_MS,
  REFRESH_LOCK_TTL_MS,
  RedisRefreshLock,
  refreshLockKey,
  setRefreshLockForTests,
  type RefreshLock,
} from '@/lib/auth/refresh-lock';
import type { Tokens } from '@/lib/auth/oidc-client';
import { FakeRedis } from './stubs/fake-redis';

/**
 * The cross-replica refresh lock (Task 2b). The in-process single-flight map
 * (proved in `session.test.ts`) only dedupes callers inside ONE process; two app
 * replicas sharing one Redis still both see the same near-expiry session and
 * would both present the *same* rotating refresh token — reuse detection then
 * revokes the whole grant family. These tests prove the `SET NX EX` lock makes
 * two lock clients (two simulated replicas) perform exactly one refresh, that
 * losers never present a refresh token, and that a crashed winner cannot lock
 * anyone out forever.
 */

function tokens(overrides: Partial<Tokens> = {}): Tokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: 'id.jwt.token',
    expiresIn: 600,
    subject: 'user-1',
    ...overrides,
  };
}

/** A Redis-backed store on the fake client, sharing one injected clock. */
function redisStore(clock: () => number) {
  return new RedisSessionStore(new FakeRedis(clock), { ttlMs: SESSION_TTL_MS, now: clock });
}

/** Drain the promise/microtask chain up to the point a pending refresh suspends. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** The access token expiry instant that lands inside `REFRESH_SKEW_MS`. */
function atExpiryEdge(clock: () => number): number {
  return clock() + 600_000 - REFRESH_SKEW_MS + 1;
}

describe('refresh lock TTL (must outlive the OIDC abort)', () => {
  it('is strictly greater than the OIDC client 30s refresh abort', () => {
    // If the lock could expire while a refresh was still inside the client's
    // abort window, a second replica could acquire it and present the same
    // (now-rotated) token — the exact reuse-detection defect this lock exists
    // to prevent.
    expect(OIDC_REFRESH_ABORT_MS).toBe(30_000);
    expect(REFRESH_LOCK_TTL_MS).toBeGreaterThan(OIDC_REFRESH_ABORT_MS);
  });
});

describe('RedisRefreshLock (mutual exclusion on one Redis)', () => {
  it('grants the lock to exactly one of two clients over the same Redis', async () => {
    const redis = new FakeRedis();
    const a = new RedisRefreshLock(redis);
    const b = new RedisRefreshLock(redis);

    const first = await a.acquire('sess-1');
    const second = await b.acquire('sess-1');

    expect(first.status).toBe('acquired');
    // The second replica must NOT get the lock while the first holds it.
    expect(second.status).toBe('busy');
    expect(redis.has(refreshLockKey('sess-1'))).toBe(true);
  });

  it('releases only when the stored token is still ours', async () => {
    const redis = new FakeRedis();
    const lock = new RedisRefreshLock(redis);
    const acquired = await lock.acquire('sess-1');
    expect(acquired.status).toBe('acquired');

    // Simulate the lock TTL lapsing and another replica re-acquiring: our
    // stale release must not delete the new owner's lock.
    await redis.del(refreshLockKey('sess-1'));
    await redis.set(refreshLockKey('sess-1'), 'someone-else', { NX: true });

    if (acquired.status === 'acquired') await acquired.release();
    expect(redis.rawValue(refreshLockKey('sess-1'))).toBe('someone-else');
  });

  it('degrades to "no cross-process lock" on a Redis error (never throws)', async () => {
    const redis = new FakeRedis();
    redis.setFailing(true);
    const lock = new RedisRefreshLock(redis);

    // Fail closed would mean the whole auth path dies; instead the caller
    // proceeds on the in-process single-flight alone (documented degraded mode).
    await expect(lock.acquire('sess-1')).resolves.toEqual({ status: 'degraded' });
  });

  it('reports disabled when there is no shared Redis (in-process-only behavior)', async () => {
    // The production `NullRefreshLock` is what `REDIS_URL`-unset resolves to;
    // `setRefreshLockForTests` with an in-process-only lock is the same shape.
    class Disabled implements RefreshLock {
      readonly ttlMs = REFRESH_LOCK_TTL_MS;
      readonly pollIntervalMs = 250;
      readonly distributed = false;
      async acquire(_sessionId: string) {
        return { status: 'disabled' as const };
      }
    }
    const lock = new Disabled();
    await expect(lock.acquire('sess-1')).resolves.toEqual({ status: 'disabled' });
  });
});

describe('getValidSession under the cross-replica lock', () => {
  afterEach(() => {
    setRefreshLockForTests(undefined);
    clearInFlightRefreshes();
  });

  it('two lock clients, one Redis: exactly one refresh; the loser gets the winner tokens', async () => {
    const clock = 1_000_000;
    const now = () => clock;
    const redis = new FakeRedis(now);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now });
    const session = await createSession(tokens(), store);

    const lockA = new RedisRefreshLock(redis, { pollIntervalMs: 1, ttlMs: 50 });
    const lockB = new RedisRefreshLock(redis, { pollIntervalMs: 1, ttlMs: 50 });

    // Replica A wins the lock and starts a slow refresh.
    setRefreshLockForTests(lockA);
    let releaseRefresh!: (t: Tokens) => void;
    const winnerRefresh = jest.fn(
      (_rt: string) => new Promise<Tokens>((resolve) => (releaseRefresh = resolve)),
    );
    const winner = getValidSession(session.id, atExpiryEdge(now), winnerRefresh, store);
    await flush();

    expect(winnerRefresh).toHaveBeenCalledTimes(1);
    expect(redis.has(refreshLockKey(session.id))).toBe(true);

    // Replica B is a separate process: its in-process single-flight map is
    // empty, so it actually reaches the lock and becomes a waiter.
    clearInFlightRefreshes();
    setRefreshLockForTests(lockB);
    const loserRefresh = jest.fn();
    const loser = getValidSession(session.id, atExpiryEdge(now), loserRefresh, store);
    await flush();

    // The loser must NEVER present a refresh token.
    expect(loserRefresh).not.toHaveBeenCalled();

    releaseRefresh(tokens({ accessToken: 'at-2', refreshToken: 'rt-2' }));
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);

    expect(winnerRefresh).toHaveBeenCalledTimes(1);
    expect(loserRefresh).not.toHaveBeenCalled();
    expect(winnerResult?.accessToken).toBe('at-2');
    // The loser observes the winner's rotated tokens rather than re-refreshing.
    expect(loserResult?.accessToken).toBe('at-2');
    expect(loserResult?.refreshToken).toBe('rt-2');
  });

  it('re-reads under the lock: the stored tokens changed between our read and our acquire', async () => {
    const clock = 1_000_000;
    const now = () => clock;
    const redis = new FakeRedis(now);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now });
    const session = await createSession(tokens(), store);

    // A lock whose acquisition we can hold open, so a "winner" refresh can land
    // in the gap between our session read and our acquire. Without the re-read
    // we would present the snapshot's now-rotated refresh token.
    let openAcquire!: () => void;
    const gate = new Promise<void>((resolve) => (openAcquire = resolve));
    const lock: RefreshLock = {
      ttlMs: REFRESH_LOCK_TTL_MS,
      pollIntervalMs: 250,
      distributed: true,
      async acquire() {
        await gate;
        return { status: 'acquired', release: async () => {} };
      },
    };
    setRefreshLockForTests(lock);

    const refresh = jest.fn();
    const pending = getValidSession(session.id, atExpiryEdge(now), refresh, store);
    await flush();
    // Another replica refreshed while we waited for the lock.
    await store.update(session.id, { accessToken: 'at-2', refreshToken: 'rt-2' });
    openAcquire();

    const result = await pending;
    expect(refresh).not.toHaveBeenCalled();
    expect(result?.accessToken).toBe('at-2');
    expect(result?.refreshToken).toBe('rt-2');
  });

  it('a crashed winner expires: the lock lapses and a later request refreshes again', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const redis = new FakeRedis(now);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now });
    const session = await createSession(tokens(), store);

    // Short TTL so the test can advance the fake clock past the whole-second
    // Redis EX; the loser's own deadline is correspondingly short.
    const lock = new RedisRefreshLock(redis, { pollIntervalMs: 2, ttlMs: 20 });
    setRefreshLockForTests(lock);

    // A crashed winner: takes the lock and never releases it.
    const crashed = await lock.acquire(session.id);
    expect(crashed.status).toBe('acquired');

    // While the lock is held the request must not present a refresh token and
    // must give up at its (TTL-bounded) deadline.
    const blockedRefresh = jest.fn();
    const blocked = await getValidSession(session.id, atExpiryEdge(now), blockedRefresh, store);
    expect(blockedRefresh).not.toHaveBeenCalled();
    expect(blocked).toBeUndefined();

    // The crashed holder's lock lapses (EX is whole seconds → 1000ms minimum).
    clock += 1000;
    expect(redis.has(refreshLockKey(session.id))).toBe(false);

    const freshRefresh = jest
      .fn()
      .mockResolvedValue(tokens({ accessToken: 'at-2', refreshToken: 'rt-2' }));
    const result = await getValidSession(session.id, atExpiryEdge(now), freshRefresh, store);
    expect(freshRefresh).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBe('at-2');
  });

  it('loser deadline: a winner that never writes tokens yields undefined (re-login)', async () => {
    const clock = 1_000_000;
    const now = () => clock;
    const redis = new FakeRedis(now);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now });
    const session = await createSession(tokens(), store);

    const lock = new RedisRefreshLock(redis, { pollIntervalMs: 2, ttlMs: 20 });
    setRefreshLockForTests(lock);
    // A holder that stays live (never crashes, never writes) — the loser must
    // still be bounded by the lock TTL rather than hang until the session dies.
    await lock.acquire(session.id);

    const refresh = jest.fn();
    const result = await getValidSession(session.id, atExpiryEdge(now), refresh, store);

    expect(refresh).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('a session that vanishes mid-wait makes the loser bail out (no refresh)', async () => {
    const clock = 1_000_000;
    const now = () => clock;
    const redis = new FakeRedis(now);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now });
    const session = await createSession(tokens(), store);

    const lock = new RedisRefreshLock(redis, { pollIntervalMs: 2, ttlMs: 200 });
    setRefreshLockForTests(lock);
    await lock.acquire(session.id);

    const refresh = jest.fn();
    const pending = getValidSession(session.id, atExpiryEdge(now), refresh, store);
    await flush();
    // The winner failed and destroyed the session (its `destroy` on refresh
    // failure) while we were waiting; we must not re-present the dead token.
    await store.destroy(session.id);

    expect(await pending).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Redis-error degraded mode: the lock is skipped and the in-process single-flight still holds', async () => {
    const clock = 1_000_000;
    const now = () => clock;
    const sessionStore = redisStore(now);
    const session = await createSession(tokens(), sessionStore);

    // The session store is healthy; the LOCK's Redis command fails. The caller
    // must still refresh (not fail closed) and concurrent in-process callers
    // must still share ONE refresh.
    const failingLockRedis = new FakeRedis(now);
    failingLockRedis.setFailing(true);
    setRefreshLockForTests(new RedisRefreshLock(failingLockRedis, { pollIntervalMs: 1 }));

    let releaseRefresh!: (t: Tokens) => void;
    const refresh = jest.fn(
      (_rt: string) => new Promise<Tokens>((resolve) => (releaseRefresh = resolve)),
    );
    const at = atExpiryEdge(now);
    const first = getValidSession(session.id, at, refresh, sessionStore);
    const second = getValidSession(session.id, at, refresh, sessionStore);
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    releaseRefresh(tokens({ accessToken: 'at-2', refreshToken: 'rt-2' }));
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1?.accessToken).toBe('at-2');
    expect(r2).toBe(r1);
  });
});
