import {
  SessionStore,
  SESSION_TTL_MS,
  createSessionStore,
  type AppSession,
  type SessionStoreApi,
} from '@/lib/auth/session-store';
import {
  RedisSessionStore,
  SessionStoreUnavailable,
  SESSION_KEY_PREFIX,
} from '@/lib/auth/redis-store';
import { createClient } from 'redis';
import { FakeRedis } from './stubs/fake-redis';

// The factory imports the real node-redis client; mock it so selection is
// exercised with the fake client and no live Redis (dev/e2e stay zero-Redis).
jest.mock('redis', () => ({ createClient: jest.fn() }));

const mockCreateClient = createClient as unknown as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;

/**
 * One contract suite, run against BOTH implementations, proves the store swap is
 * behavior-identical (sliding TTL with an injected clock, update-patch, destroy,
 * expiry). A harness normalizes the sync in-memory store and the async Redis store
 * to the same shape; `peek` reads the persisted record WITHOUT sliding so the
 * "update preserves expiry" case is observable.
 */
interface Harness {
  store: SessionStoreApi;
  now: () => number;
  advance: (ms: number) => void;
  peek: (id: string) => AppSession | undefined;
}

function inMemoryHarness(): Harness {
  let clock = 1_000_000;
  const backing = new Map<string, AppSession>();
  // Fresh backing map so tests never share the process-wide (globalThis) store.
  const store = new SessionStore(SESSION_TTL_MS, () => clock, backing);
  return {
    store,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    peek: (id) => backing.get(id),
  };
}

function redisHarness(): Harness {
  let clock = 1_000_000;
  const redis = new FakeRedis(() => clock);
  const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now: () => clock });
  return {
    store,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    peek: (id) => {
      const raw = redis.rawValue(`${SESSION_KEY_PREFIX}${id}`);
      return raw ? (JSON.parse(raw) as AppSession) : undefined;
    },
  };
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

const harnesses: Array<[string, () => Harness]> = [
  ['in-memory SessionStore', inMemoryHarness],
  ['RedisSessionStore', redisHarness],
];

