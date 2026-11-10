/**
 * Cross-adapter bulk parity suite (SPEC-bulk-ops §2.7, §2.8, §7): the change's
 * closing proof. One bulk call per kind runs through the CLI adapter and through
 * the MCP adapter's `tools/call`, each against an identically seeded stub
 * service, and the recorded per-item wires, the rendered text, and the
 * envelope-as-`structuredContent` must agree. The failure signal is proved on the
 * same pair: a partial failure omits `isError` and exits `0`, a batch where
 * nothing succeeded sets `isError` and exits `1`.
 *
 * No shipped resource opts into bulk (§2.2), so the opted-in fixture registry is
 * the one under test. The stub service is an in-process loopback server, so no
 * test contacts a real service, IdP, Redis, or database.
 */
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run.js';
import type { ServiceModule } from '../src/cli/run.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { McpTool } from '../src/mcp/tools.js';
import { storeTokens } from '../src/auth/token-store.js';
import type { BulkEnvelope, BulkItemResult } from '../src/core/bulk.js';
import type { JsonSchemaProperty } from '../src/core/schema.js';
import { BULK_WRAPPER_FIELD } from '../src/core/validate.js';
import { resources } from './support/bulk-service-module.js';
import { sampleApiToken, startStubApi, type SampleRow, type StubApi } from './support/stub-api.js';

const OWNER_SUBJECT = 'owner-a';
const VALID_REFRESH_TOKEN = 'stub.refresh.token';
const ONE_HOUR_MS = 3_600_000;
const COLLECTION_PATH = '/api/journals';
const ABSENT_JOURNAL_ERROR = 'journals.get failed (notFound): Sample not found';

/** The opted-in fixture resource: the one resource in this module that derives all four bulk kinds. */
const journals = resources[0];

/** The same bulk call in both dialects: CLI flags and MCP tool arguments. */
interface AdapterCall {
  argv: string[];
  tool: string;
  args: Record<string, unknown>;
}

/** What the CLI wrote on each stream for one call, and the exit code it ended on. */
interface CliOutcome {
  exit: number;
  stdout: string;
  stderr: string;
}

/** What the MCP adapter answered for one call: the text, the `result` object, its structure. */
interface McpOutcome {
  text: string;
  jsonRpcResult: Record<string, unknown>;
  structured: Record<string, unknown> | undefined;
}

/** What both adapters produced for one call, and the wires each ended up sending. */
interface AdapterPair {
  cli: CliOutcome;
  mcp: McpOutcome;
  cliWires: WireShape[];
  mcpWires: WireShape[];
}

/** The adapter-owned part of one recorded request; transport headers carry no signal. */
interface WireShape {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  authorization: string | undefined;
}

const GET_MANY: AdapterCall = {
  argv: ['journals', 'get-many', '--items', 'journal-a', '--items', 'journal-b'],
  tool: 'journals_get_many',
  args: { items: ['journal-a', 'journal-b'] },
};

const GET_MANY_WITH_ONE_MISSING: AdapterCall = {
  argv: ['journals', 'get-many', '--items', 'journal-a', '--items', 'journal-missing'],
  tool: 'journals_get_many',
  args: { items: ['journal-a', 'journal-missing'] },
};

const GET_MANY_ALL_MISSING: AdapterCall = {
  argv: ['journals', 'get-many', '--items', 'journal-missing', '--items', 'journal-gone'],
  tool: 'journals_get_many',
  args: { items: ['journal-missing', 'journal-gone'] },
};

const CREATE_MANY: AdapterCall = {
  argv: [
    'journals',
    'create-many',
    '--items',
    '{"title":"Morning pages"}',
    '--items',
    '{"title":"Evening pages"}',
  ],
  tool: 'journals_create_many',
  args: { items: [{ title: 'Morning pages' }, { title: 'Evening pages' }] },
};

const UPDATE_MANY: AdapterCall = {
  argv: [
    'journals',
    'update-many',
    '--items',
    '{"id":"journal-a","title":"Morning pages, retitled"}',
    '--items',
    '{"id":"journal-b","title":"Evening pages, retitled"}',
  ],
  tool: 'journals_update_many',
  args: {
    items: [
      { id: 'journal-a', title: 'Morning pages, retitled' },
      { id: 'journal-b', title: 'Evening pages, retitled' },
    ],
  },
};

const DELETE_MANY: AdapterCall = {
  argv: ['journals', 'delete-many', '--items', 'journal-a', '--items', 'journal-b'],
  tool: 'journals_delete_many',
  args: { items: ['journal-a', 'journal-b'] },
};

let credentialsFile = '';
let savedCredentialsPath: string | undefined;

