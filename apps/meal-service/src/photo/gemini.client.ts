/**
 * meal-service's only Gemini call (`SPEC-meal-service` Photo → Gemini pipeline):
 * a plain `fetch` against the Generative Language API, no SDK — one endpoint,
 * one JSON shape.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Two failures, named by their owner.** A failure is either the photo's
 *    (`COULD_NOT_READ`: an unsupported mime, a body that is not the documented
 *    envelope, a model answer that violates the schema, the model's own "I could
 *    not read this", a tool call or loop that outlives its bound) or the
 *    service's (`SERVICE_UNAVAILABLE`: a non-2xx from the API, a network error,
 *    a timeout). The caller renders a different message for each — send a better
 *    photo, or retry later. The service never turns a bad answer into a
 *    plausible-looking diary entry — a guessed number is worse than no number.
 * 2. **The key and the image stay here.** All three coordinates (key, model id,
 *    API base) come from env, the key travels only in an `x-goog-api-key`
 *    header — never in the URL, which proxies log — and this module logs only a
 *    failure's class and the API's HTTP status, never the key, the image bytes,
 *    the prompt, or the response body. Image bytes exist as base64 inside one
 *    request body and are then dropped; they are never persisted (spec: not in
 *    Redis, DB, or a log).
 * 3. **The hint is steering, not correction.** It goes into the same turn as
 *    the image, labelled as a hint. Nothing here can revise an answer — a
 *    correction is a *confirmed entry* the BFF posts later.
 *
 * Verified against the API's own discovery document
 * (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`,
 * 2026-10-03); see the Decision log in `MAP-meal-nutrition.md`.
 */

import { Logger } from '@nestjs/common';

/** The photo was unreadable — the photo is the problem, send a better one or type it by hand. */
export const COULD_NOT_READ = 'could-not-read' as const;

/** The photo service cannot answer — the service is the problem, retry later and read the server log. */
export const SERVICE_UNAVAILABLE = 'service-unavailable' as const;

/** Every way the pipeline can fail with, flowing from the client through the service to the editor. */
export type PhotoFailureReason = typeof COULD_NOT_READ | typeof SERVICE_UNAVAILABLE;

/**
 * One food the model read out of the photo — identity only. No nutrient field
 * lives here: the model names the food and weighs it, and the backend resolves
 * the numbers later (Task 8). `foodId` is a catalog id the model chose, or
 * null; `fdcId` is a USDA id it chose, or null. `searchQuery` is the
 * `search_food` query whose result carried that chosen id, or null when the
 * model named no id — the binding that keeps one food's id from resolving onto
 * another food (resolution trusts an id only when its own query offered it).
 */
export interface PhotoFoodSuggestion {
  name: string;
  grams: number;
  foodId: string | null;
  fdcId: number | null;
  searchQuery: string | null;
}

/**
 * The explicit result shape. `readable: false` carries no items on purpose: a
 * caller cannot accidentally render "0 kcal" from a failure, because there is
 * nothing to render but the reason.
 */
export type PhotoReadResult =
  | { readable: true; items: PhotoFoodSuggestion[] }
  | { readable: false; reason: PhotoFailureReason };

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

/** What the search loop carries from one turn to the next: its wall-clock deadline and its two bounds. */
interface SearchLoopState {
  deadline: number;
  searchesRun: number;
  exhaustedReplySent: boolean;
}

/** The API method; the request path is `<base>/models/<model>:<method>`. */
const METHOD = 'generateContent';

/**
 * `value` without its trailing slashes, so a configured base never doubles the
 * join's slash. A linear scan rather than `/\/+$/`, which backtracks.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

const SEARCH_TOOL_NAME = 'search_food';

/**
 * Task 2's bounds (SPEC-photo-identity § Bounds: "10 tool rounds, 45 s wall
 * clock"): a meal photo holds a handful of foods, so a model still searching
 * after ten rounds is looping, not reading; forty-five seconds is three of
 * this client's per-request timeouts. Hitting the search cap no longer discards
 * the read: the loop answers every outstanding call with an empty result and lets
 * the model answer with the foods it already found (see `readWithSearch`).
 * ponytail: fixed budget for every read; make it per-call only if a real model
 * needs longer.
 */
export const MAX_TOOL_ROUNDS = 10;
const TOOL_LOOP_WALL_CLOCK_MS = 45_000;

/** The answer to a call we will not run: it offers no candidate, so no id can resolve through it. */
const NO_SEARCH_RESULT: SearchFoodResult = { catalog: [], usda: [] };

/**
 * Image MIME types the API documents for inline image bytes (`Blob.mimeType` in
 * the discovery document). Anything else fails as unreadable here rather than
 * travelling to the API for a guaranteed rejection. Byte-size limits are the
 * controller DTO's job — they are a request-size contract, not a Gemini one.
 */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
]);

