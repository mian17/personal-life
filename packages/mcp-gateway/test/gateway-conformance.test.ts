/**
 * The gateway's client-facing contract, proven rather than asserted (SPEC-mcp-gateway §8 "Success
 * Criteria"): a client registers one `mcpServers` entry for the gateway and sees every upstream's
 * tools through it; registering app #51 is one key added to the gateway's own config file, with no
 * gateway source change; and a real independent client — the official
 * `@modelcontextprotocol/sdk` `Client` over `StdioClientTransport` — completes the handshake,
 * lists the merged table, calls one tool through the gateway, and sees the identical names in the
 * identical order on a second, cached list.
 *
 * The entry is TypeScript source driven through `packages/ops`'s own `transpile-require.cjs` hook,
 * the `packages/ops/test/sdk-client.test.ts` pattern: no `dist` build in between, and the SDK is
 * loaded with `require` so no `src` module ever imports it.
 *
 * The SDK validates every `tools/list` reply against its own `ToolSchema`, which keeps `name`,
 * `description`, `inputSchema`, `annotations` and `_meta` and drops every other field. The
 * tool-level fields the gateway must forward untouched — `defer_loading`, `tool_reference`, and a
 * made-up one — are therefore asserted on the gateway's own reply line, where they are readable;
 * `_meta` and a made-up result field are asserted through the SDK's `tools/call` round trip, whose
 * schema passes unknown fields through.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import { createMcpServer } from '../src/server';
import type { McpServer, McpServerOptions } from '../src/server';

const { Client } = require('@modelcontextprotocol/sdk/client') as SdkModule;
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as SdkModule;

jest.setTimeout(30_000);

/** The gateway's stdio entry, spawned the way a client's own `mcpServers` block spawns it. */
const SERVER_ENTRY = 'src/server.ts';

/** `packages/ops`'s require hook, reused rather than forked, so the entry needs no build. */
const TRANSPILE_HOOK = join(__dirname, '..', '..', 'ops', 'test', 'support', 'transpile-require.cjs');

const FIXTURE_CONFIG = join(__dirname, 'support', 'fixtures', 'gateway-config.json');

const CONNECT_TIMEOUT_MS = 20_000;

/** The apps the fixture config registers, in its declaration order. */
const REGISTERED_UPSTREAM_COUNT = 2;

const NOTES_TOOL_META = { app: 'notes', owner: 'personal' };

const NOTES_TOOLS: readonly Record<string, unknown>[] = [
  {
    name: 'create',
    description: 'Create a note',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    defer_loading: true,
    tool_reference: { app: 'notes' },
    _meta: NOTES_TOOL_META,
    backend_extension: { audited: true },
  },
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object' } },
];

const TODOS_TOOLS: readonly Record<string, unknown>[] = [
  { name: 'add', description: 'Add a todo', inputSchema: { type: 'object' } },
];

const CALENDAR_TOOLS: readonly Record<string, unknown>[] = [
  { name: 'schedule', description: 'Schedule an event', inputSchema: { type: 'object' } },
];

/** The upstream's answer to the one call this suite makes, unknown fields included. */
const NOTES_CREATE_RESULT: Record<string, unknown> = {
  content: [{ type: 'text', text: 'note created' }],
  _meta: { upstream: 'notes', revision: 3 },
  backend_extension: { audited: true },
};

/** What the client sends; the upstream echoes it back, so its arrival unchanged is checkable. */
const CREATE_ARGUMENTS: Record<string, unknown> = {
  text: 'hello',
  _meta: { traceId: 'trace-1' },
  client_extension: 'kept',
};

const STUB_FIXTURES: readonly Readonly<Record<string, unknown>>[] = [
  { configKey: 'notes', tools: NOTES_TOOLS, results: { create: NOTES_CREATE_RESULT } },
  { configKey: 'todos', tools: TODOS_TOOLS },
  { configKey: 'calendar', tools: CALENDAR_TOOLS },
];

/** The merged table the fixture config's two apps produce: key order, then each app's own order. */
const EXPECTED_MERGED_TOOLS: readonly Record<string, unknown>[] = [
  ...NOTES_TOOLS.map((tool) => ({ ...tool, name: `notes__${String(tool.name)}` })),
  ...TODOS_TOOLS.map((tool) => ({ ...tool, name: `todos__${String(tool.name)}` })),
];

