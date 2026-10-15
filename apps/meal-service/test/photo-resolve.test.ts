import { NotFoundException } from '@nestjs/common';
import { completeVector, zeroVector } from '../src/foods/content';
import { FoodsService, type FoodDto } from '../src/foods/foods.service';
import { GeminiClient, MAX_TOOL_ROUNDS, type SearchFoodResult } from '../src/photo/gemini.client';
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
const OTHER_FDC_ID = 999999;
const BEANS_FDC_ID = 111222;
const CHICKEN_CALORIES = 165;
const RICE_CALORIES = 130;
const BEANS_CALORIES = 88;

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
  reply: (call: { url: string }) => Response = () => usdaResponse({ foods: [] });

  readonly handler: UsdaTransport = (url, init) => {
    const call = { url: String(url) };
    this.calls.push({ url: call.url, init: init ?? {} });
    return Promise.resolve(this.reply(call));
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
function searchPayload(fdcId = FDC_ID, description = 'Broccoli, raw'): unknown {
  return {
    totalHits: 1,
    foods: [{ fdcId, description, dataType: 'SR Legacy', score: 1 }],
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

/** A fetch-by-id body carrying one calorie amount, so two foods resolve distinct vectors. */
function nutrientPayload(fdcId: number, calories: number): unknown {
  return {
    fdcId,
    description: 'food',
    foodNutrients: [{ nutrient: { number: '208', unitName: 'kcal' }, amount: calories }],
  };
}

/**
 * A USDA batch body tagged per food: each requested id maps to its own calorie
 * amount, so one list carries every food the estimate resolves.
 */
function batchPayload(fdcIds: readonly number[]): unknown {
  return fdcIds.map((fdcId) => nutrientPayload(fdcId, caloriesFor(fdcId)));
}

/** The calorie amount a scripted `fdcId` resolves to, so two foods' vectors differ. */
function caloriesFor(fdcId: number): number {
  if (fdcId === FDC_ID) return CHICKEN_CALORIES;
  if (fdcId === OTHER_FDC_ID) return RICE_CALORIES;
  return BEANS_CALORIES;
}

/**
 * A USDA transport serving three foods: a search offers the `fdcId` scripted
 * for its query (`chicken` -> `FDC_ID`, `rice` -> `OTHER_FDC_ID`, `beans` ->
 * `BEANS_FDC_ID`), and the batch endpoint answers every requested id with its
 * own calorie amount.
 */
function serveThreeFoodsFromUsda(usda: FakeUsda): void {
  usda.reply = (call) => {
    const url = new URL(call.url);
    if (url.pathname.endsWith('/v1/foods')) {
      return usdaResponse(batchPayload(url.searchParams.getAll('fdcIds').map(Number)));
    }
    const query = url.searchParams.get('query') ?? '';
    return usdaResponse(searchPayload(query === 'chicken' ? FDC_ID : query === 'rice' ? OTHER_FDC_ID : BEANS_FDC_ID, query));
  };
}

/**
 * A USDA transport serving two foods: a search offers the `fdcId` scripted for
 * its query (`chicken` -> `FDC_ID`, anything else -> `OTHER_FDC_ID`), and the
 * batch endpoint answers every requested id with its own calorie amount.
 */
function serveTwoFoodsFromUsda(usda: FakeUsda): void {
  usda.reply = (call) => {
    const url = new URL(call.url);
    if (url.pathname.endsWith('/v1/foods')) {
      return usdaResponse(batchPayload(url.searchParams.getAll('fdcIds').map(Number)));
    }
    const query = url.searchParams.get('query') ?? '';
    return usdaResponse(searchPayload(query === 'chicken' ? FDC_ID : OTHER_FDC_ID, query));
  };
}

/** A model that searches `chicken`, then `rice`, then answers with the scripted items. */
function answerAfterTwoSearches(items: Record<string, unknown>[]) {
  return (call: GeminiCall): Response => {
    const answers = answersSoFar(call);
    if (answers === 0) return toolCallTurn('chicken');
    if (answers === 1) return toolCallTurn('rice');
    return geminiResponse({ readable: true, items });
  };
}

/** A model that searches `chicken`, `rice`, then `beans`, then answers with the scripted items. */
function answerAfterThreeSearches(items: Record<string, unknown>[]) {
  return (call: GeminiCall): Response => {
    const answers = answersSoFar(call);
    if (answers === 0) return toolCallTurn('chicken');
    if (answers === 1) return toolCallTurn('rice');
    if (answers === 2) return toolCallTurn('beans');
    return geminiResponse({ readable: true, items });
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

/** How many `functionResponse` turns this request already carries. */
function answersSoFar(call: GeminiCall): number {
  const body = JSON.parse(String(call.init.body)) as {
    contents?: { parts?: { functionResponse?: unknown }[] }[];
  };
  return (body.contents ?? []).reduce(
    (count, turn) =>
      count + (turn.parts ?? []).filter((part) => part.functionResponse !== undefined).length,
    0,
  );
}

/** True when this request already carries our tool's answer — the turn to reply with JSON. */
function alreadyAnswered(call: GeminiCall): boolean {
  return answersSoFar(call) > 0;
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
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Chicken',
            grams: 200,
            foodId: 'food-1',
            fdcId: null,
            searchQuery: 'chicken',
          })
        : toolCallTurn('chicken');
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
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Chicken',
            grams: 200,
            foodId: 'food-1',
            fdcId: null,
            searchQuery: 'chicken',
          })
        : toolCallTurn('chicken');
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

  it('resolves a bare fdcId from USDA through one batch request, per 100 g, and writes nothing', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = (call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith('/v1/foods')) return usdaResponse([foodPayload()]);
      return usdaResponse(searchPayload());
    };
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Broccoli, raw',
            grams: 150,
            foodId: null,
            fdcId: FDC_ID,
            searchQuery: 'broccoli',
          })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(usda.calls).toHaveLength(2);
    expect(new URL(usda.calls[1].url).pathname).toBe('/fdc/v1/foods');
    expect(new URL(usda.calls[1].url).searchParams.getAll('fdcIds')).toEqual([String(FDC_ID)]);
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
  ])('fails open to the absent vector when the fdcId batch lookup is %s', async (_reason, status) => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = (call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith('/v1/foods')) return usdaResponse({}, status);
      return usdaResponse(searchPayload());
    };
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Broccoli, raw',
            grams: 150,
            foodId: null,
            fdcId: FDC_ID,
            searchQuery: 'broccoli',
          })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // A USDA outage costs the nutrient numbers and nothing else: the answer is
    // still a readable estimate carrying the food, the way path 3 states it.
    expect(usda.calls).toHaveLength(2);
    expect(new URL(usda.calls[1].url).pathname).toBe('/fdc/v1/foods');
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
    // A catalog row matches the query, so the search stays catalog-first and
    // never touches USDA; the answer still names no id.
    const foods = new FakeFoods([foodDto({ id: 'food-1', name: 'Chicken salad' })]);
    const usda = new FakeUsda();
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({ name: 'Chicken salad', grams: 250, foodId: null, fdcId: null, searchQuery: null })
        : toolCallTurn('chicken salad');

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

  it('fails open to the absent vector when the offered foodId no longer resolves', async () => {
    const foods = new FakeFoods([
      foodDto({ id: 'food-1', name: 'Chicken', servingGrams: 150, nutrients: completeVector({ ...zeroVector(), calories: 165 }) }),
    ]);
    // The search offered food-1, but the row is gone by the time it resolves.
    jest.spyOn(foods, 'findOne').mockRejectedValue(new NotFoundException('Food not found'));
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Chicken',
            grams: 200,
            foodId: 'food-1',
            fdcId: null,
            searchQuery: 'chicken',
          })
        : toolCallTurn('chicken');

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

  it('resolves the absent vector when the answer names an fdcId no search offered', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    // The tool offers OTHER_FDC_ID for the query the answer names; the answer guesses FDC_ID.
    usda.reply = () => usdaResponse(searchPayload(OTHER_FDC_ID));
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Broccoli, raw',
            grams: 150,
            foodId: null,
            fdcId: FDC_ID,
            searchQuery: 'broccoli',
          })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // An id the query never returned is no id: only the search ran, no fetch was
    // attempted, and the food carries the absent vector.
    expect(usda.calls).toHaveLength(1);
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].fdcId).toBe(FDC_ID);
    expect(result.items[0].nutrients).toEqual(zeroVector());
  });

  it('resolves the absent vector when the answer names a foodId the query it reports did not offer', async () => {
    const foods = new FakeFoods([foodDto({ id: 'food-1', name: 'Chicken', servingGrams: 150 })]);
    const usda = new FakeUsda();
    // The `rice` search offers OTHER_FDC_ID; the answer names foodId food-1 but
    // reports `searchQuery: "rice"`, so the query that would vouch for it is not
    // the one it names.
    usda.reply = () => usdaResponse(searchPayload(OTHER_FDC_ID, 'rice'));
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Chicken',
            grams: 200,
            foodId: 'food-1',
            fdcId: null,
            searchQuery: 'rice',
          })
        : toolCallTurn('rice');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].foodId).toBe('food-1');
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients).toEqual(zeroVector());
  });

  it('resolves the absent vector when the answer names a foodId no search offered', async () => {
    const foods = new FakeFoods([
      foodDto({ id: 'food-1', name: 'Chicken', servingGrams: 150, nutrients: completeVector({ ...zeroVector(), calories: 165 }) }),
    ]);
    const gemini = new FakeGemini();
    // The row exists and holds a vector, but no search offered its id.
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Chicken',
            grams: 200,
            foodId: 'food-1',
            fdcId: null,
            searchQuery: 'chicken',
          })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, new FakeUsda()).estimate(
      VALID_SUB,
      IMAGE_B64,
      MIME,
      HINT,
    );

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].foodId).toBe('food-1');
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients).toEqual(zeroVector());
  });

  it('resolves the absent vector when the searchQuery is null even though the fdcId was offered', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = () => usdaResponse(searchPayload());
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({
            name: 'Broccoli, raw',
            grams: 150,
            foodId: null,
            fdcId: FDC_ID,
            searchQuery: null,
          })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // No query named, so no query vouches: only the search ran, no fetch, absent vector.
    expect(usda.calls).toHaveLength(1);
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items[0].fdcId).toBe(FDC_ID);
    expect(result.items[0].nutrients).toEqual(zeroVector());
  });
});

