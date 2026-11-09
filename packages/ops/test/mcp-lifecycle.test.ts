/**
 * Lifecycle suite (SPEC-ops-agent-contract §3.1, §3.3, §10.1): hand-written stdin
 * lines run through the one loop a real client drives, and every reply that comes
 * back is a JSON-RPC object on the injected stdout. The handshake (`initialize`,
 * the inert `notifications/initialized`, `ping`), the two bad-line error codes,
 * the arrival-order rule, and the additive `structuredContent` field all assert
 * here, so conformance holds with no SDK in the loop.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { storeTokens } from '../src/auth/token-store.js';
import { renderOpsResult } from '../src/cli/render.js';
import type { LoadedModule } from '../src/cli/run.js';
import type { ResourceRegistry } from '../src/core/types.js';
import { sampleRegistry } from '../src/fixtures/sample.js';
import { createMcpServer, main, type McpServer, type McpServerOptions } from '../src/mcp/server.js';
import { resolveDeadlineMs } from '../src/transport/executor.js';
import { sampleApiToken } from './support/stub-api.js';

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
).version;

const STUB_OWNER_TOKEN = sampleApiToken;
const ONE_HOUR_MS = 3_600_000;
const UNREACHABLE_API = 'http://127.0.0.1:1';
const REPLY_TIMEOUT_MS = 2_000;
const SHORT_DEADLINE_MS = 100;
/** Longer than the deadline under test, short enough that a hang cannot sit in the suite. */
const SHORT_WAIT_MS = 250;

interface Reply {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** One server with the two line lists a run writes into. */
interface Recorder {
  options: McpServerOptions;
  stdout: string[];
  stderr: string[];
}

/** A stub service that answers every request with one canned status and body. */
interface StubService {
  baseUrl: string;
  stop: () => Promise<void>;
}

/** One canned answer, written back to the caller verbatim. */
interface CannedResponse {
  status: number;
  body: string;
}

let credentialDirectory = '';
let savedCredentialsPath: string | undefined;

beforeEach(async () => {
  credentialDirectory = mkdtempSync(join(tmpdir(), 'life-ops-lifecycle-'));
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = join(credentialDirectory, 'credentials.json');
  await storeTokens({
    accessToken: STUB_OWNER_TOKEN,
    refreshToken: 'stub.refresh.token',
    expiresAt: Date.now() + ONE_HOUR_MS,
  });
});

afterEach(() => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(credentialDirectory, { recursive: true, force: true });
});

describe('handshake', () => {
  it('echoes a version it speaks', async () => {
    const reply = await ask(serverOver(UNREACHABLE_API), 'initialize', {
      protocolVersion: '2025-06-18',
    });

    expect(protocolVersionOf(reply)).toBe('2025-06-18');
  });

  it('answers the highest version it speaks when asked for an unknown one', async () => {
    const reply = await ask(serverOver(UNREACHABLE_API), 'initialize', {
      protocolVersion: '1999-01-01',
    });

    expect(protocolVersionOf(reply)).toBe('2025-11-25');
  });

  it('declares the tools capability and its own identity', async () => {
    const reply = await ask(serverOver(UNREACHABLE_API), 'initialize', {
      protocolVersion: '2025-06-18',
    });
    const result = reply.result as {
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    };

    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo.name).toBe('life-ops');
  });

  // The library takes the version as an option; `src/mcp/entry.ts` is what reads `package.json`.
  it('reports the version the stdio entry passes it', async () => {
    const reply = await ask(serverOver(UNREACHABLE_API), 'initialize', {
      protocolVersion: '2025-06-18',
    });

    expect(serverVersionOf(reply)).toBe(PACKAGE_VERSION);
  });

  it('answers ping with an empty result', async () => {
    const reply = await ask(serverOver(UNREACHABLE_API), 'ping');

    expect(reply).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
});

describe('notifications', () => {
  it('answers no notification, whichever one arrives', async () => {
    const server = serverOver(UNREACHABLE_API);

    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/whatever' })).toBeNull();
  });
});

describe('bad lines', () => {
  it('answers -32700 to an unparseable line, and says so on stderr only', async () => {
    const recorder = record(UNREACHABLE_API);
    await serveLines(recorder, { lines: ['{"jsonrpc":"2.0","id":1'], answers: 1 });

    expect(replies(recorder)).toEqual([
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse error: incoming line is not valid JSON' },
      },
    ]);
    expect(recorder.stderr).toHaveLength(1);
  });

  it('answers -32600 to a parseable line that is not a request', async () => {
    const recorder = record(UNREACHABLE_API);
    await serveLines(recorder, { lines: ['{"jsonrpc":"2.0","id":1}'], answers: 1 });

    expect(replies(recorder)).toEqual([
      expect.objectContaining({ id: null, error: expect.objectContaining({ code: -32600 }) }),
    ]);
    expect(recorder.stderr).toEqual([]);
  });

  it('keeps answering after a bad line instead of throwing', async () => {
    const recorder = record(UNREACHABLE_API);
    await serveLines(recorder, {
      lines: ['not json at all', '{"id":1}', '{"jsonrpc":"2.0","id":2,"method":"ping"}'],
      answers: 3,
    });

    expect(replies(recorder).map((reply) => reply.id)).toEqual([null, null, 2]);
    expect(recorder.stderr).toHaveLength(1);
  });

  it('keeps the answers it already gave for a bad method and a bad call', async () => {
    const server = serverOver(UNREACHABLE_API);

    expect((await ask(server, 'tools/nope')).error?.code).toBe(-32601);
    expect((await ask(server, 'tools/call', {})).error?.code).toBe(-32602);
  });
});

