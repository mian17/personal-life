import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AuthGuard } from './auth/auth.guard';

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
  // Request-level diagnosis: a photo upload can die before any controller runs
  // (413 from the ceiling below, 400 from the validation pipe, 401 from the
  // guard), and those never reach a service log line. Path + status only.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        Logger.warn(`${req.method} ${req.url.split('?')[0]} -> ${res.statusCode}`, 'HttpReject');
      }
    });
    next();
  });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.useGlobalGuards(new AuthGuard());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
