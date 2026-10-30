/**
 * Feedback parity suite (SPEC-ops-all-services §1.6) — the mirror of
 * `notes-parity.test.ts` for the single-resource `feedback` module. One feedback
 * call runs through the CLI adapter and through the MCP adapter (`tools/call`),
 * each against a freshly started, identically seeded stub service, and the
 * recorded HTTP request (method, path, query, JSON body) plus the rendered output
 * must match — all three ops, the submission and the status change included.
 * Error parity covers validator failure, `401`, and `404`. No test contacts a real
 * service or IdP.
 *
 * The registry block above the parity block pins the four decisions the spec argues
 * rather than derives: `POST /api/feedback` is reachable and takes the client's own
 * UUIDv4 idempotency key in the body (§1.7, Open Question 10.1), the `app`, `type`,
 * and status vocabularies appear in `FEEDBACK_APPS`, `FEEDBACK_TYPE_VALUES`, and
 * `FEEDBACK_STATUS_VALUES` order, and every `id` stays a plain string — the service
 * owns the UUIDv4 parse, so no pattern is restated here. The vocabularies are
 * imported by path because `@life/ops` declares no dependency on `@life/shared`;
 * jest still reads the constants the DTO validates against, which is what keeps the
 * two lists from drifting (`meal-parity.test.ts` holds the nutrient keys the same way).
 */
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FEEDBACK_APPS, FEEDBACK_STATUS_VALUES, FEEDBACK_TYPE_VALUES } from '../../shared/src';
import { main as runCli } from '../src/cli/run';
import { createMcpServer } from '../src/mcp/server';
import { findOp } from '../src/core/registry';
import * as feedbackService from '../src/services/feedback';
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
const REFUSED_TOKEN_MESSAGE = 'feedback.update failed (unauthenticated): Unauthorized';
const ABSENT_FEEDBACK_MESSAGE = 'feedback.update failed (notFound): Sample not found';
const EMPTY_UPDATE_MESSAGE = 'feedback.update failed (invalidInput): id: required; status: required';
const EMPTY_CREATE_MESSAGE = 'feedback.create failed (invalidInput): id: required';
const UNKNOWN_STATUS_MESSAGE =
  'feedback.update failed (invalidInput): status: expected one of open, in_progress, done, wont_do';
/** A row id no UUIDv4 pattern accepts: the stub holds it, so a `200` proves it travelled verbatim. */
const NOT_A_UUID = 'not-a-uuid-42';
const FEEDBACK_ROW_ID = '2f1c9d7e-8b3a-4c6d-9e0f-1a2b3c4d5e6f';
/**
 * What one submission sends: the client's own UUIDv4 idempotency key beside the four
 * payload fields `CreateFeedbackDto` declares. The stub answers its own id, so the
 * rendered comparison redacts that one volatile field.
 */
const SUBMISSION = {
  id: '9d1c2f44-0a3c-4b9e-9f21-6a5c8d7e0b13',
  app: 'meals',
  type: 'bug_report',
  title: 'Sodium entry lost',
  description: 'Logging 300 mg of sodium stored nothing',
};

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
/** What both adapters produced for one call, and the request each left behind. */
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

