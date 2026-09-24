import { SessionStore, SESSION_TTL_MS } from '@/lib/auth/session-store';

const DAY = 24 * 60 * 60 * 1000;

function makeStore(now = 1_000_000) {
  let clock = now;
  // Fresh backing map so tests never share the process-wide (globalThis) store.
  const store = new SessionStore(SESSION_TTL_MS, () => clock, new Map());
  return { store, advance: (ms: number) => (clock += ms) };
}

function session(overrides: Partial<Parameters<SessionStore['create']>[0]> = {}) {
  return {
    id: 'sess-1',
    subject: 'me',
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: null,
    accessTokenExpiresAt: 1_000_000 + 600_000,
    ...overrides,
  };
}

describe('SessionStore', () => {
  it('creates and looks up a session', () => {
    const { store } = makeStore();
    store.create(session());
    expect(store.get('sess-1')?.subject).toBe('me');
    expect(store.get('missing')).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
  });

  it('expires a session after its TTL', () => {
    const { store, advance } = makeStore();
    store.create(session());
    advance(7 * DAY - 1);
    expect(store.get('sess-1')).toBeDefined();
    // Each get() slides the window, so to exceed the TTL without a lookup we
    // advance past TTL + the last lookup's extension.
    advance(7 * DAY + 1);
    expect(store.get('sess-1')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('slides the expiry forward on each successful lookup', () => {
    const { store, advance } = makeStore();
    store.create(session());
    advance(6 * DAY);
    const stillAlive = store.get('sess-1');
    expect(stillAlive).toBeDefined();
    // 6 more days would exceed the original 7-day window, but sliding extended it.
    advance(6 * DAY);
    expect(store.get('sess-1')).toBeDefined();
  });

  it('updates tokens on an existing session without changing the id', () => {
    const { store } = makeStore();
    store.create(session());
    const updated = store.update('sess-1', { accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(updated?.id).toBe('sess-1');
    expect(store.get('sess-1')?.accessToken).toBe('at-2');
    expect(store.update('missing', { accessToken: 'x' })).toBeUndefined();
  });

  it('destroys sessions', () => {
    const { store } = makeStore();
    store.create(session());
    store.destroy('sess-1');
    expect(store.get('sess-1')).toBeUndefined();
  });
});
