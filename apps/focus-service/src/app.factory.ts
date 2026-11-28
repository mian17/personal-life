import type { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import { createServiceApplication, resolveVerifierConfig } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { VERIFIER_ENV } from './service-config.js';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-focus-service` §2): verifier config resolves up front, the SQLite
 * directory is created before TypeORM opens the file, and `FOCUS_MASTER_KEY` is
 * enforced by `KeysModule`'s key factory.
 */
export async function createApp(): Promise<INestApplication> {
  resolveVerifierConfig(VERIFIER_ENV);
  return createServiceApplication(AppModule, {
    sqlitePath: process.env.FOCUS_DB_PATH ?? join(process.cwd(), 'data', 'focus.db'),
    verifierEnv: VERIFIER_ENV,
  });
}
