import { NUTRIENTS } from '@life/nutrition';
import { GeminiClient } from '../src/photo/gemini.client';
import {
  FakeGemini,
  geminiResponse,
  item,
  readablePayload,
} from './fake-gemini';

/**
 * The Gemini boundary (`SPEC-meal-service` Testing Strategy: "Gemini client: hint
 * passthrough, failure mapping, no key in output — unit, the risky external
 * boundary"). Driven entirely by `fake-gemini.ts`; no network call is made.
 *
 * The claims proved here are the ones the pipeline stands on: the hint reaches
 * the model as steering input, the request is addressed by env and not by a
 * hardcoded host, and *every* way the call can go wrong collapses onto a typed
 * failure owned by either the photo or the service — never a partial guess.
 */

const KEY = 'test-key-DO-NOT-LOG-7f3a';
const MODEL = 'test-model-id';
const BASE = 'https://gemini.test/v1beta';
const HINT = 'leftover from last night, in the blue bowl';
const MIME = 'image/jpeg';
const BYTES = Buffer.from('not really a photo', 'utf8');

const COULD_NOT_READ = { readable: false, reason: 'could-not-read' } as const;
const SERVICE_UNAVAILABLE = { readable: false, reason: 'service-unavailable' } as const;

function envOf(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { GEMINI_API_KEY: KEY, GEMINI_MODEL: MODEL, GEMINI_API_BASE: BASE, ...overrides };
}

function clientFor(fake: FakeGemini, env: NodeJS.ProcessEnv = envOf(), timeoutMs?: number) {
  return new GeminiClient(env, fake.handler, timeoutMs);
}