beforeEach(async () => {
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-bulk-parity-')), 'credentials.json');
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

describe('one bulk call on both adapters', () => {
  it('sends the same getMany items and renders the same envelope', async () => {
    const pair = await runBoth(GET_MANY);

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.jsonRpcResult).not.toHaveProperty('isError');
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.cliWires.map((wire) => wire.path)).toEqual([
      `${COLLECTION_PATH}/journal-a`,
      `${COLLECTION_PATH}/journal-b`,
    ]);
    expect(pair.mcp.text).toBe(pair.cli.stdout);
  });

  it('sends the same createMany items and renders the same envelope, server ids aside', async () => {
    const pair = await runBoth(CREATE_MANY);

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.jsonRpcResult).not.toHaveProperty('isError');
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.cliWires.map((wire) => wire.body)).toEqual([
      { title: 'Morning pages' },
      { title: 'Evening pages' },
    ]);
    expect(withRedactedRefIds(pair.mcp.text)).toBe(withRedactedRefIds(pair.cli.stdout));
  });

  it('sends the same updateMany items and renders the same envelope', async () => {
    const pair = await runBoth(UPDATE_MANY);

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.jsonRpcResult).not.toHaveProperty('isError');
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.cliWires.map((wire) => wire.method)).toEqual(['PATCH', 'PATCH']);
    expect(pair.cliWires.map((wire) => wire.path)).toEqual([
      `${COLLECTION_PATH}/journal-a`,
      `${COLLECTION_PATH}/journal-b`,
    ]);
    // §2.3: an item's wire carries exactly the fields that item submitted.
    expect(pair.cliWires.map((wire) => wire.body)).toEqual([
      { title: 'Morning pages, retitled' },
      { title: 'Evening pages, retitled' },
    ]);
    expect(pair.mcp.text).toBe(pair.cli.stdout);
  });

  // Task 6 AC 1 (§2.8): the camelCase op spelling resolves to the same call as the kebab one.
  it('resolves a camelCase bulk kind exactly as its kebab spelling', async () => {
    const kebab = await runBoth(GET_MANY);
    const camel = await runBoth({
      ...GET_MANY,
      argv: ['journals', 'getMany', '--items', 'journal-a', '--items', 'journal-b'],
    });

    expect(camel.cli.exit).toBe(0);
    expect(camel.cliWires).toEqual(kebab.cliWires);
    expect(camel.cli.stdout).toBe(kebab.cli.stdout);
  });

  it('sends the same deleteMany items and renders the same envelope', async () => {
    const pair = await runBoth(DELETE_MANY);

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.jsonRpcResult).not.toHaveProperty('isError');
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.cliWires.map((wire) => wire.method)).toEqual(['DELETE', 'DELETE']);
    expect(pair.mcp.text).toBe(pair.cli.stdout);
  });
});

describe('the envelope as structuredContent', () => {
  it('answers with the envelope itself at the root, and no {items} wrapping', async () => {
    const pair = await runBoth(GET_MANY);

    expect(pair.mcp.structured).toEqual(envelopeOf(pair.cli.stdout));
    expect(Object.keys(pair.mcp.structured ?? {})).toEqual([
      'total',
      'succeeded',
      'failed',
      'results',
    ]);
    expect(pair.mcp.structured).not.toHaveProperty('items');
  });
});

describe('the batch failure signal', () => {
  it('reports a partial failure in the envelope alone: no isError, exit 0', async () => {
    const pair = await runBoth(GET_MANY_WITH_ONE_MISSING);
    const envelope = envelopeOf(pair.cli.stdout);

    expect(envelope).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(envelope.results[1]).toMatchObject({ status: 'failed', error: ABSENT_JOURNAL_ERROR });
    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.jsonRpcResult).not.toHaveProperty('isError');
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.mcp.text).toBe(pair.cli.stdout);
  });

  it('reports a batch where nothing succeeded: isError, exit 1', async () => {
    const pair = await runBoth(GET_MANY_ALL_MISSING);

    expect(envelopeOf(pair.cli.stdout)).toMatchObject({ total: 2, succeeded: 0, failed: 2 });
    expect(pair.cli.exit).toBe(1);
    expect(pair.cli.stderr).toBe('');
    expect(pair.mcp.jsonRpcResult['isError']).toBe(true);
    expect(pair.mcpWires).toEqual(pair.cliWires);
    expect(pair.mcp.text).toBe(pair.cli.stdout);
  });
});

describe('one resolved cap, advertised and enforced', () => {
  const TIGHT_ENV: NodeJS.ProcessEnv = { ...process.env, LIFE_OPS_BULK_LIMIT: '2' };
  const OVER_CAP_MESSAGE =
    'journals.getMany failed (invalidInput): items: exceeds LIFE_OPS_BULK_LIMIT (2)';
  const ABOVE_THE_CAP: AdapterCall = {
    argv: [
      'journals',
      'get-many',
      '--items',
      'journal-a',
      '--items',
      'journal-b',
      '--items',
      'journal-a',
    ],
    tool: 'journals_get_many',
    args: { items: ['journal-a', 'journal-b', 'journal-a'] },
  };

  it("advertises the cap the adapter's own environment resolves", async () => {
    const stub = await startJournalsStub();

    try {
      const tools = await listMcpTools(stub, TIGHT_ENV);
      const getMany = tools.find((tool) => tool.name === GET_MANY.tool);

      expect(itemsSchemaOf(getMany).maxItems).toBe(2);
    } finally {
      await stub.stop();
    }
  });

  it("enforces that same cap on both adapters' calls before item 0 runs", async () => {
    const pair = await runBoth(ABOVE_THE_CAP, TIGHT_ENV);

    expect(pair.cli.exit).toBe(1);
    expect(pair.cli.stderr).toBe(OVER_CAP_MESSAGE);
    expect(pair.cliWires).toHaveLength(0);
    expect(pair.mcp.text).toBe(OVER_CAP_MESSAGE);
    expect(pair.mcp.jsonRpcResult['isError']).toBe(true);
    expect(pair.mcpWires).toHaveLength(0);
  });
});

