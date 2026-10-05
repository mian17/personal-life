import { NotFoundException } from '@nestjs/common';
import { completeVector, zeroVector } from '../src/foods/content';
import { FoodsService, type FoodDto } from '../src/foods/foods.service';
import { GeminiClient, type SearchFoodResult } from '../src/photo/gemini.client';
import { PhotoService } from '../src/photo/photo.service';
import { UsdaClient, type UsdaTransport } from '../src/usda/usda.client';
import { FakeGemini, geminiResponse, item, type GeminiCall } from './fake-gemini';

/**
 * Task 8's three-path resolution (`SPEC-photo-identity.md` § Resolution), driven
 * straight through `PhotoService.estimate` — no HTTP, no network: Gemini is the
 * `FakeGemini` transport, USDA is a scripted transport, and the catalog is a
 * plain in-memory stand-in for `FoodsService`.
 *
 * The claims proved here are the ones the pipeline stands on:
 *
 * - an estimate **writes nothing** — `create` is never called and the catalog
 *   list is unchanged after resolving;
 * - a carried catalog `foodId` reads the row's own vector through
 *   `FoodsService.findOne` and spends **zero** USDA calls;
 * - the search closure is **catalog-first** — a catalog hit reaches USDA zero
 *   times, a miss exactly once with the caller's dataType pair, and the tool
 *   result handed to the model carries names and ids only;
 * - the service is built without a USDA key: the client factory is a thunk,
 *   so nothing env-failing runs at construction.
 */

const VALID_SUB = 'user-a';
const IMAGE_B64 = Buffer.from('photo-bytes-not-a-real-meal-7f3a9c', 'utf8').toString('base64');
const MIME = 'image/jpeg';
const HINT = 'leftover from last night';

const USDA_KEY = 'test-usda-key-DO-NOT-LOG-7f3a';
const USDA_BASE = 'https://usda.test/fdc';
const FDC_ID = 170379;

const geminiEnv = (): NodeJS.ProcessEnv => ({
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_MODEL: 'test-model-id',
  GEMINI_API_BASE: 'https://gemini.test/v1beta',
});

/**
 * The catalog, as an in-memory stand-in for the parts of `FoodsService` the
 * estimate uses. `create` is present only to be asserted against: a resolution
 * must never reach for it.
 */
class FakeFoods {
  readonly createCalls: unknown[][] = [];

  constructor(readonly rows: FoodDto[] = []) {}

  async findAll(_sub: string, query?: string): Promise<FoodDto[]> {
    if (!query) return this.rows;
    return this.rows.filter((food) => food.name.toLowerCase().includes(query.toLowerCase()));
  }

  async findOne(_sub: string, id: string): Promise<FoodDto> {
    const row = this.rows.find((food) => food.id === id);
    if (!row) throw new NotFoundException('Food not found');
    return row;
  }

  async create(...args: unknown[]): Promise<never> {
    this.createCalls.push(args);
    throw new Error('an estimate must never create a catalog food');
  }
}

/** Injected USDA transport: records each request and replies with a scripted body. */
class FakeUsda {
  readonly calls: { url: string; init: RequestInit }[] = [];
  reply: () => Response = () => usdaResponse({ foods: [] });

  readonly handler: UsdaTransport = (url, init) => {
    this.calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(this.reply());
  };

  lastParams(): URLSearchParams {
    return new URL(this.calls[this.calls.length - 1].url).searchParams;
  }
}

function usdaResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

/** A catalog food wire shape with the fields the estimate reads filled in. */
function foodDto(overrides: Partial<FoodDto> & Pick<FoodDto, 'id' | 'name'>): FoodDto {
  return {
    servingGrams: 100,
    nutrients: zeroVector(),
    servings: [],
    version: 0,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

/** A search body in the live shape: `description` is the name, `foodNutrients` is never read. */
function searchPayload(): unknown {
  return {
    totalHits: 1,
    foods: [{ fdcId: FDC_ID, description: 'Broccoli, raw', dataType: 'SR Legacy', score: 1 }],
  };
}

/** A fetch-by-id body in the live shape: nested `nutrient`, top-level `amount`. */
function foodPayload(): unknown {
  return {
    fdcId: FDC_ID,
    description: 'Broccoli, raw',
    foodNutrients: [
      { nutrient: { number: '208', unitName: 'kcal' }, amount: 34.0 },
      { nutrient: { number: '204', unitName: 'g' }, amount: 0.37 },
      { nutrient: { number: '307', unitName: 'mg' }, amount: 33.0 },
    ],
  };
}

function serviceFor(
  foods: FakeFoods,
  gemini: FakeGemini,
  usda: FakeUsda,
  usdaEnv: NodeJS.ProcessEnv = { USDA_API_KEY: USDA_KEY, USDA_API_BASE: USDA_BASE },
): PhotoService {
  return new PhotoService(
    () => new GeminiClient(geminiEnv(), gemini.handler),
    () => new UsdaClient(usdaEnv, usda.handler),
    foods as unknown as FoodsService,
  );
}

/** A model answer that read the photo, one food carrying the given identity. */
function readableWith(overrides: Record<string, unknown>): Response {
  return geminiResponse({ readable: true, items: [item(overrides)] });
}

/** A `functionCall` turn asking the catalog-first tool for `query`. */
function toolCallTurn(query: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'search_food', args: { query }, id: 'call-1' } }],
          },
        },
      ],
    }),
  );
}

