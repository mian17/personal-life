import { NotFoundException } from '@nestjs/common';
import { ENC_PREFIX } from '@life/crypto';
import { NUTRIENTS, type NutrientVector } from '@life/nutrition';
import { MealCache, generationKey } from '../src/cache/meal-cache.js';
import { EntriesCache } from '../src/entries/entries-cache.js';
import { EntriesService } from '../src/entries/entries.service.js';
import { KeysService } from '@life/service-kit';
import type { CreateEntryDto } from '../src/entries/dto/create-entry.dto.js';
import type { Entry } from '../src/entries/entry.entity.js';
import type { CacheClient } from '@life/cache';
import { FakeRedisClient, FailingRedisClient } from './fake-redis.js';

/**
 * Unit-level contract for the meal entries read-through cache. Mirrors
 * `apps/note-service/test/notes-cache.e2e-spec.ts`: the DB is a repository fake
 * and Redis is a recording client, so these tests prove *when* the loader is
 * consulted and *what* is written to Redis without a database or live Redis.
 *
 * The three gates this suite owns (`SPEC-meal-service` Cache Rules, Contract 2,
 * `SPEC-notes-at-rest` ciphertext-at-rest pattern):
 * - **ciphertext-only**: every cached content value is a serialized row as
 *   persisted — `nutrients` stays an `enc.v1.` envelope, no plaintext.
 * - **bump-miss**: a write bumps the owner's generation, so the prior entry is
 *   unreachable and the subsequent read misses the loader again.
 * - **fail-open**: a Redis error never surfaces; reads fall through to the DB
 *   and writes still mutate.
 *
 * DEK custody is the real `@life/crypto` package over a spy `user_keys` repo, so
 * a cache hit genuinely decrypts and the no-plaintext assertions inspect the raw
 * strings written to Redis.
 */

const SUB = 'sub-1';
const OTHER_SUB = 'sub-2';
const DAY = '2026-09-03';
const ISO = '2026-01-01T00:00:00.000Z';

/** A complete nutrient vector: `overrides` on top of zeroes. */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

function body(overrides: Partial<CreateEntryDto> = {}): CreateEntryDto {
  return {
    date: DAY,
    mealGroup: 'breakfast',
    foodId: 'food-1',
    quantity: 2,
    nutrients: vector({ calories: 200, protein: 10 }),
    ...overrides,
  };
}

/**
 * A `FakeRedisClient` that also records every raw value written, so a test can
 * assert the serialized row payloads contain `enc.v1.` and no known plaintext.
 */
class CapturingRedisClient extends FakeRedisClient {
  readonly values: Array<{ key: string; value: string }> = [];

  override async set(key: string, value: string, options?: { EX?: number }): Promise<'OK'> {
    this.values.push({ key, value });
    return super.set(key, value, options);
  }
}

type StoredEntry = Entry & { createdAt: Date; updatedAt: Date };

/** Repository fake: owner-scoped, honours the `IsNull()` deleted-at predicate. */
class FakeEntryRepo {
  rows: StoredEntry[] = [];

  constructor(private readonly events: string[] = []) {}

  create = jest.fn((data: Partial<StoredEntry>): StoredEntry => ({ ...data }) as StoredEntry);

  save = jest.fn(async (row: StoredEntry): Promise<StoredEntry> => {
    this.events.push('db:save');
    row.createdAt ??= new Date(ISO);
    row.updatedAt ??= new Date(ISO);
    const index = this.rows.findIndex((r) => r.id === row.id);
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    return row;
  });

  find = jest.fn(
    async (opts: { where: { ownerSub: string; date: string } }): Promise<StoredEntry[]> =>
      this.rows
        .filter(
          (r) => r.ownerSub === opts.where.ownerSub && r.date === opts.where.date && !r.deletedAt,
        )
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id)),
  );

  findOne = jest.fn(
    async (opts: { where: { id: string; ownerSub: string } }): Promise<StoredEntry | null> =>
      this.rows.find(
        (r) => r.id === opts.where.id && r.ownerSub === opts.where.ownerSub && !r.deletedAt,
      ) ?? null,
  );
}

/** `user_keys` fake: real DEK wrap/unwrap, in-memory rows. */
class FakeUserKeysRepo {
  rows = new Map<string, { sub: string; wrappedDek: Buffer; kekVersion: number }>();

  findOne = jest.fn(
    async (opts: { where: { sub: string } }) => this.rows.get(opts.where.sub) ?? null,
  );