const PROMPT = [
  'You read a photo of a meal and name the real foods on the plate.',
  'List one item per distinct food you can identify. A bowl or pot holding',
  'several foods is several items — never one combined item. A bowl of',
  'chicken, tofu, and yardlong beans is three items, not one "chicken and',
  'tofu soup".',
  'Never answer with a dish, recipe, or menu name. Each name is a single food',
  'as a catalog name ("chicken", "tofu", "yardlong beans"), never a combination',
  '("chicken and tofu soup") and never a preparation ("grilled chicken salad").',
  'Do not split one food into its parts: an egg is one item, not "egg white"',
  'plus "egg yolk".',
  'Call the search_food tool once per food you list, with that food’s own name',
  'as the query, searching every food before you give the final answer. When it',
  'returns candidates, choose the one that best represents the food in the',
  'photo and put that candidate id in your answer; an id that did not come',
  'from that food’s own search result must be null.',
  'Reply with JSON only, matching the given response schema exactly.',
  'For each food give its name as a catalog name, the portion in grams, the',
  'catalog id or USDA id you chose from a search result — else null — and in',
  'searchQuery the exact search_food query you used to find that id. The',
  'candidate id and the query you report must be one pair from one result,',
  'from that food’s own search.',
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
            description: 'Catalog food id from a search_food result, else null.',
          },
          fdcId: {
            type: 'INTEGER',
            nullable: true,
            description: 'USDA food id from a search_food result, else null.',
          },
          searchQuery: {
            type: 'STRING',
            nullable: true,
            description:
              'The search_food query whose result carried this food’s id, else null.',
          },
        },
        required: ['name', 'grams', 'foodId', 'fdcId', 'searchQuery'],
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
    'USDA candidates so you can name a food id or a USDA id; the id in your answer ' +
    'must be one of the candidates it returns. It never returns nutrient amounts.',
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
    this.url = `${withoutTrailingSlashes(base)}/models/${model}:${METHOD}`;
  }

  /**
   * Read a photo's foods. Always resolves — transport, protocol, schema, the
   * model's own refusal, a throwing tool, and an outlived bound all land on a
   * typed failure with a reason: the model could not read the photo
   * (`COULD_NOT_READ`), or the service could not answer (`SERVICE_UNAVAILABLE`).
   * The editor renders manual entry for either, and a different banner for each.
   *
   * Without a search tool this is Task 6's single shot: one request, and the
   * terminal turn is model JSON text. With a tool, each `functionCall` part in
   * a turn runs the caller's search and is answered with its own
   * `functionResponse` part, until a text turn arrives or a bound stops the
   * loop — `MAX_TOOL_ROUNDS` executed searches, forty-five seconds of wall
   * clock. Past the wall clock the turn at hand is treated as the final answer;
   * past the search cap every pending call is answered empty for one further
   * turn. A turn with no usable JSON is `COULD_NOT_READ`.
   */
  async readPhoto(
    image: PhotoImage,
    hint?: string,
    searchTool?: SearchFood,
  ): Promise<PhotoReadResult> {
    if (!IMAGE_MIME_TYPES.has(image.mimeType)) return readFailure(COULD_NOT_READ);
    try {
      if (searchTool === undefined) return await this.readOnce(image, hint);
      return await this.readWithSearch(image, hint, searchTool);
    } catch {
      // A transport throw — network error, aborted body, expired deadline —
      // is the service failing to answer, not the photo being unreadable. The
      // classified reason is the only thing logged (rule 2).
      return readFailure(SERVICE_UNAVAILABLE);
    }
  }

  /** Task 6's single shot — no tool, one request, unchanged while the loop lives beside it. */
  private async readOnce(image: PhotoImage, hint?: string): Promise<PhotoReadResult> {
    const response = await this.send(JSON.stringify(this.requestBody(image, hint)));
    if (!response.ok) return readFailure(SERVICE_UNAVAILABLE, response.status);
    const parts = candidateParts(parseJson(await response.text()));
    if (!parts) return readFailure(COULD_NOT_READ);
    return finishReading(parts);
  }

  /**
   * The `search_food` turn loop. The conversation grows by two turns per loop —
   * the model's `functionCall` parts, then our `functionResponse` parts, one
   * answer per call — and ends on the first text turn. Either bound stops it:
   * `MAX_TOOL_ROUNDS` executed searches, or forty-five seconds since the photo
   * first went out. Every request goes out with mode `AUTO` and the identity
   * schema, so the model chooses when to search and when to answer. The cap
   * counts searches, not turns: a turn carrying three calls spends three rounds
   * and runs all three. Past the cap no call is run — the loop answers every
   * pending call with an empty result and allows one further turn, so the model
   * can answer with the foods it already found instead of losing the whole
   * estimate. The foods it could not search take the absent vector through the
   * existing path 3 — they are not special-cased here.
   */
  private async readWithSearch(
    image: PhotoImage,
    hint: string | undefined,
    searchTool: SearchFood,
  ): Promise<PhotoReadResult> {
    const turns: ConversationTurn[] = [{ role: 'user', parts: this.firstParts(image, hint) }];
    const state: SearchLoopState = {
      deadline: Date.now() + TOOL_LOOP_WALL_CLOCK_MS,
      searchesRun: 0,
      exhaustedReplySent: false,
    };
    for (;;) {
      if (Date.now() >= state.deadline) return readFailure(COULD_NOT_READ);
      const reply = await this.nextReply(turns);
      if (!Array.isArray(reply)) return reply;
      const rawCalls = findToolCalls(reply);
      if (rawCalls.length === 0) return finishReading(reply);
      const calls = readToolCalls(rawCalls);
      if (!calls) return readFailure(COULD_NOT_READ);
      const answer = await this.answerCalls(turns, reply, calls, searchTool, state);
      if (answer) return answer;
    }
  }

  /**
   * One loop request: the candidate's `parts`, or the failure that ends the read
   * — a non-2xx from the API (the service's) or a body that is not the
   * documented envelope (the photo's).
   */
  private async nextReply(turns: ConversationTurn[]): Promise<unknown[] | PhotoReadResult> {
    const response = await this.send(JSON.stringify(this.loopBody(turns)));
    if (!response.ok) return readFailure(SERVICE_UNAVAILABLE, response.status);
    return candidateParts(parseJson(await response.text())) ?? readFailure(COULD_NOT_READ);
  }

  /**
   * One turn that carries `functionCall` parts. Past the search cap no tool runs:
   * every pending call is answered empty for one further turn, so the model can
   * answer with the foods it already found instead of losing the whole estimate
   * — the empty answers offer no id, so the stranded foods take path 3.
   * Otherwise every call runs and is answered with its own result. Returns the
   * read's result when the loop is over, or null once the turn pair is appended.
   */
  private async answerCalls(
    turns: ConversationTurn[],
    parts: unknown[],
    calls: { id?: string; query: string }[],
    searchTool: SearchFood,
    state: SearchLoopState,
  ): Promise<PhotoReadResult | null> {
    if (state.searchesRun >= MAX_TOOL_ROUNDS) {
      if (state.exhaustedReplySent) return finishReading(parts);
      state.exhaustedReplySent = true;
      turns.push({ role: 'model', parts }, { role: 'user', parts: emptyAnswers(calls) });
      return null;
    }
    // Each result is remembered against its own query by the caller's closure
    // (`PhotoService.searchFoodAndRemember`), so every call keeps its own id
    // binding — no id crosses from one food's search onto another's.
    const answers = await runSearchTools(searchTool, calls, state.deadline);
    if (!answers) return readFailure(COULD_NOT_READ);
    state.searchesRun += calls.length;
    turns.push({ role: 'model', parts }, { role: 'user', parts: answers });
    return null;
  }

  private requestBody(image: PhotoImage, hint?: string): unknown {
    return {
      contents: [{ role: 'user', parts: this.firstParts(image, hint) }],
      generationConfig: generationConfig(),
    };
  }

  /**
   * One search-loop request: the conversation so far, the tool the model may
   * call, and the identity schema. The mode is `AUTO` on every round — no round
   * is forced — so the model decides when to search and when to answer, and
   * every request carries the schema the terminal text turn must satisfy.
   * Searching before answering is asked for by the prompt's per-food
   * instruction, not enforced by the API.
   */
  private loopBody(turns: ConversationTurn[]): unknown {
    return {
      contents: turns,
      tools: [{ functionDeclarations: [SEARCH_FOOD_DECLARATION] }],
      toolConfig: functionCallingConfig(),
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

/**
 * The one place a read failure is classified and recorded: the reason it
 * carries to the caller, and — when the API answered — its HTTP status. The
 * line holds no prompt, body, image, or key (rule 2). `GeminiClient` is not
 * DI-managed, but Nest's `Logger` works standalone; the class name is its
 * context.
 */
const logger = new Logger(GeminiClient.name);

function readFailure(reason: PhotoFailureReason, status?: number): PhotoReadResult {
  const detail = status === undefined ? '' : ` (HTTP ${status})`;
  logger.error(`photo estimate failed: ${reason}${detail}`);
  return { readable: false, reason };
}

/** The identity-only JSON shape the final text turn must satisfy. */
function generationConfig(): unknown {
  return { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
}

/**
 * The tool config for one search-loop request: mode `AUTO`, on every round. The
 * model is never forced to call the tool — it decides when to search and when
 * to answer, and the prompt's per-food instruction is what asks it to search
 * before answering.
 *
 * Forcing the call (`ANY`) is what the loop used to do on its first round, and
 * it cannot be paired with a response mime type: the live API answers 400
 * ("Forced function calling (ANY mode) with a response mime type:
 * 'application/json' is unsupported"). With `AUTO` every round carries the
 * identity schema, and the schema is what the terminal text turn must satisfy.
 */
function functionCallingConfig(): unknown {
  return { functionCallingConfig: { mode: 'AUTO' } };
}

/**
 * A candidate's `parts`, or null for a body that is not the documented
 * envelope (`candidates[].content.parts`). The text answer is found by
 * `finishReading`; the `functionCall` parts are found by `findToolCalls`.
 */
function candidateParts(envelope: unknown): unknown[] | null {
  const candidates = record(envelope)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = record(record(candidates[0])?.content)?.parts;
  return Array.isArray(parts) ? (parts as unknown[]) : null;
}

/**
 * The answer a terminal turn carries, or the photo's refusal — a `functionCall`
 * part reaching here is not an answer, and the model's own `readable: false`
 * or an empty/invalid items shape means the photo could not be read.
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
  if (text === null) return readFailure(COULD_NOT_READ);
  const items = readItems(parseJson(text));
  // `[]` covers the model's own `readable: false` — an empty suggestion is
  // the failure result, so there is no second way to express "no answer".
  return items === null || items.length === 0 ? readFailure(COULD_NOT_READ) : { readable: true, items };
}

/**
 * Every `functionCall` part in the turn, in order (Task 2's termination: no
 * such part ends the loop). A turn may carry several — one per food — and each
 * is answered with its own `functionResponse`.
 */
function findToolCalls(parts: unknown[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const part of parts) {
    const call = record(record(part)?.functionCall);
    if (call) found.push(call);
  }
  return found;
}

/**
 * One `functionCall` validated: ours, with a usable `args.query`. Anything else
 * — another name, a missing query — is a bad envelope, the one failure. The
 * `id` rides back on the matching `functionResponse`.
 */
function readToolCall(call: Record<string, unknown>): { id?: string; query: string } | null {
  if (call.name !== SEARCH_TOOL_NAME) return null;
  const query = record(call.args)?.query;
  if (typeof query !== 'string' || query.trim() === '') return null;
  return typeof call.id === 'string' ? { id: call.id, query } : { query };
}

/**
 * Every call in the turn, validated. One bad call fails the whole turn with the
 * single failure — a turn is answered whole or not at all, never in part.
 */
function readToolCalls(
  rawCalls: Record<string, unknown>[],
): { id?: string; query: string }[] | null {
  const calls: { id?: string; query: string }[] = [];
  for (const raw of rawCalls) {
    const call = readToolCall(raw);
    if (!call) return null;
    calls.push(call);
  }
  return calls;
}

/**
 * Run every search of the turn, in order, answering each call with its own
 * id-matched result. A tool that throws (USDA 429, catalog error) answers null,
 * and the whole turn collapses to the could-not-read failure — a typed result,
 * never a hang.
 */
async function runSearchTools(
  searchTool: SearchFood,
  calls: { id?: string; query: string }[],
  deadline: number,
): Promise<unknown[] | null> {
  const answers: unknown[] = [];
  for (const call of calls) {
    const found = await runSearchTool(searchTool, call.query, deadline);
    if (!found) return null;
    answers.push(toolResultPart(call.id, found));
  }
  return answers;
}

/** Every pending call answered with the empty result: no search runs, so the turn costs no USDA call. */
function emptyAnswers(calls: { id?: string; query: string }[]): unknown[] {
  return calls.map((call) => toolResultPart(call.id, NO_SEARCH_RESULT));
}

/**
 * Run one search round. A tool that throws (USDA 429, catalog error) answers
 * null, and the loop collapses it to the could-not-read failure — a typed
 * result, never a hang. The remaining wall clock races the tool too, so a slow tool cannot
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
 * weight, two ids, and the query they came from. `fdcId` is an integer or null;
 * `foodId` and `searchQuery` are strings or null. No nutrient field is read
 * here because none is asked for.
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
  const { name, grams, foodId, fdcId, searchQuery } = item;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0) return null;
  if (typeof foodId !== 'string' && foodId !== null) return null;
  if (typeof fdcId !== 'number' && fdcId !== null) return null;
  if (fdcId !== null && !Number.isInteger(fdcId)) return null;
  if (typeof searchQuery !== 'string' && searchQuery !== null) return null;
  return { name, grams, foodId, fdcId, searchQuery };
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
