import { NUTRIENTS, type NutrientVector } from '@life/nutrition';
import { completeVector } from '../foods/content';

/**
 * meal-service's only Gemini call (`SPEC-meal-service` Photo → Gemini pipeline):
 * a plain `fetch` against the Generative Language API, no SDK — one endpoint,
 * one JSON shape.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Every failure is one failure.** A non-2xx, a timeout, a network error, a
 *    body that is not the documented envelope, a model answer that violates the
 *    schema, and the model's own "I could not read this" all return the same
 *    `COULD_NOT_READ` result. The service never turns a bad answer into a
 *    plausible-looking diary entry — a guessed number is worse than no number.
 * 2. **The key and the image stay here.** All three coordinates (key, model id,
 *    API base) come from env, the key travels only in an `x-goog-api-key`
 *    header — never in the URL, which proxies log — and this module writes
 *    nothing to any log. Image bytes exist as base64 inside one request body
 *    and are then dropped; they are never persisted (spec: not in Redis, DB,
 *    or a log).
 * 3. **The hint is steering, not correction.** It goes into the same turn as
 *    the image, labelled as a hint. Nothing here can revise an answer — a
 *    correction is a *confirmed entry* the BFF posts later.
 *
 * Verified against the API's own discovery document
 * (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`,
 * 2026-10-03); see the Decision log in `MAP-meal-nutrition.md`.
 */

/** The single reason the pipeline can fail with — "I could not read this." */
export const COULD_NOT_READ = 'could-not-read' as const;

/** One dish the model read out of the photo, with a complete nutrient vector. */
export interface PhotoItemSuggestion {
  dish: string;
  ingredients: string[];
  portionGrams: number;
  nutrients: NutrientVector;
}

/**
 * The explicit result shape. `readable: false` carries no items on purpose: a
 * caller cannot accidentally render "0 kcal" from a failure, because there is
 * nothing to render but the reason.
 */
export type PhotoReadResult =
  | { readable: true; items: PhotoItemSuggestion[] }
  | { readable: false; reason: typeof COULD_NOT_READ };

const COULD_NOT_READ_RESULT: PhotoReadResult = { readable: false, reason: COULD_NOT_READ };

/** The API method; the request path is `<base>/models/<model>:<method>`. */
const METHOD = 'generateContent';

/**
 * Image MIME types the API documents for inline image bytes (`Blob.mimeType` in
 * the discovery document). Anything else fails as unreadable here rather than
 * travelling to the API for a guaranteed rejection. Byte-size limits are the
 * controller DTO's job — they are a request-size contract, not a Gemini one.
 */
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
];

const PROMPT = [
  'You read a photo of a meal and describe what is on the plate.',
  'Reply with JSON only, matching the given response schema exactly.',
  'For each dish give its name, the ingredients you can see, the portion in grams,',
  'and all 27 nutrient fields for that portion, each your best numeric estimate.',
  '',
  'Never invent a nutrient number. If you cannot read the photo, or cannot tell',
  'what a dish is, answer with readable: false and an empty items array instead of',
  'a guess. A missing dish is a better answer than a wrong one.',
].join('\n');

/**
 * The response schema we ask for, in the API's own `Schema` shape (`type`
 * enum `STRING|NUMBER|INTEGER|BOOLEAN|ARRAY|OBJECT`, plus `properties`,
 * `required`, `items`). The 27 nutrient fields are generated from
 * `@life/nutrition` so the model is asked for exactly what `completeVector`
 * will later require — the vocabulary has one owner.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    readable: {
      type: 'BOOLEAN',
      description: 'False when the photo could not be read; then items is empty.',
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dish: { type: 'STRING', description: 'Name of the dish as seen on the plate.' },
          ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
          portionGrams: { type: 'NUMBER', description: 'Estimated total weight in grams.' },
          nutrients: {
            type: 'OBJECT',
            properties: Object.fromEntries(
              NUTRIENTS.map(({ key, label, unit }) => [
                key,
                { type: 'NUMBER', description: `${label} in ${unit}` },
              ]),
            ),
            required: NUTRIENTS.map(({ key }) => key),
          },
        },
        required: ['dish', 'ingredients', 'portionGrams', 'nutrients'],
      },
    },
  },
  required: ['readable', 'items'],
};

/** Injected in tests; `fetch` in production (Node 18+ global, no SDK). */
export type GeminiTransport = typeof fetch;