describe('PhotoService — each food’s id resolves against its own search query', () => {
  it('resolves both foods to their own vectors when each answer names its own query', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    serveTwoFoodsFromUsda(usda);
    const gemini = new FakeGemini();
    gemini.reply = answerAfterTwoSearches([
      { name: 'Chicken', grams: 200, foodId: null, fdcId: FDC_ID, searchQuery: 'chicken' },
      { name: 'Rice', grams: 150, foodId: null, fdcId: OTHER_FDC_ID, searchQuery: 'rice' },
    ]);

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items.map((item) => item.nutrients.calories)).toEqual([
      CHICKEN_CALORIES,
      RICE_CALORIES,
    ]);
    expect(result.items[0].nutrients.calories).not.toBe(result.items[1].nutrients.calories);
    // Both foods' vectors arrive in one request, not one per food.
    const batchCalls = usda.calls.filter((call) => new URL(call.url).pathname.endsWith('/v1/foods'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0].url).searchParams.getAll('fdcIds')).toEqual([
      String(FDC_ID),
      String(OTHER_FDC_ID),
    ]);
  });

  it('resolves three USDA foods through exactly one batch request, each answer naming its own query', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    serveThreeFoodsFromUsda(usda);
    const gemini = new FakeGemini();
    gemini.reply = answerAfterThreeSearches([
      { name: 'Chicken', grams: 200, foodId: null, fdcId: FDC_ID, searchQuery: 'chicken' },
      { name: 'Rice', grams: 150, foodId: null, fdcId: OTHER_FDC_ID, searchQuery: 'rice' },
      { name: 'Beans', grams: 100, foodId: null, fdcId: BEANS_FDC_ID, searchQuery: 'beans' },
    ]);

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // One batch request carries all three ids — not three fetch-by-id calls.
    const batchCalls = usda.calls.filter((call) => new URL(call.url).pathname.endsWith('/v1/foods'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0].url).searchParams.getAll('fdcIds')).toEqual([
      String(FDC_ID),
      String(OTHER_FDC_ID),
      String(BEANS_FDC_ID),
    ]);
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items.map((item) => item.nutrients.calories)).toEqual([
      CHICKEN_CALORIES,
      RICE_CALORIES,
      BEANS_CALORIES,
    ]);
  });

  it('keeps rice on the absent vector when it names rice’s query beside chicken’s fdcId — the chicken vector is never attached to rice', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    serveTwoFoodsFromUsda(usda);
    const gemini = new FakeGemini();
    // The rice item cross-wires: it reports rice's own query but the fdcId the
    // chicken search offered, so the query it names never offered that id.
    gemini.reply = answerAfterTwoSearches([
      { name: 'Chicken', grams: 200, foodId: null, fdcId: FDC_ID, searchQuery: 'chicken' },
      { name: 'Rice', grams: 150, foodId: null, fdcId: FDC_ID, searchQuery: 'rice' },
    ]);

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    const [chicken, rice] = result.items;
    expect(chicken.nutrients.calories).toBe(CHICKEN_CALORIES);
    expect(rice.nutrients).toEqual(zeroVector());
    expect(rice.nutrients.calories).not.toBe(CHICKEN_CALORIES);
    // The chicken id was fetched only for the chicken item, never for rice: the
    // one batch request carried the chicken id and not the rejected rice id.
    const batchCalls = usda.calls.filter((call) => new URL(call.url).pathname.endsWith('/v1/foods'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0].url).searchParams.getAll('fdcIds')).toEqual([String(FDC_ID)]);
  });
});