describe.each(harnesses)('%s (store contract)', (_label, make) => {
  it('creates and looks up a session', async () => {
    const h = make();
    await h.store.create(session());
    expect((await h.store.get('sess-1'))?.subject).toBe('me');
    expect(await h.store.get('missing')).toBeUndefined();
    expect(await h.store.get(undefined)).toBeUndefined();
  });

  it('stamps the sliding expiry from the store clock on create', async () => {
    const h = make();
    const created = await h.store.create(session());
    expect(created.expiresAt).toBe(h.now() + SESSION_TTL_MS);
    expect(h.peek('sess-1')?.expiresAt).toBe(h.now() + SESSION_TTL_MS);
  });

  it('slides the window forward on each successful lookup', async () => {
    const h = make();
    await h.store.create(session());
    h.advance(6 * DAY);
    expect(await h.store.get('sess-1')).toBeDefined();
    // The renewal is persisted, not just returned.
    expect(h.peek('sess-1')?.expiresAt).toBe(h.now() + SESSION_TTL_MS);
    // 6 more days would exceed the original window, but sliding extended it.
    h.advance(6 * DAY);
    expect(await h.store.get('sess-1')).toBeDefined();
  });

  it('treats a session past its TTL as gone', async () => {
    const h = make();
    await h.store.create(session());
    h.advance(SESSION_TTL_MS + 1);
    expect(await h.store.get('sess-1')).toBeUndefined();
  });

  it('updates tokens in place without changing the id', async () => {
    const h = make();
    await h.store.create(session());
    const updated = await h.store.update('sess-1', { accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(updated?.id).toBe('sess-1');
    expect((await h.store.get('sess-1'))?.accessToken).toBe('at-2');
    expect(await h.store.update('missing', { accessToken: 'x' })).toBeUndefined();
  });

  it('preserves the sliding expiry across an update (no renewal on write)', async () => {
    const h = make();
    await h.store.create(session());
    const expiresAt = h.peek('sess-1')!.expiresAt;
    h.advance(DAY);
    await h.store.update('sess-1', { accessToken: 'at-2' });
    expect(h.peek('sess-1')?.expiresAt).toBe(expiresAt);
    expect((await h.store.get('sess-1'))?.accessToken).toBe('at-2');
  });

  it('destroys a session', async () => {
    const h = make();
    await h.store.create(session());
    await h.store.destroy('sess-1');
    expect(await h.store.get('sess-1')).toBeUndefined();
    expect(h.peek('sess-1')).toBeUndefined();
  });
});

describe('RedisSessionStore (fail-closed contract)', () => {
  function make(now = 1_000_000) {
    let clock = now;
    const redis = new FakeRedis(() => clock);
    const store = new RedisSessionStore(redis, { ttlMs: SESSION_TTL_MS, now: () => clock });
    return { redis, store, advance: (ms: number) => (clock += ms) };
  }

  it('treats a corrupt (non-JSON) record as absent', async () => {
    const { redis, store } = make();
    await redis.set(`${SESSION_KEY_PREFIX}sess-1`, 'not json{{');
    expect(await store.get('sess-1')).toBeUndefined();
    expect(await store.update('sess-1', { accessToken: 'x' })).toBeUndefined();
  });

  it('treats a JSON value that is not a session record as absent', async () => {
    const { redis, store } = make();
    await redis.set(`${SESSION_KEY_PREFIX}sess-1`, JSON.stringify('a string'));
    expect(await store.get('sess-1')).toBeUndefined();
  });

  it('swallows client errors on get/update/destroy (no throw past the auth layer)', async () => {
    const { redis, store } = make();
    await store.create(session());
    redis.setFailing(true);
    expect(await store.get('sess-1')).toBeUndefined();
    expect(await store.update('sess-1', { accessToken: 'x' })).toBeUndefined();
    await expect(store.destroy('sess-1')).resolves.toBeUndefined();
  });

  it('throws SessionStoreUnavailable on create rather than half-issuing a session', async () => {
    const { redis, store } = make();
    redis.setFailing(true);
    await expect(store.create(session())).rejects.toBeInstanceOf(SessionStoreUnavailable);
  });

  it('sets the key TTL from the sliding window and preserves it across update', async () => {
    const { redis, store, advance } = make();
    await store.create(session());
    const ttlSeconds = Math.ceil(SESSION_TTL_MS / 1000);
    expect(redis.ttlMs(`${SESSION_KEY_PREFIX}sess-1`)).toBe(ttlSeconds * 1000);

    // Advance the clock so a buggy sliding write (EX from now) would be visible
    // as a longer TTL; a correct KEEPTTL write leaves the remaining TTL shorter.
    advance(DAY);
    await store.update('sess-1', { accessToken: 'at-2' });
    expect(redis.ttlMs(`${SESSION_KEY_PREFIX}sess-1`)).toBe(ttlSeconds * 1000 - DAY);
  });

  it('re-extends the key TTL on a sliding get', async () => {
    const { redis, store } = make();
    await store.create(session());
    await redis.expire(`${SESSION_KEY_PREFIX}sess-1`, 5);
    expect(await store.get('sess-1')).toBeDefined();
    expect(redis.ttlMs(`${SESSION_KEY_PREFIX}sess-1`)).toBe(Math.ceil(SESSION_TTL_MS / 1000) * 1000);
  });

  it('destroy removes the key', async () => {
    const { redis, store } = make();
    await store.create(session());
    await store.destroy('sess-1');
    expect(redis.has(`${SESSION_KEY_PREFIX}sess-1`)).toBe(false);
  });
});

describe('createSessionStore (REDIS_URL selection)', () => {
  it('returns the in-memory store when REDIS_URL is unset', () => {
    mockCreateClient.mockClear();
    delete process.env.REDIS_URL;

    const store = createSessionStore();
    expect(store).toBeInstanceOf(SessionStore);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns a connected RedisSessionStore when REDIS_URL is set', async () => {
    const fake = new FakeRedis();
    mockCreateClient.mockReturnValue(fake);
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    try {
      const store = createSessionStore();
      expect(store).toBeInstanceOf(RedisSessionStore);
      expect(mockCreateClient).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });
      // The factory held the connect() promise; commands flow end-to-end.
      await store.create(session());
      expect((await store.get('sess-1'))?.subject).toBe('me');
    } finally {
      delete process.env.REDIS_URL;
    }
  });
});
