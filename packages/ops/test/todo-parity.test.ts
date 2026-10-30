/**
 * Todo parity suite (SPEC-ops-all-services §1.2, §8) — the mirror of
 * `notes-parity.test.ts` for the five-resource `todo` module. One todo call runs
 * through the CLI adapter and through the MCP adapter (`tools/call`), each against
 * a freshly started, identically seeded stub service, and the recorded HTTP
 * request (method, path, query, JSON body) plus the rendered output must match —
 * all twelve ops of the five resources. Error parity covers validator failure,
 * missing token, `401`, `404` (foreign and missing ids), and `409` on a stale
 * `expectedVersion`. No test contacts a real service or IdP.
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run';
import { createMcpServer } from '../src/mcp/server';
import type { ResourceRegistry } from '../src/core/types';
import { resources } from '../src/services/todo';
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
  'todos.get failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'todos.get failed (unauthenticated): Unauthorized';
const ABSENT_TODO_MESSAGE = 'todos.get failed (notFound): Sample not found';
const STALE_VERSION_MESSAGE = 'todos.update failed (conflict): Sample was modified';
const EMPTY_CREATE_MESSAGE = 'todos.create failed (invalidInput): title: required';

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
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-todo-parity-')), 'credentials.json');
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

describe('the todo registry', () => {
  it('declares the five resources at their service base paths', () => {
    expect(resources.map((resource) => resource.name)).toEqual([
      'todos',
      'todos-tags',
      'todos-trash',
      'todos-completions',
      'lists',
    ]);
    expect(resources.map((resource) => resource.basePath)).toEqual([
      '/api/todos',
      '/api/todos/tags',
      '/api/todos/trash',
      '/api/todos/completions',
      '/api/lists',
    ]);
  });

  it('declares twelve ops across the five resources', () => {
    expect(opNames()).toHaveLength(12);
  });

  it('declares no push resource and no list delete, the two policy cuts', () => {
    expect(opNames()).not.toContain('lists_delete');
    expect(resources.map((resource) => resource.basePath)).not.toContain('/api/push');
  });

  it('keeps the todo patch free of null-means-clear fields', () => {
    expect(todoFieldTypes()).not.toContain('null');
    expect(todoFieldTypes()).toEqual(expect.arrayContaining(['number[]', 'boolean', 'string']));
  });
});

describe('todo operation parity', () => {
  it('sends the same create and renders the same todo', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: [
        'todos',
        'create',
        '--title',
        'Ship the release',
        '--note',
        'After the freeze',
        '--dueDate',
        '2026-03-01T09:30',
        '--repeat',
        'weekly',
        '--tagIds',
        '1',
        '--tagIds',
        '2',
        '--important',
      ],
      tool: 'todos_create',
      args: {
        title: 'Ship the release',
        note: 'After the freeze',
        dueDate: '2026-03-01T09:30',
        repeat: 'weekly',
        tagIds: [1, 2],
        important: true,
      },
    });

    expectSuccessful(pair);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same list and renders the same page', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: [
        'todos',
        'list',
        '--q',
        'release',
        '--listId',
        'list-a',
        '--tagId',
        '2',
        '--done',
        '--important',
        '--dueBefore',
        '2026-03-01',
        '--dueAfter',
        '2026-02-01',
        '--limit',
        '20',
      ],
      tool: 'todos_list',
      args: {
        q: 'release',
        listId: 'list-a',
        tagId: 2,
        done: true,
        important: true,
        dueBefore: '2026-03-01',
        dueAfter: '2026-02-01',
        limit: 20,
      },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('passes an opaque cursor through untouched', async () => {
    const cursor = Buffer.from('todo-a', 'utf8').toString('base64url');
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'list', '--limit', '1', '--cursor', cursor],
      tool: 'todos_list',
      args: { limit: 1, cursor },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.query['cursor']).toBe(cursor);
    expect(pair.mcpWire?.query['cursor']).toBe(cursor);
  });

  it('sends the same get and renders the same todo', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'get', '--id', 'todo-a'],
      tool: 'todos_get',
      args: { id: 'todo-a' },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same update and renders the same todo', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: [
        'todos',
        'update',
        '--id',
        'todo-a',
        '--title',
        'Ship the release twice',
        '--done',
        '--repeatDays',
        '1',
        '--repeatDays',
        '3',
        '--expectedVersion',
        '0',
      ],
      tool: 'todos_update',
      args: {
        id: 'todo-a',
        title: 'Ship the release twice',
        done: true,
        repeatDays: [1, 3],
        expectedVersion: 0,
      },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same delete and renders the same answer', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'delete', '--id', 'todo-b'],
      tool: 'todos_delete',
      args: { id: 'todo-b' },
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same restore and renders the same todo', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'restore', '--id', 'todo-trashed'],
      tool: 'todos_restore',
      args: { id: 'todo-trashed' },
      seed: seededWithTrashedTodo,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same tag-usage listing', async () => {
    const pair = await runBoth({
      resource: 'todos-tags',
      argv: ['todos-tags', 'list'],
      tool: 'todos-tags_list',
      args: {},
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.path).toBe('/api/todos/tags');
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same trash listing', async () => {
    const pair = await runBoth({
      resource: 'todos-trash',
      argv: ['todos-trash', 'list', '--limit', '5'],
      tool: 'todos-trash_list',
      args: { limit: 5 },
      seed: seededWithTrashedTodo,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same completion listing', async () => {
    const pair = await runBoth({
      resource: 'todos-completions',
      argv: ['todos-completions', 'list', '--limit', '5'],
      tool: 'todos-completions_list',
      args: { limit: 5 },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.path).toBe('/api/todos/completions');
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same list create and renders the same list', async () => {
    const pair = await runBoth({
      resource: 'lists',
      argv: ['lists', 'create', '--name', 'Errands', '--importantDefault'],
      tool: 'lists_create',
      args: { name: 'Errands', importantDefault: true },
      seed: seededLists,
    });

    expectSuccessful(pair);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same list listing', async () => {
    const pair = await runBoth({
      resource: 'lists',
      argv: ['lists', 'list'],
      tool: 'lists_list',
      args: {},
      seed: seededLists,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same list update and renders the same list', async () => {
    const pair = await runBoth({
      resource: 'lists',
      argv: ['lists', 'update', '--id', 'list-a', '--name', 'Errands', '--expectedVersion', '0'],
      tool: 'lists_update',
      args: { id: 'list-a', name: 'Errands', expectedVersion: 0 },
      seed: seededLists,
    });

    expectSuccessful(pair);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('todo trash state parity', () => {
  it('trashes the row todos_delete addresses, on both adapters', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'delete', '--id', 'todo-b'],
      tool: 'todos_delete',
      args: { id: 'todo-b' },
    });

    expect(pair.cliRows).toEqual(['todo-b']);
    expect(pair.mcpRows).toEqual(pair.cliRows);
  });

  it('returns the trashed row to the active set on todos_restore, on both adapters', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'restore', '--id', 'todo-trashed'],
      tool: 'todos_restore',
      args: { id: 'todo-trashed' },
      seed: seededWithTrashedTodo,
    });

    expect(pair.cliActive).toEqual(['todo-a', 'todo-b', 'todo-trashed']);
    expect(pair.mcpActive).toEqual(pair.cliActive);
    expect(pair.cliRows).toEqual([]);
    expect(pair.mcpRows).toEqual([]);
  });
});

describe('todo error parity', () => {
  it('renders a validator failure identically and sends nothing', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'create'],
      tool: 'todos_create',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_CREATE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a missing token identically and sends nothing', async () => {
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(dirname(credentialsFile), 'absent.json');
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'get', '--id', 'todo-a'],
      tool: 'todos_get',
      args: { id: 'todo-a' },
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
      resource: 'todos',
      argv: ['todos', 'get', '--id', 'todo-a'],
      tool: 'todos_get',
      args: { id: 'todo-a' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a missing todo identically', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'get', '--id', 'no-such-todo'],
      tool: 'todos_get',
      args: { id: 'no-such-todo' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_TODO_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign todo exactly like a missing one', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'get', '--id', 'todo-foreign'],
      tool: 'todos_get',
      args: { id: 'todo-foreign' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_TODO_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a stale version identically', async () => {
    const pair = await runBoth({
      resource: 'todos',
      argv: ['todos', 'update', '--id', 'todo-a', '--title', 'Late edit', '--expectedVersion', '999'],
      tool: 'todos_update',
      args: { id: 'todo-a', title: 'Late edit', expectedVersion: 999 },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(STALE_VERSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<PairedRun> {
  const seed = call.seed ?? seededTodos;
  const cliStub = await startTodoStub(call.resource, seed());
  const mcpStub = await startTodoStub(call.resource, seed());
  try {
    const cli = await driveCli(call, cliStub);
    const mcp = await driveMcp(call, mcpStub);
    return {
      cli,
      mcp,
      cliWire: wireShapeOf(cliStub),
      mcpWire: wireShapeOf(mcpStub),
      cliRows: trashedIds(cliStub.storedRows()),
      mcpRows: trashedIds(mcpStub.storedRows()),
      cliActive: activeIds(cliStub.storedRows()),
      mcpActive: activeIds(mcpStub.storedRows()),
    };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

/** One call's outcome on both adapters, plus the row state each stub was left in. */
interface PairedRun extends AdapterPair {
  cliRows: string[];
  mcpRows: string[];
  cliActive: string[];
  mcpActive: string[];
}

