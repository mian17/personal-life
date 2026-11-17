import { jest } from '@jest/globals';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { MASTER_KEY_ENV } from '../src/service-config.js';
import {
  TEST_MASTER_KEY,
  startMeditationApp,
  startThrowawayDatabase,
  type MeditationApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * The service-kernel health dialect against a throwaway SQLite file:
 *
 * - `/health/live` answers 200 with no dependency check at all;
 * - `/health/ready` answers 200 only while the database file and the master key
 *   both answer, and 503 otherwise;
 * - `/health` aliases readiness exactly.
 *
 * The service boot path is the real one — `createApp()` from `app.factory` — so
 * readiness 200 over an on-disk SQLite file is the acceptance criterion under test.
 */
jest.setTimeout(60_000);

const DEAF_JWKS = 'http://127.0.0.1:9/jwks';

describe('Health dialect (e2e)', () => {
  let database: ThrowawayDatabase;
  let service: MeditationApp;

  beforeAll(async () => {
    database = await startThrowawayDatabase('health');
    service = await startMeditationApp({ databasePath: database.path, jwksUrl: DEAF_JWKS });
  });

  afterEach(() => {
    process.env[MASTER_KEY_ENV] = TEST_MASTER_KEY;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await service.close();
    await database.stop();
  });

  const probe = (path: string) => request(service.app.getHttpServer()).get(path);

  it('reports liveness 200 without any dependency check', async () => {
    const databaseQuery = jest
      .spyOn(service.dataSource, 'query')
      .mockRejectedValue(new Error('db down'));

    const response = await probe('/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it('reports readiness 200 {status:ok} over the SQLite file', async () => {
    const response = await probe('/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('treats the deprecated /health alias exactly like /health/ready', async () => {
    const alias = await probe('/health').expect(200);
    const ready = await probe('/health/ready').expect(200);

    expect(alias.body).toEqual(ready.body);
  });

  it('answers ready 503 when the database is down, live still 200', async () => {
    jest.spyOn(service.dataSource, 'query').mockRejectedValue(new Error('db down'));

    expect((await probe('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await probe('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('answers ready 503 when the master key is missing, live still 200', async () => {
    delete process.env[MASTER_KEY_ENV];

    expect((await probe('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await probe('/health/ready').expect(503)).body).toEqual({ status: 'degraded' });
  });

  it('serves readiness without a token, and ignores a garbage bearer', async () => {
    const garbageBearer = await probe('/health/ready').set('Authorization', 'Bearer not-a-jwt');

    expect(garbageBearer.status).toBe(200);
    expect((await probe('/health').expect(200)).body).toEqual({ status: 'ok' });
    expect(process.env.NODE_ENV).not.toBe('development');
  });

  it('leaks nothing: every healthy body is exactly the status JSON', async () => {
    for (const path of ['/health/live', '/health/ready', '/health']) {
      const response = await probe(path).expect(200);
      expect(JSON.stringify(response.body)).toMatch(/^\{"status":"(ok|degraded)"\}$/);
    }
  });

  it('creates the SQLite file it was pointed at', () => {
    expect(existsSync(database.path)).toBe(true);
  });
});