describe('stdout purity', () => {
  it('writes only JSON-RPC objects, in arrival order', async () => {
    const api = await startStubService();
    try {
      const recorder = record(api.baseUrl);
      await serveLines(recorder, {
        lines: [
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}',
          '{"jsonrpc":"2.0","method":"notifications/initialized"}',
          '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
          '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sample_get","arguments":{"id":"row-a"}}}',
        ],
        answers: 3,
      });

      const answered = replies(recorder);
      expect(answered.map((reply) => reply.id)).toEqual([1, 2, 3]);
      expect(answered.every((reply) => reply.jsonrpc === '2.0')).toBe(true);
      expect(renderedBodyOf(answered[2] as Reply)).toEqual({
        id: 'row-a',
        title: 'Row A',
        version: 1,
      });
    } finally {
      await api.stop();
    }
  });
});

describe('structuredContent', () => {
  it('carries an object body verbatim beside the canonical text', async () => {
    const api = await startStubService();
    try {
      expect(structuredContentOf(await callGet(api.baseUrl))).toEqual({
        id: 'row-a',
        title: 'Row A',
        version: 1,
      });
    } finally {
      await api.stop();
    }
  });

  it('counts an empty JSON object as an object', async () => {
    const api = await startCannedApi({ status: 200, body: '{}' });
    try {
      expect(structuredContentOf(await callGet(api.baseUrl))).toEqual({});
    } finally {
      await api.stop();
    }
  });

  it('wraps an array body as { items } so a conformant client can read it', async () => {
    const api = await startCannedApi({ status: 200, body: '[{"id":"row-a","version":1}]' });
    try {
      expect(structuredContentOf(await callGet(api.baseUrl))).toEqual({
        items: [{ id: 'row-a', version: 1 }],
      });
    } finally {
      await api.stop();
    }
  });

  it.each([
    { shape: 'a JSON string', body: '"row-a"' },
    { shape: 'a number', body: '42' },
    { shape: 'a boolean', body: 'true' },
    { shape: 'raw non-JSON text', body: 'Row A' },
  ])('declares no structuredContent for $shape', async ({ body }) => {
    const api = await startCannedApi({ status: 200, body });
    try {
      expect(structuredContentOf(await callGet(api.baseUrl))).toBeUndefined();
    } finally {
      await api.stop();
    }
  });

  it('declares no structuredContent when the body is absent', async () => {
    const api = await startCannedApi({ status: 200, body: '' });
    try {
      expect(structuredContentOf(await callGet(api.baseUrl))).toBeUndefined();
    } finally {
      await api.stop();
    }
  });

  it('keeps a failed call isError, with no structuredContent', async () => {
    const api = await startCannedApi({
      status: 404,
      body: '{"message":"Sample not found"}',
    });
    try {
      const result = (await callGet(api.baseUrl)).result as {
        isError?: boolean;
        structuredContent?: unknown;
      };

      expect(result.isError).toBe(true);
      expect('structuredContent' in result).toBe(false);
    } finally {
      await api.stop();
    }
  });

  it('keeps content[0].text the canonical render of the same body', async () => {
    const body = {
      rows: [{ id: 'row-a', labels: ['one', 'two'], version: 1 }],
      nextCursor: 'page-2',
    };
    const api = await startCannedApi({ status: 200, body: JSON.stringify(body) });
    try {
      const reply = await callGet(api.baseUrl);
      const result = reply.result as { content: { text: string }[]; structuredContent?: unknown };

      expect(result.content).toEqual([
        { type: 'text', text: renderOpsResult({ status: 200, body }) },
      ]);
      expect(result.structuredContent).toEqual(body);
    } finally {
      await api.stop();
    }
  });
});

