import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';

/**
 * Service-kernel health dialect (`SPEC-service-kernel` / `SPEC-todo-service`):
 * `/health/live` (process liveness only), `/health/ready` (DB + key custody —
 * never the fail-open cache), and the deprecated `/health` alias of
 * `/health/ready` that harnesses poll (`<500` = ready).
 *
 * The trio answers unauthenticated behind the global `AuthGuard` via `@Public()`;
 * `NODE_ENV` is pinned away from `development` so the guard's dev bypass cannot
 * mask a missing exemption.
 */

const TEST_DB = join(__dirname, 'test-todo-health.db');
const BASE_NODE_ENV = 'test';

describe('Health dialect (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.TODO_MASTER_KEY = originalEnv.TODO_MASTER_KEY;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    process.env = originalEnv;
  });

  const get = (path: string, token?: string) => {
    const r = request(app.getHttpServer()).get(path);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
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

  it('answers live 200 but ready/alias 503 {status:degraded} when the DB is down', async () => {
    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('db down'));

    expect((await get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await get('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
    expect((await get('/health').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('answers live 200 but ready/alias 503 when key custody config is missing', async () => {
    delete process.env.TODO_MASTER_KEY;

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
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
