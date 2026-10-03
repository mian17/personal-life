import { Module } from '@nestjs/common';
import { GeminiClient } from './gemini.client';
import { PhotoController } from './photo.controller';
import { GEMINI_CLIENT_FACTORY, PhotoService } from './photo.service';

/**
 * The Gemini photo pipeline (`SPEC-meal-service` Photo → Gemini pipeline).
 *
 * `GeminiClient` is meal-service's only Gemini adapter: built from the three
 * env coordinates (`GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_API_BASE`) and never
 * exported — it stays behind the one route that needs it.
 *
 * The provider is the client *factory* (not a client): `PhotoService` builds
 * its one client on the first estimate, so a missing coordinate is a
 * deployment error reported where the photo is requested rather than a boot
 * failure for a service whose other routes do not involve Gemini.
 *
 * There is **no cache provider in this module**, on purpose: estimates are
 * never cached (`SPEC-meal-service` Cache Rules), so the module imports no
 * `MEAL_CACHE` token and `PhotoService` has none to misuse. That absence is the
 * enforcement.
 */
@Module({
  controllers: [PhotoController],
  providers: [
    { provide: GEMINI_CLIENT_FACTORY, useValue: () => new GeminiClient(process.env) },
    PhotoService,
  ],
})
export class PhotoModule {}
