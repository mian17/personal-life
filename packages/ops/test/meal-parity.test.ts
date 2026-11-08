/**
 * Meal parity suite (SPEC-ops-all-services §1.3, §6) — the mirror of
 * `notes-parity.test.ts` for the four-resource `meal` module. One meal call runs
 * through the CLI adapter and through the MCP adapter (`tools/call`), each against
 * a freshly started, identically seeded stub service, and the recorded HTTP request
 * (method, path, query, JSON body) plus the rendered output must match — all fifteen
 * ops, nested `portions`, `nutrients`, and saved-meal `items` included. Error parity
 * covers validator failure, missing token, `401`, `404` (foreign and missing ids), and
 * `409` on a stale `expectedVersion`. No test contacts a real service or IdP.
 *
 * The module spells the 27 nutrient keys out rather than importing them, so the drift
 * assertion at the top of the registry block is what holds them to `@life/nutrition`:
 * a renamed or added key there fails this suite, not production. The import reaches
 * that package by path because `@life/ops` declares no dependency on it and its jest
 * config maps none — a test-only edge, never a package one.
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { NUTRIENTS } from '../../nutrition/src/nutrients';
import { main as runCli } from '../src/cli/run';
import { createMcpServer } from '../src/mcp/server';
import { findOp, kindIsDestructive } from '../src/core/registry';
import { deriveInputSchema } from '../src/core/schema';
import type { FieldSpec, OpSpec, ResourceRegistry } from '../src/core/types';
import * as mealService from '../src/services/meal';
import { storeTokens } from '../src/auth/token-store';
import {
  sampleApiToken,
  startStubApi,
  type RecordingStubApi,
  type SampleRow,
  type StubApi,
} from './support/stub-api';

const OWNER_SUBJECT = 'owner-a';
const VALID_REFRESH_TOKEN = 'stub.refresh.token';
const ONE_HOUR_MS = 3_600_000;
const MISSING_TOKEN_MESSAGE =
  'entries.get failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'entries.get failed (unauthenticated): Unauthorized';
const ABSENT_ENTRY_MESSAGE = 'entries.get failed (notFound): Sample not found';
const STALE_VERSION_MESSAGE = 'entries.update failed (conflict): Sample was modified';
const EMPTY_TARGET_MESSAGE = 'target.list failed (invalidInput): date: required';
const EMPTY_SAVED_MEAL_MESSAGE =
  'saved-meals.create failed (invalidInput): name: required; mealGroup: required; items: required';

/** The same call in both dialects: CLI flags and MCP tool arguments. */
interface AdapterCall {
  resource: string;
  argv: string[];
  tool: string;
  args: Record<string, unknown>;
  seed?: () => SampleRow[];
}

interface CliOutcome {
  exit: number;
  text: string;
}

interface McpOutcome {
  text: string;
  failed: boolean;
}

/** What both adapters produced for one call, and the request each left behind. */
interface AdapterPair {
  cli: CliOutcome;
  mcp: McpOutcome;
  cliWire: WireShape | undefined;
  mcpWire: WireShape | undefined;
}

/** The adapter-owned part of a recorded request; transport headers carry no signal. */
interface WireShape {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  authorization: string | undefined;
}

let credentialsFile = '';
let savedCredentialsPath: string | undefined;

beforeEach(async () => {
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-meal-parity-')), 'credentials.json');
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
  await storeTokens({
    accessToken: sampleApiToken,
    refreshToken: VALID_REFRESH_TOKEN,
    expiresAt: Date.now() + ONE_HOUR_MS,
  });
});

afterEach(() => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(dirname(credentialsFile), { recursive: true, force: true });
});