describe('PhotoService — the search cap degrades, never discards', () => {
  it('answers with the foods it found when the model keeps calling search_food past the round cap', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    usda.reply = (call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith('/v1/foods')) {
        return usdaResponse(batchPayload(url.searchParams.getAll('fdcIds').map(Number)));
      }
      const query = url.searchParams.get('query');
      return usdaResponse(searchPayload(query === 'chicken' ? FDC_ID : OTHER_FDC_ID, query ?? ''));
    };
    // The model searches MAX_TOOL_ROUNDS real foods, then one overflow query it
    // never gets a result for — the cap stops the tool from running again.
    const searches = ['chicken', ...Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => `filler-${i}`)];
    const gemini = new FakeGemini();
    gemini.reply = (call) => {
      const answers = answersSoFar(call);
      if (answers >= MAX_TOOL_ROUNDS + 1) {
        return geminiResponse({
          readable: true,
          items: [
            { name: 'Chicken', grams: 200, foodId: null, fdcId: FDC_ID, searchQuery: 'chicken' },
            // The food it could not search names no id: the absent vector.
            { name: 'Lentils', grams: 100, foodId: null, fdcId: null, searchQuery: null },
          ],
        });
      }
      return toolCallTurn(searches[answers]);
    };

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(result.readable).toBe(true);
    if (!result.readable) return;
    const [chicken, lentils] = result.items;
    expect(chicken.nutrients.calories).toBe(CHICKEN_CALORIES);
    expect(lentils.nutrients).toEqual(zeroVector());

    // The overflow turn ran no tool: exactly MAX_TOOL_ROUNDS searches reached
    // the USDA, and the one batch carried only the id a real search offered.
    const searchCalls = usda.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/v1/foods/search'),
    );
    expect(searchCalls).toHaveLength(MAX_TOOL_ROUNDS);
    const batchCalls = usda.calls.filter((call) => new URL(call.url).pathname.endsWith('/v1/foods'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0].url).searchParams.getAll('fdcIds')).toEqual([String(FDC_ID)]);
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
      alreadyAnswered(call) ? readableWith({ name: 'Chicken', grams: 200, foodId: 'food-1', searchQuery: 'chicken' }) : toolCallTurn('chicken');

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
      alreadyAnswered(call) ? readableWith({ name: 'Broccoli, raw', grams: 150, searchQuery: null }) : toolCallTurn('broccoli');

    await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    expect(usda.calls).toHaveLength(1);
    expect(usda.lastParams().getAll('dataType')).toEqual(['Foundation', 'SR Legacy']);
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
    // Empty catalog and empty USDA: the tool answers with no candidates, so the
    // answer names no id and needs no USDA client to resolve.
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({ name: 'Chicken salad', grams: 250, foodId: null, fdcId: null, searchQuery: null })
        : toolCallTurn('chicken salad');

    // The factory throws only if it is *run* — construction itself must not run it.
    expect(() => serviceFor(foods, gemini, usda, envWithoutKey)).not.toThrow();

    // A read whose search needs USDA runs the factory, catches its throw, and
    // degrades to no candidates: the estimate still answers.
    const result = await serviceFor(foods, gemini, usda, envWithoutKey).estimate(
      VALID_SUB,
      IMAGE_B64,
      MIME,
      HINT,
    );
    expect(result.readable).toBe(true);
    expect(usda.calls).toHaveLength(0);
  });
});

