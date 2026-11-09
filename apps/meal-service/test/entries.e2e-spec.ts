import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { NUTRIENTS, sum, type NutrientVector } from '@life/nutrition';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * Diary entries over HTTP (`SPEC-meal-service` entries / Success Criterion 3):
 * boot the real app with the real guard and drive the five entry routes for a
 * day — write the confirmed snapshot, read it back, sum the day, delete one
 * entry and watch the total move.
 *
 * The snapshot contract is proved twice here and once more in
 * `entry-snapshot.test.ts`: what the client confirmed is what the DB holds
 * (an `enc.v1.` envelope, never plaintext), and the day's total is `sum()`
 * over the day's entries, computed on read.
 */

const TEST_DB = join(__dirname, 'test-entries.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const DAY = '2026-09-03';
const OTHER_DAY = '2026-09-04';

let tokenA = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

/** A complete vector: `overrides` on top of zeroes (`SPEC-meal-service`: missing data is 0). */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

describe('Diary entries (e2e)', () => {
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

  const post = (body: Record<string, unknown>) =>
    auth(request(app.getHttpServer()).post('/api/entries'), tokenA).send(body);
  const day = (date: string, meal?: string, extra?: string) =>
    auth(
      request(app.getHttpServer()).get(
        `/api/entries?date=${date}${meal ? `&meal=${meal}` : ''}${extra ?? ''}`,
      ),
      tokenA,
    );
  const one = (id: string) => auth(request(app.getHttpServer()).get(`/api/entries/${id}`), tokenA);
  const patch = (id: string, body: Record<string, unknown>) =>
    auth(request(app.getHttpServer()).patch(`/api/entries/${id}`), tokenA).send(body);
  const remove = (id: string) =>
    auth(request(app.getHttpServer()).delete(`/api/entries/${id}`), tokenA);

  it('stores the confirmed snapshot and reads it back unchanged', async () => {
    const snapshot = vector({ calories: 987654.321, protein: 25 });
    const created = await post({
      date: DAY,
      mealGroup: 'breakfast',
      foodId: 'food-1',
      quantity: 2,
      nutrients: snapshot,
    }).expect(201);

    expect(created.body).toMatchObject({
      date: DAY,
      mealGroup: 'breakfast',
      foodId: 'food-1',
      quantity: 2,
    });
    expect(created.body.nutrients).toEqual(snapshot);
    expect(created.body).not.toHaveProperty('ownerSub');

    const reread = await one(created.body.id).expect(200);
    expect(reread.body.nutrients).toEqual(snapshot);
  });

  it("a day's total equals sum() of its entries, and deleting one entry moves the total", async () => {
    const first = vector({ calories: 400, protein: 20 });
    const second = vector({ calories: 600, protein: 10 });
    const a = await post({
      date: OTHER_DAY,
      mealGroup: 'lunch',
      foodId: 'food-2',
      quantity: 1,
      nutrients: first,
    }).expect(201);
    await post({
      date: OTHER_DAY,
      mealGroup: 'dinner',
      foodId: 'food-3',
      quantity: 1,
      nutrients: second,
    }).expect(201);

    const listed = await day(OTHER_DAY).expect(200);
    expect(listed.body.entries).toHaveLength(2);
    expect(listed.body.nextCursor).toBeNull();
    const total = sum(listed.body.entries.map((e: { nutrients: NutrientVector }) => e.nutrients));
    expect(total).toEqual(sum([first, second]));
    expect(total.calories).toBe(1000);
    expect(total.protein).toBe(30);

    await remove(a.body.id).expect(200);

    const after = await day(OTHER_DAY).expect(200);
    expect(after.body.entries).toHaveLength(1);
    const moved = sum(after.body.entries.map((e: { nutrients: NutrientVector }) => e.nutrients));
    expect(moved).toEqual(second);
    expect(moved.calories).toBe(600);
  });

  it('filters by meal group in memory and never leaks another day', async () => {
    const listed = await day(DAY).expect(200);
    expect(listed.body.entries.length).toBeGreaterThanOrEqual(1);

    const breakfast = await day(DAY, 'breakfast').expect(200);
    expect(breakfast.body.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of breakfast.body.entries) expect(entry.mealGroup).toBe('breakfast');

    const lunch = await day(DAY, 'lunch').expect(200);
    expect(lunch.body.entries).toEqual([]);
    expect(lunch.body.nextCursor).toBeNull();
  });

  it('pages a day with no gap and no duplicate across the boundary', async () => {
    const pagingDay = '2026-09-05';
    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const entry = await post({
        date: pagingDay,
        mealGroup: 'snack',
        foodId: `page-food-${index}`,
        quantity: 1,
        nutrients: vector({ calories: 100 + index }),
      }).expect(201);
      created.push(entry.body.id);
    }

    const first = await day(pagingDay, undefined, '&limit=2').expect(200);
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await day(
      pagingDay,
      undefined,
      `&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    ).expect(200);
    expect(second.body.entries).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    // Every entry of the day appears exactly once across the two pages.
    const paged = [...first.body.entries, ...second.body.entries].map((e: { id: string }) => e.id);
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toHaveLength(created.length);
    expect([...paged].sort()).toEqual([...created].sort());
  });

  it('a quantity change without a corrected vector is a 400, with one it replaces the snapshot', async () => {
    const snapshot = vector({ calories: 300 });
    const created = await post({
      date: DAY,
      mealGroup: 'snack',
      foodId: 'food-4',
      quantity: 1,
      nutrients: snapshot,
    }).expect(201);

    await patch(created.body.id, { quantity: 3 }).expect(400);

    const corrected = vector({ calories: 900 });
    const updated = await patch(created.body.id, { quantity: 3, nutrients: corrected }).expect(200);
    expect(updated.body.quantity).toBe(3);
    expect(updated.body.nutrients).toEqual(corrected);

    const reread = await one(created.body.id).expect(200);
    expect(reread.body.nutrients).toEqual(corrected);
  });

  it("rejects a missing or malformed day (the service never defaults the user's day)", async () => {
    const missingDay = await post({
      mealGroup: 'lunch',
      foodId: 'food-5',
      quantity: 1,
      nutrients: vector(),
    }).expect(400);
    expect(missingDay.status).toBe(400);
    const badDay = await post({
      date: '03-09-2026',
      mealGroup: 'lunch',
      foodId: 'food-5',
      quantity: 1,
      nutrients: vector(),
    }).expect(400);
    expect(badDay.status).toBe(400);
    const missingQuery = await auth(
      request(app.getHttpServer()).get('/api/entries'),
      tokenA,
    ).expect(400);
    expect(missingQuery.status).toBe(400);
    const badQuery = await auth(
      request(app.getHttpServer()).get('/api/entries?date=2026/09/03'),
      tokenA,
    ).expect(400);
    expect(badQuery.status).toBe(400);
  });

  it('stores the snapshot as ciphertext, never plaintext', async () => {
    const dataSource = app.get(DataSource);
    const rows: Array<{ nutrients: string }> = await dataSource.query(
      'SELECT nutrients FROM entry',
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.nutrients.startsWith('enc.v1.')).toBe(true);
      expect(row.nutrients).not.toContain('987654.321');
      expect(row.nutrients).not.toContain('calories');
    }
  });
});
