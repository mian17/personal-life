import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { SeedModule } from '../src/config/seed.module';
import { UsersService } from '../src/users/users.service';
import { isProductionDbPath, resolveDbPath } from '../src/config/db-path';

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
async function main(): Promise<void> {
  const username = process.env.SEED_USERNAME?.trim();
  const password = process.env.SEED_PASSWORD;

  if (!username || !password) {
    console.error('SEED_USERNAME and SEED_PASSWORD must both be set');
    process.exitCode = 1;
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const dbPath = resolveDbPath();

  // Refuse to touch the production identity DB outside production, before any
  // filesystem or database work. The check canonicalizes the path, so
  // `data/idp.db`, `./data/idp.db`, and absolute equivalents all count.
  if (!isProduction && isProductionDbPath(dbPath)) {
    console.error(
      `refusing to seed the production identity DB (${dbPath}) without NODE_ENV=production; ` +
        'production seeding requires NODE_ENV=production',
    );
    process.exitCode = 1;
    return;
  }

  // Announce the mode and target loudly before writing. The password is never printed.
  const banner = isProduction ? '[seed:production]' : '[seed:test]';
  const target = isProduction ? 'PRODUCTION identity DB' : 'test DB';
  console.log(`${banner} seeding ${target}: ${dbPath}`);

  mkdirSync(dirname(dbPath), { recursive: true });

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: false });
  try {
    const users = app.get(UsersService);

    if (await users.findByUsername(username)) {
      console.error(`user "${username}" already exists`);
      process.exitCode = 1;
      return;
    }

    await users.createUser(username, password);
    console.log(`seeded user "${username}"`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
