import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { AuthGuard } from '@life/service-kit';
import { FOCUS_CACHE, FocusCache, type CacheClient } from '../src/cache/focus-cache';
import { VERIFIER_ENV } from '../src/service-config';
import { TEST_AUDIENCE, TEST_ISSUER, TEST_MASTER_KEY } from './jwt-harness';

/**
 * Test environment for the `focus-service` suites (`SPEC-focus-service` §6): a
 * throwaway SQLite file, the verifier env the real global guard reads, and a boot
 * of the real application graph with only the cache seam injected.
 *
 * The file is real on disk — durability across an app rebuild is the whole point of
 * the durability suite — but it lives in a per-suite OS temp directory, never under
 * `apps/focus-service/data/` and never a compose volume. Same shape as
 * `apps/meal-service/test/entries.e2e-spec.ts`.
 */

export interface ThrowawayDatabase {
  path: string;
  stop(): Promise<void>;
}

/** A fresh, empty SQLite file for one suite; concurrent workers never share one. */
export async function startThrowawayDatabase(label: string): Promise<ThrowawayDatabase> {
  const directory = mkdtempSync(join(tmpdir(), `focus-${label}-`));
  return {
    path: join(directory, 'focus.db'),
    stop: async (): Promise<void> => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Point the process at the throwaway file and the harness's JWKS. `NODE_ENV` is
 * pinned away from `development` so the guard's dev bypass cannot mask a missing
 * token, and `REDIS_URL` is cleared because the suites inject the cache seam.
 */
function applyFocusTestEnv(databasePath: string, jwksUrl: string): void {
  process.env.FOCUS_DB_PATH = databasePath;
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
 * global whitelist pipe `app.factory` installs — over the SQLite file at
 * `databasePath`. The cache is the only injected seam: a recording client, or `null`
 * for the direct path.
 *
 * Booting a second app after closing the first is a real restart (fresh DataSource,
 * fresh cache client) on the same durable rows, which is how a suite proves
 * durability. The env is restored on `close()`, so a restart never leaks into a
 * sibling suite.
 */
export async function startFocusApp(options: {
  databasePath: string;
  jwksUrl: string;
  redis?: CacheClient | null;
}): Promise<FocusApp> {
  const originalEnv = { ...process.env };
  applyFocusTestEnv(options.databasePath, options.jwksUrl);

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