describe('a JSON array where one id belongs', () => {
  it('refuses an --items value that is a JSON array of ids, naming the flag', async () => {
    const pair = await runBoth({
      ...DELETE_MANY,
      argv: ['journals', 'delete-many', '--items', '["journal-a","journal-b"]'],
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.cli.stderr).toBe(
      'journals.deleteMany failed (invalidInput): items: --items takes one id string per flag, not a JSON array; repeat the flag once per item',
    );
    expect(pair.cliWires).toHaveLength(0);
  });
});

/** Every tool the MCP adapter advertises for the fixture registry, under one environment. */
async function listMcpTools(stub: StubApi, env: NodeJS.ProcessEnv): Promise<McpTool[]> {
  const server = createMcpServer({
    registry: journals,
    apiBase: stub.baseUrl,
    env,
    stdout: () => {},
    stderr: () => {},
  });
  const reply = (await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  })) as { result: { tools: McpTool[] } };
  return reply.result.tools;
}

/** One tool's `items` property, or a failure naming the tool that lost it. */
function itemsSchemaOf(tool: McpTool | undefined): JsonSchemaProperty {
  if (tool === undefined) throw new Error('tools/list advertised no bulk tool');
  return tool.inputSchema.properties[BULK_WRAPPER_FIELD];
}

/** Runs one call through both adapters, each against an identically seeded journals stub. */
async function runBoth(
  call: AdapterCall,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterPair> {
  const cliStub = await startJournalsStub();
  const mcpStub = await startJournalsStub();
  try {
    return {
      cli: await driveCli(call, cliStub, env),
      mcp: await driveMcp(call, mcpStub, env),
      cliWires: wireShapesOf(cliStub),
      mcpWires: wireShapesOf(mcpStub),
    };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

/** The stub service the fixture registry dials: `/api/journals`, rows dropped on delete. */
function startJournalsStub(): Promise<StubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows: seededJournals(),
    collectionPath: COLLECTION_PATH,
  });
}

async function driveCli(
  call: AdapterCall,
  stub: StubApi,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runCli({
    argv: call.argv,
    service: async () => journalsService(),
    env: { ...env, LIFE_OPS_API_BASE: stub.baseUrl },
    stdout: (line) => {
      stdout.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
    },
    signIn: async () => {},
  });
  return { exit, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

async function driveMcp(
  call: AdapterCall,
  stub: StubApi,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpOutcome> {
  const server = createMcpServer({
    registry: journals,
    apiBase: stub.baseUrl,
    env,
    stdout: () => {},
    stderr: () => {},
  });
  const reply = (await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: call.tool, arguments: call.args },
  })) as {
    result: {
      content: { type: string; text: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
  };
  return {
    text: reply.result.content[0].text,
    jsonRpcResult: reply.result as unknown as Record<string, unknown>,
    structured: reply.result.structuredContent,
  };
}

function journalsService(): ServiceModule {
  return { registry: journals };
}

/** The rows every case starts from: two journals the owner may read, write, and delete. */
function seededJournals(): SampleRow[] {
  return [
    journalRow({ id: 'journal-a', title: 'Morning pages' }),
    journalRow({ id: 'journal-b', title: 'Evening pages' }),
  ];
}

function journalRow(fields: { id: string; title: string }): SampleRow {
  return {
    id: fields.id,
    ownerSub: OWNER_SUBJECT,
    version: 1,
    title: fields.title,
    body: `${fields.title}, written`,
  };
}

/** Every request the stub received, in the terms the wire decides. */
function wireShapesOf(stub: StubApi): WireShape[] {
  return stub.requestLog.map(wireShapeOf);
}

function wireShapeOf(recorded: StubApi['requestLog'][number]): WireShape {
  return {
    method: recorded.method,
    path: recorded.path,
    query: recorded.query,
    body: recorded.body,
    authorization: recorded.headers['authorization'],
  };
}

function envelopeOf(rendered: string): BulkEnvelope {
  return JSON.parse(rendered) as BulkEnvelope;
}

/** Creates answer server-chosen ids, so that one volatile field is redacted before comparing. */
function withRedactedRefIds(rendered: string): string {
  const envelope = envelopeOf(rendered);
  return JSON.stringify({ ...envelope, results: envelope.results.map(redactRefId) });
}

function redactRefId(result: BulkItemResult): BulkItemResult {
  if (result.status === 'failed') return result;
  return { ...result, ref: { ...(result.ref as Record<string, unknown>), id: '<id>' } };
}