describe('a union of loaded modules', () => {
  it('lists the tools of every loaded module, in load order then registry order', async () => {
    const reply = await ask(serverOverUnion(unionRun({})), 'tools/list');

    expect(toolNamesOf(reply)).toEqual([
      'sample_create',
      'sample_get',
      'sample_list',
      'sample_update',
      'sample_delete',
      'lists_list',
    ]);
  });

  it('dials each tool at the base of the module that owns it', async () => {
    const sampleApi = await startCannedApi({ status: 200, body: '{"id":"row-a","name":"sample"}' });
    const listsApi = await startCannedApi({ status: 200, body: '{"items":[]}' });
    try {
      const server = serverOverUnion(
        unionRun({
          LIFE_OPS_API_BASE_SAMPLE: sampleApi.baseUrl,
          LIFE_OPS_API_BASE_LISTS: listsApi.baseUrl,
        }),
      );

      const sampleReply = await ask(server, 'tools/call', {
        name: 'sample_get',
        arguments: { id: 'row-a' },
      });
      const listsReply = await ask(server, 'tools/call', { name: 'lists_list', arguments: {} });

      expect(renderedBodyOf(sampleReply)).toEqual({ id: 'row-a', name: 'sample' });
      expect(renderedBodyOf(listsReply)).toEqual({ items: [] });
    } finally {
      await sampleApi.stop();
      await listsApi.stop();
    }
  });

  it('names an unknown tool rather than reaching any served base', async () => {
    const reply = await ask(serverOverUnion(unionRun({})), 'tools/call', {
      name: 'lists_nope',
      arguments: {},
    });

    expect(reply.error).toEqual({ code: -32602, message: 'unknown tool: lists_nope' });
  });
});

describe('the per-call deadline', () => {
  it.each([
    { name: 'no setting', env: {}, expected: 30_000 },
    { name: 'a millisecond count', env: { LIFE_OPS_DEADLINE_MS: '5000' }, expected: 5_000 },
    { name: 'zero', env: { LIFE_OPS_DEADLINE_MS: '0' }, expected: 0 },
    { name: 'unparseable text', env: { LIFE_OPS_DEADLINE_MS: 'soon' }, expected: 30_000 },
    { name: 'a negative value', env: { LIFE_OPS_DEADLINE_MS: '-5' }, expected: 30_000 },
  ])('resolves $name to $expected ms', ({ env, expected }) => {
    expect(resolveDeadlineMs(env)).toBe(expected);
  });

  it('answers a silent backend with the rendered timeout failure', async () => {
    const api = await startSilentApi();
    try {
      const reply = await callGet(api.baseUrl, { LIFE_OPS_DEADLINE_MS: String(SHORT_DEADLINE_MS) });
      const result = reply.result as { content: { text: string }[]; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: `sample.get failed (timeout): sample.get did not answer within ${SHORT_DEADLINE_MS} ms`,
        },
      ]);
    } finally {
      await api.stop();
    }
  });

  it('leaves the same silent call in flight when the deadline is disabled', async () => {
    const api = await startSilentApi();
    try {
      const pending = callGet(api.baseUrl, { LIFE_OPS_DEADLINE_MS: '0' });

      expect(await settleWithin(pending, SHORT_WAIT_MS)).toBe('in flight');
    } finally {
      await api.stop();
    }
  });
});

/** A server over the sample registry with writers a test never reads. */
function serverOver(apiBase: string): McpServer {
  return serverOverConfigured(apiBase, process.env);
}

/** The second loaded module's registry, so a union server has two resources to serve. */
const listsRegistry: ResourceRegistry = {
  name: 'lists',
  basePath: '/api/lists',
  ops: [{ kind: 'list', fields: {} }],
};

/** A run over two loaded modules, under the environment a test adds to. */
function unionRun(settings: NodeJS.ProcessEnv): McpServerOptions {
  const modules: LoadedModule[] = [
    { entry: 'sample', name: 'sample', resources: [sampleRegistry] },
    { entry: 'lists', name: 'lists', resources: [listsRegistry] },
  ];
  return {
    registry: modules.flatMap((module) => module.resources),
    modules,
    serverVersion: PACKAGE_VERSION,
    env: { ...process.env, ...settings },
    stdout: () => {},
    stderr: () => {},
  };
}

function serverOverUnion(options: McpServerOptions): McpServer {
  return createMcpServer(options);
}

