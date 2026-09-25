import {
  clearInFlightRefreshes,
  createSession,
  destroySession,
  getValidSession,
  readSession,
} from '@/lib/auth/session';
import { SessionStore, REFRESH_SKEW_MS, type AppSession } from '@/lib/auth/session-store';
import {
  REFRESH_LOCK_TTL_MS,
  setRefreshLockForTests,
  type RefreshLock,
} from '@/lib/auth/refresh-lock';
import type { Tokens } from '@/lib/auth/oidc-client';

const HOUR = 60 * 60 * 1000;

function tokens(expiresIn = 600): Tokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: 'id.jwt.token',
    expiresIn,
    subject: 'user-1',
  };
}

/** A store with a controllable clock, plus the clock's current value. */
function fixedStore(now = 1_000_000) {
  let clock = now;
  // Fresh backing map so tests never share the process-wide (globalThis) store.
  const store = new SessionStore(7 * 24 * HOUR, () => clock, new Map());
  return { store, advance: (ms: number) => (clock += ms), clock: () => clock };
}

describe('session lifecycle', () => {
  it('creates a session with the subject and a sliding 7-day expiry', async () => {
    const { store } = fixedStore();
    const session = await createSession(tokens(), store);
    expect(session.subject).toBe('user-1');
    expect(session.accessToken).toBe('at');
    // Expiry is the store's clock plus the 7-day TTL.
    expect(session.expiresAt).toBe(store.nowMs() + 7 * 24 * HOUR);
    expect(await readSession(session.id, store)).toBeDefined();
  });

  it('returns undefined for an unknown session and destroys on request', async () => {
    const { store } = fixedStore();
    expect(await readSession('nope', store)).toBeUndefined();
    const session = await createSession(tokens(), store);
    await destroySession(session.id, store);
    expect(await readSession(session.id, store)).toBeUndefined();
  });
});

describe('access-token refresh (re-login on failure)', () => {
  it('does not refresh while the access token is comfortably valid', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 60_000, refresh, store);
    expect(result?.accessToken).toBe('at');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when the access token is within the skew and stores the rotated tokens', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    const refresh = jest.fn().mockResolvedValue({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      idToken: null,
      expiresIn: 600,
      subject: 'user-1',
    });

    const atExpiryEdge = clock() + 600_000 - REFRESH_SKEW_MS + 1;
    const result = await getValidSession(session.id, atExpiryEdge, refresh, store);
    expect(refresh).toHaveBeenCalledWith('rt');
    expect(result?.accessToken).toBe('at-2');
    expect(result?.refreshToken).toBe('rt-2');
    expect((await readSession(session.id, store))?.accessToken).toBe('at-2');
  });

  it('single-flights concurrent refreshes: two callers, one refresh, one shared result', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    // A deferred refresh so both callers are genuinely in flight at once.
    let release!: (t: Tokens) => void;
    const refresh = jest.fn(
      (_rt: string) => new Promise<Tokens>((resolve) => (release = resolve)),
    );
    const at = clock() + 600_000 - REFRESH_SKEW_MS + 1;

    const first = getValidSession(session.id, at, refresh, store);
    const second = getValidSession(session.id, at, refresh, store);
    // The store read is now awaited (MaybePromise seam), so the refresh starts a
    // microtask after the calls; flush once before asserting single-flight.
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);

    release({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      idToken: null,
      expiresIn: 600,
      subject: 'user-1',
    });
    const [r1, r2] = await Promise.all([first, second]);

    // Exactly one refresh for the pair, and both callers see the same session.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('rt');
    expect(r1).toBe(r2);
    expect(r1?.accessToken).toBe('at-2');
    expect((await readSession(session.id, store))?.accessToken).toBe('at-2');
  });

  it('clears the in-flight refresh on failure so a later call may attempt again', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    // Keep the session alive through the failed refresh (which normally destroys
    // it) so the second call actually reaches the refresh path again.
    jest.spyOn(store, 'destroy').mockImplementation(() => undefined);
    const at = clock() + 600_000 + 1;

    const first = jest.fn().mockRejectedValue(new Error('invalid_grant'));
    expect(await getValidSession(session.id, at, first, store)).toBeUndefined();
    expect(first).toHaveBeenCalledTimes(1);

    const second = jest.fn().mockResolvedValue({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      idToken: null,
      expiresIn: 600,
      subject: 'user-1',
    });
    // Not the settled failed promise: a fresh attempt is made.
    const result = await getValidSession(session.id, at, second, store);
    expect(second).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBe('at-2');
  });

  it('destroys the session and returns undefined when refresh fails (no retry)', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    const error = Object.assign(new Error('invalid_grant'), { error: 'invalid_grant' });
    const refresh = jest.fn().mockRejectedValue(error);

    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);
    expect(result).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1); // never retried
    expect(await readSession(session.id, store)).toBeUndefined();
  });

  it('destroys the session when there is no refresh token to use', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession({ ...tokens(600), refreshToken: '' }, store);
    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);
    expect(result).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(await readSession(session.id, store)).toBeUndefined();
  });

  it('treats an expired session (sliding window lapsed) as unauthenticated', async () => {
    const { store, advance } = fixedStore();
    const session = await createSession(tokens(), store);
    advance(8 * 24 * HOUR);
    const result = await getValidSession(session.id, undefined, jest.fn(), store);
    expect(result).toBeUndefined();
  });
});