describe('the meal registry', () => {
  it('declares the four resources at their service base paths', () => {
    expect(mealService.resources.map((resource) => resource.name)).toEqual([
      'entries',
      'foods',
      'saved-meals',
      'target',
    ]);
    expect(mealService.resources.map((resource) => resource.basePath)).toEqual([
      '/api/entries',
      '/api/foods',
      '/api/saved-meals',
      '/api/target',
    ]);
  });

  it('declares fifteen ops across the four resources', () => {
    expect(opNames()).toHaveLength(15);
  });

  it('carries no api base and no destructiveness override', () => {
    expect('apiBase' in mealService).toBe(false);

    // `defineResource` states every op's destructiveness, so the override is read
    // against the kind default it restates rather than against its absence
    // (SPEC-ops-all-services §5, Open Question 6.4).
    for (const operation of opsOf()) {
      expect(operation.isDestructive).toBe(kindIsDestructive(operation.kind));
    }
  });

  it('hands adapters the frozen registry every other module hands them', () => {
    for (const resource of mealService.resources) {
      expect(Object.isFrozen(resource)).toBe(true);
      expect(Object.isFrozen(resource.ops[0])).toBe(true);
    }
  });

  it('declares the 27 nutrient keys in NUTRIENTS order, in all three vectors', () => {
    const shipped = NUTRIENTS.map((nutrient) => nutrient.key);
    for (const declared of declaredNutrientKeys()) expect(declared).toEqual(shipped);
  });

  it('declares every nutrient amount as a number', () => {
    for (const vector of declaredNutrientVectors()) {
      for (const amount of Object.values(vector)) expect(amount.type).toBe('number');
    }
  });

  it('requires a label and an amount for each portion, and nests the item vector', () => {
    const portions = createField('foods', 'portions').properties ?? {};
    expect(Object.keys(portions)).toEqual(['label', 'amount']);
    expect(portions['label'].required).toBe(true);
    expect(portions['amount'].required).toBe(true);

    const items = createField('saved-meals', 'items');
    expect(items.type).toBe('object[]');
    expect(items.required).toBe(true);
    expect(Object.keys(items.properties ?? {})).toEqual(['foodId', 'quantity', 'nutrients']);
    expect(items.properties?.['quantity'].required).toBe(true);
    expect(items.properties?.['nutrients'].type).toBe('object');
  });

  it('requires the fields each creating body declares without `@IsOptional()`', () => {
    // `apps/meal-service/src/**/dto/*.dto.ts` is the storage contract: a field it
    // declares without `@IsOptional()` is a 400 when omitted, so an op that leaves
    // it optional advertises a request the service refuses.
    expect(requiredFieldsOf('entries', 'create')).toEqual([
      'date',
      'mealGroup',
      'foodId',
      'quantity',
      'nutrients',
    ]);
    expect(requiredFieldsOf('foods', 'create')).toEqual(['name', 'servingGrams']);
    expect(requiredFieldsOf('saved-meals', 'create')).toEqual(['name', 'mealGroup', 'items']);
    expect(requiredFieldsOf('target', 'list')).toEqual(['date']);
  });

  it('updates every row field as optional, because each update DTO is a full patch', () => {
    expect(requiredFieldsOf('entries', 'update')).toEqual(['id']);
    expect(requiredFieldsOf('foods', 'update')).toEqual(['id']);
  });

  it('requires all 27 keys inside a vector, and the vector itself only where the DTO does', () => {
    const shipped = NUTRIENTS.map((nutrient) => nutrient.key);
    for (const vector of declaredNutrientVectors()) {
      const missing = shipped.filter((key) => vector[key].required !== true);
      expect(missing).toEqual([]);
    }

    // A vector is omitted-or-complete (`completeVector()`): `foods` and both updates
    // carry it optionally, an entry and a saved-meal item never do.
    expect(fieldOf('entries', 'create', 'nutrients').required).toBe(true);
    expect(fieldOf('foods', 'create', 'nutrients').required).toBe(false);
    expect(fieldOf('entries', 'update', 'nutrients').required).toBe(false);
    expect(fieldOf('foods', 'update', 'nutrients').required).toBe(false);
    expect(itemField('nutrients').required).toBe(true);
  });

  it('advertises exactly that over MCP `tools/list`', () => {
    expect(deriveInputSchema(registryOf('foods'), 'create').required).toEqual([
      'name',
      'servingGrams',
    ]);

    const vector = deriveInputSchema(registryOf('entries'), 'create').properties['nutrients'];
    expect(vector.required).toEqual(NUTRIENTS.map((nutrient) => nutrient.key));
  });

  it('pages the three meal listings through the one 1-to-200 window', () => {
    // Every meal list endpoint pages (`SPEC-pagination-seam` §7), so each `list`
    // op carries the same two optional fields. `target` is a single-row read of
    // the day's profile, so it keeps its one required `date`.
    for (const resource of ['entries', 'foods', 'saved-meals']) {
      const fields = findOp(registryOf(resource), 'list').fields;
      // `normalizeOp` fills the default, so an optional field reads `required: false`.
      expect(fields['limit']).toMatchObject({
        type: 'number',
        required: false,
        description: expect.stringContaining('1 to 200'),
      });
      expect(fields['cursor']).toMatchObject({ type: 'string', required: false });
    }
    expect(Object.keys(findOp(registryOf('target'), 'list').fields)).toEqual(['date']);
  });
});

