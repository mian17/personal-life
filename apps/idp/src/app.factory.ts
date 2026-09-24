import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
