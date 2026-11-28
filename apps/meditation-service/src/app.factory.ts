import type { INestApplication } from '@nestjs/common';
import { createServiceApplication, resolveVerifierConfig } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { resolveDatabasePath, VERIFIER_ENV } from './service-config.js';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-service-kernel`): verifier config resolves up front, and the SQLite
 * directory exists before TypeORM opens the file.
 */
export async function createApp(): Promise<INestApplication> {
  resolveVerifierConfig(VERIFIER_ENV);
  return createServiceApplication(AppModule, {
    sqlitePath: resolveDatabasePath(),
    verifierEnv: VERIFIER_ENV,
  });
}
