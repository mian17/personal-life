/**
 * `src/server.ts`'s handshake and `tools/list` surface against Task 6's acceptance criteria
 * (SPEC-mcp-gateway §1 "Server identity", "`tools/list` is cheap", "Upstream reachability",
 * §9.9): real stub upstreams in temp directories, so the handshake fan-out, the cache hit, the
 * down report, and the concurrency are the paths the gateway actually runs.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import { createMcpServer } from '../src/server';
import type { McpServer, McpServerOptions } from '../src/server';

jest.setTimeout(20_000);

const PACKAGE_VERSION: string = (require('../package.json') as { version: string }).version;

const NOTES_TOOLS = [
  {
    name: 'create',
    description: 'Create a note',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    defer_loading: true,
    tool_reference: { app: 'notes' },
    _meta: { app: 'notes' },
  },
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object' } },
];

const TODOS_TOOLS = [{ name: 'add', description: 'Add a todo', inputSchema: { type: 'object' } }];

describe('initialize', () => {
  it('names the gateway and pins its version to the package version', async () => {
    const reply = await initializeReply(gatewayWith([]).server, { id: 1 });

    expect(reply.result?.serverInfo).toEqual({ name: 'mcp-gateway', version: PACKAGE_VERSION });
  });

  it('answers with the version the client asked for', async () => {
    const reply = await initializeReply(gatewayWith([]).server, {
      id: 1,
      protocolVersion: '2025-06-18',
    });

    expect(reply.result?.protocolVersion).toBe('2025-06-18');
  });
});

describe('tools/list', () => {
  it('returns the complete merged table in one page, in config declaration order', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);

    const reply = await listReply(gateway.server, 2);

    expect(toolNamesOf(reply)).toEqual(['notes__create', 'notes__search', 'todos__add']);
    expect(reply.result).not.toHaveProperty('nextCursor');
    expect(reply.result?.tools[0]).toEqual({ ...NOTES_TOOLS[0], name: 'notes__create' });
  });

  it('serves the second call from the cache, with no further handshake', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);

    const first = await listReply(gateway.server, 2);
    const handshakesAfterFirst = handshakeTimes(gateway.handshakeLog);
    const second = await listReply(gateway.server, 3);

    expect(handshakesAfterFirst).toHaveLength(2);
    expect(handshakeTimes(gateway.handshakeLog)).toHaveLength(2);
    expect(toolNamesOf(second)).toEqual(toolNamesOf(first));
  });

  it('omits a down upstream, names it once on stderr, and still serves the others', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', tools: TODOS_TOOLS, mode: 'exit-early' },
    ]);

    const reply = await listReply(gateway.server, 2);

    expect(toolNamesOf(reply)).toEqual(['notes__create', 'notes__search']);
    expect(gateway.stderr).toHaveLength(1);
    expect(gateway.stderr[0]).toContain('"todos"');
    expect(gateway.stderr[0]).toContain(process.execPath);
  });

  it('handshakes the upstreams concurrently instead of one after another', async () => {
    const handshakeDelayMs = 300;
    const gateway = gatewayWith(
      ['alpha', 'beta', 'gamma'].map((configKey) => ({
        configKey,
        tools: TODOS_TOOLS,
        handshakeDelayMs,
      })),
    );

    const startedAt = Date.now();
    await listReply(gateway.server, 2);
    const elapsedMs = Date.now() - startedAt;
    const starts = handshakeTimes(gateway.handshakeLog);

    expect(starts).toHaveLength(3);
    expect(elapsedMs).toBeLessThan(3 * handshakeDelayMs);
    expect(spreadOf(starts)).toBeLessThan(handshakeDelayMs);
  });
});

describe('the rest of the method surface', () => {
  it('answers ping, ignores the initialized notification, and rejects an unknown method', async () => {
    const gateway = gatewayWith([]);

    await expect(gateway.server.handle(requestLine(7, 'ping'))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: {},
    });
    await expect(
      gateway.server.handle(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ),
    ).resolves.toBeNull();
    await expect(gateway.server.handle(requestLine(8, 'resources/list'))).resolves.toMatchObject({
      id: 8,
      error: { code: -32601 },
    });
  });

  it('answers an unparseable line with a parse error and keeps serving', async () => {
    const gateway = gatewayWith([]);

    await expect(gateway.server.handle('this is not a JSON-RPC message')).resolves.toMatchObject({
      id: null,
      error: { code: -32700 },
    });
    expect(gateway.stderr).toHaveLength(1);
    await expect(gateway.server.handle(requestLine(9, 'ping'))).resolves.toMatchObject({ id: 9 });
  });
});

interface StubFixture {
  mode?: 'answer' | 'exit-early';
  tools?: readonly unknown[];
  handshakeDelayMs?: number;
}

interface FixtureUpstream extends StubFixture {
  readonly configKey: string;
}

interface FixtureGateway {
  readonly server: McpServer;
  readonly handshakeLog: string;
  readonly stderr: string[];
}

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A gateway in front of one stub upstream per fixture, with the writers a test can read back. */
function gatewayWith(upstreams: readonly FixtureUpstream[]): FixtureGateway {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-server-'));
  tempDirectories.push(directory);

  const handshakeLog = join(directory, 'handshakes.log');
  writeFileSync(handshakeLog, '');

  const stubPaths: StubPaths = { directory, handshakeLog };
  const mcpServers = Object.fromEntries(
    upstreams.map((upstream) => [upstream.configKey, stubEntryFor(upstream, stubPaths)]),
  );
  const configPath = join(directory, 'gateway.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers }));

  const stderr: string[] = [];
  const options: McpServerOptions = {
    env: { MCP_GATEWAY_CONFIG: configPath },
    stdout: () => undefined,
    stderr: (line) => stderr.push(line),
  };

  return { server: createMcpServer(options), handshakeLog, stderr };
}

/** Where a fixture writes: its own temp directory and the log every handshake appends to. */
interface StubPaths {
  readonly directory: string;
  readonly handshakeLog: string;
}

/** The config entry that spawns this fixture's stub, under the key that becomes its prefix. */
function stubEntryFor(upstream: FixtureUpstream, paths: StubPaths): Record<string, unknown> {
  const fixturePath = join(paths.directory, `${upstream.configKey}.fixture.json`);
  writeFileSync(fixturePath, JSON.stringify(upstream));

  return {
    command: process.execPath,
    args: [stubScript(), fixturePath],
    env: { STUB_UPSTREAM_HANDSHAKE_FILE: paths.handshakeLog },
  };
}

let compiledStub: string | undefined;

/** Node cannot load the `.ts` stub, so its source is compiled once and the JavaScript spawned. */
function stubScript(): string {
  compiledStub ??= compileStub();
  return compiledStub;
}

function compileStub(): string {
  const source = readFileSync(join(__dirname, 'support', 'stub-upstream.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const path = join(mkdtempSync(join(tmpdir(), 'mcp-gateway-stub-')), 'stub-upstream.js');
  writeFileSync(path, outputText);
  return path;
}

interface InitializeRequest {
  readonly id: number;
  readonly protocolVersion?: string;
}

interface InitializeReply {
  readonly result?: {
    readonly protocolVersion?: string;
    readonly serverInfo?: { readonly name: string; readonly version: string };
  };
}

interface ListReply {
  readonly result?: {
    readonly tools: readonly { readonly name: string }[];
    readonly nextCursor?: unknown;
  };
}

function requestLine(id: number, method: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params: {} });
}

async function initializeReply(
  server: McpServer,
  request: InitializeRequest,
): Promise<InitializeReply> {
  const params = {
    protocolVersion: request.protocolVersion ?? '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  };
  const line = JSON.stringify({ jsonrpc: '2.0', id: request.id, method: 'initialize', params });
  return (await server.handle(line)) as InitializeReply;
}

async function listReply(server: McpServer, id: number): Promise<ListReply> {
  return (await server.handle(requestLine(id, 'tools/list'))) as ListReply;
}

function toolNamesOf(reply: ListReply): string[] {
  return (reply.result?.tools ?? []).map((tool) => tool.name);
}

/** The start time of each handshake the stub recorded, in the order they began. */
function handshakeTimes(handshakeLog: string): number[] {
  return readFileSync(handshakeLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map(Number);
}

function spreadOf(times: readonly number[]): number {
  return Math.max(...times) - Math.min(...times);
}
