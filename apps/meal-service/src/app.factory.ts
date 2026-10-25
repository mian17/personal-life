import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { json } from 'express';
import { AuthGuard } from '@life/service-kit';
import { AppModule } from './app.module';
import { VERIFIER_ENV } from './service-config';

/**
 * JSON body ceiling. This is the only service that receives an image, and a
 * base64 meal photo (a 3 MB JPEG is ~4 MB encoded) blows past Express's 100 kb
 * default — the photo door would 413 on a real photo. 8 MB covers a phone
 * capture with headroom; `ponytail:` the Gemini model's per-image byte limit is
 * enforced client-side by `GeminiClient`, so this is only the transport cap.
 */
const JSON_BODY_LIMIT = '8mb';

export async function createApp(): Promise<INestApplication> {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
