import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthGuard } from '@life/service-kit';
import { DataSource } from 'typeorm';
import { MASTER_KEY_ENV, VERIFIER_ENV } from '../src/service-config.js';

/**
 * Test environment for the `meditation-service` suites: a throwaway SQLite file,
 * the verifier env the real global guard reads, and a boot of the real application
 * graph.
 *
 * The file is real on disk, but it lives in a per-suite OS temp directory, never
 * under `apps/meditation-service/data/`. Same shape as
 * `apps/focus-service/test/setup-env.ts`.
 */

/** Obviously-fake key: a public test artifact, never a real secret. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 0x2b).toString('base64');
export const TEST_ISSUER = 'https://idp.test';
export const TEST_AUDIENCE = 'life-api';

export interface ThrowawayDatabase {
  path: string;
  stop(): Promise<void>;
}

/** A fresh, empty SQLite file for one suite; concurrent workers never share one. */
export function startThrowawayDatabase(label: string): ThrowawayDatabase {
  const directory = mkdtempSync(join(tmpdir(), `meditation-${label}-`));
  return {
    path: join(directory, 'meditation.db'),
    stop: async (): Promise<void> => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Point the process at the throwaway file and the harness's JWKS. `NODE_ENV` is
 * pinned away from `development` so the guard's dev bypass cannot mask a missing
 * token.
 */
function applyMeditationTestEnv(databasePath: string, jwksUrl: string): void {
  process.env.MEDITATION_DB_PATH = databasePath;
  process.env[MASTER_KEY_ENV] = TEST_MASTER_KEY;
  process.env.IDP_ISSUER = TEST_ISSUER;
  process.env[VERIFIER_ENV.jwksUrlEnv] = jwksUrl;
  process.env[VERIFIER_ENV.audienceEnv] = TEST_AUDIENCE;
  process.env.NODE_ENV = 'test';
}

export interface MeditationApp {
  app: INestApplication;
  dataSource: DataSource;
  close(): Promise<void>;
}

/**
 * Boot the real application graph — the same `AppModule` and the same global `AuthGuard`
 * and whitelist pipe the app's own factory installs — over the SQLite file at
 * `databasePath`. The env is restored on `close()`, so a restart never leaks into a
 * sibling suite.
 *
 * The graph is booted through `NestFactory` (`createApp`, the entry point `main.ts` uses)
 * rather than `Test.createTestingModule`: under this suite's ESM jest, `@nestjs/testing`
 * resolves its own copy of `@nestjs/core`, so the container's `ModuleRef`/`Reflector`
 * tokens are not the classes the modules declare and every `ModuleRef` injection (which
 * `TypeOrmModule` itself needs) fails to resolve. `NestFactory` shares the test file's
 * module graph, so the boot is the production one and nothing needs overriding — the
 * suites arm the cache seam by swapping the adapter's client, not by replacing providers.
 */
export async function startMeditationApp(options: {
  databasePath: string;
  jwksUrl: string;
}): Promise<MeditationApp> {
  const originalEnv = { ...process.env };
  applyMeditationTestEnv(options.databasePath, options.jwksUrl);

  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();

  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();

  return {
    app,
    dataSource: app.get(DataSource),
    close: async (): Promise<void> => {
      await app.close();
      process.env = originalEnv;
    },
  };
}
