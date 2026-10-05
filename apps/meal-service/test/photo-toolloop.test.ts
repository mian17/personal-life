import { NUTRIENTS } from '@life/nutrition';
import { GeminiClient, type SearchFood, type SearchFoodResult } from '../src/photo/gemini.client';
import { FakeGemini, geminiResponse, item, readablePayload } from './fake-gemini';

/**
 * The `search_food` turn loop (`SPEC-photo-identity.md` § The tool loop).
 * Driven by a fake transport and a fake tool: no network, no catalog, no USDA.
 *
 * What is proved: the model can search and then answer; the conversation is
 * bounded (five rounds, forty-five seconds) so a looping model terminates on
 * the one failure shape instead of hanging; a tool that throws is a typed
 * failure, not a hang; and the declaration and the tool result carry names and
 * ids only — no nutrient field exists anywhere in the request.
 */

const KEY = 'test-key-DO-NOT-LOG-7f3a';
const MODEL = 'test-model-id';
const BASE = 'https://gemini.test/v1beta';
const MIME = 'image/jpeg';
const BYTES = Buffer.from('not really a photo', 'utf8');

const COULD_NOT_READ = { readable: false, reason: 'could-not-read' } as const;

function envOf(): NodeJS.ProcessEnv {
  return { GEMINI_API_KEY: KEY, GEMINI_MODEL: MODEL, GEMINI_API_BASE: BASE };
}

function clientFor(fake: FakeGemini): GeminiClient {
  return new GeminiClient(envOf(), fake.handler);
}

/** What the fake catalog tool answers: one row, names and ids only. */
const CATALOG_HIT: SearchFoodResult = {
  catalog: [{ id: 'food-7', name: 'chicken', servingGrams: 100 }],
  usda: [],
};

const image = { mimeType: MIME, bytes: BYTES };

/** A transport whose first reply is a `search_food` call, then the real answer. */
function searchingFake(query = 'chicken'): FakeGemini {
  const fake = new FakeGemini();
  fake.reply = (call) =>
    fake.calls.length === 1 ? toolCallTurn(query, 'call-1') : geminiResponse(readablePayload());
  return fake;
}

/** One turn whose candidate is a `functionCall` part, as the discovery document quotes it. */
function toolCallTurn(query: string, id?: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name: 'search_food', args: { query }, id } }] } }],
    }),
    { status: 200 },
  );
}

describe('the search_food turn loop', () => {
  it('answers a food found by the tool with the model\'s final JSON', async () => {
    const fake = searchingFake();
    const queries: string[] = [];
    const searchTool: SearchFood = async (query) => {
      queries.push(query);
      return CATALOG_HIT;
    };

    const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

    expect(result).toEqual({ readable: true, items: [item()] });
    expect(queries).toEqual(['chicken']);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops an over-running loop at five tool rounds on the one failure', async () => {
    const fake = new FakeGemini();
    fake.reply = () => toolCallTurn('chicken');
    let calls = 0;
    const searchTool: SearchFood = async () => {
      calls += 1;
      return CATALOG_HIT;
    };

    const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

    // The model never stopped searching, so no usable JSON arrived: the one
    // failure shape, not a hang and not a partial answer.
    expect(result).toEqual(COULD_NOT_READ);
    expect(calls).toBe(5);
    expect(fake.calls.length).toBeLessThanOrEqual(6);
  });

  it('maps a throwing tool to the same failure, and never hangs', async () => {
    const fake = new FakeGemini();
    fake.reply = () => toolCallTurn('chicken');
    const searchTool: SearchFood = () => Promise.reject(new Error('USDA 429'));

    const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

    expect(result).toEqual(COULD_NOT_READ);
    // It stopped at the first round: a failed tool never becomes a retry loop.
    expect(fake.calls).toHaveLength(1);
  });

  it('declares a tool that names no nutrient field', async () => {
    const fake = searchingFake();
    const searchTool: SearchFood = () => Promise.resolve(CATALOG_HIT);
    await clientFor(fake).readPhoto(image, undefined, searchTool);

    const [firstRequest, toolResultRequest] = [fake.calls[0], fake.calls[1]].map((call) =>
      JSON.parse(String(call?.init.body ?? '')) as Record<string, unknown>,
    );

    // The declaration the model reads: exactly the query, no nutrient argument.
    const declaration = (firstRequest.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>)[0]
      .functionDeclarations[0];
    expect(declaration.name).toBe('search_food');
    const parameters = declaration.parameters as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(parameters.properties)).toEqual(['query']);
    expect(parameters.required).toEqual(['query']);

    // The tool result rides back as a functionResponse naming the id it answered.
    const turns = (toolResultRequest.contents as Array<{ role: string; parts: unknown[] }>).map(
      (turn) => turn.role,
    );
    expect(turns).toEqual(['user', 'model', 'user']);
    const response = (
      (toolResultRequest.contents as Array<{ parts: unknown[] }>)[2].parts[0] as {
        functionResponse: { name: string; id: string; response: SearchFoodResult };
      }
    ).functionResponse;
    expect(response.name).toBe('search_food');
    expect(response.id).toBe('call-1');
    expect(response.response).toEqual(CATALOG_HIT);

    // Not one of the 27 nutrient keys appears anywhere in any request body.
    const serialised = fake.calls
      .map((call) => String(call.init.body))
      .join('\n');
    for (const { key } of NUTRIENTS) expect(serialised).not.toContain(key);
  });
});