describe('meal operation parity', () => {
  it('sends the same entry create and renders the same entry', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: [
        'entries',
        'create',
        '--date',
        '2026-02-01',
        '--mealGroup',
        'lunch',
        '--foodId',
        'food-a',
        '--quantity',
        '2',
        '--nutrients',
        JSON.stringify(oneOfEachNutrient()),
      ],
      tool: 'entries_create',
      args: {
        date: '2026-02-01',
        mealGroup: 'lunch',
        foodId: 'food-a',
        quantity: 2,
        nutrients: oneOfEachNutrient(),
      },
    });

    expectSuccessful(pair);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same entry listing and renders the same page', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'list', '--date', '2026-02-01', '--meal', 'lunch', '--limit', '25'],
      tool: 'entries_list',
      args: { date: '2026-02-01', meal: 'lunch', limit: 25 },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.query).toEqual({ date: '2026-02-01', meal: 'lunch', limit: '25' });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same entry read and renders the same entry', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'get', '--id', 'entry-a'],
      tool: 'entries_get',
      args: { id: 'entry-a' },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same entry update and renders the same entry', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: [
        'entries',
        'update',
        '--id',
        'entry-a',
        '--mealGroup',
        'dinner',
        '--quantity',
        '3',
        '--expectedVersion',
        '0',
      ],
      tool: 'entries_update',
      args: { id: 'entry-a', mealGroup: 'dinner', quantity: 3, expectedVersion: 0 },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same entry delete and renders the same answer', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'delete', '--id', 'entry-a'],
      tool: 'entries_delete',
      args: { id: 'entry-a' },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('DELETE');
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same food create with its portions and vector', async () => {
    const pair = await runBoth({
      resource: 'foods',
      argv: [
        'foods',
        'create',
        '--name',
        'Greek yoghurt',
        '--unit',
        'g',
        '--servingGrams',
        '170',
        '--portions',
        JSON.stringify([{ label: '1 carton', amount: 170 }]),
        '--nutrients',
        JSON.stringify(oneOfEachNutrient()),
      ],
      tool: 'foods_create',
      args: {
        name: 'Greek yoghurt',
        unit: 'g',
        servingGrams: 170,
        portions: [{ label: '1 carton', amount: 170 }],
        nutrients: oneOfEachNutrient(),
      },
      seed: seededFoods,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.body).toEqual({
      name: 'Greek yoghurt',
      unit: 'g',
      servingGrams: 170,
      portions: [{ label: '1 carton', amount: 170 }],
      nutrients: oneOfEachNutrient(),
    });
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same food listing and renders the same page', async () => {
    const pair = await runBoth({
      resource: 'foods',
      argv: ['foods', 'list', '--q', 'yoghurt', '--includeDeleted', '--cursor', 'next-page'],
      tool: 'foods_list',
      args: { q: 'yoghurt', includeDeleted: true, cursor: 'next-page' },
      seed: seededFoods,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.query).toEqual({
      q: 'yoghurt',
      includeDeleted: 'true',
      cursor: 'next-page',
    });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same food read and renders the same food', async () => {
    const pair = await runBoth({
      resource: 'foods',
      argv: ['foods', 'get', '--id', 'food-a'],
      tool: 'foods_get',
      args: { id: 'food-a' },
      seed: seededFoods,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same food update without the immutable unit', async () => {
    const pair = await runBoth({
      resource: 'foods',
      argv: [
        'foods',
        'update',
        '--id',
        'food-a',
        '--name',
        'Greek yoghurt 0%',
        '--expectedVersion',
        '0',
      ],
      tool: 'foods_update',
      args: { id: 'food-a', name: 'Greek yoghurt 0%', expectedVersion: 0 },
      seed: seededFoods,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.body).toEqual({ name: 'Greek yoghurt 0%', expectedVersion: 0 });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same food delete and renders the same answer', async () => {
    const pair = await runBoth({
      resource: 'foods',
      argv: ['foods', 'delete', '--id', 'food-a'],
      tool: 'foods_delete',
      args: { id: 'food-a' },
      seed: seededFoods,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same saved-meal create with its nested item vectors', async () => {
    const items = [savedMealItem()];
    const pair = await runBoth({
      resource: 'saved-meals',
      argv: [
        'saved-meals',
        'create',
        '--name',
        'Usual breakfast',
        '--mealGroup',
        'breakfast',
        '--items',
        JSON.stringify(items),
      ],
      tool: 'saved-meals_create',
      args: { name: 'Usual breakfast', mealGroup: 'breakfast', items },
      seed: seededSavedMeals,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.body).toEqual({
      name: 'Usual breakfast',
      mealGroup: 'breakfast',
      items,
    });
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same saved-meal listing and renders the same page', async () => {
    const pair = await runBoth({
      resource: 'saved-meals',
      argv: ['saved-meals', 'list', '--limit', '10'],
      tool: 'saved-meals_list',
      args: { limit: 10 },
      seed: seededSavedMeals,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.path).toBe('/api/saved-meals');
    expect(pair.cliWire?.query).toEqual({ limit: '10' });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same saved-meal read and renders the same meal', async () => {
    const pair = await runBoth({
      resource: 'saved-meals',
      argv: ['saved-meals', 'get', '--id', 'meal-a'],
      tool: 'saved-meals_get',
      args: { id: 'meal-a' },
      seed: seededSavedMeals,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same saved-meal delete and renders the same answer', async () => {
    const pair = await runBoth({
      resource: 'saved-meals',
      argv: ['saved-meals', 'delete', '--id', 'meal-a'],
      tool: 'saved-meals_delete',
      args: { id: 'meal-a' },
      seed: seededSavedMeals,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the target read for the requested day', async () => {
    const pair = await runBoth({
      resource: 'target',
      argv: ['target', 'list', '--date', '2026-02-01'],
      tool: 'target_list',
      args: { date: '2026-02-01' },
      seed: seededTargets,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.path).toBe('/api/target');
    expect(pair.cliWire?.query).toEqual({ date: '2026-02-01' });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('meal error parity', () => {
  it('refuses a target read with no day and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'target',
      argv: ['target', 'list'],
      tool: 'target_list',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_TARGET_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('refuses a saved meal with no name and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'saved-meals',
      argv: ['saved-meals', 'create'],
      tool: 'saved-meals_create',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_SAVED_MEAL_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a missing token identically and sends nothing', async () => {
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(dirname(credentialsFile), 'absent.json');
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'get', '--id', 'entry-a'],
      tool: 'entries_get',
      args: { id: 'entry-a' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(MISSING_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a refused token identically', async () => {
    await storeTokens({
      accessToken: 'bogus',
      refreshToken: undefined,
      expiresAt: Date.now() + ONE_HOUR_MS,
    });
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'get', '--id', 'entry-a'],
      tool: 'entries_get',
      args: { id: 'entry-a' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a missing entry identically', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'get', '--id', 'no-such-entry'],
      tool: 'entries_get',
      args: { id: 'no-such-entry' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_ENTRY_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign entry exactly like a missing one', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'get', '--id', 'entry-foreign'],
      tool: 'entries_get',
      args: { id: 'entry-foreign' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_ENTRY_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a stale version identically', async () => {
    const pair = await runBoth({
      resource: 'entries',
      argv: ['entries', 'update', '--id', 'entry-a', '--quantity', '4', '--expectedVersion', '999'],
      tool: 'entries_update',
      args: { id: 'entry-a', quantity: 4, expectedVersion: 999 },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(STALE_VERSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const seed = call.seed ?? seededEntries;
  const cliStub = await startMealStub(call.resource, seed());
  const mcpStub = await startMealStub(call.resource, seed());
  try {
    const cli = await driveCli(call, cliStub);
    const mcp = await driveMcp(call, mcpStub);
    return { cli, mcp, cliWire: wireShapeOf(cliStub), mcpWire: wireShapeOf(mcpStub) };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

function startMealStub(resourceName: string, rows: SampleRow[]): Promise<RecordingStubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows,
    collectionPath: registryOf(resourceName).basePath,
  });
}

async function driveCli(call: AdapterCall, stub: StubApi): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const registry = registryOf(call.resource);
  const exit = await runCli({
    argv: call.argv,
    service: async () => ({ registry }),
    env: { ...process.env, LIFE_OPS_API_BASE: stub.baseUrl },
    stdout: (line) => {
      stdout.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
    },
    signIn: async () => {},
  });
  return { exit, text: exit === 0 ? stdout.join('\n') : stderr.join('\n') };
}

async function driveMcp(call: AdapterCall, stub: StubApi): Promise<McpOutcome> {
  const server = createMcpServer({
    registry: registryOf(call.resource),
    apiBase: stub.baseUrl,
    env: process.env,
    stdout: () => {},
    stderr: () => {},
  });
  const reply = (await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: call.tool, arguments: call.args },
  })) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
  return { text: reply.result.content[0].text, failed: reply.result.isError === true };
}

function registryOf(resourceName: string): ResourceRegistry {
  const resource = mealService.resources.find((candidate) => candidate.name === resourceName);
  if (resource === undefined) throw new Error(`unknown meal resource: ${resourceName}`);
  return resource;
}

/** Every op the module declares, in declaration order. */
function opsOf(): OpSpec[] {
  return mealService.resources.flatMap((resource) => resource.ops);
}

/** Every `<resource>_<op>` tool name the module declares, in declaration order. */
function opNames(): string[] {
  return mealService.resources.flatMap((resource) =>
    resource.ops.map((operation) => `${resource.name}_${operation.kind}`),
  );
}

/** One field the resource's `create` op declares. */
function createField(resourceName: string, fieldName: string): FieldSpec {
  return findOp(registryOf(resourceName), 'create').fields[fieldName];
}

/** One field of any op the resource declares. */
function fieldOf(resourceName: string, kind: OpSpec['kind'], fieldName: string): FieldSpec {
  return findOp(registryOf(resourceName), kind).fields[fieldName];
}

/** One key of the saved-meal item the `items` field nests. */
function itemField(fieldName: string): FieldSpec {
  const item = createField('saved-meals', 'items').properties?.[fieldName];
  if (item === undefined) throw new Error(`saved-meal item declares no ${fieldName}`);
  return item;
}

/** The fields one op marks required, in declaration order. */
function requiredFieldsOf(resourceName: string, kind: OpSpec['kind']): string[] {
  return Object.entries(findOp(registryOf(resourceName), kind).fields)
    .filter(([, field]) => field.required === true)
    .map(([fieldName]) => fieldName);
}

/** The keys of the three `nutrients` declarations, each in declaration order. */
function declaredNutrientKeys(): string[][] {
  return declaredNutrientVectors().map((vector) => Object.keys(vector));
}

/** The three `nutrients` declarations: entry, food, and the saved-meal item's. */
function declaredNutrientVectors(): Record<string, FieldSpec>[] {
  return [
    createField('entries', 'nutrients').properties ?? {},
    createField('foods', 'nutrients').properties ?? {},
    createField('saved-meals', 'items').properties?.['nutrients'].properties ?? {},
  ];
}

/** One amount per nutrient key, so a vector is complete without naming all 27 again. */
function oneOfEachNutrient(): Record<string, number> {
  return Object.fromEntries(NUTRIENTS.map((nutrient, index) => [nutrient.key, index + 1]));
}

function savedMealItem(): Record<string, unknown> {
  return { foodId: 'food-a', quantity: 1, nutrients: oneOfEachNutrient() };
}

/** The entry rows every case starts from, one of them owned by somebody else. */
function seededEntries(): SampleRow[] {
  return [
    entryRow({ id: 'entry-a', mealGroup: 'lunch' }),
    entryRow({ id: 'entry-b', mealGroup: 'dinner' }),
    entryRow({ id: 'entry-foreign', mealGroup: 'lunch', ownerSub: 'owner-b' }),
  ];
}

function entryRow(fields: { id: string; mealGroup: string; ownerSub?: string }): SampleRow {
  return {
    id: fields.id,
    ownerSub: fields.ownerSub ?? OWNER_SUBJECT,
    version: 0,
    date: '2026-02-01',
    mealGroup: fields.mealGroup,
    foodId: 'food-a',
    quantity: 1,
    nutrients: oneOfEachNutrient(),
  };
}

function seededFoods(): SampleRow[] {
  return [
    foodRow({ id: 'food-a', name: 'Greek yoghurt' }),
    foodRow({ id: 'food-b', name: 'Oat milk' }),
  ];
}

function foodRow(fields: { id: string; name: string }): SampleRow {
  return {
    id: fields.id,
    ownerSub: OWNER_SUBJECT,
    version: 0,
    name: fields.name,
    unit: 'g',
    servingGrams: 170,
    portions: [{ label: '1 carton', amount: 170 }],
    nutrients: oneOfEachNutrient(),
  };
}

function seededSavedMeals(): SampleRow[] {
  return [
    {
      id: 'meal-a',
      ownerSub: OWNER_SUBJECT,
      version: 0,
      name: 'Usual breakfast',
      mealGroup: 'breakfast',
      items: [savedMealItem()],
    },
  ];
}

function seededTargets(): SampleRow[] {
  return [
    {
      id: 'target-a',
      ownerSub: OWNER_SUBJECT,
      version: 0,
      date: '2026-02-01',
      calories: 2200,
    },
  ];
}

/** The adapter-owned shape of the last recorded request; `undefined` when none arrived. */
function wireShapeOf(stub: StubApi): WireShape | undefined {
  const recorded = stub.requestLog[stub.requestLog.length - 1];
  if (recorded === undefined) return undefined;
  return {
    method: recorded.method,
    path: recorded.path,
    query: recorded.query,
    body: recorded.body,
    authorization: recorded.headers['authorization'],
  };
}

function expectSuccessful(pair: AdapterPair): void {
  expect(pair.cli.exit).toBe(0);
  expect(pair.mcp.failed).toBe(false);
  expect(pair.mcpWire).toEqual(pair.cliWire);
}

function expectFailed(pair: AdapterPair): void {
  expect(pair.cli.exit).toBe(1);
  expect(pair.mcp.failed).toBe(true);
}

/** Creates assign server-chosen ids, so the comparison redacts that one volatile field. */
function redactedId(rendered: string): string {
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, id: '<id>' });
}
