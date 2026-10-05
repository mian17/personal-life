/**
 * meal-service's only Gemini call (`SPEC-meal-service` Photo → Gemini pipeline):
 * a plain `fetch` against the Generative Language API, no SDK — one endpoint,
 * one JSON shape.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Every failure is one failure.** A non-2xx, a timeout, a network error, a
 *    body that is not the documented envelope, a model answer that violates the
 *    schema, a tool call that throws or outlives its bound, and the model's own
 *    "I could not read this" all return the same `COULD_NOT_READ` result. The
 *    service never turns a bad answer into a plausible-looking diary entry — a
 *    guessed number is worse than no number.
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

/**
 * One food the model read out of the photo — identity only. No nutrient field
 * lives here: the model names the food and weighs it, and the backend resolves
 * the numbers later (Task 8). `foodId` is a catalog id the model chose, or
 * null; `fdcId` is a USDA id it chose, or null.
 */
export interface PhotoFoodSuggestion {
  name: string;
  grams: number;
  foodId: string | null;
  fdcId: number | null;
}

/**
 * The explicit result shape. `readable: false` carries no items on purpose: a
 * caller cannot accidentally render "0 kcal" from a failure, because there is
 * nothing to render but the reason.
 */
export type PhotoReadResult =
  | { readable: true; items: PhotoFoodSuggestion[] }
  | { readable: false; reason: typeof COULD_NOT_READ };

const COULD_NOT_READ_RESULT: PhotoReadResult = { readable: false, reason: COULD_NOT_READ };

/**
 * The caller's search tool (`SPEC-photo-identity.md` § The tool loop, declared
 * once here): given a food name, answer with matching catalog rows and USDA
 * candidates. Task 8 builds the closure over its injected services and passes
 * it to `readPhoto`; this client only declares the shape and calls it.
 */
export interface SearchFoodResult {
  catalog: { id: string; name: string; servingGrams: number }[];
  usda: { name: string; fdcId: number }[];
}

export type SearchFood = (query: string) => Promise<SearchFoodResult>;

/** One turn of the conversation the search loop builds up. */
interface ConversationTurn {
  role: 'user' | 'model';
  parts: unknown[];
}

/** The API method; the request path is `<base>/models/<model>:<method>`. */
const METHOD = 'generateContent';

const SEARCH_TOOL_NAME = 'search_food';

/**
 * Task 2's bounds (SPEC-photo-identity § Bounds: "5 tool rounds, 45 s wall
 * clock"): a meal photo holds a handful of foods, so a model still searching
 * after five rounds is looping, not reading; forty-five seconds is three of
 * this client's per-request timeouts. ponytail: fixed budget for every read;
 * make it per-call only if a real model needs longer.
 */
const MAX_TOOL_ROUNDS = 5;
const TOOL_LOOP_WALL_CLOCK_MS = 45_000;

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
  'You read a photo of a meal and name the real foods on the plate.',
  'Reply with JSON only, matching the given response schema exactly.',
  'For each food give its name as a catalog name, the portion in grams,',
  'and the catalog id or USDA id when you recognise one — else null.',
  '',
  'Never estimate a nutrient number. Your answer carries identity only:',
  'names, weights, and ids. Numbers come from the catalog, never from you.',
  'If you cannot read the photo, or cannot tell what a food is, answer with',
  'readable: false and an empty items array instead of a guess. A missing',
  'food is a better answer than a wrong one.',
].join('\n');

/**
 * The response schema we ask for, in the API's own `Schema` shape (`type`
 * enum `STRING|NUMBER|INTEGER|BOOLEAN|ARRAY|OBJECT`, plus `properties`,
 * `required`, `items`). Identity only: no nutrient key exists anywhere in
 * this schema or the request body — the backend attaches the resolved vector
 * later (Task 8). Nullable ids use the schema's `nullable` flag.
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
          name: { type: 'STRING', description: 'Name of the food as a catalog name.' },
          grams: { type: 'NUMBER', description: 'Estimated portion weight in grams.' },
          foodId: {
            type: 'STRING',
            nullable: true,
            description: 'Catalog food id when recognised, else null.',
          },
          fdcId: {
            type: 'INTEGER',
            nullable: true,
            description: 'USDA food id when recognised, else null.',
          },
        },
        required: ['name', 'grams', 'foodId', 'fdcId'],
      },
    },
  },
  required: ['readable', 'items'],
};

/**
 * The `search_food` declaration the model sees, in `tools[].functionDeclarations`
 * (SPEC-photo-identity § The verified envelope): `name` and `description` are
 * required, `parameters` an OpenAPI 3.03 Parameter Object. The single property
 * is the query — identity only, no nutrient argument.
 */
