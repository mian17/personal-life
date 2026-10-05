import { NUTRIENTS } from '@life/nutrition';
import { UsdaClient, type UsdaTransport } from '../src/usda/usda.client';

/**
 * The USDA boundary (`docs/specs/SPEC-usda-source.md`). Fixtures copy the two
 * live shapes from the samples Task 1 kept (`/tmp/opencode/usda-search.json`,
 * `/tmp/opencode/usda-food.json`): search rows carry `description` + `fdcId`
 * plus flat nutrient rows we never read; fetch-by-id rows are the nested shape
 * with a top-level `amount` that the mapper accepts.
 *
 * The claims proved here are the ones the pipeline stands on: the caller's
 * `dataType` pair rides out as `dataType[]`, the key never reaches any captured
 * output (it rides in the query string, so a logged URL would be a leaked key),
 * a `429` is one `rate-limited` with no retry, and every other way the call can
 * go wrong lands on one typed reason instead of a partial vector.
 */

const KEY = 'test-usda-key-DO-NOT-LOG-7f3a';
const BASE = 'https://usda.test/fdc';
const FDC_ID = 170379;

const UNAVAILABLE = { ok: false, reason: 'unavailable' } as const;
const RATE_LIMITED = { ok: false, reason: 'rate-limited' } as const;
const NOT_FOUND = { ok: false, reason: 'not-found' } as const;

function envOf(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { USDA_API_KEY: KEY, USDA_API_BASE: BASE, ...overrides };
}

interface UsdaCall {
  url: string;
  init: RequestInit;
}

/** Injected transport: records each request and replies with a scripted body. */
class FakeUsda {
  readonly calls: UsdaCall[] = [];
  reply: (call: UsdaCall) => Promise<Response> | Response = () => usdaResponse(searchPayload());

  readonly handler: UsdaTransport = (url, init) => {
    const call: UsdaCall = { url: String(url), init: init ?? {} };
    this.calls.push(call);
    return Promise.resolve(this.reply(call));
  };

  /** Parsed query of the most recent request — the params the API sees. */
  lastParams(): URLSearchParams {
    const call = this.calls[this.calls.length - 1];
    return new URL(call.url).searchParams;
  }
}

function usdaResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function clientFor(fake: FakeUsda, env: NodeJS.ProcessEnv = envOf(), timeoutMs?: number) {
  return new UsdaClient(env, fake.handler, timeoutMs);
}

/** A search body in the live shape: `description` is the name, plus flat rows we never read. */
function searchPayload(): unknown {
  return {
    totalHits: 1,
    foods: [
      {
        fdcId: FDC_ID,
        description: 'Broccoli, raw',
        dataType: 'SR Legacy',
        score: 371.21582,
        foodNutrients: [
          { nutrientId: 1292, nutrientNumber: '645', nutrientName: 'Fatty acids, total monounsaturated', unitName: 'G', value: 0.031 },
        ],
      },
    ],
  };
}

/** A fetch-by-id body in the live shape: nested `nutrient`, top-level `amount`. */
function foodPayload(): unknown {
  return {
    fdcId: FDC_ID,
    description: 'Broccoli, raw',
    foodNutrients: [
      { nutrient: { id: 2045, number: '951', name: 'Proximates', rank: 50, unitName: 'g' }, type: 'FoodNutrient' },
      { nutrient: { id: 1008, number: '208', name: 'Energy', rank: 300, unitName: 'kcal' }, amount: 34.0, type: 'FoodNutrient' },
      { nutrient: { id: 1004, number: '204', name: 'Total lipid (fat)', rank: 800, unitName: 'g' }, amount: 0.37, type: 'FoodNutrient' },
      { nutrient: { id: 1093, number: '307', name: 'Sodium, Na', rank: 600, unitName: 'mg' }, amount: 33.0, type: 'FoodNutrient' },
      { nutrient: { id: 1062, number: '268', name: 'Energy', rank: 400, unitName: 'kJ' }, amount: 141.0, type: 'FoodNutrient' },
    ],
  };
}

describe('UsdaClient — the caller decides which data types to search', () => {
  it('sends the caller’s dataType pair as the FDC dataType[] params', async () => {
    const fake = new FakeUsda();
    await clientFor(fake).usda_search('broccoli', ['Foundation', 'SR Legacy']);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].init.method).toBe('GET');
    expect(fake.lastParams().getAll('dataType[]')).toEqual(['Foundation', 'SR Legacy']);
    expect(fake.lastParams().get('query')).toBe('broccoli');
    expect(fake.calls[0].url.startsWith(`${BASE}/v1/foods/search?`)).toBe(true);

    // The pair is a caller-supplied parameter, not a constant in the client:
    // the type locks it to exactly this pair, and it rides out as dataType[].

    // Both coordinates come from env, and a trailing slash must not double up.
    const moved = new FakeUsda();
    await clientFor(moved, envOf({ USDA_API_BASE: 'https://proxy.internal/fdc/' })).usda_search(
      'chicken',
      ['Foundation', 'SR Legacy'],
    );
    expect(moved.calls[0].url.startsWith('https://proxy.internal/fdc/v1/foods/search?')).toBe(true);
  });

  it('returns search candidates as names and ids only', async () => {
    const fake = new FakeUsda();
    const result = await clientFor(fake).usda_search('broccoli', ['Foundation', 'SR Legacy']);

    expect(result).toEqual({
      ok: true,
      candidates: [{ name: 'Broccoli, raw', fdcId: FDC_ID }],
    });
    // Search's flat nutrient rows are never read: the candidate carries no amount.
    expect(JSON.stringify(result)).not.toContain('nutrient');
  });
});

