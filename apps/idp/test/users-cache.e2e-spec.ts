import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { User } from '../src/users/user.entity.js';
import { UsersService } from '../src/users/users.service.js';
import {
  PassthroughCache,
  USERS_CACHE,
  USERS_CACHE_TTL_SECONDS,
  USERS_NEGATIVE_TTL_SECONDS,
  RedisUsersCache,
  createUsersCache,
  userCacheKey,
} from '../src/users/users-cache.js';
import { FakeCacheClient } from './fake-cache-client.js';

const FIXTURE_PASSWORD = 'fixture-password-not-a-secret';

describe('IdP users read-through cache (e2e)', () => {
  const TEST_DB = join(__dirname, 'test-idp-users-cache.db');
  const TEST_KEYS = join(__dirname, 'test-idp-users-cache-keys.json');
  process.env.DB_PATH = TEST_DB;
  process.env.KEYS_PATH = TEST_KEYS;

  let app: INestApplication;
  let users: UsersService;
  let repo: Repository<User>;
  let cache: FakeCacheClient;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    // The default selection must stay the DB-only path; this spec injects the
    // fake cache explicitly so no real Redis is ever required.
    delete process.env.REDIS_URL;

    cache = new FakeCacheClient();
    // Deferred import AFTER DB_PATH is set: `AppModule`'s TypeORM config calls
    // `resolveDbPath()` at decorator evaluation, so importing it up front would
    // capture the default `data/scratch.db` and leak fixtures there (the house
    // pattern every other idp spec uses).
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(USERS_CACHE)
      .useValue(new RedisUsersCache(cache))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    users = app.get(UsersService);
    repo = app.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('serves the second identical lookup from cache without touching the repository', async () => {
    await users.createUser('cache-alice', FIXTURE_PASSWORD);
    const findSpy = jest.spyOn(repo, 'findOne');

    const first = await users.findByUsername('cache-alice');
    const second = await users.findByUsername('cache-alice');

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(second?.id).toBe(first?.id);
    expect(second?.passwordHash).toBe(first?.passwordHash);
    // `createdAt` keeps its type across the JSON round-trip.
    expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
    expect(await users.verifyPassword(second!, FIXTURE_PASSWORD)).toBe(true);

    findSpy.mockRestore();
  });

  it('caches a found row under the 300s positive TTL', async () => {
    await users.createUser('cache-ttl', FIXTURE_PASSWORD);
    await users.findByUsername('cache-ttl');
    expect(cache.ttlSeconds.get(userCacheKey('cache-ttl'))).toBe(USERS_CACHE_TTL_SECONDS);
  });

  it('never writes a key outside the idp:user: namespace', async () => {
    // Exercise both write paths — createUser's invalidate (a delete, not a set)
    // and findByUsername's populate — so "every key ever written" is meaningful.
    await users.createUser('cache-keyspace', FIXTURE_PASSWORD);
    await users.findByUsername('cache-keyspace');
    await users.findByUsername('cache-keyspace-missing');

    const written = [...cache.writtenKeys];
    expect(written.length).toBeGreaterThan(0); // non-vacuous: something was written
    for (const key of written) {
      expect(key.startsWith('idp:user:')).toBe(true);
    }
  });

  it('invalidates the cached key when createUser writes', async () => {
    // Prime a negative sentinel for a username that does not exist yet.
    expect(await users.findByUsername('cache-bob')).toBeNull();
    expect(cache.store.has(userCacheKey('cache-bob'))).toBe(true);

    // createUser must drop that sentinel; otherwise the next read would wrongly
    // report "absent" for up to the negative TTL.
    await users.createUser('cache-bob', FIXTURE_PASSWORD);
    expect(cache.store.has(userCacheKey('cache-bob'))).toBe(false);

    // A stale value can never survive: the next read must hit the repository.
    const findSpy = jest.spyOn(repo, 'findOne');
    const reread = await users.findByUsername('cache-bob');
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(reread?.username).toBe('cache-bob');
    findSpy.mockRestore();
  });

  it('caches unknown usernames behind a short TTL sentinel', async () => {
    const findSpy = jest.spyOn(repo, 'findOne');

    const first = await users.findByUsername('cache-nobody');
    const second = await users.findByUsername('cache-nobody');

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(cache.ttlSeconds.get(userCacheKey('cache-nobody'))).toBeLessThanOrEqual(
      USERS_NEGATIVE_TTL_SECONDS,
    );

    findSpy.mockRestore();
  });

  it('returns null for an empty username without touching repository or cache', async () => {
    const findSpy = jest.spyOn(repo, 'findOne');
    const getCallsBefore = cache.getCalls;

    expect(await users.findByUsername('   ')).toBeNull();

    expect(findSpy).not.toHaveBeenCalled();
    expect(cache.getCalls).toBe(getCallsBefore);
    findSpy.mockRestore();
  });

  it('falls open to the DB when the cache cannot be read', async () => {
    await users.createUser('cache-carol', FIXTURE_PASSWORD);
    cache.failReads = true;
    try {
      const user = await users.findByUsername('cache-carol');
      expect(user?.username).toBe('cache-carol');
      expect(await users.verifyPassword(user!, FIXTURE_PASSWORD)).toBe(true);
    } finally {
      cache.failReads = false;
    }
  });

  it('still returns the row when cache population fails', async () => {
    await users.createUser('cache-dave', FIXTURE_PASSWORD);
    cache.failWrites = true;
    try {
      const user = await users.findByUsername('cache-dave');
      expect(user?.username).toBe('cache-dave');
    } finally {
      cache.failWrites = false;
    }
  });

  it('does not let a failed invalidation break createUser', async () => {
    cache.failDeletes = true;
    try {
      await expect(users.createUser('cache-erin', FIXTURE_PASSWORD)).resolves.toMatchObject({
        username: 'cache-erin',
      });
    } finally {
      cache.failDeletes = false;
    }
  });
});