const EXPECTED_TOOL_NAMES: readonly string[] = EXPECTED_MERGED_TOOLS.map(nameOf);

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('one gateway registration', () => {
  it('exposes the tools of every upstream the config file names, their fields untouched', async () => {
    const run = startGatewayRun();

    const tools = await listToolsThroughGateway(run.configPath);

    expect(tools).toEqual(EXPECTED_MERGED_TOOLS);
  });

  it('adds an app by adding one config key, with no gateway code change', async () => {
    const run = startGatewayRun();

    const names = (await listToolsThroughGateway(run.configPathWithEveryApp)).map(nameOf);

    expect(names).toEqual([...EXPECTED_TOOL_NAMES, 'calendar__schedule']);
  });
});

describe('the official SDK client over the gateway entry', () => {
  it('completes the handshake and lists the merged table', async () => {
    const run = startGatewayRun();

    await withSdkSession(run.configPath, async (session) => {
      const tools = await session.listTools();

      expect(session.serverVersion()?.name).toBe('mcp-gateway');
      expect(tools.map(nameOf)).toEqual(EXPECTED_TOOL_NAMES);
      expect(tools[0]?._meta).toEqual(NOTES_TOOL_META);
    });
  });

  it('calls one tool through the gateway and receives its result unchanged', async () => {
    const run = startGatewayRun();

    await withSdkSession(run.configPath, async (session) => {
      const result = await session.callTool('notes__create', CREATE_ARGUMENTS);

      expect(result.request).toEqual({ name: 'create', arguments: CREATE_ARGUMENTS });
      expect(result._meta).toEqual(NOTES_CREATE_RESULT._meta);
      expect(result.backend_extension).toEqual(NOTES_CREATE_RESULT.backend_extension);
    });
  });

  it('sees the identical names in the identical order on a second, cached list', async () => {
    const run = startGatewayRun();

    await withSdkSession(run.configPath, async (session) => {
      const first = await session.listTools();
      const handshakesAfterFirstList = handshakeCount(run.handshakeLog);
      const second = await session.listTools();

      expect(second.map(nameOf)).toEqual(first.map(nameOf));
      expect(handshakesAfterFirstList).toBe(REGISTERED_UPSTREAM_COUNT);
      expect(handshakeCount(run.handshakeLog)).toBe(REGISTERED_UPSTREAM_COUNT);
    });
  });
});

/**
 * The gateway's own `tools/list` reply, read in-process: the forwarded objects as they are on the
 * wire, before any client's validation decides which fields it understands.
 */
async function listToolsThroughGateway(configPath: string): Promise<Record<string, unknown>[]> {
  const reply = (await gatewayFor(configPath).handle(requestLine('tools/list'))) as ToolsReply;
  return [...(reply.result?.tools ?? [])];
}

function gatewayFor(configPath: string): McpServer {
  const options: McpServerOptions = {
    env: { MCP_GATEWAY_CONFIG: configPath },
    stdout: () => undefined,
    stderr: () => undefined,
  };
  return createMcpServer(options);
}

function requestLine(method: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} });
}

function nameOf(tool: Record<string, unknown>): string {
  return String(tool.name);
}

/** One connected SDK session: the calls this suite makes and the child it owns. */
interface SdkSession {
  serverVersion(): { name: string; version?: string } | undefined;
  listTools(): Promise<SdkTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<SdkToolResult>;
  close(): Promise<void>;
}

/** Connect, run the assertions, then close — so a failing assertion still ends the child. */
async function withSdkSession(
  configPath: string,
  assertions: (session: SdkSession) => Promise<void>,
): Promise<void> {
  const session = await openSdkSession(configPath);
  try {
    await assertions(session);
  } finally {
    await session.close();
  }
}

/** Spawn the gateway's own entry through the SDK transport and finish the handshake. */
async function openSdkSession(configPath: string): Promise<SdkSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--require', TRANSPILE_HOOK, SERVER_ENTRY],
    cwd: packageRoot(),
    env: { ...definedEnvironment(), MCP_GATEWAY_CONFIG: configPath },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-gateway-conformance', version: '0.0.0' });
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);

  return {
    serverVersion: () => client.getServerVersion(),
    listTools: async () => (await client.listTools()).tools,
    callTool: async (name, args) => await client.callTool({ name, arguments: args }),
    close: () => client.close(),
  };
}

/** The package directory the suite runs from — the child's cwd, so relative paths line up. */
function packageRoot(): string {
  return join(__dirname, '..');
}

/** The gateway child inherits this process's environment; only absent values are dropped. */
function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

