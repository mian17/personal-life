import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';

/**
 * Service-kernel health dialect (T2) for the IdP: `/health/live` (process
 * liveness only), `/health/ready` (DB + key-custody **config presence** — never
 * `SigningKeyService.jwks()`, which lazily writes `keys.json`), and the
 * deprecated `/health` alias of `/health/ready`.
 *
 * The readiness probe must be side-effect-free: booting and probing this suite
 * must NOT create the keys file.
 */

const TEST_DB = join(import.meta.dirname, 'test-idp.db');
const TEST_KEYS = join(import.meta.dirname, 'test-idp-health-keys.json');
process.env.DB_PATH = TEST_DB;
process.env.KEYS_PATH = TEST_KEYS;

describe('Health (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('reports liveness {status:ok}', async () => {
    const res = await get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness {status:ok}', async () => {
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers the deprecated /health alias identically to /health/ready', async () => {
    const alias = await get('/health').expect(200);
    const ready = await get('/health/ready').expect(200);
    expect(alias.body).toEqual(ready.body);
    expect(alias.body).toEqual({ status: 'ok' });
  });

  it('serves the whole trio unauthenticated', async () => {
    const live = await get('/health/live').expect(200);
    const ready = await get('/health/ready').expect(200);
    const alias = await get('/health').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(ready.body).toEqual({ status: 'ok' });
    expect(alias.body).toEqual({ status: 'ok' });
  });

  it('answers live 200 but ready/alias 503 {status:degraded} when the DB is down', async () => {
    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('does not create key material from a readiness probe', async () => {
    expect(existsSync(TEST_KEYS)).toBe(false);

    await get('/health/ready').expect(200);
    await get('/health').expect(200);
    await get('/health/live').expect(200);

    // A probe must never trigger lazy `keys.json` generation.
    expect(existsSync(TEST_KEYS)).toBe(false);
  });
});