describe('PhotoService — a USDA failure degrades the item, never the estimate', () => {
  const envWithoutKey: NodeJS.ProcessEnv = { USDA_API_BASE: USDA_BASE };

  it('fails open to the absent vector when the batch request throws for an offered fdcId', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    // Search succeeds and offers FDC_ID; only the batch request throws.
    usda.reply = (call) => {
      if (new URL(call.url).pathname.endsWith('/v1/foods')) throw new Error('fetch failed');
      return usdaResponse(searchPayload());
    };
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({ name: 'Broccoli, raw', grams: 150, foodId: null, fdcId: FDC_ID, searchQuery: 'broccoli' })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda).estimate(VALID_SUB, IMAGE_B64, MIME, HINT);

    // The id was offered, so the gate lets the fetch run; the throw is the
    // fail-open path, and the estimate still carries the food.
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Broccoli, raw');
    expect(result.items[0].fdcId).toBe(FDC_ID);
    expect(result.items[0].servingGrams).toBe(100);
    expect(result.items[0].nutrients).toEqual(zeroVector());
    expect(usda.calls).toHaveLength(2);
    expect(new URL(usda.calls[1].url).pathname).toBe('/fdc/v1/foods');
    expect(foods.createCalls).toHaveLength(0);
  });

  it('hands the model empty USDA candidates when the factory throws during search_food', async () => {
    const foods = new FakeFoods();
    const usda = new FakeUsda();
    const gemini = new FakeGemini();
    gemini.reply = (call) =>
      alreadyAnswered(call)
        ? readableWith({ name: 'Broccoli, raw', grams: 150, foodId: null, fdcId: null, searchQuery: null })
        : toolCallTurn('broccoli');

    const result = await serviceFor(foods, gemini, usda, envWithoutKey).estimate(
      VALID_SUB,
      IMAGE_B64,
      MIME,
      HINT,
    );

    expect(result.readable).toBe(true);
    expect(usda.calls).toHaveLength(0);
    expect(toolResultSent(gemini)).toEqual({ catalog: [], usda: [] });
  });
});
