import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppModule } from './app.module.js';
import { AuthGuard } from '@life/service-kit';
import { VERIFIER_ENV } from './service-config.js';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
