import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_MASTER_KEY,
  canProvidePostgres,
  startThrowawayPostgres,
  type ThrowawayPostgres,
} from './feedback-harness.js';

/**
 * Group 6 of `SPEC-feedback-service`'s Testing Strategy — the service-kernel
 * health dialect, against a throwaway Postgres:
 *
 *  - `/health/live` 200 with no dependency check at all (a DB blip must never
 *    restart the service);
 *  - `/health/ready` 503 on DB down or missing key custody — and never on a
 *    fail-open cache or broker outage;
 *  - `/health` aliases readiness exactly.
 *
 * The real `createApp()` boots here (fail-closed verifier config, global
 * guard, global whitelist pipe); `NODE_ENV` is pinned away from `development`
 * so the trio's unauthenticated answers prove the `@Public()` metadata
 * exemption, not the guard's dev bypass.
 *
 * Skipped — never failed — when Docker is absent and no `FEEDBACK_TEST_DB_URL`
 * is configured.
 */

jest.setTimeout(180_000);

const describeDb = canProvidePostgres() ? describe : describe.skip;
const BASE_NODE_ENV = 'test';

describeDb('Health dialect (e2e)', () => {
  let pg: ThrowawayPostgres;
  let app: INestApplication;
  let dataSource: DataSource;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    pg = await startThrowawayPostgres('health');
    process.env.FEEDBACK_DB_URL = pg.url;
    process.env.FEEDBACK_MASTER_KEY = TEST_MASTER_KEY;
    process.env.IDP_ISSUER = TEST_ISSUER;
    process.env.FEEDBACK_IDP_JWKS_URL = 'http://127.0.0.1:9/jwks';
    process.env.FEEDBACK_SERVICE_AUDIENCE = TEST_AUDIENCE;
    process.env.NODE_ENV = BASE_NODE_ENV;
    delete process.env.REDIS_URL;
    delete process.env.RABBITMQ_URL;

    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    // Restore env the health probes read per request; never leak into siblings.
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.FEEDBACK_MASTER_KEY = TEST_MASTER_KEY;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
    await pg?.stop();
  });

  const get = (path: string, token?: string) => {
    const probe = request(app.getHttpServer()).get(path);
    return token ? probe.set('Authorization', `Bearer ${token}`) : probe;
  };

  it('reports liveness 200 {status:ok} without any dependency check', async () => {
    const spy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    const res = await get('/health/live').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
    // Liveness must not touch the DB at all: a DB blip must never restart us.
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports readiness 200 {status:ok} when DB and key custody are available', async () => {
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('treats the /health alias identically to /health/ready', async () => {
    const alias = await get('/health').expect(200);
    const ready = await get('/health/ready').expect(200);
    expect(alias.body).toEqual(ready.body);
    expect(alias.body).toEqual({ status: 'ok' });
  });

  it('answers live 200 but ready/alias 503 {status:degraded} when the DB is down', async () => {
    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('answers live 200 but ready/alias 503 when key custody config is missing', async () => {
    delete process.env.FEEDBACK_MASTER_KEY;

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('serves all three unauthenticated (no token, no 401, no dev bypass)', async () => {
    // The guard is global and NODE_ENV is not 'development': a 200 here proves
    // the `@Public()` metadata exemption, not the dev bypass.
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
});
