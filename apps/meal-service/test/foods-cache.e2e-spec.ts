import { ENC_PREFIX } from '@life/crypto';
import { NUTRIENTS, type NutrientVector } from '@life/nutrition';
import type { CacheClient } from '@life/cache';
import { MealCache } from '../src/cache/meal-cache.js';
import { FoodsCache } from '../src/foods/foods-cache.js';
import { FoodsService } from '../src/foods/foods.service.js';
import { KeysService } from '@life/service-kit';
import type { CreateFoodDto } from '../src/foods/dto/create-food.dto.js';
import { FakeRedisClient } from './fake-redis.js';

/**
 * Unit-level contract for the foods read-through cache. Mirrors
 * `apps/note-service/test/notes-cache.e2e-spec.ts`: the DB is a repository fake
 * and Redis is a recording client, so these tests prove *when* the loader is
 * consulted and *what* is written to Redis without a database or a live Redis.
 *
 * The gate this suite owns (`SPEC-food-units` Success Criterion 4, Contract 2,
 * `SPEC-notes-at-rest` ciphertext-at-rest pattern): **ciphertext-only**, with
 * `unit` the one plaintext field. The cached value is the row as persisted —
 * `name`, the base vector, and each serving's `label`/vector stay `enc.v1.`
 * envelopes, so decrypt and DTO assembly always run after a hit and Redis
 * (AOF-persistent) never holds a food's content in the clear. `unit` is a unit
 * literal, not content, so it is deliberately plaintext alongside `servingGrams`.
 *
 * DEK custody is the real `@life/crypto` package over a spy `user_keys` repo, so
 * a cache hit genuinely decrypts and the no-plaintext assertions inspect the raw
 * strings written to Redis.
 */

const SUB = 'sub-1';
const ISO = '2026-01-01T00:00:00.000Z';

/** A complete 27-field vector with only the given nutrient set. */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

