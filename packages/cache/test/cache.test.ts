import {
  CACHE_TTL_SECONDS,
  createCache,
  ReadThroughCache,
  type CacheClient,
  type CacheSetOptions,
} from '../src/index';

/**
 * Contract suite for the generic read-through cache (`SPEC-service-kernel`
 * "Shared primitives"; ported from `apps/note-service/test/notes-cache.e2e-spec.ts`).
 *
 * The DB is a loader spy — these tests prove *when* the loader is consulted and
 * *what* is written to Redis, without a database or a live Redis. Generic
 * behavior (key composition, generation counter, TTL, fail-open, per-sub
 * isolation, ciphertext-value discipline via `cacheable`) is asserted directly
 * on `@life/cache`; the service-level ciphertext proof stays in note-service.
 */

const SERVICE = 'note';
const SUB = 'sub-1';

/** In-memory node-redis stand-in: implements only GET/SET EX/INCR. */
class FakeRedisClient implements CacheClient {
  readonly store = new Map<string, string>();
  readonly sets: Array<{ key: string; value: string; options?: CacheSetOptions }> = [];
  readonly incrCalls: string[] = [];

  constructor(readonly events: string[] = []) {}

  get setCalls(): string[] {
    return this.sets.map((entry) => entry.key);
  }

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, options?: CacheSetOptions): Promise<'OK'> {
    this.events.push(`set:${key}`);
    this.sets.push({ key, value, options });
    this.store.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.events.push(`incr:${key}`);
    this.incrCalls.push(key);
    const next = (Number.parseInt(this.store.get(key) ?? '0', 10) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }
}

/** Every command rejects, modelling Redis being unreachable (fail-open proof). */
class FailingRedisClient implements CacheClient {
  async get(): Promise<string | null> {
    throw new Error('redis unreachable');
  }
  async set(): Promise<'OK'> {
    throw new Error('redis unreachable');
  }
  async incr(): Promise<number> {
    throw new Error('redis unreachable');
  }
}

function makeCache(client: CacheClient | null, service = SERVICE): ReadThroughCache {
  return createCache({ service, client });
}

