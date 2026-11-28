import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AuthGuard, resolveVerifierConfig } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { resolveDatabasePath, VERIFIER_ENV } from './service-config.js';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-service-kernel`): verifier config resolves up front, and the SQLite
 * directory exists before TypeORM opens the file.
 */
export async function createApp(): Promise<INestApplication> {
  createDatabaseDirectory();
  resolveVerifierConfig(VERIFIER_ENV);

  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}

function createDatabaseDirectory(): void {
  mkdirSync(dirname(resolveDatabasePath()), { recursive: true });
}