describe('GeminiClient', () => {
  it('sends the hint as a separate steering input alongside the image', async () => {
    const fake = new FakeGemini();
    const withHint = await clientFor(fake).readPhoto({ mimeType: MIME, bytes: BYTES }, HINT);
    expect(withHint.readable).toBe(true);

    const parts = fake.lastParts();
    const textParts = parts.filter((part) => typeof part.text === 'string').map((p) => p.text as string);
    expect(textParts).toHaveLength(2);
    // The hint rides in the request, labelled as steering — it cannot read as a
    // correction of an estimate that does not exist yet.
    expect(textParts[1]).toContain(HINT);
    expect(textParts[1]).toMatch(/steering|not a correction/i);

    // Without a hint the request is byte-identical in shape: no empty hint part.
    const bare = new FakeGemini();
    await clientFor(bare).readPhoto({ mimeType: MIME, bytes: BYTES });
    expect(bare.lastParts().filter((part) => typeof part.text === 'string')).toHaveLength(1);
    expect(JSON.stringify(bare.lastRequestBody())).not.toContain(HINT);
  });

  it('addresses the request as <GEMINI_API_BASE>/models/<GEMINI_MODEL>:generateContent', async () => {
    const fake = new FakeGemini();
    await clientFor(fake).readPhoto({ mimeType: MIME, bytes: BYTES });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${BASE}/models/${MODEL}:generateContent`);
    expect(fake.calls[0].init.method).toBe('POST');

    // Both coordinates are read from env: changing either moves the URL, which a
    // hardcoded host could not do.
    const other = new FakeGemini();
    await clientFor(
      other,
      envOf({ GEMINI_API_BASE: 'https://proxy.internal/genai', GEMINI_MODEL: 'other-model' }),
    ).readPhoto({ mimeType: MIME, bytes: BYTES });
    expect(other.calls[0].url).toBe('https://proxy.internal/genai/models/other-model:generateContent');
    expect(other.calls[0].url).not.toContain('googleapis.com');

    // A trailing slash on the base must not double up.
    const slashed = new FakeGemini();
    await clientFor(slashed, envOf({ GEMINI_API_BASE: `${BASE}/` })).readPhoto({
      mimeType: MIME,
      bytes: BYTES,
    });
    expect(slashed.calls[0].url).toBe(`${BASE}/models/${MODEL}:generateContent`);
  });

  it('returns the read foods when the answer satisfies the schema', async () => {
    const fake = new FakeGemini();
    const result = await clientFor(fake).readPhoto({ mimeType: MIME, bytes: BYTES });
    expect(result).toEqual({ readable: true, items: [item()] });

    // The model's answer carries identity only: a name, a weight, and the two
    // ids it chose (here: neither). A chosen id — a catalog string, a USDA
    // integer — rides through unchanged.
    const identified = new FakeGemini();
    identified.reply = () =>
      geminiResponse({ readable: true, items: [{ ...item(), foodId: 'food-1', fdcId: 12345 }] });
    expect(await clientFor(identified).readPhoto({ mimeType: MIME, bytes: BYTES })).toEqual({
      readable: true,
      items: [{ name: 'Chicken salad', grams: 250, foodId: 'food-1', fdcId: 12345 }],
    });
  });

  it('asks for identity only: the request body names no nutrient field', async () => {
    const fake = new FakeGemini();
    await clientFor(fake).readPhoto({ mimeType: MIME, bytes: BYTES });

    // The schema's item asks for exactly the four identity fields — the model
    // cannot answer a field the schema does not request.
    const body = fake.lastRequestBody() as {
      generationConfig: {
        responseSchema: {
          properties: { items: { items: { properties: Record<string, unknown>; required: string[] } } };
        };
      };
    };
    const itemSchema = body.generationConfig.responseSchema.properties.items.items;
    expect(Object.keys(itemSchema.properties).sort()).toEqual(['fdcId', 'foodId', 'grams', 'name']);
    expect([...itemSchema.required].sort()).toEqual(['fdcId', 'foodId', 'grams', 'name']);

    // Not one of the 27 nutrient keys appears anywhere in the request.
    const serialised = JSON.stringify(body);
    for (const { key } of NUTRIENTS) expect(serialised).not.toContain(key);
  });

  it('classifies each failure by its owner: the service for non-2xx and timeout, the photo for a bad body', async () => {
    const readWith = async (fake: FakeGemini, timeoutMs?: number) =>
      clientFor(fake, envOf(), timeoutMs).readPhoto({ mimeType: MIME, bytes: BYTES });

    // 1. non-2xx — the service failing to answer (rate limit, bad key, block).
    const rejected = new FakeGemini();
    rejected.reply = () => geminiResponse(readablePayload(), 429);
    const on429 = await readWith(rejected);
    expect(on429).toEqual(SERVICE_UNAVAILABLE);

    // 2. timeout — the request outlives the deadline and is aborted.
    const hanging = new FakeGemini();
    hanging.reply = (call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const onTimeout = await readWith(hanging, 5);
    expect(onTimeout).toEqual(SERVICE_UNAVAILABLE);

    // 3. schema violations — six shapes of "do not guess", one result.
    const violating: unknown[] = [
      { readable: true, items: [{ ...item(), fdcId: 123.5 }] },
      { readable: true, items: [{ ...item(), foodId: 12 }] },
      { readable: true, items: [{ ...item(), grams: '250 g' }] },
      { readable: true, items: [{ ...item(), grams: -1 }] },
      { readable: true, items: [{ ...item(), grams: Infinity }] },
      { readable: true, items: [] },
    ];
    for (const payload of violating) {
      const fake = new FakeGemini();
      fake.reply = () => geminiResponse(payload);
      expect(await readWith(fake)).toEqual(COULD_NOT_READ);
    }

    // An envelope that is not the documented shape, and a model that says it
    // could not read the photo, land on the same result too.
    const notAnEnvelope = new FakeGemini();
    notAnEnvelope.reply = () => new Response('{"items":[]}', { status: 200 });
    expect(await readWith(notAnEnvelope)).toEqual(COULD_NOT_READ);

    const refused = new FakeGemini();
    refused.reply = () => geminiResponse({ readable: false, items: [] });
    expect(await readWith(refused)).toEqual(COULD_NOT_READ);
  });

  it('keeps the key and the image bytes out of the URL and out of every log line', async () => {
    const fake = new FakeGemini();
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      }),
    );

    try {
      const ok = await clientFor(fake).readPhoto({ mimeType: MIME, bytes: BYTES }, HINT);
      const failing = new FakeGemini();
      failing.reply = () => geminiResponse(null, 500);
      const failed = await clientFor(failing).readPhoto({ mimeType: MIME, bytes: BYTES }, HINT);

      // The key rides in a header — never in the URL, which proxies and access
      // logs would otherwise capture.
      const headers = fake.calls[0].init.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe(KEY);
      expect(fake.calls[0].url).not.toContain(KEY);

      // Nothing observable carries the key or the image.
      const observable = [
        JSON.stringify(ok),
        JSON.stringify(failed),
        fake.calls[0].url,
        logs.join('\n'),
      ].join('\n');
      expect(observable).not.toContain(KEY);
      expect(observable).not.toContain(BYTES.toString('base64'));
      expect(logs.join('\n')).not.toContain(HINT);

      // The image is inlined in the body (that is how the model sees it) and
      // nowhere else.
      expect(JSON.stringify(fake.lastRequestBody())).toContain(BYTES.toString('base64'));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('fails closed at construction when a coordinate is missing', () => {
    for (const missing of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_API_BASE'] as const) {
      const env = envOf();
      delete env[missing];
      expect(() => new GeminiClient(env, new FakeGemini().handler)).toThrow(missing);
      expect(() => new GeminiClient(env, new FakeGemini().handler)).not.toThrow(KEY);
    }
  });

  it('rejects an unsupported image type without calling the API', async () => {
    const fake = new FakeGemini();
    const result = await clientFor(fake).readPhoto({ mimeType: 'image/tiff', bytes: BYTES });
    expect(result).toEqual(COULD_NOT_READ);
    expect(fake.calls).toHaveLength(0);
  });
});