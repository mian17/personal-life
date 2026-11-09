import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `SPEC-focus-service` §6 — the service-kernel health dialect, against a throwaway
 * SQLite file:
 *
 * - `/health/live` answers 200 with no dependency check at all (a DB blip must
 *   never restart the service);
 * - `/health/ready` answers 503 on DB down or missing key custody — never on the
 *   fail-open cache;
 * - `/health` aliases readiness exactly.
 *
 * The real `createApp()` boots here (fail-closed verifier config, global guard,
 * global whitelist pipe), with `NODE_ENV` pinned away from `development` so the
 * unauthenticated trio proves the `@Public()` metadata exemption, not the guard's
 * dev bypass.
 */
jest.setTimeout(60_000);

const TEST_DB = join(__dirname, 'test-focus-health.db');
const TEST_ISSUER = 'https://idp.test';
const TEST_AUDIENCE = 'life-api';
/** Obviously-fake key: a public test artifact, never a real secret. */
const TEST_MASTER_KEY = Buffer.alloc(32, 0x2b).toString('base64');
const BASE_NODE_ENV = 'test';

describe('Health dialect (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.FOCUS_DB_PATH = TEST_DB;
    process.env.FOCUS_MASTER_KEY = TEST_MASTER_KEY;
    process.env.IDP_ISSUER = TEST_ISSUER;
    process.env.FOCUS_IDP_JWKS_URL = 'http://127.0.0.1:9/jwks';
    process.env.FOCUS_SERVICE_AUDIENCE = TEST_AUDIENCE;
    process.env.NODE_ENV = BASE_NODE_ENV;
    delete process.env.REDIS_URL;

    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    // Restore env the health probes read per request; never leak into siblings.
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.FOCUS_MASTER_KEY = TEST_MASTER_KEY;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    process.env = originalEnv;
  });

  const get = (path: string, token?: string) => {
    const probe = request(app.getHttpServer()).get(path);
    return token ? probe.set('Authorization', `Bearer ${token}`) : probe;
  };

  it('reports liveness 200 {status:ok} without any dependency check', async () => {
    const spy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    const res = await get('/health/live').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports readiness 200 {status:ok} when DB and key custody are available', async () => {
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('treats the deprecated /health alias identically to /health/ready', async () => {
    const alias = await get('/health').expect(200);
    const ready = await get('/health/ready').expect(200);
    expect(alias.body).toEqual(ready.body);
    expect(alias.body).toEqual({ status: 'ok' });
  });

  it('answers live 200 but ready/alias 503 when the DB is down', async () => {
    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('answers live 200 but ready/alias 503 when key custody config is missing', async () => {
    delete process.env.FOCUS_MASTER_KEY;

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('serves all three unauthenticated (no token, no 401, no dev bypass)', async () => {
    expect(process.env.NODE_ENV).not.toBe('development');
    await get('/health/live').expect(200);
    await get('/health/ready').expect(200);
    await get('/health').expect(200);
  });

  it('ignores even a garbage bearer on the health trio', async () => {
    const live = await get('/health/live', 'not-a-jwt').expect(200);
    const ready = await get('/health/ready', 'not-a-jwt').expect(200);
    const alias = await get('/health', 'not-a-jwt').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(ready.body).toEqual({ status: 'ok' });
    expect(alias.body).toEqual({ status: 'ok' });
  });

  it('leaks nothing: bodies are exactly the status JSON', async () => {
    for (const path of ['/health/live', '/health/ready', '/health']) {
      const res = await get(path).expect(200);
      expect(Object.keys(res.body)).toEqual(['status']);
      expect(JSON.stringify(res.body)).toMatch(/^\{"status":"(ok|degraded)"\}$/);
    }

    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));
    for (const path of ['/health/ready', '/health']) {
      const res = await get(path).expect(503);
      expect(res.body).toEqual({ status: 'degraded' });
      expect(JSON.stringify(res.body)).not.toMatch(/db down|select|error/i);
    }
  });

  it('never checks the fail-open cache: readiness is ok even with Redis down', async () => {
    // REDIS_URL stays unset for the suite, so the cache is a loader passthrough;
    // readiness must not consult it either way.
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
