import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  IS_PUBLIC_KEY,
  HealthController,
  HealthModule,
} from '../src/index';

const MASTER_KEY_ENV = 'SERVICE_KIT_TEST_MASTER_KEY';

/**
 * Builds the app the way every service does: a global `TypeOrmModule` (which is
 * what makes the datasource injectable into the imported health module) plus
 * `HealthModule.forRoot`. An in-memory sqlite DB is a real datasource, so the
 * readiness probe is exercised for real rather than against a hand-rolled stub.
 */
async function buildApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [],
        synchronize: true,
      }),
      HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('@life/service-kit health', () => {
  const originalKey = process.env[MASTER_KEY_ENV];

  beforeEach(() => {
    process.env[MASTER_KEY_ENV] = Buffer.alloc(32, 7).toString('base64');
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[MASTER_KEY_ENV];
    else process.env[MASTER_KEY_ENV] = originalKey;
  });

  it('pins the public metadata key the service guards read', () => {
    // The kit ships its own `Public` so the package imports nothing from an app.
    // The literal is the cross-package contract: every service's `@Public()` and
    // this package's guard must agree on it for the exemption to work.
    expect(IS_PUBLIC_KEY).toBe('auth:isPublic');
  });

  it('marks the health routes public so probes never need credentials', () => {
    const reflector = new Reflector();
    // `@Public()` sits on the controller, so it covers all three routes at once.
    expect(reflector.get(IS_PUBLIC_KEY, HealthController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController) ?? []).toEqual(
      [],
    );
  });

  it('reports liveness 200 without touching the database', async () => {
    const app = await buildApp();
    const dataSource = app.get(DataSource);
    const query = jest.spyOn(dataSource, 'query');
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    await app.close();
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness 200 when the DB answers and key custody loads', async () => {
    const app = await buildApp();
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok' });
    // The deprecated alias must answer identically — the harness polls it.
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
    await app.close();
  });

  it('reports degraded 503 when the database is unreachable', async () => {
    const app = await buildApp();
    // A destroyed pool is what a real outage looks like: `SELECT 1` throws.
    await app.get(DataSource).destroy();
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body).toEqual({ status: 'degraded' });
    await app.close();
  });

  it('reports degraded 503 when key custody is missing', async () => {
    delete process.env[MASTER_KEY_ENV];
    const app = await buildApp();
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body).toEqual({ status: 'degraded' });
    await app.close();
  });

  it('never leaks a driver message into the probe body', async () => {
    const app = await buildApp();
    const dataSource = app.get(DataSource);
    jest
      .spyOn(dataSource, 'query')
      .mockRejectedValueOnce(
        new Error('connection refused: password=hunter2'),
      );
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    await app.close();
  });

  it('exposes the datasource token the services provide globally', async () => {
    // Guards the wiring assumption `forRoot` relies on: the app's global
    // TypeOrmModule is what makes `@InjectDataSource()` resolvable here.
    expect(getDataSourceToken()).toBe(getDataSourceToken('default'));
  });
});
