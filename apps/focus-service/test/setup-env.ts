import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthGuard } from '@life/service-kit';
import { bin, childEnv } from '../../../packages/shared/src/child-process';
import { FOCUS_CACHE, FocusCache, type CacheClient } from '../src/cache/focus-cache';
import { VERIFIER_ENV } from '../src/service-config';
import { TEST_AUDIENCE, TEST_ISSUER, TEST_MASTER_KEY } from './jwt-harness';

/**
 * Test environment for the `focus-service` suites (`SPEC-focus-service` §6): a
 * throwaway Postgres, the verifier env the real global guard reads, and a boot of the
 * real application graph with only the cache seam injected.
 *
 * Postgres is the one dependency that cannot be faked — durability across an app
 * rebuild is the whole point of these suites — so every suite gets its own
 * `focus_<label>` database on a short-lived `postgres:17-alpine` container (or on the
 * operator's `FOCUS_TEST_DB_URL` server). Never a data directory, never the compose
 * database. A host with neither gets the suites **skipped, never failed**.
 *
 * `AppModule` reads `FOCUS_DB_URL` at import time and fails closed without it, so
 * every suite applies the env first and imports the app afterwards.
 */

const TEST_DB_IMAGE = 'postgres:17-alpine';
const TEST_DB_PASSWORD = 'test-only';

export interface ThrowawayPostgres {
  url: string;
  stop(): Promise<void>;
}

function runDocker(args: string[]): string {
  return execFileSync(bin('docker'), args, {
    env: childEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, milliseconds));
}

/** True when a throwaway Postgres can be provided: a configured server, or Docker. */
export function canProvidePostgres(): boolean {
  if (process.env.FOCUS_TEST_DB_URL?.trim()) return true;
  try {
    runDocker(['version']);
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
  const databaseUrl = new URL(serverUrl);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.href;
}

async function publishedPort(container: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const mapped = runDocker(['port', container, '5432/tcp']).trim();
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
async function awaitPostmaster(container: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      runDocker([
        'exec',
        container,
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

async function startContainer(): Promise<{ serverUrl: string; stop(): Promise<void> }> {
  const container = `focus-test-${process.pid}-${randomUUID().slice(0, 8)}`;
  const stop = async (): Promise<void> => {
    try {
      runDocker(['rm', '-f', container]);
    } catch {
      /* already gone */
    }
  };
  try {
    runDocker([
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '-e',
      `POSTGRES_PASSWORD=${TEST_DB_PASSWORD}`,
      '-e',
      'POSTGRES_DB=postgres',
      // Ephemeral loopback port: reachable from this host only.
      '-p',
      '127.0.0.1::5432',
      TEST_DB_IMAGE,
    ]);
    const port = await publishedPort(container);
    await awaitPostmaster(container);
    return {
      serverUrl: `postgresql://postgres:${TEST_DB_PASSWORD}@127.0.0.1:${port}/postgres`,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A throwaway database for one suite; concurrent workers never share one. */
export async function startThrowawayPostgres(label: string): Promise<ThrowawayPostgres> {
  const configured = process.env.FOCUS_TEST_DB_URL?.trim();
  const server = configured
    ? { serverUrl: configured, stop: async (): Promise<void> => undefined }
    : await startContainer();
  return { url: await createDatabase(server.serverUrl, label), stop: server.stop };
}

/**
 * Point the process at the throwaway database and the harness's JWKS. `NODE_ENV` is
 * pinned away from `development` so the guard's dev bypass cannot mask a missing
 * token, and `REDIS_URL` is cleared because the suites inject the cache seam.
 */
function applyFocusTestEnv(databaseUrl: string, jwksUrl: string): void {
  process.env.FOCUS_DB_URL = databaseUrl;
  process.env.FOCUS_MASTER_KEY = TEST_MASTER_KEY;
  process.env.IDP_ISSUER = TEST_ISSUER;
  process.env.FOCUS_IDP_JWKS_URL = jwksUrl;
  process.env.FOCUS_SERVICE_AUDIENCE = TEST_AUDIENCE;
  process.env.NODE_ENV = 'test';
  delete process.env.REDIS_URL;
}

export interface FocusApp {
  app: INestApplication;
  dataSource: DataSource;
  /** The recorded Redis stand-in, or `null` for the direct database path. */
  redis: CacheClient | null;
  close(): Promise<void>;
}

/**
 * Boot the real application graph — the same `AppModule`, global `AuthGuard` and
 * global whitelist pipe `app.factory` installs — over `databaseUrl`. The cache is the
 * only injected seam: a recording client, or `null` for the direct path.
 *
 * Booting a second app after closing the first is a real restart (fresh DataSource,
 * fresh cache client) on the same durable rows, which is how a suite proves durability.
 * The env is restored on `close()`, so a restart never leaks into a sibling suite.
 */
export async function startFocusApp(options: {
  databaseUrl: string;
  jwksUrl: string;
  redis?: CacheClient | null;
}): Promise<FocusApp> {
  const originalEnv = { ...process.env };
  applyFocusTestEnv(options.databaseUrl, options.jwksUrl);

  const redis = options.redis === undefined ? null : options.redis;
  const { AppModule } = await import('../src/app.module');
  const app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FOCUS_CACHE)
      .useValue(new FocusCache(redis))
      .compile()
  ).createNestApplication();

  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();

  return {
    app,
    dataSource: app.get(DataSource),
    redis,
    close: async (): Promise<void> => {
      await app.close();
      process.env = originalEnv;
    },
  };
}
