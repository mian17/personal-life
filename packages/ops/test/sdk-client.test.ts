/**
 * Official-SDK conformance suite (SPEC-ops-agent-contract §3.8, §10.9): the one
 * place in the package that imports an MCP SDK. It spawns the server's own stdio
 * entry (`src/mcp/entry.ts`, not the library in `src/mcp/server.ts`) — TypeScript
 * source, through `test/support/transpile-require.cjs`, with no `dist` build — and
 * drives it with the SDK's `Client` over `StdioClientTransport`, so an independent
 * implementation proves the handshake, the tool surface, and one round trip
 * through the stub service.
 *
 * The SDK is loaded with `require` so it answers from its own `dist/cjs` build;
 * no `src/` module imports it, and neither does any other suite.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeTokens } from '../src/auth/token-store.js';
import { renderOpsResult } from '../src/cli/render.js';
import { sampleApiToken, startStubApi } from './support/stub-api.js';
import type { StubApi } from './support/stub-api.js';

const { Client } = require('@modelcontextprotocol/sdk/client') as SdkModule;
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as SdkModule;

const SERVER_ENTRY = 'src/mcp/entry.ts';
const TRANSPILE_HOOK = './test/support/transpile-require.cjs';
const SERVICE_MODULE = 'test/support/service-module.ts';
const OWNER_SUBJECT = 'agent-under-test';
const ROW = { id: 'row-a', title: 'Row A', version: 1 };
/** The version the spawned entry reads out of `package.json` and the handshake reports. */
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version: string }
).version;
const ONE_HOUR_MS = 3_600_000;
const CONNECT_TIMEOUT_MS = 15_000;

/** The tool surface this registry must present, one row per registered op. */
const EXPECTED_TOOLS: ExpectedTool[] = [
  expectedTool('sample_create', 'Create sample', {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  }),
  expectedTool('sample_get', 'Get sample', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  expectedTool('sample_list', 'List sample', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  expectedTool('sample_update', 'Update sample', {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  }),
  expectedTool('sample_delete', 'Delete sample', {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  }),
];

let stubApi: StubApi;
/** Set by a test that answers from its own service instead of the shared stub. */
let apiBaseOverride: string | undefined;
let credentialDirectory: string;
let savedCredentialsPath: string | undefined;

beforeEach(async () => {
  stubApi = await startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows: [{ ...ROW, ownerSub: OWNER_SUBJECT }],
  });
  credentialDirectory = mkdtempSync(join(tmpdir(), 'life-ops-sdk-client-'));
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = join(credentialDirectory, 'credentials.json');
  await storeTokens({
    accessToken: sampleApiToken,
    refreshToken: 'stub.refresh.token',
    expiresAt: Date.now() + ONE_HOUR_MS,
  });
});

afterEach(async () => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(credentialDirectory, { recursive: true, force: true });
  await stubApi.stop();
});

describe('the official SDK client over the spawned stdio entry', () => {
  it('completes the initialize handshake', async () => {
    await withSdkSession(async (session) => {
      expect(session.serverVersion()?.name).toBe('life-ops');
      expect(session.serverVersion()?.version).toBe(PACKAGE_VERSION);
    });
  });

  it('lists every registered tool with its title and all four hints', async () => {
    await withSdkSession(async (session) => {
      const tools = await session.listTools();

      expect(tools.map(describedTool)).toEqual(EXPECTED_TOOLS);
    });
  });

  it('round-trips one call through the stub service', async () => {
    await withSdkSession(async (session) => {
      const result = await session.callTool('sample_get', { id: ROW.id });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(ROW);
      expect(textOf(result)).toBe(renderOpsResult({ status: 200, body: ROW }));
    });
  });

  it('returns a list-shaped body a conformant client accepts', async () => {
    const arrayApi = await startBareArrayApi();
    apiBaseOverride = arrayApi.baseUrl;
    try {
      await withSdkSession(async (session) => {
        const result = await session.callTool('sample_list', {});

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({ items: [ROW] });
      });
    } finally {
      apiBaseOverride = undefined;
      await arrayApi.stop();
    }
  });

  it('leaves no process behind when the session closes', async () => {
    const session = await openSdkSession();

    expect(isRunning(session.pid)).toBe(true);
    await session.close();
    expect(isRunning(session.pid)).toBe(false);
  });
});