describe('UsdaClient — one food becomes our vector', () => {
  it('fetches by fdcId and maps the nested rows into a complete vector', async () => {
    const fake = new FakeUsda();
    fake.reply = () => usdaResponse(foodPayload());

    const result = await clientFor(fake).fetchByFdcId(FDC_ID);

    expect(fake.calls[0].url.startsWith(`${BASE}/v1/food/${FDC_ID}?`)).toBe(true);
    if (!result.ok) throw new Error(`expected a vector, got ${result.reason}`);
    expect(result.vector.calories).toBe(34);
    expect(result.vector.fat).toBe(0.37);
    expect(result.vector.sodium).toBe(33);
    expect(Object.keys(result.vector)).toHaveLength(NUTRIENTS.length);
    // The Proximates group row carries no amount and the kJ energy row is not
    // ours: neither moved a number, which is the mapper's rule, not a second one.
    expect(result.vector.vitaminC).toBe(0);
  });
});

describe('UsdaClient — every failure is one failure', () => {
  it('turns a 429 into rate-limited without a second request', async () => {
    const fake = new FakeUsda();
    fake.reply = () => usdaResponse({ error: { message: 'rate limit exceeded' } }, 429);

    expect(await clientFor(fake).fetchByFdcId(FDC_ID)).toEqual(RATE_LIMITED);
    expect(await clientFor(fake).usda_search('broccoli', ['Foundation', 'SR Legacy'])).toEqual(RATE_LIMITED);
    // One request each. A retry would extend the key's one-hour block.
    expect(fake.calls).toHaveLength(2);
  });

  it('collapses a non-2xx, a 404, a malformed body, and a transport error into typed reasons', async () => {
    const rejected = new FakeUsda();
    rejected.reply = () => usdaResponse({}, 500);
    expect(await clientFor(rejected).fetchByFdcId(FDC_ID)).toEqual(UNAVAILABLE);
    expect(await clientFor(rejected).usda_search('broccoli', ['Foundation', 'SR Legacy'])).toEqual(UNAVAILABLE);

    const missing = new FakeUsda();
    missing.reply = () => usdaResponse({}, 404);
    expect(await clientFor(missing).fetchByFdcId(FDC_ID)).toEqual(NOT_FOUND);

    // Bodies that are not the documented envelope are the same unavailable —
    // never a vector assembled from nothing.
    for (const payload of [{}, { foodNutrients: 'none' }, { foods: 'none' }]) {
      const malformed = new FakeUsda();
      malformed.reply = () => usdaResponse(payload);
      expect(await clientFor(malformed).fetchByFdcId(FDC_ID)).toEqual(UNAVAILABLE);
    }
    const searchMalformed = new FakeUsda();
    searchMalformed.reply = () => usdaResponse({ foods: [{ description: 'Broccoli' }] });
    expect(await clientFor(searchMalformed).usda_search('broccoli', ['Foundation', 'SR Legacy'])).toEqual(UNAVAILABLE);

    // A food USDA described in rows we cannot map is the mapper's own verdict.
    const noReadableRows = new FakeUsda();
    noReadableRows.reply = () =>
      usdaResponse({
        foodNutrients: [{ nutrient: { number: '951', name: 'Proximates', unitName: 'g' }, type: 'FoodNutrient' }],
      });
    expect(await clientFor(noReadableRows).fetchByFdcId(FDC_ID)).toEqual({ ok: false, reason: 'unmapped' });

    // A hung connection is a failure, not an estimate that never returns.
    const hanging = new FakeUsda();
    hanging.reply = () =>
      new Promise<Response>((_resolve, reject) => {
        hanging.calls[0].init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(await clientFor(hanging, envOf(), 5).fetchByFdcId(FDC_ID)).toEqual(UNAVAILABLE);

    // A transport that throws outright is the same reason.
    const broken = new FakeUsda();
    broken.reply = () => {
      throw new Error('network down');
    };
    expect(await clientFor(broken).fetchByFdcId(FDC_ID)).toEqual(UNAVAILABLE);
  });

  it('keeps the key out of every captured error, result, and log line', async () => {
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      }),
    );

    try {
      const working = new FakeUsda();
      const found = await clientFor(working).usda_search('broccoli', ['Foundation', 'SR Legacy']);
      const resolving = new FakeUsda();
      resolving.reply = () => usdaResponse(foodPayload());
      const vector = await clientFor(resolving).fetchByFdcId(FDC_ID);
      const limited = new FakeUsda();
      limited.reply = () => usdaResponse({}, 429);
      const on429 = await clientFor(limited).fetchByFdcId(FDC_ID);
      const failing = new FakeUsda();
      failing.reply = () => usdaResponse({}, 500);
      const on500 = await clientFor(failing).fetchByFdcId(FDC_ID);

      // The key rides in the query string — the API's own `in: query` auth — so
      // the URL is exactly what must never be logged or reported.
      expect(working.lastParams().get('api_key')).toBe(KEY);
      const observable = [
        JSON.stringify(found),
        JSON.stringify(vector),
        JSON.stringify(on429),
        JSON.stringify(on500),
        logs.join('\n'),
      ].join('\n');
      expect(observable).not.toContain(KEY);
      // A returned reason never names the host either.
      expect(JSON.stringify(on500)).not.toContain(BASE);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('fails closed at construction without a key, naming the variable not its value', () => {
    const env = envOf();
    delete env.USDA_API_KEY;
    expect(() => new UsdaClient(env, new FakeUsda().handler)).toThrow('USDA_API_KEY');
    expect(() => new UsdaClient(env, new FakeUsda().handler)).not.toThrow(KEY);
  });
});