  insert = jest.fn(async (row: { sub: string; wrappedDek: Buffer }) => {
    this.rows.set(row.sub, { ...row, kekVersion: 1 });
  });
}

interface Harness {
  service: EntriesService;
  repo: FakeEntryRepo;
  client: CacheClient;
  keys: KeysService;
  events: string[];
}

function makeHarness(client: CacheClient, events: string[] = []): Harness {
  const repo = new FakeEntryRepo(events);
  const userKeys = new FakeUserKeysRepo();
  const keys = new KeysService(userKeys as never, Buffer.alloc(32, 0x2c));
  const service = new EntriesService(repo as never, new EntriesCache(new MealCache(client)), keys);
  return { service, repo, client, keys, events };
}

describe('MealCache (read-through + generation invalidation)', () => {
  describe('hit: identical reads are served from cache (decrypted after the hit)', () => {
    it('findAll twice consults the loader once and writes one v0 ciphertext-row key with a 60s TTL', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      await h.service.create(SUB, body());

      const first = await h.service.findAll(SUB, { date: DAY });
      const dbCallsOnHit = h.repo.find.mock.calls.length;
      const second = await h.service.findAll(SUB, { date: DAY });

      // The API output is byte-identical across a miss and a hit.
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.entries[0].nutrients.calories).toBe(200);
      // The second read did not run the loader again.
      expect(h.repo.find.mock.calls).toHaveLength(dbCallsOnHit);
      // One entry was written for the day, under the current generation.
      expect(client.setCalls).toContain(`meal:${SUB}:v1:entries:${DAY}`);
      const written = client.values.find((v) => v.key === `meal:${SUB}:v1:entries:${DAY}`)!;
      expect(written.value).toContain(ENC_PREFIX);
      expect(written.value).not.toContain('calories');
    });

    it('findOne twice consults the loader once and returns decrypted content on the hit', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      const created = await h.service.create(SUB, body({ nutrients: vector({ calories: 321 }) }));

      const first = await h.service.findOne(SUB, created.id);
      const dbCallsOnHit = h.repo.findOne.mock.calls.length;
      const second = await h.service.findOne(SUB, created.id);

      expect(first.nutrients.calories).toBe(321);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(h.repo.findOne.mock.calls).toHaveLength(dbCallsOnHit);
      const written = client.values.find((v) => v.key === `meal:${SUB}:v1:entry:${created.id}`)!;
      // The cached value is the stored row, never the decrypted DTO.
      expect(written.value).toContain(ENC_PREFIX);
      expect(written.value).not.toContain('calories');
    });
  });

  describe('ciphertext-only: content rows never write plaintext to Redis', () => {
    it('day and one serialize ciphertext only', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      const created = await h.service.create(
        SUB,
        body({ nutrients: vector({ calories: 777, protein: 12 }) }),
      );

      await h.service.findAll(SUB, { date: DAY });
      await h.service.findOne(SUB, created.id);

      expect(client.values.map((v) => v.key)).toEqual([
        `meal:${SUB}:v1:entries:${DAY}`,
        `meal:${SUB}:v1:entry:${created.id}`,
      ]);
      for (const { value } of client.values) {
        expect(value).toContain(ENC_PREFIX);
        // No known plaintext of the snapshot reaches Redis.
        expect(value).not.toContain('calories');
        expect(value).not.toContain('777');
      }
    });

    it('serves a legacy plaintext row directly but refuses to cache it', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      // A pre-backfill row: nutrients is not an envelope (dual-read).
      h.repo.rows = [
        {
          id: 'legacy',
          ownerSub: SUB,
          date: DAY,
          mealGroup: 'breakfast',
          foodId: 'food-1',
          quantity: 1,
          nutrients: JSON.stringify(vector({ calories: 111 })),
          version: 0,
          deletedAt: null,
          createdAt: new Date(ISO),
          updatedAt: new Date(ISO),
        },
      ];

      const page = await h.service.findAll(SUB, { date: DAY });

      expect(page.entries[0].nutrients.calories).toBe(111);
      // The loader's result is returned, but nothing was written to Redis.
      expect(client.values).toHaveLength(0);
      expect(client.setCalls).toHaveLength(0);
    });
  });

  describe('invalidation: every write bumps the generation', () => {
    it('a write bumps the owner counter and makes the stale entry unreachable; a fresh read repopulates', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(client);
      await h.service.create(SUB, body({ nutrients: vector({ calories: 100 }) }));
      await h.service.findAll(SUB, { date: DAY });
      expect(client.setCalls).toEqual([`meal:${SUB}:v1:entries:${DAY}`]);

      // The next write bumps to v2; the v1 entry can no longer be addressed.
      await h.service.create(SUB, body({ foodId: 'food-2', nutrients: vector({ calories: 250 }) }));
      expect(client.incrCalls).toContain(generationKey(SUB));

      const after = await h.service.findAll(SUB, { date: DAY });

      // The read missed (the old key is dead) and repopulated under v2.
      expect(after.entries).toHaveLength(2);
      expect(client.setCalls).toContain(`meal:${SUB}:v2:entries:${DAY}`);
    });

    it('an update and a remove each invalidate a populated read', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(client);
      const created = await h.service.create(SUB, body({ nutrients: vector({ calories: 100 }) }));

      await h.service.findAll(SUB, { date: DAY });
      expect(client.setCalls).toEqual([`meal:${SUB}:v1:entries:${DAY}`]);

      await h.service.update(SUB, created.id, { nutrients: vector({ calories: 999 }) });
      const afterUpdate = await h.service.findAll(SUB, { date: DAY });
      expect(afterUpdate.entries[0].nutrients.calories).toBe(999);
      expect(client.setCalls).toContain(`meal:${SUB}:v2:entries:${DAY}`);

      await h.service.remove(SUB, created.id);
      const afterRemove = await h.service.findAll(SUB, { date: DAY });
      expect(afterRemove.entries).toHaveLength(0);
      expect(client.setCalls).toContain(`meal:${SUB}:v3:entries:${DAY}`);
    });

    it('a bump is strictly after the DB mutation', async () => {
      const events: string[] = [];
      const client = new FakeRedisClient(events);
      const h = makeHarness(client, events);

      await h.service.create(SUB, body());

      expect(events.indexOf('db:save')).toBeLessThan(events.indexOf(`incr:${generationKey(SUB)}`));
    });

    it('a failed mutation does not bump (cache stays consistent)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(client);

      // No such entry → 404, no DB mutation, no bump.
      await expect(
        h.service.update(SUB, '11111111-1111-4111-8111-111111111111', {
          nutrients: vector(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(h.service.remove(SUB, 'missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(client.incrCalls).toHaveLength(0);
    });
  });

  describe("isolation: one user's writes never reach another user's entries", () => {
    it("A's write bumps only meal:gen:<a>; B's cached day survives and still serves", async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(client);
      const A = 'user-a';
      const B = 'user-b';

      await h.service.findAll(A, { date: DAY });
      await h.service.findAll(B, { date: DAY });
      expect(client.setCalls).toEqual([
        `meal:${A}:v0:entries:${DAY}`,
        `meal:${B}:v0:entries:${DAY}`,
      ]);

      await h.service.create(A, body());
      expect(client.incrCalls).toEqual([generationKey(A)]);
      expect(client.incrCalls).not.toContain(generationKey(B));

      // B's entry survived A's write: B's next read is still a hit.
      const dbCallsBefore = h.repo.find.mock.calls.length;
      await h.service.findAll(B, { date: DAY });
      expect(h.repo.find.mock.calls).toHaveLength(dbCallsBefore);
    });
  });

  describe('fail-open: Redis errors degrade to the DB path', () => {
    it('reads still return DB data and never throw', async () => {
      const h = makeHarness(new FailingRedisClient());
      const created = await h.service.create(SUB, body({ nutrients: vector({ calories: 444 }) }));

      const page = await h.service.findAll(SUB, { date: DAY });
      expect(page.entries[0].nutrients.calories).toBe(444);
      const one = await h.service.findOne(SUB, created.id);
      expect(one.nutrients.calories).toBe(444);
    });

    it('writes still mutate the DB when the bump cannot reach Redis', async () => {
      const h = makeHarness(new FailingRedisClient());

      const created = await h.service.create(SUB, body());
      await expect(
        h.service.update(SUB, created.id, { nutrients: vector({ calories: 5 }) }),
      ).resolves.toBeDefined();
      await expect(h.service.remove(SUB, created.id)).resolves.toBeUndefined();

      expect(h.repo.save).toHaveBeenCalled();
    });
  });

  describe("selection: REDIS_URL unset is today's direct path", () => {
    it('a null client cache calls the loader every time', async () => {
      const loader = jest.fn(async () => [] as unknown[]);
      const cache = new MealCache(null);

      await cache.getThrough(SUB, 'meal:entries:x', loader);
      await cache.getThrough(SUB, 'meal:entries:x', loader);

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
