import type { GeminiTransport } from '../src/photo/gemini.client';

/**
 * Test double for the Gemini HTTP transport (`SPEC-meal-service` Testing
 * Strategy: "No live Gemini call in tests — `fake-gemini.ts` mirrors
 * `test/fake-redis.ts`"). It implements only the `fetch` surface the client
 * uses (`ok`, `status`, `text`) with the real `Response`, records the request it
 * was handed, and lets a test script the reply — so every failure branch can be
 * driven without a network.
 */
export interface GeminiCall {
  url: string;
  init: RequestInit;
}

export class FakeGemini {
  readonly calls: GeminiCall[] = [];

  /** Default: a readable answer, one identified food. */
  reply: (call: GeminiCall) => Promise<Response> | Response = () =>
    geminiResponse(readablePayload());

  /** `fetch`-compatible handler to pass to `new GeminiClient(env, fake.handler)`. */
  readonly handler: GeminiTransport = (url, init) => {
    const call: GeminiCall = { url: String(url), init: init ?? {} };
    this.calls.push(call);
    return Promise.resolve(this.reply(call));
  };

  /** Parsed JSON of the most recent request body, for assertions on what was sent. */
  lastRequestBody(): Record<string, unknown> {
    const call = this.calls[this.calls.length - 1];
    return JSON.parse(String(call?.init.body ?? '')) as Record<string, unknown>;
  }

  /** The `parts` array of the most recent request. */
  lastParts(): Array<Record<string, unknown>> {
    const contents = (this.lastRequestBody() as { contents?: Array<{ parts?: unknown }> }).contents;
    return (contents?.[0]?.parts ?? []) as Array<Record<string, unknown>>;
  }
}

/** Wrap a model JSON payload in the API's response envelope, as a real `Response`. */
export function geminiResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
    { status },
  );
}

/** A model answer that read the photo. */
export function readablePayload(): unknown {
  return { readable: true, items: [item()] };
}

/** One identified food — identity only (`PhotoFoodSuggestion`). No nutrient
 * field: the model answers identity, the backend resolves numbers (Task 8).
 */
export function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Chicken salad',
    grams: 250,
    foodId: null,
    fdcId: null,
    ...overrides,
  };
}
