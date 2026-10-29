import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { bin, childEnv } from '../../../packages/shared/src/child-process';

/**
 * `SPEC-focus-service` §6 — the service-kernel health dialect, against a throwaway
 * Postgres:
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
 *
 * Skipped — never failed — when Docker is absent and no `FOCUS_TEST_DB_URL` is set.
 */
jest.setTimeout(180_000);

const TEST_DB_IMAGE = 'postgres:17-alpine';
const TEST_DB_PASSWORD = 'test-only';
const TEST_ISSUER = 'https://idp.test';
const TEST_AUDIENCE = 'life-api';
/** Obviously-fake key: a public test artifact, never a real secret. */
const TEST_MASTER_KEY = Buffer.alloc(32, 0x2b).toString('base64');
const BASE_NODE_ENV = 'test';

interface ThrowawayPostgres {
  url: string;
  stop(): Promise<void>;
}

function runSilently(args: string[]): void {
  execFileSync(bin('docker'), args, { env: childEnv(), stdio: 'ignore' });
}

function runCaptured(args: string[]): string {
  return execFileSync(bin('docker'), args, {
    env: childEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, milliseconds));
}

function canProvidePostgres(): boolean {
  if (process.env.FOCUS_TEST_DB_URL?.trim()) return true;
  try {
    runSilently(['version']);
    return true;
  } catch {
    return false;
  }
}

async function createDatabase(serverUrl: string, label: string): Promise<string> {
  const name = `focus_${label}`;
  const admin = new DataSource({ type: 'postgres', url: serverUrl, entities: [] });
  await admin.initialize();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.destroy();
  }
  const parsed = new URL(serverUrl);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

async function publishedPort(name: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const mapped = runCaptured(['port', name, '5432/tcp']).trim();
    const match = /:(\d+)$/.exec(mapped.split('\n')[0] ?? '');
    if (match) return match[1]!;
    await pause(250);
  }
  throw new Error('postgres container never published a port');
}

/**
 * Probe the published TCP path rather than the container's unix socket: the
 * entrypoint's bootstrap server answers `psql` long before the real postmaster
 * accepts connections, and connecting into that window fails mid-suite.
 */
async function awaitPostmaster(name: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      runCaptured([
        'exec',
        name,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        'select 1',
      ]);
      return;
    } catch {
      if (attempt >= 60) throw new Error('postgres never became ready');
      await pause(500);
    }
  }
}

async function startContainer(): Promise<{ url: string; stop(): Promise<void> }> {
  const name = `focus-test-${process.pid}-${randomUUID().slice(0, 8)}`;
  const stop = async (): Promise<void> => {
    try {
      runSilently(['rm', '-f', name]);
    } catch {
      /* already gone */
    }
  };
  try {
    runSilently([
      'run',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      `POSTGRES_PASSWORD=${TEST_DB_PASSWORD}`,
      '-e',
      'POSTGRES_DB=postgres',
      '-p',
      '127.0.0.1::5432',
      TEST_DB_IMAGE,
    ]);
    const port = await publishedPort(name);
    await awaitPostmaster(name);
    return { url: `postgresql://postgres:${TEST_DB_PASSWORD}@127.0.0.1:${port}/postgres`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function startThrowawayPostgres(label: string): Promise<ThrowawayPostgres> {
  const configured = process.env.FOCUS_TEST_DB_URL?.trim();
  const server = configured
    ? { url: configured, stop: async (): Promise<void> => undefined }
    : await startContainer();
  const url = await createDatabase(server.url, label);
  return { url, stop: server.stop };
}

const describeDb = canProvidePostgres() ? describe : describe.skip;

describeDb('Health dialect (e2e)', () => {
  let postgres: ThrowawayPostgres;
  let app: INestApplication;
  let dataSource: DataSource;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    postgres = await startThrowawayPostgres('health');
    process.env.FOCUS_DB_URL = postgres.url;
    process.env.FOCUS_MASTER_KEY = TEST_MASTER_KEY;
    process.env.IDP_ISSUER = TEST_ISSUER;
    process.env.FOCUS_IDP_JWKS_URL = 'http://127.0.0.1:9/jwks';
    process.env.FOCUS_SERVICE_AUDIENCE = TEST_AUDIENCE;
    process.env.NODE_ENV = BASE_NODE_ENV;
    delete process.env.REDIS_URL;

    const { createApp } = await import('../src/app.factory');
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
    await postgres?.stop();
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
