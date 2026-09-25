import { createClient } from 'redis';
import {
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_RECONNECT_MAX_DELAY_MS,
  RedisSessionStore,
  SessionStoreUnavailable,
  connectBounded,
  unboundedReconnectStrategy,
  type SessionRedisClient,
} from '@/lib/auth/redis-store';
import { SessionStore, createSessionStore, SESSION_TTL_MS } from '@/lib/auth/session-store';
import { RedisRefreshLock, createRefreshLock } from '@/lib/auth/refresh-lock';
import { FakeRedis } from './stubs/fake-redis';

// The auth factories import the real node-redis client; mock it so selection is
// exercised against the fake and no live Redis is required (dev/e2e stay zero-Redis).
jest.mock('redis', () => ({ createClient: jest.fn() }));

const mockCreateClient = createClient as unknown as jest.Mock;

const CLOCK = 1_000_000;

function session() {
  return {
    id: 'sess-1',
    subject: 'me',
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: null,
    accessTokenExpiresAt: CLOCK + 600_000,
  };
}

/**
 * A client whose socket never becomes ready: `connect()` hangs forever and every
 * command rejects the way node-redis's `disableOfflineQueue` does for an offline
 * socket. This is the "Redis unreachable" shape the old factories could not fail
 * on — commands awaited a `connect()` that never settled.
 */
class UnreachableRedis implements SessionRedisClient {
  connect(): Promise<unknown> {
    return new Promise(() => {});
  }

  on(): this {
    return this;
  }

  get(): Promise<string | null> {
    return Promise.reject(new Error('ClientOfflineError'));
  }

  set(): Promise<unknown> {
    return Promise.reject(new Error('ClientOfflineError'));
  }

  del(): Promise<number> {
    return Promise.reject(new Error('ClientOfflineError'));
  }

  expire(): Promise<number> {
    return Promise.reject(new Error('ClientOfflineError'));
  }
}

/**
 * A client whose socket can be taken down and brought back up while the SAME
 * store instance keeps using it — the shape of a transient Redis blip. While
 * disconnected, `connect()` never settles (node-redis's behavior for a host that
 * never answers) and every command rejects like `disableOfflineQueue` does for an
 * offline socket; flipping `connected` to true recovers commands with no new
 * client and no re-instantiation.
 */
class LifecycleRedis implements SessionRedisClient {
  connected = false;
  private readonly store = new Map<string, string>();

  connect(): Promise<unknown> {
    return this.connected ? Promise.resolve(this) : new Promise(() => {});
  }

  on(): this {
    return this;
  }

  private assertUp(): void {
    if (!this.connected) throw new Error('ClientOfflineError');
  }

  async get(key: string): Promise<string | null> {
    this.assertUp();
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.assertUp();
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.assertUp();
    return this.store.delete(key) ? 1 : 0;
  }

  async expire(): Promise<number> {
    this.assertUp();
    return 1;
  }
}

describe('unboundedReconnectStrategy (never gives up: background recovery)', () => {
  it('always returns a capped backoff — never the false "stop reconnecting" signal', () => {
    for (const retries of [0, 1, 3, 10, 1_000, 1_000_000]) {
      const delay = unboundedReconnectStrategy(retries);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThanOrEqual(0);
      // Capped at the backoff ceiling (jitter stays within 200 ms of it).
      expect(delay).toBeLessThanOrEqual(REDIS_RECONNECT_MAX_DELAY_MS + 200);
    }
  });
});

