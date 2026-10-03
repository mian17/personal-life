import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { NUTRIENTS } from '@life/nutrition';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * `q` search (`foods.findAll(sub, q)`): owner-scoped, matching only the decrypted
 * name as a case-insensitive substring (`likeMatch` in memory — never `LIKE`
 * over the encrypted column, `SPEC-meal-service` Cache Rules).
 *
 * Case-insensitivity is exercised here as the observable proof the match runs
 * after decrypt: rows whose stored value is always an `enc.v1.` envelope
 * (verified directly on the DB below) still match across ASCII case, so the
 * comparison cannot be running against the stored string.
 */

const TEST_DB = join(__dirname, 'test-foods-search.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Foods search `q` (e2e)', () => {
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

  /** A complete 27-field vector with only the given nutrient set. */
  const vectorOf = (calories: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const { key } of NUTRIENTS) out[key] = 0;
    out.calories = calories;
    return out;
  };

  it('stores encrypted names yet matches a substring case-insensitively after decrypt', async () => {
    await post({ name: 'Steel Cut OATS', servingGrams: 100 }, tokenA).expect(201);
    await post({ name: 'Brown Rice', servingGrams: 150 }, tokenA).expect(201);

    const search = await list(tokenA, 'oats').expect(200);
    expect(search.body.map((f: { name: string }) => f.name)).toEqual(['Steel Cut OATS']);

    const upper = await list(tokenA, 'STEEL').expect(200);
    expect(upper.body.map((f: { name: string }) => f.name)).toEqual(['Steel Cut OATS']);

    const noMatch = await list(tokenA, 'quinoa').expect(200);
    expect(noMatch.body).toEqual([]);

    // The rows the search ran over are sealed envelopes, not plaintext: the
    // match ran over decrypted names in memory, never against the stored string.
    const dataSource = app.get(DataSource);
    const rows: Array<{ name: string }> = await dataSource.query('SELECT name FROM food');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.name.startsWith('enc.v1.')).toBe(true);
      expect(row.name).not.toContain('OATS');
      expect(row.name).not.toContain('Rice');
    }
  });

  it('returns only the caller\'s matches (owner scoping survives the filter)', async () => {
    await post({ name: 'shared-token-A', servingGrams: 100 }, tokenA).expect(201);
    await post({ name: 'shared-token-B', servingGrams: 100 }, tokenB).expect(201);

    const aSearch = await list(tokenA, 'shared-token').expect(200);
    expect(aSearch.body.map((f: { name: string }) => f.name)).toEqual(['shared-token-A']);

    const bSearch = await list(tokenB, 'shared-token').expect(200);
    expect(bSearch.body.map((f: { name: string }) => f.name)).toEqual(['shared-token-B']);
  });

  it('a name-only PATCH leaves the stored base vector untouched', async () => {
    const created = await post(
      { name: 'Keep my numbers', servingGrams: 100, nutrients: vectorOf(420) },
      tokenA,
    ).expect(201);

    // Rename it — the classic PATCH that omits `nutrients`.
    await patch(created.body.id, { name: 'Renamed' }, tokenA).expect(200);

    const read = await one(created.body.id, tokenA).expect(200);
    expect(read.body.name).toBe('Renamed');
    expect(read.body.nutrients.calories).toBe(420);
  });

  it('a base-vector PATCH re-derives every serving from the new base', async () => {
    const created = await post(
      {
        name: 'Derived portions',
        servingGrams: 100,
        nutrients: vectorOf(200),
        portions: [{ label: 'half', grams: 50 }],
      },
      tokenA,
    ).expect(201);
    expect(created.body.servings[0].nutrients.calories).toBe(100);

    await patch(created.body.id, { nutrients: vectorOf(400) }, tokenA).expect(200);

    const read = await one(created.body.id, tokenA).expect(200);
    expect(read.body.nutrients.calories).toBe(400);
    // The serving was not re-sent, yet it now reflects the doubled base.
    expect(read.body.servings[0].nutrients.calories).toBe(200);
  });

  it('rejects a negative nutrient value at the write boundary', async () => {
    const negative = vectorOf(-5);
    await post({ name: 'Negative', servingGrams: 100, nutrients: negative }, tokenA).expect(400);
  });
});
