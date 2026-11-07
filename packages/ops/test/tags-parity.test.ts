/**
 * Tags parity suite (SPEC-ops-all-services §1.4, §9.8) — the mirror of
 * `notes-parity.test.ts` for the two-resource `tags` module. One tag call runs
 * through the CLI adapter and through the MCP adapter (`tools/call`), each against
 * a freshly started, identically seeded stub service, and the recorded HTTP request
 * (method, path, query, JSON body) plus the rendered output must match — all four
 * ops, the numeric-id rename included. Error parity covers validator failure, missing
 * token, `401`, `404` (foreign and missing ids), and `409` on a stale
 * `expectedVersion`. No test contacts a real service or IdP.
 *
 * The registry block above the parity block is what pins the two decisions the spec
 * argues rather than derives: `tags-resolve` carries the run's single
 * `isDestructive: false` override, and `DELETE /api/tags/:id` exists nowhere.
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run';
import { createMcpServer } from '../src/mcp/server';
import { findOp } from '../src/core/registry';
import type { ResourceRegistry } from '../src/core/types';
import * as tagsService from '../src/services/tags';
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
  'tags.list failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'tags.list failed (unauthenticated): Unauthorized';
const ABSENT_TAG_MESSAGE = 'tags.update failed (notFound): Sample not found';
const STALE_VERSION_MESSAGE = 'tags.update failed (conflict): Sample was modified';
const EMPTY_CREATE_MESSAGE = 'tags.create failed (invalidInput): name: required';
const EMPTY_RESOLVE_MESSAGE = 'tags-resolve.create failed (invalidInput): ids: required';

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
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-tags-parity-')), 'credentials.json');
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

describe('the tags registry', () => {
  it('declares the two resources at their service base paths', () => {
    expect(tagsService.resources.map((resource) => resource.name)).toEqual(['tags', 'tags-resolve']);
    expect(tagsService.resources.map((resource) => resource.basePath)).toEqual([
      '/api/tags',
      '/api/tags/resolve',
    ]);
  });

  it('declares four ops across the two resources', () => {
    expect(opNames()).toEqual(['tags_create', 'tags_list', 'tags_update', 'tags-resolve_create']);
  });

  it('carries no api base and keeps resolve the one non-destructive create', () => {
    expect('apiBase' in tagsService).toBe(false);
    expect(destructiveOps()).toEqual(['tags_create', 'tags_update']);
    expect(findOp(registryOf('tags-resolve'), 'create').isDestructive).toBe(false);
  });

  it('declares no delete on tags, the policy cut', () => {
    expect(opNames()).not.toContain('tags_delete');
    expect(registryOf('tags').ops.map((operation) => operation.kind)).toEqual([
      'create',
      'list',
      'update',
    ]);
  });

  it('addresses a rename by numeric id and carries only the rename in the body', () => {
    const update = findOp(registryOf('tags'), 'update');
    expect(update.fields['id'].type).toBe('number');
    expect(update.fields['id'].required).toBe(true);
    expect(Object.keys(update.fields)).toEqual(['id', 'name', 'expectedVersion']);
  });

  it('addresses the listing with the two paging fields, in order', () => {
    const list = findOp(registryOf('tags'), 'list');

    expect(Object.keys(list.fields)).toEqual(['limit', 'cursor']);
    expect(list.fields['limit'].type).toBe('number');
    expect(list.fields['limit'].description).toContain('1 to 200');
    expect(list.fields['cursor'].description).toContain('passed back untouched');
  });

  it('requires a numeric id list to resolve', () => {
    const resolve = findOp(registryOf('tags-resolve'), 'create');
    expect(resolve.fields['ids'].type).toBe('number[]');
    expect(resolve.fields['ids'].required).toBe(true);
  });
});

describe('tags operation parity', () => {
  it('sends the same create and renders the same tag', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'create', '--name', 'errands'],
      tool: 'tags_create',
      args: { name: 'errands' },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('POST');
    expect(pair.cliWire?.path).toBe('/api/tags');
    expect(pair.cliWire?.body).toEqual({ name: 'errands' });
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same list and renders the same page', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'list'],
      tool: 'tags_list',
      args: {},
      seed: seededTags,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('GET');
    expect(pair.cliWire?.path).toBe('/api/tags');
    expect(pair.cliWire?.body).toBeUndefined();
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same paged listing and passes the cursor through untouched', async () => {
    const cursor = Buffer.from('home', 'utf8').toString('base64url');
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'list', '--limit', '20', '--cursor', cursor],
      tool: 'tags_list',
      args: { limit: 20, cursor },
      seed: seededTags,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('GET');
    expect(pair.cliWire?.path).toBe('/api/tags');
    expect(pair.cliWire?.query).toEqual({ limit: '20', cursor });
    expect(pair.mcpWire?.query).toEqual(pair.cliWire?.query);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same numeric-id rename and renders the same tag', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'update', '--id', '7', '--name', 'errands', '--expectedVersion', '0'],
      tool: 'tags_update',
      args: { id: 7, name: 'errands', expectedVersion: 0 },
      seed: seededTags,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('PATCH');
    expect(pair.cliWire?.path).toBe('/api/tags/7');
    expect(pair.cliWire?.body).toEqual({ name: 'errands', expectedVersion: 0 });
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same resolve and renders the same tags', async () => {
    const pair = await runBoth({
      resource: 'tags-resolve',
      argv: ['tags-resolve', 'create', '--ids', '7', '--ids', '9'],
      tool: 'tags-resolve_create',
      args: { ids: [7, 9] },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('POST');
    expect(pair.cliWire?.path).toBe('/api/tags/resolve');
    expect(pair.cliWire?.body).toEqual({ ids: [7, 9] });
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });
});

describe('tags error parity', () => {
  it('refuses a create with no name and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'create'],
      tool: 'tags_create',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_CREATE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('refuses a resolve with no ids and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'tags-resolve',
      argv: ['tags-resolve', 'create'],
      tool: 'tags-resolve_create',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_RESOLVE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a missing token identically and sends nothing', async () => {
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(dirname(credentialsFile), 'absent.json');
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'list'],
      tool: 'tags_list',
      args: {},
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
      resource: 'tags',
      argv: ['tags', 'list'],
      tool: 'tags_list',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a missing tag identically', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'update', '--id', '404', '--name', 'late'],
      tool: 'tags_update',
      args: { id: 404, name: 'late' },
      seed: seededTags,
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_TAG_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign tag exactly like a missing one', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'update', '--id', '8', '--name', 'late'],
      tool: 'tags_update',
      args: { id: 8, name: 'late' },
      seed: seededTags,
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_TAG_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a stale version identically', async () => {
    const pair = await runBoth({
      resource: 'tags',
      argv: ['tags', 'update', '--id', '7', '--name', 'late', '--expectedVersion', '999'],
      tool: 'tags_update',
      args: { id: 7, name: 'late', expectedVersion: 999 },
      seed: seededTags,
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(STALE_VERSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const seed = call.seed ?? seededTags;
  const cliStub = await startTagsStub(call.resource, seed());
  const mcpStub = await startTagsStub(call.resource, seed());
  try {
    const cli = await driveCli(call, cliStub);
    const mcp = await driveMcp(call, mcpStub);
    return { cli, mcp, cliWire: wireShapeOf(cliStub), mcpWire: wireShapeOf(mcpStub) };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

/** The tag contract's own shape: the resource's base path, and rows the service keeps. */
function startTagsStub(resourceName: string, rows: SampleRow[]): Promise<RecordingStubApi> {
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
  const resource = tagsService.resources.find((candidate) => candidate.name === resourceName);
  if (resource === undefined) throw new Error(`unknown tags resource: ${resourceName}`);
  return resource;
}

