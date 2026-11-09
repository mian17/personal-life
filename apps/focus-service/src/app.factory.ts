import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AuthGuard, resolveVerifierConfig } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { VERIFIER_ENV } from './service-config.js';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-focus-service` §2): verifier config resolves up front, the SQLite
 * directory is created before TypeORM opens the file, and `FOCUS_MASTER_KEY` is
 * enforced by `KeysModule`'s key factory.
 */
export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.FOCUS_DB_PATH ?? join(process.cwd(), 'data', 'focus.db')), {
    recursive: true,
  });
  resolveVerifierConfig(VERIFIER_ENV);
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
