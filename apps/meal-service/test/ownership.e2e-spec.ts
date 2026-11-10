import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { NUTRIENTS, type Nutrient } from '@life/nutrition';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * Two-subject ownership isolation (`SPEC-meal-service` Success Criterion 1):
 * boot the real app with the real guard and drive it over HTTP for two
 * independently minted subjects A and B. Every route is scoped by the verified
 * `sub`, so a foreign id is indistinguishable from a missing one (byte-identical
 * 404) and B can never read, mutate, or delete A's food or target.
 *
 * Food and target blocks are separate describes so Tasks 9 (entry) and 11
 * (saved meal) can extend this file with their own cross-entity blocks without
 * restructuring it. `NODE_ENV` is pinned to a non-development value for the
 * whole suite (jest workers share `process.env`; the guard's dev bypass reads it
 * per request).
 */

const TEST_DB = join(import.meta.dirname, 'test-ownership.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Meal ownership (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    tokenA = await harness.sign({ subject: 'user-a', expiresIn: 3600 });
    tokenB = await harness.sign({ subject: 'user-b', expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
  });

  afterEach(() => {
    // The dev bypass must never leak into a later case in this worker.
    process.env.NODE_ENV = BASE_NODE_ENV;
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  describe('foods', () => {
    const post = (body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).post('/api/foods'), token).send(body);
    const list = (token: string, q?: string) =>
      auth(
        request(app.getHttpServer()).get('/api/foods' + (q ? `?q=${encodeURIComponent(q)}` : '')),
        token,
      );
    const one = (id: string, token: string) =>
      auth(request(app.getHttpServer()).get(`/api/foods/${id}`), token);
    const patch = (id: string, body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).patch(`/api/foods/${id}`), token).send(body);
    const remove = (id: string, token: string) =>
      auth(request(app.getHttpServer()).delete(`/api/foods/${id}`), token);

    it("scopes the list to the caller (B sees nothing of A's foods)", async () => {
      await post({ name: 'A oats', servingGrams: 100 }, tokenA).expect(201);

      const bList = await list(tokenB).expect(200);
      expect(bList.body.foods).toEqual([]);

      const aList = await list(tokenA).expect(200);
      expect(aList.body.foods.map((f: { name: string }) => f.name)).toContain('A oats');
    });

    it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
      const created = await post({ name: 'A rice', servingGrams: 150 }, tokenA).expect(201);

      const compare404 = async (foreign: () => request.Test, missing: () => request.Test) => {
        const f = await foreign().expect(404);
        const m = await missing().expect(404);
        expect(f.status).toBe(m.status);
        expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
      };

      await compare404(
        () => one(created.body.id, tokenB),
        () => one(MISSING_ID, tokenB),
      );
      await compare404(
        () => patch(created.body.id, { name: 'hijack' }, tokenB),
        () => patch(MISSING_ID, { name: 'hijack' }, tokenB),
      );
      await compare404(
        () => remove(created.body.id, tokenB),
        () => remove(MISSING_ID, tokenB),
      );

      // B's failed attempts never touched A's row.
      const reread = await one(created.body.id, tokenA).expect(200);
      expect(reread.body.name).toBe('A rice');
    });

    it("does not leak B's matching food through A's search (`q` post-decrypt)", async () => {
      await post({ name: 'shared-token-A', servingGrams: 100 }, tokenA).expect(201);
      await post({ name: 'shared-token-B', servingGrams: 100 }, tokenB).expect(201);

      const aSearch = await list(tokenA, 'shared-token').expect(200);
      expect(aSearch.body.foods.map((f: { name: string }) => f.name)).toEqual(['shared-token-A']);

      const bSearch = await list(tokenB, 'shared-token').expect(200);
      expect(bSearch.body.foods.map((f: { name: string }) => f.name)).toEqual(['shared-token-B']);
    });
  });

  describe('entries', () => {
    const DAY = '2026-09-03';
    const post = (body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).post('/api/entries'), token).send(body);
    const list = (date: string, token: string) =>
      auth(request(app.getHttpServer()).get(`/api/entries?date=${date}`), token);
    const one = (id: string, token: string) =>
      auth(request(app.getHttpServer()).get(`/api/entries/${id}`), token);
    const patch = (id: string, body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).patch(`/api/entries/${id}`), token).send(body);
    const remove = (id: string, token: string) =>
      auth(request(app.getHttpServer()).delete(`/api/entries/${id}`), token);

    /** A complete 27-field vector (missing data is 0), distinct per caller. */
    const entryVector = (calories: number): Record<Nutrient, number> => {
      const out = {} as Record<Nutrient, number>;
      for (const { key } of NUTRIENTS) out[key] = 0;
      out.calories = calories;
      return out;
    };

    it("scopes the day to the caller (B sees nothing of A's entries)", async () => {
      await post(
        {
          date: DAY,
          mealGroup: 'breakfast',
          foodId: 'food-a',
          quantity: 1,
          nutrients: entryVector(500),
        },
        tokenA,
      ).expect(201);

      const bList = await list(DAY, tokenB).expect(200);
      expect(bList.body.entries).toEqual([]);

      const aList = await list(DAY, tokenA).expect(200);
      expect(aList.body.entries).toHaveLength(1);
      expect(aList.body.entries[0].nutrients.calories).toBe(500);
      expect(aList.body.entries[0]).not.toHaveProperty('ownerSub');
    });

    it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
      const created = await post(
        {
          date: DAY,
          mealGroup: 'lunch',
          foodId: 'food-a',
          quantity: 1,
          nutrients: entryVector(300),
        },
        tokenA,
      ).expect(201);

      const compare404 = async (foreign: () => request.Test, missing: () => request.Test) => {
        const f = await foreign().expect(404);
        const m = await missing().expect(404);
        expect(f.status).toBe(m.status);
        expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
      };

      await compare404(
        () => one(created.body.id, tokenB),
        () => one(MISSING_ID, tokenB),
      );
      await compare404(
        () => patch(created.body.id, { mealGroup: 'dinner' }, tokenB),
        () => patch(MISSING_ID, { mealGroup: 'dinner' }, tokenB),
      );
      await compare404(
        () => remove(created.body.id, tokenB),
        () => remove(MISSING_ID, tokenB),
      );

      // B's failed attempts never touched A's row or its snapshot.
      const reread = await one(created.body.id, tokenA).expect(200);
      expect(reread.body.mealGroup).toBe('lunch');
      expect(reread.body.nutrients.calories).toBe(300);
    });

    it("does not let B's entries move A's day total", async () => {
      const aBefore = await list(DAY, tokenA).expect(200);
      const totalBefore = aBefore.body.entries.reduce(
        (n: number, e: { nutrients: { calories: number } }) => n + e.nutrients.calories,
        0,
      );

      await post(
        {
          date: DAY,
          mealGroup: 'snack',
          foodId: 'food-b',
          quantity: 1,
          nutrients: entryVector(700),
        },
        tokenB,
      ).expect(201);

      const aAfter = await list(DAY, tokenA).expect(200);
      const totalAfter = aAfter.body.entries.reduce(
        (n: number, e: { nutrients: { calories: number } }) => n + e.nutrients.calories,
        0,
      );
      expect(aAfter.body).toEqual(aBefore.body);
      expect(totalAfter).toBe(totalBefore);
    });
  });

  describe('targets', () => {
    const put = (body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).put('/api/target/profile'), token).send(body);
    const get = (date: string, token: string) =>
      auth(request(app.getHttpServer()).get(`/api/target?date=${date}`), token);

    const PROFILE = {
      age: 30,
      sex: 'male',
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goal: 'maintain',
    };

    it('scopes the target read to the caller (B 404s while A has a row)', async () => {
      await put({ ...PROFILE, date: '2026-01-01' }, tokenA).expect(200);

      await get('2026-06-01', tokenB).expect(404);

      const aTarget = await get('2026-06-01', tokenA).expect(200);
      expect(aTarget.body.weightKg).toBe(80);
      expect(aTarget.body).not.toHaveProperty('ownerSub');
    });

    it("B's profile write never alters A's target", async () => {
      await put({ ...PROFILE, date: '2026-01-01' }, tokenA).expect(200);
      const aBefore = await get('2026-06-01', tokenA).expect(200);

      await put({ ...PROFILE, weightKg: 120, date: '2026-01-01' }, tokenB).expect(200);

      const aAfter = await get('2026-06-01', tokenA).expect(200);
      expect(aAfter.body).toEqual(aBefore.body);
    });
  });

  describe('saved meals', () => {
    const post = (body: Record<string, unknown>, token: string) =>
      auth(request(app.getHttpServer()).post('/api/saved-meals'), token).send(body);
    const list = (token: string) =>
      auth(request(app.getHttpServer()).get('/api/saved-meals'), token);
    const one = (id: string, token: string) =>
      auth(request(app.getHttpServer()).get(`/api/saved-meals/${id}`), token);
    const remove = (id: string, token: string) =>
      auth(request(app.getHttpServer()).delete(`/api/saved-meals/${id}`), token);

    const savedVector = (calories: number): Record<Nutrient, number> => {
      const out = {} as Record<Nutrient, number>;
      for (const { key } of NUTRIENTS) out[key] = 0;
      out.calories = calories;
      return out;
    };

    const body = (name: string, calories: number) => ({
      name,
      mealGroup: 'dinner',
      items: [{ foodId: 'food-a', quantity: 1, nutrients: savedVector(calories) }],
    });

    it("scopes the list and one-read to the caller (B sees nothing of A's saved meal)", async () => {
      const created = await post(body('A dinner', 640), tokenA).expect(201);

      const bList = await list(tokenB).expect(200);
      expect(bList.body.savedMeals).toEqual([]);

      const aList = await list(tokenA).expect(200);
      expect(aList.body.savedMeals).toHaveLength(1);
      expect(aList.body.savedMeals[0].items[0].nutrients.calories).toBe(640);
      expect(aList.body.savedMeals[0]).not.toHaveProperty('ownerSub');

      await one(created.body.id, tokenB).expect(404);
      await one(created.body.id, tokenA).expect(200);
    });

    it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
      const created = await post(body('A lunch', 500), tokenA).expect(201);

      const f = await one(created.body.id, tokenB).expect(404);
      const m = await one(MISSING_ID, tokenB).expect(404);
      expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));

      await remove(created.body.id, tokenB).expect(404);
      const stillThere = await one(created.body.id, tokenA).expect(200);
      expect(stillThere.body.name).toBe('A lunch');
    });
  });
});