/** The todo contract's own shape: the resource's base path, and `DELETE` trashes. */
function startTodoStub(resourceName: string, rows: SampleRow[]): Promise<RecordingStubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows,
    collectionPath: registryOf(resourceName).basePath,
    deletePolicy: 'trash',
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
  const resource = resources.find((candidate) => candidate.name === resourceName);
  if (resource === undefined) throw new Error(`unknown todo resource: ${resourceName}`);
  return resource;
}

/** Every `<resource>_<op>` tool name the module declares, in declaration order. */
function opNames(): string[] {
  return resources.flatMap((resource) =>
    resource.ops.map((operation) => `${resource.name}_${operation.kind}`),
  );
}

/** The declared type of every field on every todo op. */
function todoFieldTypes(): string[] {
  const todoResource = registryOf('todos');
  return todoResource.ops.flatMap((operation) =>
    Object.values(operation.fields).map((field) => field.type),
  );
}

/** The todo rows every case starts from, one of them owned by somebody else. */
function seededTodos(): SampleRow[] {
  return [
    todoRow({ id: 'todo-a', title: 'Ship the release' }),
    todoRow({ id: 'todo-b', title: 'Buy milk' }),
    todoRow({ id: 'todo-foreign', title: 'Not mine', ownerSub: 'owner-b' }),
  ];
}

