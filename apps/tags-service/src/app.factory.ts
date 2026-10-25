import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppModule } from './app.module';
import { AuthGuard } from './auth/auth.guard';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'tags.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
