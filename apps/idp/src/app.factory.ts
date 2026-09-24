import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { AppModule } from './app.module';
import { OidcService } from './oidc/oidc.service';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule);
  // Mount the OIDC protocol routes before init() so they precede Nest's body
  // parsers: oidc-provider reads the raw request body itself.
  const oidc = app.get(OidcService);
  (app.getHttpAdapter().getInstance() as Express).use(oidc.middleware());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