/** One connected SDK session: the calls the suite makes, and the child it owns. */
interface SdkSession {
  /** The spawned server's pid, asserted gone once the session closes. */
  pid: number;
  serverVersion(): { name: string; version: string } | undefined;
  listTools(): Promise<SdkTool[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<SdkToolResult>;
  close(): Promise<void>;
}

/** Connect, run the assertions, then close — so a failing assertion still kills the child. */
async function withSdkSession(assertions: (session: SdkSession) => Promise<void>): Promise<void> {
  const session = await openSdkSession();
  try {
    await assertions(session);
  } finally {
    await session.close();
  }
}

/** Spawn the stdio entry through the SDK transport and finish the handshake. */
async function openSdkSession(): Promise<SdkSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--require', TRANSPILE_HOOK, SERVER_ENTRY],
    cwd: packageRoot(),
    env: serverEnvironment(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'life-ops-conformance', version: '0.0.0' });
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);
  return {
    pid: spawnedPidOf(transport),
    serverVersion: () => client.getServerVersion(),
    listTools: async () => (await client.listTools()).tools,
    callTool: async (name, input) => await client.callTool({ name, arguments: input }),
    close: () => client.close(),
  };
}

/** What the spawned child reads: its service module, the stub API, the suite's credentials. */
function serverEnvironment(): Record<string, string> {
  return {
    LIFE_OPS_SERVICE: join(packageRoot(), SERVICE_MODULE),
    LIFE_OPS_API_BASE: apiBaseOverride ?? stubApi.baseUrl,
    LIFE_OPS_CREDENTIALS_PATH: join(credentialDirectory, 'credentials.json'),
  };
}

/** The package directory the suite runs from — the child's cwd, so relative paths line up. */
function packageRoot(): string {
  return join(__dirname, '..');
}

/**
 * A service that answers a collection `GET` with a bare row array, the way
 * `apps/tags-service` `list()` does — the shape a conformant client rejects when it
 * reaches `structuredContent` unwrapped (SPEC-ops-agent-contract §3.3).
 */
async function startBareArrayApi(): Promise<BareArrayApi> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify([ROW]));
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => closeServer(server) };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((closed, fail) => {
    server.closeAllConnections();
    server.close((error) => (error === undefined ? closed() : fail(error)));
  });
}

/** The transport knows its pid only after `start`; `connect` already ran it. */
function spawnedPidOf(transport: { pid: number | null }): number {
  if (transport.pid === null) throw new Error('the SDK transport spawned no child');
  return transport.pid;
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([work, rejectAfter(milliseconds)]);
}

/** An unref'd timer: it fails a hung handshake without holding the suite open. */
function rejectAfter(milliseconds: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`the handshake did not finish within ${milliseconds} ms`)),
      milliseconds,
    ).unref();
  });
}

/** Whether a pid still exists: signal `0` asks the OS without touching the process. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One tool as the SDK delivers it, reduced to the fields a gate reads. */
interface SdkTool {
  name: string;
  title?: string;
  annotations?: SdkToolHints;
}

/** The four behavior hints, as MCP spells them. */
interface SdkToolHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One expected `tools/list` row: the name, the title, every hint stated. */
interface ExpectedTool {
  name: string;
  title: string;
  annotations: SdkToolHints;
}

function expectedTool(name: string, title: string, annotations: SdkToolHints): ExpectedTool {
  return { name, title, annotations };
}

function describedTool(tool: SdkTool): ExpectedTool {
  return { name: tool.name, title: tool.title ?? '', annotations: tool.annotations ?? {} };
}

/** What `tools/call` answered: the canonical text part, and the body beside it. */
interface SdkToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

function textOf(result: SdkToolResult): string | undefined {
  return result.content.find((part) => part.type === 'text')?.text;
}

/** A loopback service the list-shaped test owns, so the shared stub fixture stays untouched. */
interface BareArrayApi {
  baseUrl: string;
  stop: () => Promise<void>;
}

/** The SDK's own CommonJS entry points, typed to the two constructors this suite uses. */
interface SdkModule {
  Client: new (clientInfo: { name: string; version: string }) => {
    connect(transport: unknown): Promise<void>;
    getServerVersion(): { name: string; version: string } | undefined;
    listTools(): Promise<{ tools: SdkTool[] }>;
    callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<SdkToolResult>;
    close(): Promise<void>;
  };
  StdioClientTransport: new (parameters: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    stderr: 'pipe';
  }) => { pid: number | null };
}
