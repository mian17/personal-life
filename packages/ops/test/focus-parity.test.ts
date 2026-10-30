/**
 * Focus parity suite (SPEC-ops-all-services §1.5) — the mirror of
 * `tags-parity.test.ts` for the two-resource `focus` module. One focus call runs
 * through the CLI adapter and through the MCP adapter (`tools/call`), each against a
 * freshly started, identically seeded stub service, and the recorded HTTP request
 * (method, path, query, JSON body) plus the rendered output must match — all three
 * ops, the required session range included. Error parity covers validator failure,
 * missing token, and `401`. No test contacts a real service or IdP.
 *
 * The registry block pins the two decisions the spec argues rather than derives:
 * `goal` is read-only through this package (no `PUT`-shaped op), and `minutes`
 * carries no local bound — the service owns 1–180 (§9.13).
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run';
import { createMcpServer } from '../src/mcp/server';
import { findOp } from '../src/core/registry';
import type { ResourceRegistry } from '../src/core/types';
import * as focusService from '../src/services/focus';
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
  'sessions.list failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'sessions.list failed (unauthenticated): Unauthorized';
const OPEN_RANGE_MESSAGE = 'sessions.list failed (invalidInput): from: required; to: required';
const EMPTY_SESSION_MESSAGE =
  'sessions.create failed (invalidInput): date: required; minutes: required';

/** The same call in both dialects: CLI flags and MCP tool arguments. */
interface AdapterCall {
  resource: string;
  argv: string[];
  tool: string;
  args: Record<string, unknown>;
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

beforeEach(async () => {
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-focus-parity-')), 'credentials.json');
  process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
  await storeTokens({
    accessToken: sampleApiToken,
    refreshToken: VALID_REFRESH_TOKEN,
    expiresAt: Date.now() + ONE_HOUR_MS,
  });
});

afterEach(() => {
  delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  rmSync(dirname(credentialsFile), { recursive: true, force: true });
});

describe('the focus registry', () => {
  it('declares the two resources at their service base paths', () => {
    expect(focusService.resources.map((resource) => resource.name)).toEqual(['goal', 'sessions']);
    expect(focusService.resources.map((resource) => resource.basePath)).toEqual([
      '/api/goal',
      '/api/sessions',
    ]);
  });

  it('declares three ops across the two resources', () => {
    expect(opNames()).toEqual(['goal_list', 'sessions_create', 'sessions_list']);
  });

  it('reads the goal but never writes it, the policy cut', () => {
    expect(registryOf('goal').ops.map((operation) => operation.kind)).toEqual(['list']);
  });

  it('requires both range bounds to list sessions', () => {
    const list = findOp(registryOf('sessions'), 'list');
    expect(Object.keys(list.fields)).toEqual(['from', 'to']);
    expect(list.fields['from'].required).toBe(true);
    expect(list.fields['to'].required).toBe(true);
  });

  it('sends a session as a day and whole minutes, with no local bound', () => {
    const create = findOp(registryOf('sessions'), 'create');
    expect(Object.keys(create.fields)).toEqual(['date', 'minutes']);
    expect(create.fields['date'].type).toBe('string');
    expect(create.fields['date'].required).toBe(true);
    expect(create.fields['minutes'].type).toBe('number');
    expect(create.fields['minutes'].required).toBe(true);
    expect(create.fields['minutes'].enum).toBeUndefined();
  });
});

describe('focus operation parity', () => {
  it('sends the same goal read and renders the same goals', async () => {
    const pair = await runBoth({
      resource: 'goal',
      argv: ['goal', 'list'],
      tool: 'goal_list',
      args: {},
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('GET');
    expect(pair.cliWire?.path).toBe('/api/goal');
    expect(pair.cliWire?.body).toBeUndefined();
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same session and renders the same row', async () => {
    const pair = await runBoth({
      resource: 'sessions',
      argv: ['sessions', 'create', '--date', '2026-10-14', '--minutes', '25'],
      tool: 'sessions_create',
      args: { date: '2026-10-14', minutes: 25 },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('POST');
    expect(pair.cliWire?.path).toBe('/api/sessions');
    expect(pair.cliWire?.body).toEqual({ date: '2026-10-14', minutes: 25 });
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same range and renders the same sessions', async () => {
    const pair = await runBoth({
      resource: 'sessions',
      argv: ['sessions', 'list', '--from', '2026-10-01', '--to', '2026-10-14'],
      tool: 'sessions_list',
      args: { from: '2026-10-01', to: '2026-10-14' },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('GET');
    expect(pair.cliWire?.path).toBe('/api/sessions');
    expect(pair.cliWire?.query).toEqual({ from: '2026-10-01', to: '2026-10-14' });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('focus error parity', () => {
  it('refuses a session with neither day nor minutes and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'sessions',
      argv: ['sessions', 'create'],
      tool: 'sessions_create',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_SESSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('refuses a range with no bounds and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'sessions',
      argv: ['sessions', 'list'],
      tool: 'sessions_list',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(OPEN_RANGE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a missing token identically and sends nothing', async () => {
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(dirname(credentialsFile), 'absent.json');
    const pair = await runBoth({
      resource: 'sessions',
      argv: ['sessions', 'list', '--from', '2026-10-01', '--to', '2026-10-14'],
      tool: 'sessions_list',
      args: { from: '2026-10-01', to: '2026-10-14' },
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
      resource: 'sessions',
      argv: ['sessions', 'list', '--from', '2026-10-01', '--to', '2026-10-14'],
      tool: 'sessions_list',
      args: { from: '2026-10-01', to: '2026-10-14' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const cliStub = await startFocusStub(call.resource);
  const mcpStub = await startFocusStub(call.resource);
  try {
    const cli = await driveCli(call, cliStub);
    const mcp = await driveMcp(call, mcpStub);
    return { cli, mcp, cliWire: wireShapeOf(cliStub), mcpWire: wireShapeOf(mcpStub) };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

/** The focus contract's own shape: the resource's base path, and the rows the service keeps. */
function startFocusStub(resourceName: string): Promise<RecordingStubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows: seededRows(resourceName),
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
  const resource = focusService.resources.find((candidate) => candidate.name === resourceName);
  if (resource === undefined) throw new Error(`unknown focus resource: ${resourceName}`);
  return resource;
}

/** Every `<resource>_<op>` tool name the module declares, in declaration order. */
function opNames(): string[] {
  return focusService.resources.flatMap((resource) =>
    resource.ops.map((operation) => `${resource.name}_${operation.kind}`),
  );
}

/** The rows each resource's listing reads back: goals by day, sessions by their minute count. */
function seededRows(resourceName: string): SampleRow[] {
  if (resourceName === 'goal') return [focusRow({ id: 'goal-a', date: '2026-10-13', minutes: 50 })];
  return [
    focusRow({ id: 'session-a', date: '2026-10-13', minutes: 25 }),
    focusRow({ id: 'session-b', date: '2026-10-14', minutes: 50 }),
  ];
}

/** One stored focus row: the day it applies to, and the whole minutes it counts. */
function focusRow(fields: { id: string; date: string; minutes: number }): SampleRow {
  return { ...fields, ownerSub: OWNER_SUBJECT, version: 0 };
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