/** Where one suite run's stub script, stub fixtures, config files, and handshake log live. */
interface GatewayRun {
  /** Two apps registered: the client's single `mcp-gateway` entry in front of both. */
  readonly configPath: string;
  /** The same config plus the third app — the one edit that registers app #51. */
  readonly configPathWithEveryApp: string;
  readonly handshakeLog: string;
}

function startGatewayRun(): GatewayRun {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-conformance-'));
  tempDirectories.push(directory);

  const handshakeLog = join(directory, 'handshakes.log');
  writeFileSync(handshakeLog, '');
  writeStubFixtures(directory);

  const fixture = filledInFixture({
    node: process.execPath,
    stubScript: compiledStubScript(),
    stubFixtures: directory,
    handshakeLog,
  });

  const configPath = join(directory, 'gateway.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: fixture.mcpServers }));

  const configPathWithEveryApp = join(directory, 'gateway-every-app.json');
  writeFileSync(
    configPathWithEveryApp,
    JSON.stringify({ mcpServers: { ...fixture.mcpServers, ...fixture.unregisteredApps } }),
  );

  return { configPath, configPathWithEveryApp, handshakeLog };
}

/** The fixture config's own shape: the registered apps, plus the app it is one key away from. */
interface FixtureConfig {
  readonly mcpServers: Readonly<Record<string, unknown>>;
  readonly unregisteredApps: Readonly<Record<string, unknown>>;
}

/** The shipped fixture config with this run's real paths where its placeholders are. */
function filledInFixture(paths: FixturePaths): FixtureConfig {
  const template = JSON.parse(readFileSync(FIXTURE_CONFIG, 'utf8')) as unknown;
  return fillInPaths(template, paths) as FixtureConfig;
}

const PLACEHOLDER_NAMES = ['node', 'stubScript', 'stubFixtures', 'handshakeLog'] as const;

type FixturePaths = Readonly<Record<(typeof PLACEHOLDER_NAMES)[number], string>>;

function fillInPaths(value: unknown, paths: FixturePaths): unknown {
  if (typeof value === 'string') return filledIn(value, paths);
  if (Array.isArray(value)) return value.map((element) => fillInPaths(element, paths));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([field, fieldValue]) => [field, fillInPaths(fieldValue, paths)]),
  );
}

function filledIn(template: string, paths: FixturePaths): string {
  return PLACEHOLDER_NAMES.reduce(
    (text, name) => text.replaceAll(`{{${name}}}`, paths[name]),
    template,
  );
}

/** One stub fixture file per app, named after the config key that spawns it. */
function writeStubFixtures(directory: string): void {
  for (const fixture of STUB_FIXTURES) {
    writeFileSync(join(directory, `${String(fixture.configKey)}.json`), JSON.stringify(fixture));
  }
}

let compiledStub: string | undefined;

/** Node cannot load the `.ts` stub, so its source is transpiled once and the JavaScript spawned. */
function compiledStubScript(): string {
  compiledStub ??= transpileStub();
  return compiledStub;
}

function transpileStub(): string {
  const source = readFileSync(join(__dirname, 'support', 'stub-upstream.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const path = join(mkdtempSync(join(tmpdir(), 'mcp-gateway-stub-')), 'stub-upstream.ts.js');
  writeFileSync(path, outputText);
  return path;
}

function handshakeCount(handshakeLog: string): number {
  return readFileSync(handshakeLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '').length;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `tools/list` reply as this suite reads it; the forwarded objects keep every field. */
interface ToolsReply {
  readonly result?: { readonly tools?: readonly Record<string, unknown>[] };
}

/** One tool as the SDK delivers it, reduced to what a client-facing gate reads. */
interface SdkTool {
  name: string;
  _meta?: unknown;
  [field: string]: unknown;
}

/** One `tools/call` result as the SDK delivers it: the result object's shape is loose, as sent. */
interface SdkToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  _meta?: unknown;
  [field: string]: unknown;
}

/** The SDK's own CommonJS entry points, typed to the two constructors this suite uses. */
interface SdkModule {
  Client: new (clientInfo: { name: string; version: string }) => SdkClient;
  StdioClientTransport: new (parameters: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    stderr: 'pipe';
  }) => { pid: number | null };
}

interface SdkClient {
  connect(transport: unknown): Promise<void>;
  getServerVersion(): { name: string; version?: string } | undefined;
  listTools(): Promise<{ tools: SdkTool[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<SdkToolResult>;
  close(): Promise<void>;
}