export interface PhotoImage {
  /** Must be one of `IMAGE_MIME_TYPES`. */
  mimeType: string;
  /** Raw bytes. Never persisted, never logged. */
  bytes: Buffer;
}

export class GeminiClient {
  private readonly url: string;
  private readonly key: string;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly transport: GeminiTransport = fetch,
    /** ponytail: one fixed deadline for every request; make it per-call only if a real model needs longer. */
    private readonly timeoutMs = 15_000,
  ) {
    const key = env.GEMINI_API_KEY;
    const model = env.GEMINI_MODEL;
    const base = env.GEMINI_API_BASE;
    // Fail closed at construction, like the master key: a missing coordinate is
    // a deployment error, not a photo this service could not read. The message
    // names the variables, never their values.
    if (!key || !model || !base) {
      throw new Error(
        'Gemini is not configured: GEMINI_API_KEY, GEMINI_MODEL and GEMINI_API_BASE must all be set',
      );
    }
    this.key = key;
    this.url = `${base.replace(/\/+$/, '')}/models/${model}:${METHOD}`;
  }

  /**
   * Estimate a photo. Always resolves — transport, protocol, schema, and the
   * model's own refusal all land on the same "could not read" result, so the
   * controller has exactly one failure path (open manual entry).
   */
  async readPhoto(image: PhotoImage, hint?: string): Promise<PhotoReadResult> {
    if (!IMAGE_MIME_TYPES.includes(image.mimeType)) return COULD_NOT_READ_RESULT;
    try {
      const response = await this.send(JSON.stringify(this.requestBody(image, hint)));
      if (!response.ok) return COULD_NOT_READ_RESULT;
      const text = candidateText(parseJson(await response.text()));
      if (text === null) return COULD_NOT_READ_RESULT;
      const items = readItems(parseJson(text));
      // `[]` covers the model's own `readable: false` — an empty suggestion is
      // the failure result, so there is no second way to express "no answer".
      return items === null || items.length === 0 ? COULD_NOT_READ_RESULT : { readable: true, items };
    } catch {
      // Network error, aborted body, unreadable JSON: one outcome, no detail
      // logged (the body may contain the prompt, and the reason is the caller's).
      return COULD_NOT_READ_RESULT;
    }
  }

  private requestBody(image: PhotoImage, hint?: string): unknown {
    const parts: unknown[] = [{ text: PROMPT }];
    if (hint && hint.trim() !== '') {
      parts.push({
        text:
          `Steering hint from the person logging this meal — use it to focus your ` +
          `reading; it is not a correction of any previous estimate: ${hint}`,
      });
    }
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString('base64') } });
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    };
  }

  private async send(body: string): Promise<Response> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('gemini request timed out')), this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.transport(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        }),
        expiry,
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
}

/** The API's response envelope is `candidates[].content.parts[].text`; anything else is not an answer. */
function candidateText(envelope: unknown): string | null {
  const candidates = record(envelope)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = record(record(candidates[0])?.content)?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const text = record(part)?.text;
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return null;
}

/**
 * Validate the model's own JSON. Returns `null` for anything the schema does
 * not admit — no partial parse, no defaulted field. `completeVector` is the one
 * owner of the "a vector is complete" rule, so a vector with a hole in it (the
 * shape an invented number usually takes) fails here rather than reaching a
 * day total.
 */
function readItems(payload: unknown): PhotoItemSuggestion[] | null {
  const root = record(payload);
  if (!root || typeof root.readable !== 'boolean') return null;
  if (!root.readable) return [];
  const items = root.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const out: PhotoItemSuggestion[] = [];
  for (const item of items) {
    const parsed = readItem(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function readItem(value: unknown): PhotoItemSuggestion | null {
  const item = record(value);
  if (!item) return null;
  const { dish, ingredients, portionGrams } = item;
  if (typeof dish !== 'string' || dish.trim() === '') return null;
  if (
    !Array.isArray(ingredients) ||
    ingredients.length === 0 ||
    ingredients.some((name) => typeof name !== 'string' || name.trim() === '')
  ) {
    return null;
  }
  if (typeof portionGrams !== 'number' || !Number.isFinite(portionGrams) || portionGrams < 0) return null;
  let nutrients: NutrientVector;
  try {
    nutrients = completeVector(item.nutrients);
  } catch {
    return null;
  }
  return { dish, ingredients: ingredients as string[], portionGrams, nutrients };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}