/** True when this request already carries our tool's answer — the turn to reply with JSON. */
function alreadyAnswered(call: GeminiCall): boolean {
  const body = JSON.parse(String(call.init.body)) as {
    contents?: { parts?: { functionResponse?: unknown }[] }[];
  };
  return (body.contents ?? []).some((turn) =>
    (turn.parts ?? []).some((part) => part.functionResponse !== undefined),
  );
}

/** The `functionResponse` payload the service handed back to the model on the second turn. */
function toolResultSent(gemini: FakeGemini): SearchFoodResult {
  const body = JSON.parse(String(gemini.calls[1].init.body)) as {
    contents: { parts: { functionResponse?: { response: SearchFoodResult } }[] }[];
  };
  for (const turn of body.contents) {
    for (const part of turn.parts) {
      if (part.functionResponse) return part.functionResponse.response;
    }
  }
  throw new Error('no functionResponse was sent to the model');
}

describe('PhotoService — an estimate writes nothing', () => {
  it('creates no Food: after resolving, the catalog list is unchanged', async () => {
    const foods = new FakeFoods([foodDto({ id: 'food-1', name: 'Chicken' })]);
    const gemini = new FakeGemini();
    gemini.reply = () => readableWith({ name: 'Chicken', grams: 200, foodId: 'food-1', fdcId: null });
    const photo = serviceFor(foods, gemini, new FakeUsda());

    await photo.estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(foods.createCalls).toHaveLength(0);
    expect(foods.rows).toEqual([foodDto({ id: 'food-1', name: 'Chicken' })]);
  });
});

describe('PhotoService — the three paths', () => {
  it('resolves a catalog foodId through findOne and makes zero USDA calls', async () => {
    const stored = completeVector({ ...zeroVector(), calories: 165 });
    const foods = new FakeFoods([
      foodDto({ id: 'food-1', name: 'Chicken', servingGrams: 150, nutrients: stored }),
    ]);
    const gemini = new FakeGemini();
    gemini.reply = () => readableWith({ name: 'Chicken', grams: 200, foodId: 'food-1', fdcId: null });
    const usda = new FakeUsda();

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result).toEqual({
      readable: true,
      items: [
        { name: 'Chicken', grams: 200, foodId: 'food-1', fdcId: null, servingGrams: 150, nutrients: stored },
      ],
    });
    expect(usda.calls).toHaveLength(0);
    expect(foods.createCalls).toHaveLength(0);
  });

  it('resolves a bare fdcId from USDA per 100 g and writes nothing', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = () => usdaResponse(foodPayload());
    const gemini = new FakeGemini();
    gemini.reply = () => readableWith({ name: 'Broccoli, raw', grams: 150, foodId: null, fdcId: FDC_ID });

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(usda.calls).toHaveLength(1);
    expect(usda.calls[0].url.startsWith(`${USDA_BASE}/v1/food/${FDC_ID}?`)).toBe(true);
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].foodId).toBeNull();
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients.calories).toBe(34);
    expect(result.items[0].nutrients.fat).toBe(0.37);
    expect(foods.createCalls).toHaveLength(0);
  });

  it.each([
    ['rate-limited', 429],
    ['not-found', 404],
  ])('fails open to the absent vector when the fdcId lookup is %s', async (_reason, status) => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = () => usdaResponse({}, status);
    const gemini = new FakeGemini();
    gemini.reply = () => readableWith({ name: 'Broccoli, raw', grams: 150, foodId: null, fdcId: FDC_ID });

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // A USDA outage costs the nutrient numbers and nothing else: the answer is
    // still a readable estimate carrying the food, the way path 3 states it.
    expect(usda.calls).toHaveLength(1);
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Broccoli, raw');
    expect(result.items[0].grams).toBe(150);
    expect(result.items[0].foodId).toBeNull();
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients).toEqual(zeroVector());
    expect(foods.createCalls).toHaveLength(0);
  });

  it('resolves the absent vector when the model names no id', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    const gemini = new FakeGemini(); // default payload: foodId null, fdcId null

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result).toEqual({
      readable: true,
      items: [
        {
          name: 'Chicken salad',
          grams: 250,
          foodId: null,
          fdcId: null,
          servingGrams: 100,
          nutrients: zeroVector(),
        },
      ],
    });
    expect(usda.calls).toHaveLength(0);
  });

  it('fails open to the absent vector when a carried foodId no longer exists', async () => {
    const foods = new FakeFoods();
    const gemini = new FakeGemini();
    gemini.reply = () => readableWith({ name: 'Chicken', grams: 200, foodId: 'gone', fdcId: null });

    const result = await serviceFor(foods, gemini, new FakeUsda()).estimate(
      VALID_SUB,
      IMAGE_B64,
      MIME,
      HINT,
    );

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients).toEqual(zeroVector());
  });
});