describe('connectBounded (ready always settles, never rejects)', () => {
  it('resolves within the hard bound when connect() never settles', async () => {
    jest.useFakeTimers();
    try {
      const { ready } = connectBounded({ connect: () => new Promise(() => {}) });
      let settled = false;
      void ready.then(() => (settled = true));

      await jest.advanceTimersByTimeAsync(REDIS_CONNECT_TIMEOUT_MS - 1);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await expect(ready).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('swallows a rejecting connect() (no unhandled rejection)', async () => {
    const { ready } = connectBounded({ connect: () => Promise.reject(new Error('boom')) });
    await expect(ready).resolves.toBeUndefined();
  });
});

describe('fail-closed mapping with a bounded client (unreachable Redis)', () => {
  function makeStore() {
    const client = new UnreachableRedis();
    const { ready } = connectBounded(client);
    return new RedisSessionStore(client, { ttlMs: SESSION_TTL_MS, now: () => CLOCK, ready });
  }

  it('resolves get to undefined within the bound instead of hanging', async () => {
    jest.useFakeTimers();
    try {
      const store = makeStore();
      const pending = store.get('sess-1');
      await jest.advanceTimersByTimeAsync(REDIS_CONNECT_TIMEOUT_MS);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects create with SessionStoreUnavailable within the bound', async () => {
    jest.useFakeTimers();
    try {
      const store = makeStore();
      const pending = store.create(session());
      const assertion = expect(pending).rejects.toBeInstanceOf(SessionStoreUnavailable);
      await jest.advanceTimersByTimeAsync(REDIS_CONNECT_TIMEOUT_MS);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('recovers the SAME store instance once the client reconnects (no re-instantiation)', async () => {
    jest.useFakeTimers();
    try {
      const client = new LifecycleRedis(); // starts disconnected
      const { ready } = connectBounded(client);
      const store = new RedisSessionStore(client, { ttlMs: SESSION_TTL_MS, now: () => CLOCK, ready });

      // While down: fail-closed within the bound — `get` resolves undefined and
      // `create` throws, neither hangs.
      const downGet = store.get('sess-1');
      const downCreate = store.create(session());
      const downCreateAssertion = expect(downCreate).rejects.toBeInstanceOf(
        SessionStoreUnavailable,
      );
      await jest.advanceTimersByTimeAsync(REDIS_CONNECT_TIMEOUT_MS);
      await expect(downGet).resolves.toBeUndefined();
      await downCreateAssertion;

      // Redis comes back. node-redis reconnects in the background; the bound
      // `ready` already settled, so the same instance's commands now flow.
      client.connected = true;

      const written = await store.create(session());
      expect(written.id).toBe('sess-1');
      expect((await store.get('sess-1'))?.subject).toBe('me');
    } finally {
      jest.useRealTimers();
    }
  });

  it('degrades the refresh lock (acquire) within the bound instead of hanging', async () => {
    jest.useFakeTimers();
    try {
      const client = new UnreachableRedis();
      const { ready } = connectBounded(client);
      const lock = new RedisRefreshLock(client, { ready });
      const pending = lock.acquire('sess-1');
      await jest.advanceTimersByTimeAsync(REDIS_CONNECT_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ status: 'degraded' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('auth factories build the shared bounded client', () => {
  afterEach(() => {
    mockCreateClient.mockReset();
    delete process.env.REDIS_URL;
  });

  it('selects the in-memory store/lock with no client when REDIS_URL is unset', () => {
    const store = createSessionStore();
    expect(store).toBeInstanceOf(SessionStore);
    // No shared Redis: the null lock reports `disabled` and builds no client.
    expect(createRefreshLock().distributed).toBe(false);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('createSessionStore disables the offline queue and installs a never-give-up reconnect', () => {
    const fake = new FakeRedis();
    fake.setFailing(true); // never touch a real socket if connect() is awaited
    mockCreateClient.mockReturnValue(fake);
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    const store = createSessionStore();

    expect(store).toBeInstanceOf(RedisSessionStore);
    // Exact shape: the offline queue is off (commands fail fast while down) and
    // the strategy is the unbounded one — NO give-up strategy may be installed.
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'redis://127.0.0.1:6379',
      disableOfflineQueue: true,
      socket: { reconnectStrategy: unboundedReconnectStrategy },
    });
  });

  it('createRefreshLock builds the same fail-closed client shape', () => {
    const fake = new FakeRedis();
    fake.setFailing(true);
    mockCreateClient.mockReturnValue(fake);
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    const lock = createRefreshLock();

    expect(lock.distributed).toBe(true);
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'redis://127.0.0.1:6379',
      disableOfflineQueue: true,
      socket: { reconnectStrategy: unboundedReconnectStrategy },
    });
  });
});
