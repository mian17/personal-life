import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { NUTRIENTS, type NutrientVector } from '@life/nutrition';
import { AuthGuard } from '@life/service-kit';
import { MEAL_CACHE, MealCache, generationKey } from '../src/cache/meal-cache';
import { VERIFIER_ENV } from '../src/service-config';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';
import { FakeRedisClient } from './fake-redis';

/**
 * The eight meal-service batch routes (`SPEC-meal-service.md` §5, map §4).
 *
 * Every case drives the real Nest app through supertest, so a route that
 * resolved to a parameter path instead of the literal AIP URI fails here as a
 * 404 rather than passing silently.
 *
 * The cache is a recording fake rather than the module's `REDIS_URL` selection:
 * "one bump per successful request, none after a rollback, and the shared
 * `meal:gen:<sub>` counter" is only observable if the test can see the bumps.
 * The recording client also captures every serialized value, which is how the
 * ciphertext assertion at the end reads the cached rows after a batch write.
 *
 * The DB is a throwaway under `test/`; this suite NEVER opens anything under
 * `apps/meal-service/data/` (the hard line).
 */

const TEST_DB = join(__dirname, 'test-meal-batch.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const owner = 'meal-batch-owner';
const stranger = 'meal-batch-stranger';
const DAY = '2026-09-11';
/** An id no row holds, for the cases where one item names an absent row. */
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

/** A complete vector: `overrides` on top of zeroes (`SPEC-meal-service`: missing data is 0). */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

/** A recording cache client: the fake Redis plus every raw value written through it. */
class CapturingRedisClient extends FakeRedisClient {
  readonly values: Array<{ key: string; value: string }> = [];

  override async set(key: string, value: string, options?: { EX?: number }): Promise<'OK'> {
    this.values.push({ key, value });
    return super.set(key, value, options);
  }
}

describe('Meal-service batch API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let redis: CapturingRedisClient;
  let originalEnv: NodeJS.ProcessEnv;
  let token = '';
  let strangerToken = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ subject: owner, expiresIn: 3600 });
    strangerToken = await harness.sign({ subject: stranger, expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    redis = new CapturingRedisClient();
    app = await startApp(new MealCache(redis));
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    // The guard's dev bypass reads `NODE_ENV` per request; keep every case owned.
    process.env.NODE_ENV = BASE_NODE_ENV;
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  /** The app as `app.module` builds it, with the one cache adapter swapped for the recorder. */
  async function startApp(mealCache: MealCache): Promise<INestApplication> {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEAL_CACHE)
      .useValue(mealCache)
      .compile();
    const application = moduleRef.createNestApplication();
    application.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
    application.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await application.init();
    return application;
  }

  describe('entries', () => {
    it('answers a two-item batchCreate on the literal route and both rows list for the day', async () => {
      const items = [entryItem('breakfast', 300), entryItem('lunch', 500)];

      const created = await apiPost('/api/entries:batchCreate', { items }).expect(201);

      expect(created.body.map((entry: { mealGroup: string }) => entry.mealGroup)).toEqual([
        'breakfast',
        'lunch',
      ]);
      expect(created.body.map((entry: { nutrients: NutrientVector }) => entry.nutrients.calories))
        .toEqual([300, 500]);
      expect(await listedEntryIds()).toEqual(
        expect.arrayContaining(created.body.map((entry: { id: string }) => entry.id)),
      );
    });

    it('does not answer on a slashed path, which would be the parameter route', async () => {
      const response = await apiPost('/api/entries/batchCreate', {
        items: [entryItem('snack', 1)],
      }).expect(404);

      expect(response.body).toEqual(routedNowhere('POST', '/api/entries/batchCreate'));
    });

    it('rejects ten items when one carries a partial nutrient vector, writing none of them', async () => {
      const entriesBefore = await countRows('entry');
      const items = [
        ...Array.from({ length: 9 }, (_unused, index) => entryItem('dinner', 100 + index)),
        { ...entryItem('dinner', 900), nutrients: { calories: 900 } },
      ];

      await apiPost('/api/entries:batchCreate', { items }).expect(400);

      expect(await countRows('entry')).toBe(entriesBefore);
    });

    it('answers 404 for a foreign id in a ten-item batchDelete and leaves all ten live', async () => {
      const ids = await createdEntryIds(10);
      const [foreignId] = await createdEntryIdsAs(strangerToken, 1);

      await apiPost('/api/entries:batchDelete', { items: [...ids.slice(1), foreignId].map(idItem) })
        .expect(404);

      const live = await listedEntryIds();
      expect(ids.every((id) => live.includes(id))).toBe(true);
      expect(await trashedEntryCount(ids)).toBe(0);
    });

    it('soft deletes a fully-owned ten-item batch in one commit and advances the counter once', async () => {
      const ids = await createdEntryIds(10);
      const bumpsBefore = redis.incrCalls.length;

      const deleted = await apiPost('/api/entries:batchDelete', { items: ids.map(idItem) })
        .expect(200);

      expect(deleted.body.deleted).toEqual(ids);
      expect(await listedEntryIds()).not.toEqual(expect.arrayContaining(ids));
      expect(await trashedEntryCount(ids)).toBe(10);
      expect(redis.incrCalls).toHaveLength(bumpsBefore + 1);
      expect(redis.incrCalls.at(-1)).toBe(generationKey(owner));
    });

    it('answers 409 for a stale expectedVersion on item seven and leaves 1-6 unchanged', async () => {
      const ids = await createdEntryIds(10);

      await apiPost('/api/entries:batchUpdate', {
        items: ids.map((id, index) => ({
          id,
          quantity: 2,
          nutrients: vector({ calories: 50 }),
          expectedVersion: index === 6 ? 5 : 0,
        })),
      }).expect(409);

      for (const id of ids.slice(0, 6)) {
        const entry = await apiGet(`/api/entries/${id}`).expect(200);
        expect(entry.body.version).toBe(0);
        expect(entry.body.quantity).toBe(1);
      }
    });
  });

  describe('foods', () => {
    it('answers a two-item batchCreate on the literal route and both rows are listed', async () => {
      const created = await apiPost('/api/foods:batchCreate', {
        items: [foodItem('oats'), foodItem('milk')],
      }).expect(201);

      expect(created.body.map((food: { name: string }) => food.name)).toEqual(['oats', 'milk']);
      expect(await listedFoodNames()).toEqual(expect.arrayContaining(['oats', 'milk']));
    });

    it('rejects ten items when one carries a partial vector, writing zero foods and zero servings', async () => {
      const names = Array.from({ length: 9 }, (_unused, index) => `rollback food ${index}`);
      const foodsBefore = await countRows('food');
      const servingsBefore = await countRows('serving');

      await apiPost('/api/foods:batchCreate', {
        items: [
          ...names.map((name) => foodItem(name)),
          { ...foodItem('rollback bad'), nutrients: { calories: 1 } },
        ],
      }).expect(400);

      expect(await listedFoodNames()).not.toEqual(
        expect.arrayContaining([...names, 'rollback bad']),
      );
      expect(await countRows('food')).toBe(foodsBefore);
      expect(await countRows('serving')).toBe(servingsBefore);
    });

    it('answers 404 for a foreign id in a ten-item batchDelete and leaves all ten live', async () => {
      const ids = await createdFoodIds(10);
      const [foreignId] = await createdFoodIdsAs(strangerToken, 1);

      await apiPost('/api/foods:batchDelete', { items: [...ids.slice(1), foreignId].map(idItem) })
        .expect(404);

      expect(await listedFoodIds()).toEqual(expect.arrayContaining(ids));
      expect(await trashedFoodCount(ids)).toBe(0);
    });

    it('soft deletes a fully-owned ten-item batch and advances the counter once', async () => {
      const ids = await createdFoodIds(10);
      const bumpsBefore = redis.incrCalls.length;

      await apiPost('/api/foods:batchDelete', { items: ids.map(idItem) }).expect(200);

      expect(await listedFoodIds()).not.toEqual(expect.arrayContaining(ids));
      expect(await trashedFoodCount(ids)).toBe(10);
      expect(redis.incrCalls).toHaveLength(bumpsBefore + 1);
    });

    it('rolls all three items back when one nutrient vector is invalid', async () => {
      const ids = await createdFoodIds(3);

      await apiPost('/api/foods:batchUpdate', {
        items: [
          { id: ids[0], name: 'renamed 0' },
          { id: ids[1], name: 'renamed 1', nutrients: { calories: 1 } },
          { id: ids[2], name: 'renamed 2' },
        ],
      }).expect(400);

      for (const id of ids) {
        const food = await apiGet(`/api/foods/${id}`).expect(200);
        expect(food.body.version).toBe(0);
      }
    });
  });

  describe('saved meals', () => {
    it('soft deletes a fully-owned ten-item batch and advances the counter once', async () => {
      const ids = await createdSavedMealIds(10);
      const bumpsBefore = redis.incrCalls.length;

      const deleted = await apiPost('/api/saved-meals:batchDelete', { items: ids.map(idItem) })
        .expect(200);

      expect(deleted.body.deleted).toEqual(ids);
      expect(await listedSavedMealIds()).not.toEqual(expect.arrayContaining(ids));
      expect(await trashedSavedMealCount(ids)).toBe(10);
      expect(redis.incrCalls).toHaveLength(bumpsBefore + 1);
      expect(redis.incrCalls.at(-1)).toBe(generationKey(owner));
    });

    it('creates 110 rows for ten meals of ten items in one transaction', async () => {
      const meals = Array.from({ length: 10 }, (_unused, index) => savedMealItem(`meal ${index}`));
      const mealsBefore = await countRows('saved_meal');
      const itemsBefore = await countRows('saved_meal_item');

      const created = await apiPost('/api/saved-meals:batchCreate', { items: meals }).expect(201);

      expect(created.body).toHaveLength(10);
      expect(await countRows('saved_meal')).toBe(mealsBefore + 10);
      expect(await countRows('saved_meal_item')).toBe(itemsBefore + 100);
    });

    it('writes no saved-meal row when one item carries a partial vector', async () => {
      const meals = Array.from({ length: 9 }, (_unused, index) => savedMealItem(`atomic ${index}`));
      const mealsBefore = await countRows('saved_meal');
      const itemsBefore = await countRows('saved_meal_item');

      await apiPost('/api/saved-meals:batchCreate', {
        items: [
          ...meals,
          {
            ...savedMealItem('atomic bad'),
            items: [{ quantity: 1, nutrients: { calories: 1 } }],
          },
        ],
      }).expect(400);

      expect(await countRows('saved_meal')).toBe(mealsBefore);
      expect(await countRows('saved_meal_item')).toBe(itemsBefore);
    });

    it('answers 404 for a foreign id in a ten-item batchDelete and leaves all ten readable', async () => {
      const ids = await createdSavedMealIds(10);
      const [foreignId] = await createdSavedMealIdsAs(strangerToken, 1);

      await apiPost('/api/saved-meals:batchDelete', { items: [...ids.slice(1), foreignId].map(idItem) })
        .expect(404);

      for (const id of ids) {
        const meal = await apiGet(`/api/saved-meals/${id}`).expect(200);
        expect(meal.body.id).toBe(id);
      }
      expect(await trashedSavedMealCount(ids)).toBe(0);
    });

    it('has no :batchUpdate route', async () => {
      const response = await apiPost('/api/saved-meals:batchUpdate', {
        items: [idItem(MISSING_ID)],
      }).expect(404);

      expect(response.body).toEqual(routedNowhere('POST', '/api/saved-meals:batchUpdate'));
    });
  });

  describe('the item cap', () => {
    /**
     * All eight routes, each handed one item past the cap. The cap is checked
     * before any transaction opens (`MAX_BATCH_ITEMS`), so a route that wrote
     * anything here shows up as a changed row count rather than a 400 alone.
     *
     * Every item is otherwise valid, so a route passing by rejecting the shape
     * would answer 400 for the wrong reason and this table would not notice.
     */
    it.each([
      { route: '/api/entries:batchCreate', table: 'entry', items: elevenEntryItems() },
      {
        route: '/api/entries:batchUpdate',
        table: 'entry',
        items: elevenOf({ id: MISSING_ID, quantity: 1, nutrients: vector() }),
      },
      { route: '/api/entries:batchDelete', table: 'entry', items: elevenOf(idItem(MISSING_ID)) },
      { route: '/api/foods:batchCreate', table: 'food', items: elevenOf(foodItem('over cap')) },
      {
        route: '/api/foods:batchUpdate',
        table: 'food',
        items: elevenOf({ id: MISSING_ID, name: 'over cap' }),
      },
      { route: '/api/foods:batchDelete', table: 'food', items: elevenOf(idItem(MISSING_ID)) },
      {
        route: '/api/saved-meals:batchCreate',
        table: 'saved_meal',
        items: elevenOf(savedMealItem('over cap')),
      },
      {
        route: '/api/saved-meals:batchDelete',
        table: 'saved_meal',
        items: elevenOf(idItem(MISSING_ID)),
      },
    ])('answers 400 on $route and writes no $table row', async ({ route, table, items }) => {
      const rowsBefore = await countRows(table);

      await apiPost(route, { items }).expect(400);

      expect(await countRows(table)).toBe(rowsBefore);
    });
  });

  describe('cache invalidation', () => {
    it('bumps once per successful batch request on the shared owner counter', async () => {
      const before = redis.incrCalls.length;

      await apiPost('/api/foods:batchCreate', {
        items: [foodItem('bump a'), foodItem('bump b')],
      }).expect(201);

      expect(redis.incrCalls).toHaveLength(before + 1);
      expect(redis.incrCalls.at(-1)).toBe(generationKey(owner));
    });

    it('bumps nothing when a batch rolls back', async () => {
      const before = redis.incrCalls.length;

      await apiPost('/api/entries:batchCreate', { items: elevenEntryItems() }).expect(400);
      await apiPost('/api/entries:batchUpdate', {
        items: [{ id: MISSING_ID, quantity: 1, nutrients: vector() }],
      }).expect(404);
      await apiPost('/api/saved-meals:batchDelete', { items: [idItem(MISSING_ID)] }).expect(404);

      expect(redis.incrCalls).toHaveLength(before);
    });

    it('writes no cache entry of its own', async () => {
      const before = redis.sets.length;

      await apiPost('/api/entries:batchCreate', {
        items: [entryItem('snack', 11), entryItem('snack', 12)],
      }).expect(201);

      expect(redis.sets).toHaveLength(before);
    });

    it('leaves the cached value ciphertext-only after a batch write', async () => {
      const day = '2026-09-12';
      await apiPost('/api/entries:batchCreate', {
        items: [{ ...entryItem('breakfast', 123456.789), date: day }],
      }).expect(201);

      // The first read after the bump populates the day entry from the DB.
      await apiGet(`/api/entries?date=${day}`).expect(200);

      const written = redis.values.filter((entry) => entry.key.endsWith(`entries:${day}`));
      expect(written).toHaveLength(1);
      expect(written[0].value).toContain('enc.v1.');
      expect(written[0].value).not.toContain('calories');
      expect(written[0].value).not.toContain('123456.789');
    });
  });

  function apiGet(path: string): request.Test {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  }

  function apiPost(path: string, body: unknown): request.Test {
    return apiPostAs(token, path, body);
  }

  function apiPostAs(bearer: string, path: string, body: unknown): request.Test {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${bearer}`).send(body as object);
  }

  /**
   * What Nest answers for a `POST` that matched no route at all. An absent path
   * answers exactly this body, so a 404 carrying a domain message (a batch route
   * that did resolve and then failed on its items) can never pass for an absent
   * route.
   */
  function routedNowhere(verb: string, path: string) {
    return { statusCode: 404, message: `Cannot ${verb} ${path}`, error: 'Not Found' };
  }

  function entryItem(mealGroup: string, calories: number) {
    return {
      date: DAY,
      mealGroup,
      foodId: 'food-' + mealGroup,
      quantity: 1,
      nutrients: vector({ calories }),
    };
  }

  function elevenEntryItems() {
    return Array.from({ length: 11 }, (_unused, index) => entryItem('snack', 1 + index));
  }

  /** Eleven copies of one item — a batch one item past the cap. */
  function elevenOf(item: object): object[] {
    return Array.from({ length: 11 }, () => ({ ...item }));
  }

  function foodItem(name: string) {
    return {
      name,
      servingGrams: 100,
      portions: [{ label: 'portion', amount: 100 }],
      nutrients: vector({ calories: 100 }),
    };
  }

  function savedMealItem(name: string) {
    return {
      name,
      mealGroup: 'dinner',
      items: Array.from({ length: 10 }, (_unused, index) => ({
        foodId: `food-${index}`,
        quantity: 1,
        nutrients: vector({ calories: 10 }),
      })),
    };
  }

  function idItem(id: string) {
    return { id };
  }

  async function listedEntryIds(): Promise<string[]> {
    return listedEntryIdsAs(token);
  }

  async function listedEntryIdsAs(bearer: string): Promise<string[]> {
    const listed = await request(app.getHttpServer())
      .get(`/api/entries?date=${DAY}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return listed.body.map((entry: { id: string }) => entry.id);
  }

  async function createdEntryIds(count: number): Promise<string[]> {
    return createdEntryIdsAs(token, count);
  }

  async function createdEntryIdsAs(bearer: string, count: number): Promise<string[]> {
    const items = Array.from({ length: count }, (_unused, index) => entryItem('snack', 1 + index));
    const created = await apiPostAs(bearer, '/api/entries:batchCreate', { items }).expect(201);
    return created.body.map((entry: { id: string }) => entry.id);
  }

  async function listedFoodNames(): Promise<string[]> {
    const listed = await apiGet('/api/foods').expect(200);
    return listed.body.map((food: { name: string }) => food.name);
  }

  async function listedFoodIds(): Promise<string[]> {
    return listedFoodIdsAs(token);
  }

  async function listedFoodIdsAs(bearer: string): Promise<string[]> {
    const listed = await request(app.getHttpServer())
      .get('/api/foods')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return listed.body.map((food: { id: string }) => food.id);
  }

  async function createdFoodIds(count: number): Promise<string[]> {
    return createdFoodIdsAs(token, count);
  }

  async function createdFoodIdsAs(bearer: string, count: number): Promise<string[]> {
    const items = Array.from({ length: count }, (_unused, index) => foodItem(`batch food ${index}`));
    const created = await apiPostAs(bearer, '/api/foods:batchCreate', { items }).expect(201);
    return created.body.map((food: { id: string }) => food.id);
  }

  async function listedSavedMealIds(): Promise<string[]> {
    const listed = await apiGet('/api/saved-meals').expect(200);
    return listed.body.map((meal: { id: string }) => meal.id);
  }

  async function createdSavedMealIds(count: number): Promise<string[]> {
    return createdSavedMealIdsAs(token, count);
  }

  async function createdSavedMealIdsAs(bearer: string, count: number): Promise<string[]> {
    const items = Array.from({ length: count }, (_unused, index) => savedMealItem(`batch saved ${index}`));
    const created = await apiPostAs(bearer, '/api/saved-meals:batchCreate', { items }).expect(201);
    return created.body.map((meal: { id: string }) => meal.id);
  }

  /** Rows of one table still carrying `deletedAt` — the soft-delete proof. */
  async function countRows(table: string): Promise<number> {
    const [row] = await dataSource.query(`SELECT COUNT(*) AS total FROM ${table}`);
    return Number(row.total);
  }

  async function countTrashed(table: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const [row] = await dataSource.query(
      `SELECT COUNT(*) AS total FROM ${table} WHERE deletedAt IS NOT NULL AND id IN (${placeholders})`,
      ids,
    );
    return Number(row.total);
  }

  const trashedEntryCount = (ids: string[]) => countTrashed('entry', ids);
  const trashedFoodCount = (ids: string[]) => countTrashed('food', ids);
  const trashedSavedMealCount = (ids: string[]) => countTrashed('saved_meal', ids);
});
