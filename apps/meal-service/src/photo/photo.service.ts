import { Inject, Injectable } from '@nestjs/common';
import { GeminiClient, type PhotoReadResult } from './gemini.client';

/**
 * DI token for the Gemini client factory.
 *
 * It lives here, not in `photo.module.ts`, on purpose: `PhotoModule` imports
 * this service, so a token defined there would be erased at runtime by the
 * circular import and every `PhotoService` would fail to resolve.
 *
 * The client is built from it on the first estimate, not at boot: the client's
 * env check is fail-closed by design (`SPEC-meal-service` Never: leak the key),
 * and boot must not depend on Gemini being configured for the rest of the
 * service to serve. Tests swap this token for a `FakeGemini`-backed factory
 * (`overrideProvider(GEMINI_CLIENT_FACTORY)`).
 */
export const GEMINI_CLIENT_FACTORY = Symbol('GEMINI_CLIENT_FACTORY');

/**
 * The photo estimate: image (+ optional hint) → Gemini → suggestion, and only
 * ever that (`SPEC-meal-service` Photo → Gemini pipeline).
 *
 * The hard edges of this method are all `SPEC-meal-service` Boundaries:
 *
 * - It **never writes an entry.** The result is a suggestion for the editor's
 *   draft; the diary is written only when the BFF posts a *confirmed* entry to
 *   `POST /api/entries` (a different route, a different request).
 * - Image bytes are **never persisted and never logged.** They travel in one
 *   request body to the model and are dropped when it returns — not in the DB,
 *   not in Redis, not in a log line. This service emits no log at all, so byte,
 *   prompt, or key leakage has nowhere to hide.
 * - Estimate responses are **never cached.** A Gemini result is per-request and
 *   unconfirmed; this module provides no `MEAL_CACHE` token on purpose, so
 *   there is no cache it could even touch. Only a confirmed entry gets the
 *   read-through treatment, in the entries service.
 *
 * Every failure the model can produce — non-2xx, timeout, schema violation, or
 * its own refusal — collapses into one explicit `{ readable: false }` result
 * inside `GeminiClient`, so this service has no error path of its own to leak a
 * detail (or a byte) through.
 */
@Injectable()
export class PhotoService {
  private client?: GeminiClient;

  constructor(
    @Inject(GEMINI_CLIENT_FACTORY) private readonly makeClient: () => GeminiClient,
  ) {}

  /**
   * @param imageBase64 raw image bytes, base64 — validated by the DTO, decoded
   *   here and handed straight to the model.
   * @param mimeType the client's image type; the model validates it against its
   *   documented allowlist (one owner, `GeminiClient`).
   * @param hint optional steering text — a hint, never a correction.
   */
  estimate(imageBase64: string, mimeType: string, hint?: string): Promise<PhotoReadResult> {
    this.client ??= this.makeClient();
    return this.client.readPhoto({ mimeType, bytes: Buffer.from(imageBase64, 'base64') }, hint);
  }
}