beforeEach(async () => {
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-feedback-parity-')), 'credentials.json');
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

describe('the feedback registry', () => {
  it('declares one resource at the service base path', () => {
    expect(registryOf().name).toBe('feedback');
    expect(registryOf().basePath).toBe('/api/feedback');
  });

  it('declares exactly three ops, the listing, the submission, and the status change', () => {
    expect(opNames()).toEqual(['feedback_list', 'feedback_create', 'feedback_update']);
    expect(registryOf().ops.map((operation) => operation.kind)).toEqual([
      'list',
      'create',
      'update',
    ]);
  });

  it('addresses the listing with no fields at all', () => {
    expect(Object.keys(findOp(registryOf(), 'list').fields)).toEqual([]);
  });

  it('takes the five fields `CreateFeedbackDto` declares, in its order', () => {
    const create = findOp(registryOf(), 'create');

    expect(Object.keys(create.fields)).toEqual(['id', 'app', 'type', 'title', 'description']);
    expect(Object.entries(create.fields).map(([name, field]) => [name, field.required])).toEqual([
      ['id', true],
      ['app', true],
      ['type', true],
      ['title', true],
      ['description', true],
    ]);
  });

  it('sends the id as a client-supplied idempotency key, not a server id', () => {
    const id = findOp(registryOf(), 'create').fields['id'];

    expect(id.type).toBe('string');
    expect(id.enum).toBeUndefined();
    expect(id.description).toContain('UUIDv4');
    expect(id.description).toContain('idempotency key');
  });

  it('spells the app vocabulary in FEEDBACK_APPS order', () => {
    const app = findOp(registryOf(), 'create').fields['app'];

    expect(app.type).toBe('string');
    expect(app.enum).toEqual(['notes', 'todos', 'meals', 'pomodoro', 'feedback']);
    expect(app.enum).toEqual(FEEDBACK_APPS);
  });

  it('spells the report vocabulary in FEEDBACK_TYPE_VALUES order', () => {
    const type = findOp(registryOf(), 'create').fields['type'];

    expect(type.type).toBe('string');
    expect(type.enum).toEqual(['feature_request', 'enhancement', 'bug_report']);
    expect(type.enum).toEqual(FEEDBACK_TYPE_VALUES);
  });

  it('states the two server-enforced length bounds', () => {
    const create = findOp(registryOf(), 'create');

    expect(create.fields['title'].description).toContain('200 characters');
    expect(create.fields['description'].description).toContain('2000 characters');
  });

  it('requires an id and a status to restatus a row', () => {
    const update = findOp(registryOf(), 'update');

    expect(Object.keys(update.fields)).toEqual(['id', 'status']);
    expect(update.fields['id'].required).toBe(true);
    expect(update.fields['status'].required).toBe(true);
  });

  it('carries the id as plain text, with no pattern restated from the service', () => {
    const id = findOp(registryOf(), 'update').fields['id'];

    expect(id.type).toBe('string');
    expect(id.enum).toBeUndefined();
    expect(Object.keys(id).sort()).toEqual(['description', 'required', 'type']);
    expect(id.description).toContain('UUIDv4');
  });

  it('spells the status vocabulary in FEEDBACK_STATUS_VALUES order', () => {
    const status = findOp(registryOf(), 'update').fields['status'];

    expect(status.enum).toEqual(['open', 'in_progress', 'done', 'wont_do']);
    expect(status.enum).toEqual(FEEDBACK_STATUS_VALUES);
    expect(status.description).toContain(FEEDBACK_STATUS_VALUES.join(', '));
  });
});

describe('feedback operation parity', () => {
  it('sends the same listing and renders the same rows', async () => {
    const pair = await runBoth({ argv: ['feedback', 'list'], tool: 'feedback_list', args: {} });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('GET');
    expect(pair.cliWire?.path).toBe('/api/feedback');
    expect(pair.cliWire?.body).toBeUndefined();
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('sends the same submission and renders the same new row', async () => {
    const pair = await runBoth({
      argv: [
        'feedback',
        'create',
        '--id',
        SUBMISSION.id,
        '--app',
        SUBMISSION.app,
        '--type',
        SUBMISSION.type,
        '--title',
        SUBMISSION.title,
        '--description',
        SUBMISSION.description,
      ],
      tool: 'feedback_create',
      args: SUBMISSION,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('POST');
    expect(pair.cliWire?.path).toBe('/api/feedback');
    expect(pair.cliWire?.query).toEqual({});
    expect(pair.cliWire?.body).toEqual(SUBMISSION);
    expect(redactedId(pair.mcp.text)).toBe(redactedId(pair.cli.text));
  });

  it('sends the same status change and renders the same row', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', FEEDBACK_ROW_ID, '--status', 'done'],
      tool: 'feedback_update',
      args: { id: FEEDBACK_ROW_ID, status: 'done' },
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.method).toBe('PATCH');
    expect(pair.cliWire?.path).toBe(`/api/feedback/${FEEDBACK_ROW_ID}`);
    expect(pair.cliWire?.body).toEqual({ status: 'done' });
    expect(pair.cliWire?.query).toEqual({});
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('leaves the row restatused on both adapters', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', FEEDBACK_ROW_ID, '--status', 'in_progress'],
      tool: 'feedback_update',
      args: { id: FEEDBACK_ROW_ID, status: 'in_progress' },
    });

    expectSuccessful(pair);
    expect(statusById(pair.cliRows, FEEDBACK_ROW_ID)).toBe('in_progress');
    expect(statusById(pair.mcpRows, FEEDBACK_ROW_ID)).toBe('in_progress');
  });

  it('sends a non-UUID id verbatim, the server being the only parser', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', NOT_A_UUID, '--status', 'wont_do'],
      tool: 'feedback_update',
      args: { id: NOT_A_UUID, status: 'wont_do' },
      seed: seededWithPlainId,
    });

    expectSuccessful(pair);
    expect(pair.cliWire?.path).toBe(`/api/feedback/${NOT_A_UUID}`);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

describe('feedback error parity', () => {
  it('renders a submission missing its required id identically and sends nothing', async () => {
    const pair = await runBoth({
      argv: [
        'feedback',
        'create',
        '--app',
        SUBMISSION.app,
        '--type',
        SUBMISSION.type,
        '--title',
        SUBMISSION.title,
        '--description',
        SUBMISSION.description,
      ],
      tool: 'feedback_create',
      args: {
        app: SUBMISSION.app,
        type: SUBMISSION.type,
        title: SUBMISSION.title,
        description: SUBMISSION.description,
      },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_CREATE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders a validator failure identically and sends nothing', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update'],
      tool: 'feedback_update',
      args: {},
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(EMPTY_UPDATE_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
    expect(pair.cliWire).toBeUndefined();
    expect(pair.mcpWire).toBeUndefined();
  });

  it('renders an unknown status identically and sends nothing', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', FEEDBACK_ROW_ID, '--status', 'archived'],
      tool: 'feedback_update',
      args: { id: FEEDBACK_ROW_ID, status: 'archived' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(UNKNOWN_STATUS_MESSAGE);
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
      argv: ['feedback', 'update', '--id', FEEDBACK_ROW_ID, '--status', 'done'],
      tool: 'feedback_update',
      args: { id: FEEDBACK_ROW_ID, status: 'done' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(REFUSED_TOKEN_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders an absent row identically', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', 'no-such-feedback', '--status', 'done'],
      tool: 'feedback_update',
      args: { id: 'no-such-feedback', status: 'done' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_FEEDBACK_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });

  it('renders a foreign row exactly like an absent one', async () => {
    const pair = await runBoth({
      argv: ['feedback', 'update', '--id', 'feedback-foreign', '--status', 'done'],
      tool: 'feedback_update',
      args: { id: 'feedback-foreign', status: 'done' },
    });

    expectFailed(pair);
    expect(pair.cli.text).toBe(ABSENT_FEEDBACK_MESSAGE);
    expect(pair.mcp.text).toBe(pair.cli.text);
  });
});

/** Runs one call through both adapters, each against an identically seeded stub. */
async function runBoth(call: AdapterCall): Promise<AdapterPair> {
  const seed = call.seed ?? seededFeedback;
  const cliStub = await startFeedbackStub(seed());
  const mcpStub = await startFeedbackStub(seed());
  try {
    const cli = await driveCli(call, cliStub);
    const mcp = await driveMcp(call, mcpStub);
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

/** The feedback contract's own shape: the one base path, and the rows the service keeps. */
function startFeedbackStub(rows: SampleRow[]): Promise<RecordingStubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows,
    collectionPath: registryOf().basePath,
  });
}

async function driveCli(call: AdapterCall, stub: StubApi): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runCli({
    argv: call.argv,
    service: async () => ({ registry: registryOf() }),
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
    registry: registryOf(),
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

function registryOf(): typeof feedbackService.service.registry {
  return feedbackService.service.registry;
}

/** Every `<resource>_<op>` tool name the module declares, in declaration order. */
function opNames(): string[] {
  return registryOf().ops.map((operation) => `${registryOf().name}_${operation.kind}`);
}

/** The row an owner holds, one of them owned by somebody else. */
function seededFeedback(): SampleRow[] {
  return [
    feedbackRow({ id: FEEDBACK_ROW_ID, status: 'open' }),
    feedbackRow({ id: 'feedback-foreign', status: 'open', ownerSub: 'owner-b' }),
  ];
}

/** The same rows, one addressed by an id no UUIDv4 pattern accepts. */
function seededWithPlainId(): SampleRow[] {
  return [feedbackRow({ id: NOT_A_UUID, status: 'open' })];
}

function feedbackRow(fields: { id: string; status: string; ownerSub?: string }): SampleRow {
  return {
    id: fields.id,
    ownerSub: fields.ownerSub ?? OWNER_SUBJECT,
    version: 0,
    status: fields.status,
  };
}

function statusById(rows: readonly SampleRow[], id: string): unknown {
  return rows.find((row) => row.id === id)?.['status'];
}

/** A create answers the stub's own id, so the comparison redacts that one volatile field. */
function redactedId(rendered: string): string {
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, id: '<id>' });
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
