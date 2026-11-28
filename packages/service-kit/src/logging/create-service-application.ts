import { ValidationPipe, type INestApplication, type NestApplicationOptions } from '@nestjs/common';
import { NestFactory, type IEntryNestModule } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AuthGuard } from '../auth/auth.guard.js';
import type { VerifierEnvNames } from '../auth/jwt-verifier.js';
import { ServiceLogger } from './service-logger.js';

export interface ServiceApplicationOptions {
  /** The service's SQLite file; its directory is created before TypeORM opens it. */
  sqlitePath?: string;
  /**
   * The env var names `AuthGuard` verifies tokens against. Omit only for the IdP,
   * which issues the tokens instead of accepting them.
   */
  verifierEnv?: VerifierEnvNames;
  /** Anything else the service passes to `NestFactory.create`, e.g. `bodyParser: false`. */
  nestOptions?: Omit<NestApplicationOptions, 'logger'>;
}

/**
 * Boot the shared service kernel: the `ServiceLogger` console, the JWT guard and
 * the whitelisting validation pipe.
 *
 * The three steps are one function because every service runs them in the same
 * order and none of them varies — a copy per service is how the eight factories
 * drifted apart in the first place. What a service does vary arrives as options:
 * its SQLite path (created here, before the module opens the file), its verifier
 * env names, and any extra `NestFactory.create` settings.
 *
 * The IdP passes no `verifierEnv`: it mints the tokens the other seven verify, so
 * a global guard there would demand a bearer token from the login flow itself.
 */
export async function createServiceApplication(
  module: IEntryNestModule,
  { sqlitePath, verifierEnv, nestOptions }: ServiceApplicationOptions = {},
): Promise<INestApplication> {
  if (sqlitePath !== undefined) mkdirSync(dirname(sqlitePath), { recursive: true });

  const app = await NestFactory.create(module, { ...nestOptions, logger: new ServiceLogger() });
  if (verifierEnv !== undefined) app.useGlobalGuards(new AuthGuard(verifierEnv));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
