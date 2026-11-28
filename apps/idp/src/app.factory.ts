import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { createServiceApplication } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { resolveDbPath } from './config/db-path.js';
import { OidcService } from './oidc/oidc.service.js';

/**
 * Build the application with the global kernel wiring. No `verifierEnv`: this is
 * the IdP that mints the tokens the other services verify, so it registers no
 * JWT guard.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await createServiceApplication(AppModule, { sqlitePath: resolveDbPath() });
  // Mount the OIDC protocol routes before init() so they precede Nest's body
  // parsers: oidc-provider reads the raw request body itself.
  const oidc = app.get(OidcService);
  (app.getHttpAdapter().getInstance() as Express).use(oidc.middleware());
  return app;
}
