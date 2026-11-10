// Must stay the first import: ts-node's ESM loader evaluates the decorator modules
// this script reaches before `@nestjs/common`'s barrel (the one place that loads
// reflect-metadata), and the first `@Optional()` call throws
// `TypeError: Reflect.getMetadata is not a function` when the polyfill is absent.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SeedModule } from '../src/config/seed.module.js';
import { UsersService } from '../src/users/users.service.js';
import { isProductionDbPath, resolveDbPath } from '../src/config/db-path.js';

/**
 * Seeds the single pre-approved user. There is deliberately no signup path:
 * this script creates one user and refuses to touch an existing one.
 * Credentials come from the environment; the password is never printed or logged.
 *
 * Environment safety (2026-09-25): the real identity DB is only ever seeded when
 * `NODE_ENV=production` (this repo's environment switch). Outside production the
 * default target is `data/scratch.db`, and pointing at the production DB is
 * refused outright — before any file or DB write.
 */
/**
 * Default dev credentials. Non-production only (see the guarantee below) — a
 * convenience so a fresh scratch DB is usable without running the seed by hand.
 * The values are checked into the dev env example; they are not secrets.
 */
const DEV_SEED_USERNAME = 'dev';
const DEV_SEED_PASSWORD = 'dev-password-not-a-secret';

/**
 * Honor the local dev env file for the DEV FLOW ONLY, behind an explicit opt-in
 * (`SEED_LOAD_DEV_ENV=1`, set by the root `dev:seed` script). Without the opt-in
 * the process reads its environment and nothing else — so a stray developer
 * `.env.development` can never inject credentials into a production run or into
 * a test that deliberately controls the environment (it silently defeated the
 * production-refusal test before this gate). `process.loadEnvFile` assigns only
 * unset keys, so explicit env always wins even when the file is loaded.
 */
/** A username or path reaching these logs comes from the environment, so it is
 * reduced to one printable line first: a value carrying a newline would forge
 * extra log lines. Allowlist, not a control-byte denylist. */
function oneLine(value: string): string {
  return value.replace(/[^\u0020-\u007e]+/g, ' ').trim();
}

function loadDevEnvFile(): void {
  if (process.env.SEED_LOAD_DEV_ENV !== '1') return;
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '..', '..', '..', '.env.development'));
  } catch {
    // No dev env file — fine; defaults apply.
  }
}

async function main(): Promise<void> {
  loadDevEnvFile();
  const isProduction = process.env.NODE_ENV === 'production';

  // Credentials: production MUST supply them explicitly (no defaulted prod
  // credentials, ever). Non-production falls back to the documented dev pair.
  const username =
    process.env.SEED_USERNAME?.trim() || (isProduction ? undefined : DEV_SEED_USERNAME);
  const password = process.env.SEED_PASSWORD ?? (isProduction ? undefined : DEV_SEED_PASSWORD);

  if (!username || !password) {
    console.error('SEED_USERNAME and SEED_PASSWORD must both be set');
    process.exitCode = 1;
    return;
  }

  const dbPath = resolveDbPath();

  // Refuse to touch the production identity DB outside production, before any
  // filesystem or database work. The check canonicalizes the path, so
  // `data/idp.db`, `./data/idp.db`, and absolute equivalents all count.
  if (!isProduction && isProductionDbPath(dbPath)) {
    console.error(
      `refusing to seed the production identity DB (${oneLine(dbPath)}) without NODE_ENV=production; ` +
        'production seeding requires NODE_ENV=production',
    );
    process.exitCode = 1;
    return;
  }

  // Announce the mode and target loudly before writing. The password is never printed.
  const banner = isProduction ? '[seed:production]' : '[seed:test]';
  const target = isProduction ? 'PRODUCTION identity DB' : 'test DB';
  console.log(`${banner} seeding ${target}: ${oneLine(dbPath)}`);

  mkdirSync(dirname(dbPath), { recursive: true });

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: false });
  try {
    const users = app.get(UsersService);

    if (await users.findByUsername(username)) {
      // Idempotent: an already-seeded user is success, not an error — so a
      // dev-start hook can call this on every boot without failing.
      console.log(`user "${oneLine(username)}" already exists — nothing to do`);
      return;
    }

    await users.createUser(username, password);
    console.log(`seeded user "${oneLine(username)}"`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', oneLine(err instanceof Error ? err.message : 'unknown error'));
  process.exitCode = 1;
});