/** The tool names a `tools/list` reply carries, in the order it declared them. */
function toolNamesOf(reply: Reply): string[] {
  return (reply.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
}

/** The same server under a given environment, so the deadline knob is a test's to set. */
function serverOverConfigured(apiBase: string, env: NodeJS.ProcessEnv): McpServer {
  return createMcpServer({
    registry: sampleRegistry,
    apiBase,
    serverVersion: PACKAGE_VERSION,
    env,
    stdout: () => {},
    stderr: () => {},
  });
}

/** One authenticated `sample_get` call against `apiBase` under `env`, as the reply it produced. */
async function callGet(apiBase: string, env: NodeJS.ProcessEnv = process.env): Promise<Reply> {
  return await ask(serverOverConfigured(apiBase, env), 'tools/call', {
    name: 'sample_get',
    arguments: { id: 'row-a' },
  });
}

/** The `structuredContent` of a reply, or `undefined` when the key is absent. */
function structuredContentOf(reply: Reply): unknown {
  return (reply.result as { structuredContent?: unknown }).structuredContent;
}

/** The same server, plus the two line lists its writes land in. */
function record(apiBase: string): Recorder {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const options: McpServerOptions = {
    registry: sampleRegistry,
    apiBase,
    serverVersion: PACKAGE_VERSION,
    env: process.env,
    stdout: (line) => {
      stdout.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
    },
  };
  return { options, stdout, stderr };
}

/** One stdin run: the lines a client sends, and how many of them are requests. */
interface StdinRun {
  lines: string[];
  answers: number;
}

/** Feed the run's lines through the real stdin binding, close it, wait for its answers. */
async function serveLines(recorder: Recorder, run: StdinRun): Promise<void> {
  const listeners = watchedStdinListeners();
  try {
    const served = main(recorder.options);
    for (const line of run.lines) listeners.data(`${line}\n`);
    listeners.end();
    await served;
    await untilWritten(recorder, run.answers);
  } finally {
    jest.restoreAllMocks();
  }
}

/** Stands in for the byte stream: `main` binds these two listeners; the test calls them. */
function watchedStdinListeners(): { data: (chunk: string) => void; end: () => void } {
  const listeners: StdinListeners = {};
  jest.spyOn(process.stdin, 'setEncoding').mockReturnValue(process.stdin);
  jest
    .spyOn(process.stdin, 'on')
    .mockImplementation(watchStdin(listeners) as typeof process.stdin.on);
  return {
    data: (chunk) => listeners['data']?.(chunk),
    end: () => listeners['end']?.(),
  };
}

/** What `main` bound, keyed by event name, so the test can stand in for the bytes. */
type StdinListeners = Record<string, ((chunk?: string) => void) | undefined>;

function watchStdin(listeners: StdinListeners) {
  return (event: string, listener: (chunk?: string) => void) => {
    listeners[event] = listener;
    return process.stdin;
  };
}

/** A reply is written after its handler settles, so wait for the last one. */
async function untilWritten(recorder: Recorder, expected: number): Promise<void> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (recorder.stdout.length < expected && Date.now() < deadline) await pause(5);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function replies(recorder: Recorder): Reply[] {
  return recorder.stdout.map((line) => JSON.parse(line) as Reply);
}

async function ask(server: McpServer, method: string, params?: unknown): Promise<Reply> {
  const fields: Record<string, unknown> = { jsonrpc: '2.0', id: 1, method };
  if (params !== undefined) fields['params'] = params;
  return (await server.handle(fields)) as Reply;
}

function protocolVersionOf(reply: Reply): unknown {
  return (reply.result as { protocolVersion: string }).protocolVersion;
}

function serverVersionOf(reply: Reply): unknown {
  return (reply.result as { serverInfo: { version: string } }).serverInfo.version;
}

/** The service body the canonical render prints, read back out of the text part. */
function renderedBodyOf(reply: Reply): unknown {
  const result = reply.result as { content: { text: string }[] };
  return JSON.parse(result.content[0]?.text ?? 'null') as unknown;
}

/** One fixed row body for every authenticated request, so a call reaches the wire. */
async function startStubService(): Promise<StubService> {
  return await startCannedApi({
    status: 200,
    body: '{"id":"row-a","title":"Row A","version":1}',
  });
}

/** A loopback stub answering every request with the one canned response. */
async function startCannedApi(canned: CannedResponse): Promise<StubService> {
  const server = createServer((_request, response) => {
    response.writeHead(canned.status, { 'content-type': 'application/json' });
    response.end(canned.body);
  });
  const port = await listenOnLoopback(server);
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => closeServer(server) };
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

/** A loopback service that accepts the request and never answers it, so a deadline can fire. */
async function startSilentApi(): Promise<StubService> {
  const server = createServer(() => {});
  const port = await listenOnLoopback(server);
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => closeSilentApi(server) };
}

/** The held connections outlive their replies, so they are dropped before the server closes. */
function closeSilentApi(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

/** Whether the call settled inside `waitMs`; a call still waiting answers `in flight`. */
async function settleWithin(
  call: Promise<unknown>,
  waitMs: number,
): Promise<'settled' | 'in flight'> {
  const settled = call.then(
    () => 'settled' as const,
    () => 'settled' as const,
  );
  return await Promise.race([settled, waitFor(waitMs)]);
}

function waitFor(waitMs: number): Promise<'in flight'> {
  return new Promise((resolve) => setTimeout(() => resolve('in flight'), waitMs));
}
