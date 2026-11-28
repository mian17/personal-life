import type { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import { createServiceApplication } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { VERIFIER_ENV } from './service-config.js';

/**
 * Build the application with the global kernel wiring: the shared logger, the JWT
 * guard and the whitelisting validation pipe. The SQLite directory exists before
 * TypeORM opens the file, and `NOTE_MASTER_KEY` is enforced by `KeysModule`.
 */
export async function createApp(): Promise<INestApplication> {
  return createServiceApplication(AppModule, {
    sqlitePath: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
    verifierEnv: VERIFIER_ENV,
  });
}