/**
 * Regression for the leaked `app:lock:refresh:<id>` (five-lane blocker B2): the
 * acquired lock's `release` originally sat in a `finally` that the two early
 * returns (session vanished / tokens already rotated) returned *before*, so the
 * lock was held for its full TTL and other replicas saw `busy`. Every
 * post-acquire path must release exactly once.
 */
describe('refresh lock release on every post-acquire path', () => {
  afterEach(() => {
    setRefreshLockForTests(undefined);
    clearInFlightRefreshes();
  });

  /**
   * A distributed lock whose `acquire` records a spy `release`. The store is
   * real (in-memory) so the test drives the vanished / adopted / refreshed paths
   * by controlling what `store.get`/`store.update`/`refresh` return.
   */
  function spyLock() {
    const release = jest.fn(async () => {});
    const acquire = jest.fn(async () => ({ status: 'acquired' as const, release }));
    const lock: RefreshLock = {
      ttlMs: REFRESH_LOCK_TTL_MS,
      pollIntervalMs: 250,
      distributed: true,
      acquire,
    };
    return { lock, release, acquire };
  }

  it('releases exactly once when the session vanished before the re-read', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    // First read (before the lock) sees the session; the winner destroyed it in
    // the gap, so the re-read under the lock sees nothing.
    jest.spyOn(store, 'get').mockReturnValueOnce(session).mockReturnValue(undefined);
    const { lock, release, acquire } = spyLock();
    setRefreshLockForTests(lock);

    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases exactly once when the tokens were already rotated (adopted)', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    // The re-read under the lock returns newer tokens → adopt, do not refresh.
    const rotated: AppSession = { ...session, accessToken: 'at-2', refreshToken: 'rt-2' };
    jest.spyOn(store, 'get').mockReturnValueOnce(session).mockReturnValueOnce(rotated);
    const { lock, release } = spyLock();
    setRefreshLockForTests(lock);

    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);

    expect(result?.accessToken).toBe('at-2');
    expect(refresh).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases exactly once on a successful refresh', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    const { lock, release } = spyLock();
    setRefreshLockForTests(lock);

    const refresh = jest.fn().mockResolvedValue({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      idToken: null,
      expiresIn: 600,
      subject: 'user-1',
    });
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);

    expect(result?.accessToken).toBe('at-2');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases exactly once when the refresh itself throws (finally still runs)', async () => {
    const { store, clock } = fixedStore();
    const session = await createSession(tokens(600), store);
    const { lock, release } = spyLock();
    setRefreshLockForTests(lock);

    const refresh = jest.fn().mockRejectedValue(
      Object.assign(new Error('invalid_grant'), { error: 'invalid_grant' }),
    );
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);

    expect(result).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