/** Every `<resource>_<op>` tool name the module declares, in declaration order. */
function opNames(): string[] {
  return tagsService.resources.flatMap((resource) =>
    resource.ops.map((operation) => `${resource.name}_${operation.kind}`),
  );
}

/** The tool names whose op would ask a human first; every write but resolve. */
function destructiveOps(): string[] {
  return tagsService.resources.flatMap((resource) =>
    resource.ops
      .filter((operation) => operation.isDestructive === true)
      .map((operation) => `${resource.name}_${operation.kind}`),
  );
}

/** The tag rows every case starts from, one of them owned by somebody else. */
function seededTags(): SampleRow[] {
  return [
    tagRow({ id: '7', name: 'errands' }),
    tagRow({ id: '9', name: 'home' }),
    tagRow({ id: '8', name: 'Not mine', ownerSub: 'owner-b' }),
  ];
}

function tagRow(fields: { id: string; name: string; ownerSub?: string }): SampleRow {
  return {
    id: fields.id,
    ownerSub: fields.ownerSub ?? OWNER_SUBJECT,
    version: 0,
    name: fields.name,
  };
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

/** Creates assign server-chosen ids, so the comparison redacts those volatile fields. */
function redactedId(rendered: string): string {
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  const redacted = Array.isArray(parsed)
    ? parsed.map((entry) => ({ ...(entry as Record<string, unknown>), id: '<id>' }))
    : { ...parsed, id: '<id>' };
  return JSON.stringify(redacted);
}
