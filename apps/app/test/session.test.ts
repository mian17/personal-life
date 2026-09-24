import {
  createSession,
  destroySession,
  getValidSession,
  readSession,
} from '@/lib/auth/session';
import { SessionStore, REFRESH_SKEW_MS } from '@/lib/auth/session-store';
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
  const store = new SessionStore(7 * 24 * HOUR, () => clock);
  return { store, advance: (ms: number) => (clock += ms), clock: () => clock };
}

describe('session lifecycle', () => {
  it('creates a session with the subject and a sliding 7-day expiry', () => {
    const { store } = fixedStore();
    const session = createSession(tokens(), store);
    expect(session.subject).toBe('user-1');
    expect(session.accessToken).toBe('at');
    // Expiry is the store's clock plus the 7-day TTL.
    expect(session.expiresAt).toBe(store.nowMs() + 7 * 24 * HOUR);
    expect(readSession(session.id, store)).toBeDefined();
  });

  it('returns undefined for an unknown session and destroys on request', () => {
    const { store } = fixedStore();
    expect(readSession('nope', store)).toBeUndefined();
    const session = createSession(tokens(), store);
    destroySession(session.id, store);
    expect(readSession(session.id, store)).toBeUndefined();
  });
});

describe('access-token refresh (re-login on failure)', () => {
  it('does not refresh while the access token is comfortably valid', async () => {
    const { store, clock } = fixedStore();
    const session = createSession(tokens(600), store);
    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 60_000, refresh, store);
    expect(result?.accessToken).toBe('at');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when the access token is within the skew and stores the rotated tokens', async () => {
    const { store, clock } = fixedStore();
    const session = createSession(tokens(600), store);
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
    expect(readSession(session.id, store)?.accessToken).toBe('at-2');
  });

  it('destroys the session and returns undefined when refresh fails (no retry)', async () => {
    const { store, clock } = fixedStore();
    const session = createSession(tokens(600), store);
    const error = Object.assign(new Error('invalid_grant'), { error: 'invalid_grant' });
    const refresh = jest.fn().mockRejectedValue(error);

    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);
    expect(result).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1); // never retried
    expect(readSession(session.id, store)).toBeUndefined();
  });

  it('destroys the session when there is no refresh token to use', async () => {
    const { store, clock } = fixedStore();
    const session = createSession({ ...tokens(600), refreshToken: '' }, store);
    const refresh = jest.fn();
    const result = await getValidSession(session.id, clock() + 600_000 + 1, refresh, store);
    expect(result).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(readSession(session.id, store)).toBeUndefined();
  });

  it('treats an expired session (sliding window lapsed) as unauthenticated', async () => {
    const { store, advance } = fixedStore();
    const session = createSession(tokens(), store);
    advance(8 * 24 * HOUR);
    const result = await getValidSession(session.id, undefined, jest.fn(), store);
    expect(result).toBeUndefined();
  });
});
