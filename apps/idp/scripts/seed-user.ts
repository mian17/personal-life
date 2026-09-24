import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';

/**
 * Seeds the single pre-approved user. There is deliberately no signup path:
 * this script creates one user and refuses to touch an existing one.
 * Credentials come from the environment; the password is never printed or logged.
 */
async function main(): Promise<void> {
  const username = process.env.SEED_USERNAME?.trim();
  const password = process.env.SEED_PASSWORD;

  if (!username || !password) {
    console.error('SEED_USERNAME and SEED_PASSWORD must both be set');
    process.exitCode = 1;
    return;
  }

  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
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
