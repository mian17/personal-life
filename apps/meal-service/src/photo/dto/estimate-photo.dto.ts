import { IsBase64, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /api/estimates/photo` (`SPEC-meal-service` Photo → Gemini
 * pipeline).
 *
 * The image travels as base64 + `mimeType` — the browser's natural encoding of
 * a `File` over JSON — and lives only for the duration of the request. Nothing
 * here is persisted or logged: the bytes reach `GeminiClient.readPhoto` and are
 * dropped when the response is assembled.
 *
 * `hint` is the *steering* input from the photo door (`SPEC-meal-capture-ui.md`
 * §Code Style, intent doc): it focuses the read ("leftover from last night, in
 * the blue bowl") and can never correct an estimate, because no estimate exists
 * until this call returns. It is optional — a bare photo is a valid request.
 */
export class EstimatePhotoDto {
  /** Base64 of the raw image bytes; `@IsBase64` rejects a malformed body before any call. */
  @IsString()
  @MinLength(1)
  @IsBase64()
  imageBase64: string;

  /** MIME type of the bytes — the client validates it against the model's documented set. */
  @IsString()
  @MaxLength(64)
  mimeType: string;

  /** Optional steering text; a hint, never a correction. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
}
