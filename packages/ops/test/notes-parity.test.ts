/**
 * Notes parity suite (SPEC-ops-notes-service §6, §8.4) — the centerpiece. One notes
 * call runs through the CLI adapter and through the MCP adapter (`tools/call`),
 * each against a freshly started, identically seeded stub service, and the
 * recorded HTTP request (method, path, query, JSON body) plus the rendered output
 * must match — all six kinds, `restore` included. Error parity covers the notes
 * registry too: validator failure, missing token, `401`, `404` (foreign and
 * missing ids), and `409` on a stale `expectedVersion` render one canonical
 * message through both adapters. No test contacts a real service or IdP.
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { main as runCli } from '../src/cli/run.js';
import { createMcpServer } from '../src/mcp/server.js';
import { service } from '../src/services/notes.js';
import { storeTokens } from '../src/auth/token-store.js';
import {
  sampleApiToken,
  startStubApi,
  type RecordingStubApi,
  type SampleRow,
  type StubApi,
} from './support/stub-api.js';

const OWNER_SUBJECT = 'owner-a';
const VALID_REFRESH_TOKEN = 'stub.refresh.token';
const ONE_HOUR_MS = 3_600_000;

const MISSING_TOKEN_MESSAGE =
  'notes.get failed (unauthenticated): no token found, run `npm run ops -- login` first';
const REFUSED_TOKEN_MESSAGE = 'notes.get failed (unauthenticated): Unauthorized';
const ABSENT_NOTE_MESSAGE = 'notes.get failed (notFound): Sample not found';
const STALE_VERSION_MESSAGE = 'notes.update failed (conflict): Sample was modified';
const EMPTY_CREATE_MESSAGE = 'notes.create failed (invalidInput): body: required';

/** The same call in both dialects: CLI flags and MCP tool arguments. */
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