function seededWithTrashedTodo(): SampleRow[] {
  return [
    ...seededTodos(),
    todoRow({
      id: 'todo-trashed',
      title: 'Throw the boxes out',
      deletedAt: '2026-10-01T09:00:00.000Z',
    }),
  ];
}

function todoRow(fields: {
  id: string;
  title: string;
  ownerSub?: string;
  deletedAt?: string;
}): SampleRow {
  return {
    id: fields.id,
    ownerSub: fields.ownerSub ?? OWNER_SUBJECT,
    version: 0,
    title: fields.title,
    done: false,
    ...(fields.deletedAt === undefined ? {} : { deletedAt: fields.deletedAt }),
  };
}

function seededLists(): SampleRow[] {
  return [
    { id: 'list-a', ownerSub: OWNER_SUBJECT, version: 0, name: 'Home', importantDefault: false },
    { id: 'list-b', ownerSub: OWNER_SUBJECT, version: 0, name: 'Work', importantDefault: true },
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

function activeIds(rows: readonly SampleRow[]): string[] {
  return idsOf(ownedRows(rows).filter((row) => !isTrashed(row)));
}

function trashedIds(rows: readonly SampleRow[]): string[] {
  return idsOf(ownedRows(rows).filter(isTrashed));
}

/** The owner's rows only: the stub also holds the foreign todo no adapter may see. */
function ownedRows(rows: readonly SampleRow[]): SampleRow[] {
  return rows.filter((row) => row.ownerSub === OWNER_SUBJECT);
}

function idsOf(rows: readonly SampleRow[]): string[] {
  return rows.map((row) => row.id).sort();
}

function isTrashed(row: SampleRow): boolean {
  return row.deletedAt !== undefined && row.deletedAt !== null;
}

/** Creates assign server-chosen ids, so the comparison redacts that one volatile field. */
function redactedId(rendered: string): string {
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, id: '<id>' });
}
