/**
 * Parity suite (SPEC.md §3, §7, §9.2, §9.4) — the centerpiece. The same input
 * runs through the CLI adapter and through the MCP adapter (`tools/call`),
 * each against a freshly started, identically seeded stub API, and the
 * recorded HTTP requests (method, path, query, JSON body) plus the rendered
 * outputs must match. Error parity too: a validator failure, a missing token,
 * `401`, `404` (foreign and missing byte-identical), and `409` render the same
 * canonical message through both adapters.
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run.js';
import { createMcpServer } from '../src/mcp/server.js';
import { sampleRegistry } from '../src/fixtures/sample.js';
import { storeTokens } from '../src/auth/token-store.js';
import { sampleApiToken, startStubApi, type SampleRow, type StubApi } from './support/stub-api.js';

const OWNER = 'owner-a';
const VALID_REFRESH = 'stub.refresh.token';

const MISSING_TOKEN_MESSAGE =
  'sample.get failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'sample.get failed (unauthenticated): Unauthorized';
const ABSENT_ROW_MESSAGE = 'sample.get failed (notFound): Sample not found';
const STALE_VERSION_MESSAGE = 'sample.update failed (conflict): Sample was modified';
const EMPTY_CREATE_MESSAGE = 'sample.create failed (invalidInput): title: required';

/** One adapter call in both dialects: CLI flags and the MCP tool arguments. */
interface AdapterCall {
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

/** What both adapters produced from one call, with what the stubs recorded. */
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
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-parity-')), 'credentials.json');
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
  await storeTokens({
    accessToken: sampleApiToken,
    refreshToken: VALID_REFRESH,
    expiresAt: Date.now() + 3600000,
  });
});

afterEach(() => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(dirname(credentialsFile), { recursive: true, force: true });
});

describe('operation parity', () => {
  it('sends the same create and renders the same row', async () => {
    const pair = await runBoth({
      argv: [
        'sample',
        'create',
        '--title',
        'New',
        '--priority',
        '3',
        '--archived',
        '--labels',
        'x',
        '--labels',
        'y',
      ],
      tool: 'sample_create',
      args: { title: 'New', priority: 3, archived: true, labels: ['x', 'y'] },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same get and renders the same row', async () => {
    const pair = await runBoth({
      argv: ['sample', 'get', '--id', 'row-a'],
      tool: 'sample_get',
      args: { id: 'row-a' },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same list and renders the same page', async () => {
    const pair = await runBoth({
      argv: ['sample', 'list', '--limit', '1', '--includeArchived'],
      tool: 'sample_list',
      args: { limit: 1, includeArchived: true },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same update and renders the same row', async () => {
    const pair = await runBoth({
      argv: ['sample', 'update', '--id', 'row-a', '--title', 'Renamed', '--expectedVersion', '1'],
      tool: 'sample_update',
      args: { id: 'row-a', title: 'Renamed', expectedVersion: 1 },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same delete and renders the same row', async () => {
    const pair = await runBoth({
      argv: ['sample', 'delete', '--id', 'row-b'],
      tool: 'sample_delete',
      args: { id: 'row-b' },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('error parity', () => {
  it('renders a validator failure identically and sends nothing', async () => {
    const pair = await runBoth({ argv: ['sample', 'create'], tool: 'sample_create', args: {} });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(EMPTY_CREATE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a missing token identically and sends nothing', async () => {
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(dirname(credentialsFile), 'absent.json');
    const pair = await runBoth({
      argv: ['sample', 'get', '--id', 'row-a'],
      tool: 'sample_get',
      args: { id: 'row-a' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(MISSING_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a refused token identically', async () => {
    await storeTokens({
      accessToken: 'bogus',
      refreshToken: undefined,
      expiresAt: Date.now() + 3600000,
    });
    const pair = await runBoth({
      argv: ['sample', 'get', '--id', 'row-a'],
      tool: 'sample_get',
      args: { id: 'row-a' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a missing row identically', async () => {
    const pair = await runBoth({
      argv: ['sample', 'get', '--id', 'no-such-row'],
      tool: 'sample_get',
      args: { id: 'no-such-row' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(ABSENT_ROW_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign row exactly like a missing one', async () => {
    const pair = await runBoth({
      argv: ['sample', 'get', '--id', 'row-foreign'],
      tool: 'sample_get',
      args: { id: 'row-foreign' },
      seed: seededWithForeignRow,
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(ABSENT_ROW_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a stale version identically', async () => {
    const pair = await runBoth({
      argv: ['sample', 'update', '--id', 'row-a', '--title', 'Renamed', '--expectedVersion', '999'],
      tool: 'sample_update',
      args: { id: 'row-a', title: 'Renamed', expectedVersion: 999 },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(STALE_VERSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const seed = call.seed ?? seededRows;
  const cliStub = await startStubApi({ ownerSubject: OWNER, rows: seed() });
  const mcpStub = await startStubApi({ ownerSubject: OWNER, rows: seed() });
  try {
    const cli = await driveCli(call.argv, cliStub);
    const mcp = await driveMcp(call.tool, call.args, mcpStub);
    return { cli, mcp, cliWire: wireShapeOf(cliStub), mcpWire: wireShapeOf(mcpStub) };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

async function driveCli(argv: string[], stub: StubApi): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runCli({
    argv,
    service: async () => ({ registry: sampleRegistry }),
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

async function driveMcp(
  tool: string,
  args: Record<string, unknown>,
  stub: StubApi,
): Promise<McpOutcome> {
  const server = createMcpServer({
    registry: sampleRegistry,
    apiBase: stub.baseUrl,
    env: process.env,
    stdout: () => {},
    stderr: () => {},
  });
  const reply = (await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  })) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
  return { text: reply.result.content[0].text, failed: reply.result.isError === true };
}

function seededRows(): SampleRow[] {
  return [
    { id: 'row-a', title: 'Row A', version: 1, ownerSub: OWNER },
    { id: 'row-b', title: 'Row B', version: 1, ownerSub: OWNER },
    { id: 'row-c', title: 'Row C', version: 1, ownerSub: OWNER },
  ];
}

function seededWithForeignRow(): SampleRow[] {
  return [
    ...seededRows(),
    { id: 'row-foreign', title: 'Foreign', version: 1, ownerSub: 'owner-b' },
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

/** Creates assign server-chosen ids, so comparisons redact the one volatile field. */
function redactedId(rendered: string): string {
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, id: '<id>' });
}
