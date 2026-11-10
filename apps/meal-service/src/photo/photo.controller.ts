import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { EstimatePhotoDto } from './dto/estimate-photo.dto.js';
import { PhotoService } from './photo.service.js';

/**
 * `POST /api/estimates/photo` — the ONE path string the UI's server action
 * posts to (`SPEC-meal-service` Photo → Gemini pipeline; Task 17's call site in
 * `lib/meal-api.ts`). `@Controller('api/estimates')` follows the repo's
 * `api/<noun>` convention.
 *
 * The route returns a **suggestion, never an entry**: the client's
 * `readable: true` items become the editor's draft, and a failure response
 * opens it empty (manual mode) — `could-not-read` when the photo was
 * unreadable, `service-unavailable` when the photo service could not answer
 * (see `SPEC-photo-identity.md` § Failure reasons).
 * Nothing is written, nothing is cached, and no image byte reaches a log.
 *
 * `@Principal()` is bound here like every other route (`SPEC-meal-service` Code
 * Style: the owner comes from the verified token, never the body — enforced by
 * the global `forbidNonWhitelisted` pipe, which rejects an `ownerSub` field).
 * An estimate persists nothing, so the principal is read as proof of an
 * authenticated caller and is not forwarded to a query that does not exist.
 */
@Controller('api/estimates')
export class PhotoController {
  constructor(private readonly photo: PhotoService) {}

  @Post('photo')
  @HttpCode(HttpStatus.OK)
  estimate(@Principal() owner: Principal, @Body() dto: EstimatePhotoDto) {
    // The principal is read here because every route's owner is bound to it
    // (`SPEC-meal-service` Code Style), and forwarded as the scope of the
    // catalog reads the estimate resolves against — a per-owner read even
    // though nothing is written. `OK`, not `201 Created`: the endpoint
    // produces no resource — a suggestion is a transient read, and a failure
    // is a valid answer to a valid request.
    return this.photo.estimate(owner.sub, dto.imageBase64, dto.mimeType, dto.hint);
  }
}