function body(overrides: Partial<CreateFoodDto> = {}): CreateFoodDto {
  return {
    name: 'Milk, Brand X',
    unit: 'ml',
    servingGrams: 100,
    nutrients: vector({ calories: 60 }),
    portions: [{ label: '1 carton', amount: 1000 }],
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

/**
 * Food repository fake: owner-scoped, and it honours a `deletedAt` predicate the
 * way TypeORM does — only when the caller's `where` carries one. `find` is called
 * without it (the list loader collects soft-deleted rows too, split in memory
 * after the cache hit); `findOne` passes `deletedAt: IsNull()`.
 */
class FakeFoodRepo {
  rows: Array<Record<string, unknown>> = [];

  /** Set by the harness so a loaded food carries its persisted servings. */
  servingsFor: (foodId: string) => Array<Record<string, unknown>> = () => [];

  create = jest.fn((data: Record<string, unknown>) => {
    const now = new Date(ISO);
    return { createdAt: now, updatedAt: now, ...data };
  });

  save = jest.fn(async (row: Record<string, unknown>) => {
    const index = this.rows.findIndex((r) => r.id === row.id);
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    return row;
  });

  find = jest.fn(async (opts: { where: { ownerSub: string; deletedAt?: unknown } }) =>
    this.rows
      .filter((r) => r.ownerSub === opts.where.ownerSub)
      .filter((r) => !('deletedAt' in opts.where) || r.deletedAt == null)
      .map((r) => ({ ...r, servings: this.servingsFor(r.id as string) })),
  );

  findOne = jest.fn(
    async (opts: { where: { id: string; ownerSub: string; deletedAt?: unknown } }) => {
      const row = this.rows.find(
        (r) =>
          r.id === opts.where.id &&
          r.ownerSub === opts.where.ownerSub &&
          (!('deletedAt' in opts.where) || r.deletedAt == null),
      );
      return row ? { ...row, servings: this.servingsFor(row.id as string) } : null;
    },
  );
}

/** Serving repository fake: owner-scoped, replace-by-foodId. */
class FakeServingRepo {
  rows: Array<Record<string, unknown>> = [];

  create = jest.fn((data: Record<string, unknown>) => {
    const now = new Date(ISO);
    return { createdAt: now, updatedAt: now, ...data };
  });

  delete = jest.fn(async (opts: { foodId: string }) => {
    this.rows = this.rows.filter((r) => r.foodId !== opts.foodId);
  });

  find = jest.fn(async (opts: { where: { foodId: string } }) =>
    this.rows.filter((r) => r.foodId === opts.where.foodId),
  );

  save = jest.fn(async (rows: Array<Record<string, unknown>>) => {
    this.rows.push(...rows);
    return rows;
  });
}

/** `user_keys` fake: real DEK wrap/unwrap, in-memory rows. */
class FakeUserKeysRepo {
  rows = new Map<string, { sub: string; wrappedDek: string; kekVersion: number }>();

  findOne = jest.fn(
    async (opts: { where: { sub: string } }) => this.rows.get(opts.where.sub) ?? null,
  );

  insert = jest.fn(async (row: { sub: string; wrappedDek: string }) => {
    this.rows.set(row.sub, { ...row, kekVersion: 1 });
  });
}

interface Harness {
  service: FoodsService;
  foods: FakeFoodRepo;
}

function makeHarness(client: CacheClient): Harness {
  const foods = new FakeFoodRepo();
  const servings = new FakeServingRepo();
  foods.servingsFor = (foodId) => servings.rows.filter((r) => r.foodId === foodId);
  const keys = new KeysService(new FakeUserKeysRepo() as never, Buffer.alloc(32, 0x2c));
  const service = new FoodsService(
    foods as never,
    servings as never,
    new FoodsCache(new MealCache(client)),
    keys,
  );
  return { service, foods };
}

describe('FoodsCache (read-through + ciphertext-only)', () => {
  describe('ciphertext-only: content rows never write plaintext to Redis', () => {
    it('seals name, label, and vectors in the list entry, leaving unit plaintext (SC4)', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      await h.service.create(SUB, body({ nutrients: vector({ calories: 60 }) }));

      await h.service.findAll(SUB);

      const written = client.values.find((v) => v.key === `meal:${SUB}:v1:food:list`)!;
      expect(written).toBeDefined();
      expect(written.value).toContain(ENC_PREFIX);
      // No known plaintext of the food reaches Redis.
      expect(written.value).not.toContain('Brand X');
      expect(written.value).not.toContain('carton');
      expect(written.value).not.toContain('calories');
      // `unit` is a unit literal, not content — plaintext by design, like `servingGrams`.
      const [row] = JSON.parse(written.value) as Array<{
        unit: string;
        servings: Array<{ grams: number }>;
      }>;
      expect(row.unit).toBe('ml');
      expect(row.servings[0].grams).toBe(1000);
    });

    it('serves a legacy plaintext food row directly but refuses to cache it', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      // A pre-backfill row: name and vector are not envelopes (dual-read).
      h.foods.rows = [
        {
          id: 'legacy',
          ownerSub: SUB,
          name: 'Legacy staple',
          unit: 'g',
          servingGrams: 100,
          nutrients: JSON.stringify(vector({ calories: 111 })),
          version: 0,
          deletedAt: null,
          createdAt: new Date(ISO),
          updatedAt: new Date(ISO),
        },
      ];

      const page = await h.service.findAll(SUB);

      expect(page.foods[0].nutrients.calories).toBe(111);
      // The loader's result is returned, but nothing was written to Redis.
      expect(client.values).toHaveLength(0);
      expect(client.setCalls).toHaveLength(0);
    });
  });

  describe('soft delete: one entry serves the active and include-deleted reads', () => {
    it('a removed food leaves the default list but stays resolvable through the same key', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      const created = await h.service.create(SUB, body());

      const active = await h.service.findAll(SUB);
      expect(active.foods.map((food) => food.id)).toEqual([created.id]);

      await h.service.remove(SUB, created.id);

      // Post-hit in-memory split (`SPEC-meal-service` Cache Rules): one cache
      // entry serves both read variants — no second key, no second loader shape.
      // The read before the write warmed the v1 entry; the `remove()` bumped
      // the generation, so the first post-write read is the miss that reloads
      // the entry, and the second read hits it.
      const loaderCallsBefore = h.foods.find.mock.calls.length;
      const defaultList = await h.service.findAll(SUB);
      const loaderCallsAfterFirst = h.foods.find.mock.calls.length;
      const withDeleted = await h.service.findAll(SUB, { includeDeleted: true });

      expect(defaultList.foods).toEqual([]);
      expect(withDeleted.foods.map((food) => food.name)).toEqual(['Milk, Brand X']);
      expect(loaderCallsAfterFirst).toBe(loaderCallsBefore + 1);
      expect(h.foods.find.mock.calls).toHaveLength(loaderCallsAfterFirst);

      const written = client.values.find((v) => v.key === `meal:${SUB}:v2:food:list`)!;
      expect(written).toBeDefined();
      const [row] = JSON.parse(written.value) as Array<{ deletedAt: string | null }>;
      expect(row.deletedAt).not.toBeNull();
    });

    it('owner scoping survives the include-deleted read', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      await h.service.create(SUB, body());

      expect(await h.service.findMatching('someone-else', undefined, true)).toEqual([]);
    });
  });

  describe('hit: identical reads are served from cache (decrypted after the hit)', () => {
    it('findAll twice consults the loader once and decrypts the sealed row on the hit', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      await h.service.create(SUB, body());

      const first = await h.service.findAll(SUB);
      const loaderCallsOnHit = h.foods.find.mock.calls.length;
      const second = await h.service.findAll(SUB);

      // The API output is byte-identical across a miss and a hit.
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(second.foods[0].unit).toBe('ml');
      expect(second.foods[0].name).toBe('Milk, Brand X');
      expect(second.foods[0].servings[0].amount).toBe(1000);
      // `scale(base, amount / servingGrams)`: 1000 ml of a 100 ml base = ×10.
      expect(second.foods[0].servings[0].nutrients.calories).toBe(600);
      // The second read did not run the loader again.
      expect(h.foods.find.mock.calls).toHaveLength(loaderCallsOnHit);
    });

    it('findOne twice consults the loader once and returns decrypted content on the hit', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(client);
      const created = await h.service.create(SUB, body({ nutrients: vector({ calories: 321 }) }));

      const first = await h.service.findOne(SUB, created.id);
      const loaderCallsOnHit = h.foods.findOne.mock.calls.length;
      const second = await h.service.findOne(SUB, created.id);

      expect(first.nutrients.calories).toBe(321);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(h.foods.findOne.mock.calls).toHaveLength(loaderCallsOnHit);
      const written = client.values.find((v) => v.key === `meal:${SUB}:v1:food:one:${created.id}`)!;
      // The cached value is the stored row, never the decrypted DTO.
      expect(written.value).toContain(ENC_PREFIX);
      expect(written.value).not.toContain('calories');
    });
  });
});