/** What both adapters produced for one call, and the stub state each left behind. */
interface AdapterPair {
  cli: CliOutcome;
  mcp: McpOutcome;
  cliWire: WireShape | undefined;
  mcpWire: WireShape | undefined;
  cliRows: readonly SampleRow[];
  mcpRows: readonly SampleRow[];
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
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-notes-parity-')), 'credentials.json');
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

describe('notes operation parity', () => {
  it('sends the same create and renders the same note', async () => {
    const pair = await runBoth({
      argv: ['notes', 'create', '--body', 'Call the dentist', '--tagIds', '1', '--tagIds', '2'],
      tool: 'notes_create',
      args: { body: 'Call the dentist', tagIds: [1, 2] },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same get and renders the same note', async () => {
    const pair = await runBoth({
      argv: ['notes', 'get', '--id', 'note-a'],
      tool: 'notes_get',
      args: { id: 'note-a' },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same list and renders the same page', async () => {
    const pair = await runBoth({
      argv: ['notes', 'list', '--limit', '20', '--tagId', '2', '--q', 'milk'],
      tool: 'notes_list',
      args: { limit: 20, tagId: 2, q: 'milk' },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same update and renders the same note', async () => {
    const pair = await runBoth({
      argv: [
        'notes',
        'update',
        '--id',
        'note-a',
        '--body',
        'Call the dentist twice',
        '--expectedVersion',
        '0',
      ],
      tool: 'notes_update',
      args: { id: 'note-a', body: 'Call the dentist twice', expectedVersion: 0 },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same delete and renders the same answer', async () => {
    const pair = await runBoth({
      argv: ['notes', 'delete', '--id', 'note-b'],
      tool: 'notes_delete',
      args: { id: 'note-b' },
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same restore and renders the same note', async () => {
    const pair = await runBoth({
      argv: ['notes', 'restore', '--id', 'note-trashed'],
      tool: 'notes_restore',
      args: { id: 'note-trashed' },
      seed: seededWithTrashedNote,
    });

    expect(pair.cli.exit).toBe(0);
    expect(pair.mcp.failed).toBe(false);
    expect(pair.mcpWire).toEqual(pair.cliWire);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('notes trash state parity', () => {
  it('trashes the row notes_delete addresses, on both adapters', async () => {
    const pair = await runBoth({
      argv: ['notes', 'delete', '--id', 'note-b'],
      tool: 'notes_delete',
      args: { id: 'note-b' },
    });

    expect(trashedIds(pair.cliRows)).toEqual(['note-b']);
    expect(trashedIds(pair.mcpRows)).toEqual(trashedIds(pair.cliRows));
  });

  it('returns the trashed row to the active set on notes_restore, on both adapters', async () => {
    const pair = await runBoth({
      argv: ['notes', 'restore', '--id', 'note-trashed'],
      tool: 'notes_restore',
      args: { id: 'note-trashed' },
      seed: seededWithTrashedNote,
    });

    expect(activeIds(pair.cliRows)).toEqual(['note-a', 'note-b', 'note-trashed']);
    expect(activeIds(pair.mcpRows)).toEqual(activeIds(pair.cliRows));
    expect(trashedIds(pair.cliRows)).toEqual([]);
    expect(trashedIds(pair.mcpRows)).toEqual([]);
  });
});

describe('notes error parity', () => {
  it('renders a validator failure identically and sends nothing', async () => {
    const pair = await runBoth({ argv: ['notes', 'create'], tool: 'notes_create', args: {} });

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
      argv: ['notes', 'get', '--id', 'note-a'],
      tool: 'notes_get',
      args: { id: 'note-a' },
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
      expiresAt: Date.now() + ONE_HOUR_MS,
    });
    const pair = await runBoth({
      argv: ['notes', 'get', '--id', 'note-a'],
      tool: 'notes_get',
      args: { id: 'note-a' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a missing note identically', async () => {
    const pair = await runBoth({
      argv: ['notes', 'get', '--id', 'no-such-note'],
      tool: 'notes_get',
      args: { id: 'no-such-note' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(ABSENT_NOTE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign note exactly like a missing one', async () => {
    const pair = await runBoth({
      argv: ['notes', 'get', '--id', 'note-foreign'],
      tool: 'notes_get',
      args: { id: 'note-foreign' },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(ABSENT_NOTE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a stale version identically', async () => {
    const pair = await runBoth({
      argv: [
        'notes',
        'update',
        '--id',
        'note-a',
        '--body',
        'Late edit',
        '--expectedVersion',
        '999',
      ],
      tool: 'notes_update',
      args: { id: 'note-a', body: 'Late edit', expectedVersion: 999 },
    });

    expect(pair.cli.exit).toBe(1);
    expect(pair.mcp.failed).toBe(true);
    expect(pair.cli.text).toBe(STALE_VERSION_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded notes stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const seed = call.seed ?? seededNotes;
  const cliStub = await startNotesStub(seed());
  const mcpStub = await startNotesStub(seed());
  try {
    const cli = await driveCli(call.argv, cliStub);
    const mcp = await driveMcp(call.tool, call.args, mcpStub);
    return {
      cli,
      mcp,
      cliWire: wireShapeOf(cliStub),
      mcpWire: wireShapeOf(mcpStub),
      cliRows: cliStub.storedRows(),
      mcpRows: mcpStub.storedRows(),
    };
  } finally {
    await cliStub.stop();
    await mcpStub.stop();
  }
}

/** The notes contract's own shape: `/api/notes`, and `DELETE` trashes instead of dropping. */
function startNotesStub(rows: SampleRow[]): Promise<RecordingStubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows,
    collectionPath: '/api/notes',
    deletePolicy: 'trash',
  });
}

async function driveCli(argv: string[], stub: StubApi): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runCli({
    argv,
    service: async () => ({ registry: service.registry }),
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
    registry: service.registry,
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

/** The note rows every case starts from, one of them owned by somebody else. */
function seededNotes(): SampleRow[] {
  return [
    noteRow({ id: 'note-a', body: 'Call the dentist' }),
    noteRow({ id: 'note-b', body: 'Buy milk' }),
    noteRow({ id: 'note-foreign', body: 'Not mine', ownerSub: 'owner-b' }),
  ];
}

function seededWithTrashedNote(): SampleRow[] {
  return [
    ...seededNotes(),
    noteRow({
      id: 'note-trashed',
      body: 'Throw the boxes out',
      deletedAt: '2026-10-01T09:00:00.000Z',
    }),
  ];
}

function noteRow(fields: {
  id: string;
  body: string;
  ownerSub?: string;
  deletedAt?: string;
}): SampleRow {
  return {
    id: fields.id,
    ownerSub: fields.ownerSub ?? OWNER_SUBJECT,
    version: 0,
    body: fields.body,
    tagIds: [],
    ...(fields.deletedAt === undefined ? {} : { deletedAt: fields.deletedAt }),
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

function activeIds(rows: readonly SampleRow[]): string[] {
  return idsOf(ownedRows(rows).filter((row) => !isTrashed(row)));
}

function trashedIds(rows: readonly SampleRow[]): string[] {
  return idsOf(ownedRows(rows).filter(isTrashed));
}

/** The owner's rows only: the stub also holds the foreign note no adapter may see. */
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