/** Drain microtasks until the in-flight loader has started. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('ReadThroughCache (read-through + generation invalidation)', () => {
  describe('hit: identical reads are served from cache', () => {
    it('a second read skips the loader and writes one v0 key with a 60s TTL', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      const loader = jest.fn(async () => [{ id: 'n1', body: 'cipher' }]);

      const first = await cache.getThrough(SUB, 'list', loader);
      const second = await cache.getThrough(SUB, 'list', loader);

      expect(first).toEqual(second);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(client.sets).toHaveLength(1);
      expect(client.sets[0].key).toBe(`${SERVICE}:${SUB}:v0:list`);
      expect(client.sets[0].options).toEqual({ EX: CACHE_TTL_SECONDS });
    });

    it('keys compose as <service>:<sub>:v<gen>:<rest> for an arbitrary rest', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      await cache.getThrough(SUB, 'one:abc', async () => ({ id: 'abc' }));
      await cache.getThrough(SUB, 'tags', async () => []);

      expect(client.setCalls).toEqual([
        `${SERVICE}:${SUB}:v0:one:abc`,
        `${SERVICE}:${SUB}:v0:tags`,
      ]);
    });

    it('strips a caller-supplied <service>: prefix so adapter keys stay byte-identical', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      // Adapters whose call sites carry the service prefix (`note:all`) rely on
      // the cache stripping it; a prefix of a *different* service, or a bare
      // rest, must pass through untouched.
      await cache.getThrough(SUB, `${SERVICE}:list`, async () => 1);
      await cache.getThrough(SUB, 'other:list', async () => 2);
      await cache.getThrough(SUB, 'all', async () => 3);

      expect(client.setCalls).toEqual([
        `${SERVICE}:${SUB}:v0:list`,
        `${SERVICE}:${SUB}:v0:other:list`,
        `${SERVICE}:${SUB}:v0:all`,
      ]);
    });

    it('honors a custom ttlSeconds option', async () => {
      const client = new FakeRedisClient();
      const cache = createCache({ service: SERVICE, client, ttlSeconds: 5 });
      await cache.getThrough(SUB, 'list', async () => []);
      expect(client.sets[0].options).toEqual({ EX: 5 });
    });
  });

  describe('decode: an unusable or throwing entry is a miss', () => {
    it('a throwing decode discards the entry, runs the loader, and rewrites', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      const key = `${SERVICE}:${SUB}:v0:list`;
      // A leftover plaintext entry from a pre-fix deploy.
      client.store.set(key, JSON.stringify([{ body: 'old plaintext' }]));

      const loader = jest.fn(async () => [{ body: 'enc.v1.fresh' }]);
      const value = await cache.getThrough(SUB, 'list', loader, {
        decode: (raw) => {
          const rows = raw as Array<{ body: string }>;
          if (!rows.every((r) => r.body.startsWith('enc.v1.'))) throw new Error('not ciphertext');
          return rows;
        },
      });

      expect(value).toEqual([{ body: 'enc.v1.fresh' }]);
      expect(loader).toHaveBeenCalledTimes(1);
      const written = client.sets.filter((s) => s.key === key);
      expect(written).toHaveLength(1);
      expect(written[0].value).toContain('enc.v1.');
      expect(written[0].value).not.toContain('old plaintext');
    });

    it('uses decode on a successful hit (raw parsed value is transformed)', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      const decode = (r: unknown) => ({ n: (r as { n: number }).n * 10 });
      await cache.getThrough(SUB, 'list', async () => ({ n: 1 }), { decode });
      const hit = await cache.getThrough(SUB, 'list', async () => ({ n: 2 }), { decode });
      // The cached raw {n:1} was decoded, not the loader's {n:2}.
      expect(hit).toEqual({ n: 10 });
    });
  });

  describe('cacheable: the ciphertext tripwire refuses a plaintext populate', () => {
    it('skips the populate when cacheable returns false, still returning the value', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      const value = await cache.getThrough(
        SUB,
        'list',
        async () => [{ body: 'legacy plaintext' }],
        { cacheable: (rows) => rows.every((r) => r.body.startsWith('enc.v1.')) },
      );

      expect(value).toEqual([{ body: 'legacy plaintext' }]);
      expect(client.sets).toHaveLength(0); // nothing written to an AOF-persistent store
    });

    it('defaults to cacheable when the hook is absent', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      await cache.getThrough(SUB, 'list', async () => [1, 2, 3]);
      expect(client.sets).toHaveLength(1);
    });
  });

  describe('invalidation: a bump makes old keys unreachable', () => {
    it('bumpGeneration increments <service>:gen:<sub> and a fresh read repopulates at v1', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);

      await cache.getThrough(SUB, 'list', async () => ['a']);
      expect(client.setCalls).toEqual([`${SERVICE}:${SUB}:v0:list`]);

      await cache.bumpGeneration(SUB);
      expect(client.incrCalls).toEqual([`${SERVICE}:gen:${SUB}`]);

      const value = await cache.getThrough(SUB, 'list', async () => ['b']);
      expect(value).toEqual(['b']);
      expect(client.setCalls).toContain(`${SERVICE}:${SUB}:v1:list`);
    });

    it('no DEL is ever issued (the client surface has none)', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      expect((client as unknown as Record<string, unknown>).del).toBeUndefined();
      await cache.bumpGeneration(SUB);
    });
  });

  describe('stale-guard: a bump during a slow load is not masked', () => {
    it('does not populate the pre-bump key when the generation changes mid-load', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);

      let resolveRows: (rows: string[]) => void = () => undefined;
      const pending = new Promise<string[]>((resolve) => {
        resolveRows = resolve;
      });
      let started = false;
      const firstLoad = cache.getThrough(SUB, 'list', async () => {
        started = true;
        return pending;
      });
      // Let the loader start (generation already captured) before bumping.
      await flush();
      expect(started).toBe(true);
      await cache.bumpGeneration(SUB);

      resolveRows(['raced']);
      await firstLoad;

      expect(client.setCalls).not.toContain(`${SERVICE}:${SUB}:v0:list`);
      expect(client.setCalls).not.toContain(`${SERVICE}:${SUB}:v1:list`);

      const second = await cache.getThrough(SUB, 'list', async () => ['raced']);
      expect(second).toEqual(['raced']);
    });
  });

  describe('isolation: one sub never reaches another sub or another service', () => {
    it('per-sub keys and counters are disjoint', async () => {
      const client = new FakeRedisClient();
      const cache = makeCache(client);
      const A = 'user-a';
      const B = 'user-b';

      await cache.getThrough(A, 'list', async () => ['a']);
      await cache.getThrough(B, 'list', async () => ['b']);
      expect(client.setCalls).toEqual([`${SERVICE}:${A}:v0:list`, `${SERVICE}:${B}:v0:list`]);

      await cache.bumpGeneration(A);
      expect(client.incrCalls).toEqual([`${SERVICE}:gen:${A}`]);

      // B's entry survives A's bump: B's next read is still a hit.
      const loaderB = jest.fn(async () => ['b']);
      await cache.getThrough(B, 'list', loaderB);
      expect(loaderB).not.toHaveBeenCalled();
    });

    it('two services sharing one Redis never cross-invalidate or share keys', async () => {
      const client = new FakeRedisClient();
      const notes = makeCache(client, 'note');
      const todos = makeCache(client, 'todo');

      await notes.getThrough(SUB, 'list', async () => ['note-row']);
      await todos.getThrough(SUB, 'list', async () => ['todo-row']);

      expect(client.setCalls).toEqual([`note:${SUB}:v0:list`, `todo:${SUB}:v0:list`]);

      await notes.bumpGeneration(SUB);
      expect(client.incrCalls).toEqual([`note:gen:${SUB}`]);

      // The todo cache's counter and entry are untouched.
      const todoLoader = jest.fn(async () => ['todo-row']);
      const value = await todos.getThrough(SUB, 'list', todoLoader);
      expect(value).toEqual(['todo-row']);
      expect(todoLoader).not.toHaveBeenCalled();
      expect(client.incrCalls).not.toContain(`todo:gen:${SUB}`);
    });
  });

  describe('fail-open: Redis errors degrade to the direct loader', () => {
    it('reads return loader data and never throw', async () => {
      const cache = makeCache(new FailingRedisClient());
      await expect(cache.getThrough(SUB, 'list', async () => ['db'])).resolves.toEqual(['db']);
    });

    it('a failing bump never throws', async () => {
      const cache = makeCache(new FailingRedisClient());
      await expect(cache.bumpGeneration(SUB)).resolves.toBeUndefined();
    });
  });

  describe('selection: a null client runs the loader every time', () => {
    it('createCache with a null client performs no caching', async () => {
      const cache = makeCache(null);
      const loader = jest.fn(async () => ({ ok: true }));
      await cache.getThrough(SUB, 'list', loader);
      await cache.getThrough(SUB, 'list', loader);
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
