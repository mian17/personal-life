import { NUTRIENTS } from '@life/nutrition';
import {
  GeminiClient,
  MAX_TOOL_ROUNDS,
  type SearchFood,
  type SearchFoodResult,
} from '../src/photo/gemini.client';
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

/** A transport whose first reply is a `search_food` call, then the bound answer. */
function searchingFake(query = 'chicken'): FakeGemini {
  const fake = new FakeGemini();
  fake.reply = (call) =>
    fake.calls.length === 1
      ? toolCallTurn(query, 'call-1')
      : geminiResponse(readablePayload({ foodId: 'food-7', searchQuery: query }));
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

/**
 * A clock already past the loop's 45 s bound: the first `Date.now()` sets the
 * deadline, every later read is 60 s beyond it. Restore with `mockRestore()`.
 */
function startClockPastDeadline(): jest.SpiedFunction<typeof Date.now> {
  const start = 1_000_000;
  return jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(start)
    .mockReturnValue(start + 60_000);
}

/**
 * A clock that leaves the loop inside its 45 s bound but the tool a single
 * millisecond: the deadline is set normally, the guard before the request still
 * passes, and every later read is one millisecond short of the deadline. So
 * `runSearchTool`'s remaining budget expires on a real timer. Restore with
 * `mockRestore()`.
 */
function startClockWithOneMillisecondOfToolBudget(): jest.SpiedFunction<typeof Date.now> {
  const start = 1_000_000;
  return jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(start) // the loop's deadline: start + 45 s
    .mockReturnValueOnce(start + 44_000) // the guard before the request: inside the bound
    .mockReturnValue(start + 44_999); // the tool's budget: one millisecond
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

    expect(result).toEqual({
      readable: true,
      items: [item({ foodId: 'food-7', searchQuery: 'chicken' })],
    });
    expect(queries).toEqual(['chicken']);
    expect(fake.calls).toHaveLength(2);
  });

  it('degrades an over-running loop past five tool rounds to the one failure', async () => {
    const fake = new FakeGemini();
    fake.reply = () => toolCallTurn('chicken');
    let calls = 0;
    const searchTool: SearchFood = async () => {
      calls += 1;
      return CATALOG_HIT;
    };

    const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

    // The model never stopped searching, so no usable JSON arrived: the one
    // failure shape, not a hang and not a partial answer. The cap is spent on
    // tool rounds; the overflow turn then answers the call empty — no tool runs,
    // no id is offered — and the one further turn still carries a call instead
    // of text, so the read fails rather than hanging.
    expect(result).toEqual(COULD_NOT_READ);
    expect(calls).toBe(MAX_TOOL_ROUNDS);
    expect(fake.calls).toHaveLength(MAX_TOOL_ROUNDS + 2);
  });

  it('stops on the forty-five-second wall clock before any further tool round', async () => {
    const clock = startClockPastDeadline();
    let toolCalls = 0;
    const fake = new FakeGemini();
    fake.reply = () => toolCallTurn('chicken');
    const searchTool: SearchFood = async () => {
      toolCalls += 1;
      return CATALOG_HIT;
    };

    try {
      const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

      // The deadline is read before the first request, so no call goes out and
      // the tool never runs: the wall clock is a real second bound, not a no-op.
      expect(result).toEqual(COULD_NOT_READ);
      expect(fake.calls).toHaveLength(0);
      expect(toolCalls).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops on the wall clock when a search tool never answers', async () => {
    const clock = startClockWithOneMillisecondOfToolBudget();
    let toolCalls = 0;
    const fake = new FakeGemini();
    fake.reply = () => toolCallTurn('chicken');
    const searchTool: SearchFood = () => {
      toolCalls += 1;
      return new Promise(() => {}); // never settles
    };

    try {
      const result = await clientFor(fake).readPhoto(image, undefined, searchTool);

      // The tool ran and never answered, so only the remaining wall clock could
      // have ended the loop: without the race this await would never return.
      expect(result).toEqual(COULD_NOT_READ);
      expect(toolCalls).toBe(1);
      expect(fake.calls).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
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