const SEARCH_FOOD_DECLARATION = {
  name: SEARCH_TOOL_NAME,
  description:
    'Look up a food by name before answering. Returns matching catalog foods and ' +
    'USDA candidates so you can name a food id or a USDA id. It never returns ' +
    'nutrient amounts.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: 'A food name to look up, e.g. "chicken".' },
    },
    required: ['query'],
  },
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
   * Read a photo's foods. Always resolves — transport, protocol, schema, the
   * model's own refusal, a throwing tool, and an outlived bound all land on
   * the same "could not read" result, so the controller has exactly one
   * failure path (open manual entry).
   *
   * Without a search tool this is Task 6's single shot: one request, and the
   * terminal turn is model JSON text. With a tool, each `functionCall` turn
   * runs the caller's search and answers with a `functionResponse` turn, until
   * a text turn arrives or a bound stops the loop — five tool rounds, forty-
   * five seconds of wall clock. Past either bound the turn at hand is treated
   * as the final answer, and a turn with no usable JSON is the one failure.
   */
  async readPhoto(
    image: PhotoImage,
    hint?: string,
    searchTool?: SearchFood,
  ): Promise<PhotoReadResult> {
    if (!IMAGE_MIME_TYPES.includes(image.mimeType)) return COULD_NOT_READ_RESULT;
    try {
      if (searchTool === undefined) return await this.readOnce(image, hint);
      return await this.readWithSearch(image, hint, searchTool);
    } catch {
      // Network error, aborted body, unreadable JSON, throwing tool: one
      // outcome, no detail logged (the body may contain the prompt, and the
      // reason is the caller's).
      return COULD_NOT_READ_RESULT;
    }
  }

  /** Task 6's single shot — no tool, one request, unchanged while the loop lives beside it. */
  private async readOnce(image: PhotoImage, hint?: string): Promise<PhotoReadResult> {
    const response = await this.send(JSON.stringify(this.requestBody(image, hint)));
    if (!response.ok) return COULD_NOT_READ_RESULT;
    const parts = candidateParts(parseJson(await response.text()));
    if (!parts) return COULD_NOT_READ_RESULT;
    return finishReading(parts);
  }

  /**
   * The `search_food` turn loop. The conversation grows two turns per round —
   * the model's `functionCall`, then our `functionResponse` — and ends on the
   * first text turn. Either bound stops it: five tool rounds, or forty-five
   * seconds since the photo first went out.
   */
  private async readWithSearch(
    image: PhotoImage,
    hint: string | undefined,
    searchTool: SearchFood,
  ): Promise<PhotoReadResult> {
    const turns: ConversationTurn[] = [{ role: 'user', parts: this.firstParts(image, hint) }];
    const deadline = Date.now() + TOOL_LOOP_WALL_CLOCK_MS;
    let toolsUsed = 0;
    for (;;) {
      if (Date.now() >= deadline) return COULD_NOT_READ_RESULT;
      const response = await this.send(JSON.stringify(this.loopBody(turns)));
      if (!response.ok) return COULD_NOT_READ_RESULT;
      const parts = candidateParts(parseJson(await response.text()));
      if (!parts) return COULD_NOT_READ_RESULT;
      const rawCall = findToolCall(parts);
      if (rawCall === undefined) return finishReading(parts);
      if (toolsUsed >= MAX_TOOL_ROUNDS) return finishReading(parts);
      const call = readToolCall(rawCall);
      if (!call) return COULD_NOT_READ_RESULT;
      const found = await runSearchTool(searchTool, call.query, deadline);
      if (!found) return COULD_NOT_READ_RESULT;
      toolsUsed += 1;
      turns.push({ role: 'model', parts }, { role: 'user', parts: [toolResultPart(call.id, found)] });
    }
  }

  private requestBody(image: PhotoImage, hint?: string): unknown {
    return {
      contents: [{ role: 'user', parts: this.firstParts(image, hint) }],
      generationConfig: generationConfig(),
    };
  }

  /** One search-loop request: the conversation so far, plus the tool the model may call. */
  private loopBody(turns: ConversationTurn[]): unknown {
    return {
      contents: turns,
      tools: [{ functionDeclarations: [SEARCH_FOOD_DECLARATION] }],
      generationConfig: generationConfig(),
    };
  }

  private firstParts(image: PhotoImage, hint?: string): unknown[] {
    const parts: unknown[] = [{ text: PROMPT }];
    if (hint && hint.trim() !== '') {
      parts.push({
        text:
          `Steering hint from the person logging this meal — use it to focus your ` +
          `reading; it is not a correction of any previous estimate: ${hint}`,
      });
    }
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString('base64') } });
    return parts;
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