describe('RedisUsersCache helper (unit)', () => {
  const row = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u1',
      username: 'zoe',
      // A fixture hash, not a credential: this suite round-trips a cached row and
      // never verifies it, so the value only has to survive the JSON trip.
      passwordHash: 'argon2id-fixture-not-a-secret',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as User;

  it('returns the fresh DB row on miss, then the cached row on hit', async () => {
    const fake = new FakeCacheClient();
    const cache = new RedisUsersCache(fake);
    const loader = jest.fn(async () => row());

    const first = await cache.getThrough(userCacheKey('zoe'), USERS_CACHE_TTL_SECONDS, loader);
    const second = await cache.getThrough(userCacheKey('zoe'), USERS_CACHE_TTL_SECONDS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first?.id).toBe('u1');
    expect(second?.id).toBe('u1');
    expect(second?.createdAt).toBeInstanceOf(Date);
  });

  it('caches a null result under the short negative TTL', async () => {
    const fake = new FakeCacheClient();
    const cache = new RedisUsersCache(fake);
    const loader = jest.fn(async () => null);

    // The positive TTL is requested, but a null result must be stored short.
    await cache.getThrough(userCacheKey('ghost'), USERS_CACHE_TTL_SECONDS, loader);
    await cache.getThrough(userCacheKey('ghost'), USERS_CACHE_TTL_SECONDS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.ttlSeconds.get(userCacheKey('ghost'))).toBe(USERS_NEGATIVE_TTL_SECONDS);
  });

  it('fails open to the loader on read and write errors', async () => {
    const fake = new FakeCacheClient();
    const cache = new RedisUsersCache(fake);
    const loader = jest.fn(async () => row({ id: 'u2', username: 'yan' }));

    fake.failReads = true;
    expect((await cache.getThrough(userCacheKey('yan'), USERS_CACHE_TTL_SECONDS, loader))?.id).toBe(
      'u2',
    );
    fake.failReads = false;

    // Read-error path populated a value above; drop it so the write-error case
    // is a genuine miss and must reach the loader again.
    await fake.del(userCacheKey('yan'));
    fake.failWrites = true;
    expect((await cache.getThrough(userCacheKey('yan'), USERS_CACHE_TTL_SECONDS, loader))?.id).toBe(
      'u2',
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('treats a corrupt cached value as a miss', async () => {
    const fake = new FakeCacheClient();
    const cache = new RedisUsersCache(fake);
    await fake.set(userCacheKey('corrupt'), '{not-json', { EX: USERS_CACHE_TTL_SECONDS });
    const loader = jest.fn(async () => null);

    await expect(
      cache.getThrough(userCacheKey('corrupt'), USERS_CACHE_TTL_SECONDS, loader),
    ).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('swallows invalidate errors so callers never see a cache failure', async () => {
    const fake = new FakeCacheClient();
    const cache = new RedisUsersCache(fake);
    fake.failDeletes = true;
    await expect(cache.invalidate(userCacheKey('x'))).resolves.toBeUndefined();
  });
});

describe('createUsersCache selection (unit)', () => {
  it('selects the DB-only pass-through when REDIS_URL is unset', async () => {
    const selected = createUsersCache(undefined);
    expect(selected).toBeInstanceOf(PassthroughCache);

    const loader = jest.fn(async () => null);
    await selected.getThrough('k', USERS_CACHE_TTL_SECONDS, loader);
    await selected.getThrough('k', USERS_CACHE_TTL_SECONDS, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    await expect(selected.invalidate('k')).resolves.toBeUndefined();
  });
});

/**
 * The SPEC-idp-cache hard rule has two halves and neither is allowed to rely on
 * convention: (1) the users cache must never see OIDC payloads, and (2) no OIDC
 * module may reach into the users cache. Both are enforced by reading the real
 * source files — a mock here would prove nothing.
 */
describe('OIDC payloads are never cached (module boundary, real source)', () => {
  const srcDir = join(__dirname, '..', 'src');
  const oidcDir = join(srcDir, 'oidc');
  const usersCachePath = join(srcDir, 'users', 'users-cache.ts');

  /** Every `.ts` file under a directory, recursively. */
  function tsFilesUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...tsFilesUnder(full));
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
  }

  it('no file under src/oidc imports the users cache', () => {
    const oidcFiles = tsFilesUnder(oidcDir);
    expect(oidcFiles.length).toBeGreaterThan(0);

    const offenders = oidcFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('users-cache') || source.includes('USERS_CACHE');
    });

    expect(offenders).toEqual([]);
  });

  it('users-cache.ts imports nothing from src/oidc', () => {
    const source = readFileSync(usersCachePath, 'utf8');
    const offendingImports = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) && line.includes('oidc'));

    expect(offendingImports).toEqual([]);
  });
});
