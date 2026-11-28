import type { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import { json } from 'express';
import { createServiceApplication } from '@life/service-kit';
import { AppModule } from './app.module.js';
import { VERIFIER_ENV } from './service-config.js';

/**
 * JSON body ceiling. This is the only service that receives an image, and a
 * base64 meal photo (a 3 MB JPEG is ~4 MB encoded) blows past Express's 100 kb
 * default — the photo door would 413 on a real photo. 8 MB covers a phone
 * capture with headroom; `ponytail:` the Gemini model's per-image byte limit is
 * enforced client-side by `GeminiClient`, so this is only the transport cap.
 */
const JSON_BODY_LIMIT = '8mb';

/**
 * Build the application with the global kernel wiring, plus this service's own
 * body parser: `bodyParser: false` keeps Nest's 100 kb default off, and the
 * 8 MB JSON parser below replaces it so a meal photo fits.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await createServiceApplication(AppModule, {
    sqlitePath: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
    verifierEnv: VERIFIER_ENV,
    nestOptions: { bodyParser: false },
  });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  return app;
}