/** The identity-only JSON shape the final text turn must satisfy. */
function generationConfig(): unknown {
  return { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
}

/**
 * A candidate's `parts`, or null for a body that is not the documented
 * envelope (`candidates[].content.parts`). The text answer is found by
 * `finishReading`; a `functionCall` part is found by `findToolCall`.
 */
function candidateParts(envelope: unknown): unknown[] | null {
  const candidates = record(envelope)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = record(record(candidates[0])?.content)?.parts;
  return Array.isArray(parts) ? (parts as unknown[]) : null;
}

/**
 * The answer a terminal turn carries, or the one failure. A `functionCall`
 * part reaching here is not an answer — it fails the same way bad JSON does.
 */
function finishReading(parts: unknown[]): PhotoReadResult {
  let text: string | null = null;
  for (const part of parts) {
    const candidate = record(part)?.text;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      text = candidate;
      break;
    }
  }
  if (text === null) return COULD_NOT_READ_RESULT;
  const items = readItems(parseJson(text));
  // `[]` covers the model's own `readable: false` — an empty suggestion is
  // the failure result, so there is no second way to express "no answer".
  return items === null || items.length === 0 ? COULD_NOT_READ_RESULT : { readable: true, items };
}

/**
 * The turn's loop condition from the shape (Task 2's termination): a
 * `functionCall` part means the loop continues — the caller runs the tool and
 * answers it with a `functionResponse` turn. No such part ends the loop.
 */
function findToolCall(parts: unknown[]): Record<string, unknown> | undefined {
  for (const part of parts) {
    const call = record(record(part)?.functionCall);
    if (call) return call;
  }
  return undefined;
}

/**
 * The one `functionCall` this loop answers: ours, with a usable `args.query`.
 * Anything else — another name, a missing query — is a bad envelope, the one
 * failure. The `id` rides back on the matching `functionResponse`.
 */
function readToolCall(call: Record<string, unknown>): { id?: string; query: string } | null {
  if (call.name !== SEARCH_TOOL_NAME) return null;
  const query = record(call.args)?.query;
  if (typeof query !== 'string' || query.trim() === '') return null;
  return typeof call.id === 'string' ? { id: call.id, query } : { query };
}

/**
 * Run one search round. A tool that throws (USDA 429, catalog error) answers
 * null, and the loop collapses it to the one failure — a typed result, never
 * a hang. The remaining wall clock races the tool too, so a slow tool cannot
 * stall the loop past its 45 s bound. Task 8's closure fails open to this
 * shape behind the tool.
 */
async function runSearchTool(
  searchTool: SearchFood,
  query: string,
  deadline: number,
): Promise<SearchFoodResult | null> {
  try {
    const budget = deadline - Date.now();
    if (budget <= 0) return null;
    return await Promise.race([searchTool(query), refuseAfter(budget)]);
  } catch {
    return null;
  }
}

/** Rejects when the loop's remaining wall clock runs out, clearing its timer if it does not. */
async function refuseAfter(budgetMs: number): Promise<never> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('search tool outlived its budget')), budgetMs);
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `functionResponse` turn answering one call, on `role: "user"` by
 * convention: `name` echoes the call, `id` echoes when the call carried one,
 * `response` carries the names-and-ids result — never a nutrient amount.
 */
function toolResultPart(callId: string | undefined, found: SearchFoodResult): unknown {
  return {
    functionResponse: {
      name: SEARCH_TOOL_NAME,
      ...(callId === undefined ? {} : { id: callId }),
      response: found,
    },
  };
}

/**
 * Validate the model's own JSON. Returns `null` for anything the schema does
 * not admit — no partial parse, no defaulted field. Identity only: a name, a
 * weight, and two ids. `fdcId` is an integer or null; `foodId` a string or
 * null. No nutrient field is read here because none is asked for.
 */
function readItems(payload: unknown): PhotoFoodSuggestion[] | null {
  const root = record(payload);
  if (!root || typeof root.readable !== 'boolean') return null;
  if (!root.readable) return [];
  const items = root.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const out: PhotoFoodSuggestion[] = [];
  for (const item of items) {
    const parsed = readSuggestion(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function readSuggestion(value: unknown): PhotoFoodSuggestion | null {
  const item = record(value);
  if (!item) return null;
  const { name, grams, foodId, fdcId } = item;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0) return null;
  if (typeof foodId !== 'string' && foodId !== null) return null;
  if (typeof fdcId !== 'number' && fdcId !== null) return null;
  if (fdcId !== null && !Number.isInteger(fdcId)) return null;
  return { name, grams, foodId, fdcId };
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
