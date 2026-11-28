import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppModule } from './app.module.js';
import { resolveDbPath } from './config/db-path.js';
import { ServiceLogger } from '@life/service-kit';
import { OidcService } from './oidc/oidc.service.js';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(resolveDbPath()), { recursive: true });
  const app = await NestFactory.create(AppModule, { logger: new ServiceLogger() });
  // Mount the OIDC protocol routes before init() so they precede Nest's body
  // parsers: oidc-provider reads the raw request body itself.
  const oidc = app.get(OidcService);
  (app.getHttpAdapter().getInstance() as Express).use(oidc.middleware());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
