import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { NUTRIENTS, scale, type Food as FoodModel, type NutrientVector } from '@life/nutrition';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * The Lose It! unit contract (`SPEC-food-units`, `docs/intent/meal-food-management.md`):
 * one canonical unit per food, chosen at creation and immutable after, with
 * named measures carrying explicit amounts in the food's own unit. Measure
 * vectors are derived server-side with `scale()`, so a client can never
 * disagree with a stored number — and there is no g↔ml conversion anywhere.
 *
 * Each block reads like the sentence it proves: the round-trip creates, the
 * 400 case edits, the amounts case reads back. AC4 (editing a food rewrites no
 * entry row) is proved by construction — `FoodsService` never touches `Entry`
 * rows — and asserted here against the DB, not the cache. SC4 (the cached row
 * is sealed except `unit`) lives in its own cache suite, `foods-cache.e2e-spec.ts`.
 */

const TEST_DB = join(__dirname, 'test-foods-units.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';

let tokenA = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

/** A complete 27-field vector with only the given nutrient set. */
const vectorOf = (calories: number): NutrientVector => {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = 0;
  out.calories = calories;
  return out;
};

describe('Food units contract (e2e)', () => {
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

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
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

  const post = (body: Record<string, unknown>, token: string = tokenA) =>
    auth(request(app.getHttpServer()).post('/api/foods'), token).send(body);
  const one = (id: string, token: string = tokenA) =>
    auth(request(app.getHttpServer()).get(`/api/foods/${id}`), token);
  const patch = (id: string, body: Record<string, unknown>, token: string = tokenA) =>
    auth(request(app.getHttpServer()).patch(`/api/foods/${id}`), token).send(body);

  it('creates an ml food whose measure vector is scale(base, amount / servingGrams) exactly (AC1, AC3)', async () => {
    const base = vectorOf(60);
    const created = await post({
      name: 'Milk, Brand X',
      unit: 'ml',
      servingGrams: 100,
      nutrients: base,
      portions: [{ label: '1 carton', amount: 1000 }],
    }).expect(201);

    expect(created.body.unit).toBe('ml');
    expect(created.body.servings[0]).toMatchObject({ label: '1 carton', amount: 1000 });

    const model: FoodModel = {
      id: 'derive',
      name: '',
      servingGrams: 100,
      nutrients: base as never,
      portions: [],
    };
    expect(created.body.servings[0].nutrients).toEqual(scale(model, 1000 / 100));
    expect(created.body.servings[0].nutrients.calories).toBe(600);
    // The wire renamed `grams` → `amount`: the old field is gone.
    expect(created.body.servings[0]).not.toHaveProperty('grams');

    const read = await one(created.body.id).expect(200);
    expect(read.body.unit).toBe('ml');
    expect(read.body.servings[0].amount).toBe(1000);
    expect(read.body.servings[0].nutrients).toEqual(scale(model, 1000 / 100));
  });

  it('defaults an omitted unit to g (contract anchor)', async () => {
    const created = await post({
      name: 'Plain staple',
      servingGrams: 100,
      nutrients: vectorOf(300),
    }).expect(201);

    expect(created.body.unit).toBe('g');
    expect((await one(created.body.id).expect(200)).body.unit).toBe('g');
  });

  it('rejects a PATCH carrying unit with 400 and leaves the unit byte-identical on a real edit (AC2)', async () => {
    const base = vectorOf(60);
    const created = await post({
      name: 'Milk, Brand X',
      unit: 'ml',
      servingGrams: 100,
      nutrients: base,
      portions: [{ label: '1 carton', amount: 1000 }],
    }).expect(201);
    expect(created.body.version).toBe(0);

    await patch(created.body.id, { unit: 'g' } as never).expect(400);

    // The edit body carries no `unit` — the app never sends it, and the 400
    // above is what a body that did would meet.
    const patched = await patch(created.body.id, {
      name: 'Milk, Brand Y',
      nutrients: vectorOf(70),
      portions: [{ label: '1 bottle', amount: 500 }],
    }).expect(200);
    expect(patched.body.version).toBe(1);

    const read = await one(created.body.id).expect(200);
    expect(read.body.version).toBe(1);
    expect(read.body.unit).toBe('ml');
    expect(read.body.unit).toBe(created.body.unit);
    expect(read.body.name).toBe('Milk, Brand Y');
    // The measures edit landed and still carries the food's unit, unchanged.
    expect(read.body.servings).toHaveLength(1);
    expect(read.body.servings[0]).toMatchObject({ label: '1 bottle', amount: 500 });
  });

  it('a stale expectedVersion is a 409, so two editors cannot silently overwrite (SPEC-food-catalog-ui: resubmits carry expectedVersion)', async () => {
    const created = await post({
      name: 'Concurrency probe',
      servingGrams: 100,
      nutrients: vectorOf(120),
    }).expect(201);

    await patch(created.body.id, { name: 'First editor', expectedVersion: 0 }).expect(200);
    // The second editor still holds version 0: its write is refused, not merged.
    await patch(created.body.id, { name: 'Second editor', expectedVersion: 0 }).expect(409);
    expect((await one(created.body.id).expect(200)).body.name).toBe('First editor');
  });

  it('deleting a food rewrites no entry: the logged day stays byte-identical (SPEC-food-catalog-ui AC5: history immutability)', async () => {
    const created = await post({
      name: 'Delete keeps history',
      unit: 'ml',
      servingGrams: 100,
      nutrients: vectorOf(240),
      portions: [{ label: '1 carton', amount: 1000 }],
    }).expect(201);

    const day = '2026-09-05';
    await auth(request(app.getHttpServer()).post('/api/entries'), tokenA)
      .send({
        date: day,
        mealGroup: 'lunch',
        foodId: created.body.id,
        quantity: 2,
        nutrients: vectorOf(480),
      })
      .expect(201);

    const before = await auth(
      request(app.getHttpServer()).get(`/api/entries?date=${day}`),
      tokenA,
    ).expect(200);
    expect(before.body).toHaveLength(1);

    await auth(request(app.getHttpServer()).delete(`/api/foods/${created.body.id}`), tokenA).expect(
      200,
    );

    const after = await auth(
      request(app.getHttpServer()).get(`/api/entries?date=${day}`),
      tokenA,
    ).expect(200);
    // The day's entries and their totals are exactly what they were.
    expect(JSON.stringify(after.body)).toBe(JSON.stringify(before.body));

    // The food itself is gone: reads like a missing row, absent from the default catalog.
    await one(created.body.id).expect(404);
    const catalog = await auth(request(app.getHttpServer()).get('/api/foods'), tokenA).expect(200);
    expect(catalog.body.map((food: { id: string }) => food.id)).not.toContain(created.body.id);

    // ...but a past entry's dish name still resolves: the include-deleted read
    // returns the soft-deleted row with the same DTO and owner scoping.
    const withDeleted = await auth(
      request(app.getHttpServer()).get('/api/foods?includeDeleted=1'),
      tokenA,
    ).expect(200);
    const restored = withDeleted.body.find((food: { id: string }) => food.id === created.body.id);
    expect(restored).toMatchObject({ name: 'Delete keeps history', unit: 'ml' });
    // The pre-feature rows (an entry whose `foodId` is the dish name) never lose
    // their fallback: an unknown id still matches no row here.
    expect(restored).not.toMatchObject({ deletedAt: expect.anything() });
  });

  it('the include-deleted catalog is owner-scoped (a foreign soft-deleted food never leaks)', async () => {
    const tokenB = await harness.sign({ subject: 'user-b', expiresIn: 3600 });
    const mine = await post({ name: 'Mine', servingGrams: 100 }).expect(201);
    const theirs = await auth(request(app.getHttpServer()).post('/api/foods'), tokenB)
      .send({ name: 'Theirs', servingGrams: 100 })
      .expect(201);
    await auth(request(app.getHttpServer()).delete(`/api/foods/${theirs.body.id}`), tokenB).expect(
      200,
    );

    const mineWithDeleted = await auth(
      request(app.getHttpServer()).get('/api/foods?includeDeleted=1'),
      tokenA,
    ).expect(200);
    const ids = mineWithDeleted.body.map((food: { id: string }) => food.id);
    expect(ids).toContain(mine.body.id);
    expect(ids).not.toContain(theirs.body.id);
  });

  it('stores an ml amount verbatim, with no conversion anywhere (no g↔ml)', async () => {
    const created = await post({
      name: 'Oat drink',
      unit: 'ml',
      servingGrams: 100,
      nutrients: vectorOf(45),
      portions: [
        { label: '1 tbsp', amount: 15 },
        { label: '1 carton', amount: 1000 },
      ],
    }).expect(201);

    expect(
      created.body.servings
        .map((s: { amount: number }) => s.amount)
        .sort((a: number, b: number) => a - b),
    ).toEqual([15, 1000]);

    const dataSource = app.get(DataSource);
    const servings: Array<{ grams: number }> = await dataSource.query(
      'SELECT grams FROM serving WHERE foodId = ? ORDER BY grams ASC',
      [created.body.id],
    );
    // The persisted column still says `grams` (`SPEC-food-units` § 0.3), but it
    // holds the ml amount verbatim — nothing was scaled or converted.
    expect(servings.map((s) => s.grams)).toEqual([15, 1000]);

    const food: Array<{ unit: string }> = await dataSource.query(
      'SELECT unit FROM food WHERE id = ?',
      [created.body.id],
    );
    expect(food[0].unit).toBe('ml');
  });

  it('editing a food rewrites no entry row (AC4, history immutable by construction)', async () => {
    const created = await post({
      name: 'Keep history',
      servingGrams: 100,
      nutrients: vectorOf(200),
      portions: [{ label: 'half', amount: 50 }],
    }).expect(201);

    const dataSource = app.get(DataSource);
    const base = vectorOf(200);
    const entryId = 'history-entry-1';
    await dataSource.query(
      'INSERT INTO entry (id, ownerSub, date, mealGroup, foodId, quantity, nutrients, version, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
      [
        entryId,
        'user-a',
        '2026-09-03',
        'breakfast',
        created.body.id,
        2,
        JSON.stringify(base),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    const before: Array<{ nutrients: string; quantity: number }> = await dataSource.query(
      'SELECT nutrients, quantity FROM entry WHERE id = ?',
      [entryId],
    );

    await patch(created.body.id, { name: 'Renamed', nutrients: vectorOf(400) }).expect(200);

    const after: Array<{ nutrients: string; quantity: number }> = await dataSource.query(
      'SELECT nutrients, quantity FROM entry WHERE id = ?',
      [entryId],
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