describe('PhotoService — failure reasons name the layer that failed', () => {
  it('answers service-unavailable when the photo API rejects the call (402, the real case)', async () => {
    const fake = new FakeGemini();
    fake.reply = () => new Response(JSON.stringify({ error: { code: 402, status: 'RESOURCE_EXHAUSTED' } }), { status: 402 });
    const photo = serviceFor(new FakeFoods(), fake, new FakeUsda());

    const result = await photo.estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result).toEqual({ readable: false, reason: 'service-unavailable' });
  });

  it('answers service-unavailable when the transport throws before answering', async () => {
    const fake = new FakeGemini();
    fake.reply = () => Promise.reject(new Error('fetch failed'));
    const photo = serviceFor(new FakeFoods(), fake, new FakeUsda());

    const result = await photo.estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result).toEqual({ readable: false, reason: 'service-unavailable' });
  });

  it('answers could-not-read when the model answers its own readable:false', async () => {
    const fake = new FakeGemini();
    fake.reply = () => geminiResponse({ readable: false, items: [] });
    const photo = serviceFor(new FakeFoods(), fake, new FakeUsda());

    const result = await photo.estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result).toEqual({ readable: false, reason: 'could-not-read' });
  });
});

describe('PhotoService — the search closure is catalog-first', () => {
  it('reaches USDA zero times on a catalog hit, with names and ids only', async () => {
    const foods = new FakeFoods([foodDto({ id: 'food-1', name: 'Chicken', servingGrams: 120 })]);
    const usda = new FakeUsda();
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call) ? readableWith({ name: 'Chicken', grams: 200, foodId: 'food-1' }) : toolCallTurn('chicken');

    await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(usda.calls).toHaveLength(0);
    expect(toolResultSent(gemini)).toEqual({
      catalog: [{ id: 'food-1', name: 'Chicken', servingGrams: 120 }],
      usda: [],
    });
  });

  it('reaches USDA exactly once, with the caller’s dataType pair, on a catalog miss', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = () => usdaResponse(searchPayload());
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call) ? readableWith({ name: 'Broccoli, raw', grams: 150 }) : toolCallTurn('broccoli');

    await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(usda.calls).toHaveLength(1);
    expect(usda.lastParams().getAll('dataType[]')).toEqual(['Foundation', 'SR Legacy']);
    expect(usda.lastParams().get('query')).toBe('broccoli');
    expect(usda.calls[0].url.startsWith(`${USDA_BASE}/v1/foods/search?`)).toBe(true);

    const toolResult = toolResultSent(gemini);
    expect(toolResult).toEqual({ catalog: [], usda: [{ name: 'Broccoli, raw', fdcId: FDC_ID }] });
    // Names and ids only: the search body's nutrient rows never reach the model.
    expect(JSON.stringify(toolResult)).not.toContain('nutrient');
  });
});

describe('PhotoService — boot is independent of USDA config', () => {
  it('constructs without a USDA key, and builds the client only when a lookup needs one', async () => {
    const envWithoutKey: NodeJS.ProcessEnv = { USDA_API_BASE: USDA_BASE };
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    const gemini = new FakeGemini();

    // The factory throws only if it is *run* — construction itself must not run it.
    expect(() => serviceFor(foods, gemini, usda, envWithoutKey)).not.toThrow();

    // A read that needs no USDA lookup never runs the factory, so it never throws.
    const result = await serviceFor(foods, gemini, usda, envWithoutKey).estimate(
      VALID_SUB,
      IMAGE_B64,
      MIME,
      HINT,
    );
    expect(result.readable).toBe(true);
  });
});
