/**
 * `src/server.ts`'s `tools/call` surface against Task 7's acceptance criteria (SPEC-mcp-gateway §1
 * "`tools/call` is lazy", "Error mapping by class", §9.7): real stub upstreams in temp
 * directories, so routing, the single spawn, the untouched result, and every error class are the
 * paths the gateway actually runs.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import { createMcpServer } from '../src/server.js';
import type { McpServer, McpServerOptions } from '../src/server.js';

jest.setTimeout(20_000);

const NOTES_TOOLS = [
  {
    name: 'create',
    description: 'Create a note',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    defer_loading: true,
    _meta: { app: 'notes' },
  },
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object' } },
];

const TODOS_TOOLS = [{ name: 'add', description: 'Add a todo', inputSchema: { type: 'object' } }];

const ECHO_RESULT = {
  content: [{ type: 'text', text: 'ok' }],
  _meta: { cached: false },
  unknownField: { kept: true },
};

describe('routing', () => {
  it('calls the upstream the name prefixes, with the unprefixed name and the same arguments', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);
    const args = { text: 'hello', nested: { depth: [1, 2, 3] } };

    const reply = await callReply(gateway.server, { id: 2, name: 'todos__add', args });

    expect(reply.result?.request).toEqual({ name: 'add', arguments: args });
    expect(gateway.handshakeTimes('todos')).toHaveLength(1);
    expect(gateway.handshakeTimes('notes')).toHaveLength(0);
  });
});

describe('the result travels back untouched', () => {
  it('forwards content, `_meta`, and a field the gateway does not know', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS, results: { search: ECHO_RESULT } },
    ]);

    const reply = await callReply(gateway.server, {
      id: 3,
      name: 'notes__search',
      args: { q: 'a' },
    });

    expect(reply.result).toEqual({
      ...ECHO_RESULT,
      request: { name: 'search', arguments: { q: 'a' } },
    });
  });

  it('answers an isError result as a result, never as a JSON-RPC error', async () => {
    const businessFailure = { content: [{ type: 'text', text: 'no' }], isError: true };
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS, results: { create: businessFailure } },
    ]);

    const reply = await callReply(gateway.server, { id: 4, name: 'notes__create', args: {} });

    expect(reply.error).toBeUndefined();
    expect(reply.result).toMatchObject({ isError: true, content: businessFailure.content });
  });
});

describe('structural failures', () => {
  it('maps an unspawnable upstream to -32000, naming its config key', async () => {
    const directory = tempDirectory();
    const gateway = gatewayIn(directory, {
      broken: { command: join(directory, 'no-such-upstream') },
    });

    const reply = await callReply(gateway.server, { id: 5, name: 'broken__anything' });

    expectErrorCode(reply, -32000);
    expect(reply.error?.message).toContain('broken');
  });

  it('maps a line that is not JSON-RPC to -32000', async () => {
    const gateway = gatewayWith([{ configKey: 'notes', tools: NOTES_TOOLS, mode: 'garbled' }]);

    const reply = await callReply(gateway.server, { id: 6, name: 'notes__search' });

    expectErrorCode(reply, -32000);
    expect(reply.error?.message).toContain('notes');
  });

  it('maps an upstream that dies before answering to -32000', async () => {
    const gateway = gatewayWith([{ configKey: 'notes', tools: NOTES_TOOLS, mode: 'exit-early' }]);

    const reply = await callReply(gateway.server, { id: 7, name: 'notes__search' });

    expectErrorCode(reply, -32000);
    expect(processIsGone(gateway.pidFile('notes'))).toBe(true);
  });
});

describe('malformed gateway calls', () => {
  it('rejects a call with no params.name', async () => {
    const gateway = gatewayWith([{ configKey: 'notes', tools: NOTES_TOOLS }]);

    const reply = await callReply(gateway.server, { id: 8 });

    expectErrorCode(reply, -32602);
    expect(gateway.handshakeTimes('notes')).toHaveLength(0);
  });

  it('rejects a name no config key prefixes', async () => {
    const gateway = gatewayWith([{ configKey: 'notes', tools: NOTES_TOOLS }]);

    const reply = await callReply(gateway.server, { id: 9, name: 'elsewhere__search' });

    expectErrorCode(reply, -32602);
  });

  it('rejects a name the upstream does not publish, without spawning it', async () => {
    const gateway = gatewayWith([{ configKey: 'notes', tools: NOTES_TOOLS }]);

    await listReply(gateway.server, 10);
    const reply = await callReply(gateway.server, { id: 11, name: 'notes__nosuch' });

    expectErrorCode(reply, -32602);
    expect(gateway.handshakeTimes('notes')).toHaveLength(1);
  });
});

describe('the spawned child', () => {
  it('is gone once the reply has resolved', async () => {
    const gateway = gatewayWith([
      { configKey: 'notes', tools: NOTES_TOOLS, results: { search: ECHO_RESULT } },
    ]);

    await callReply(gateway.server, { id: 12, name: 'notes__search', args: {} });

    expect(processIsGone(gateway.pidFile('notes'))).toBe(true);
  });
});

interface StubFixture {
  mode?: 'answer' | 'exit-early' | 'silent' | 'garbled';
  tools?: readonly unknown[];
  results?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

interface FixtureUpstream extends StubFixture {
  readonly configKey: string;
}

interface FixtureGateway {
  readonly server: McpServer;
  handshakeTimes(configKey: string): number[];
  pidFile(configKey: string): string;
}

interface CallRequest {
  readonly id: number;
  readonly name?: string;
  readonly args?: unknown;
}

interface CallReply {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A gateway in front of one stub upstream per fixture, each with its own pid and handshake log. */
function gatewayWith(upstreams: readonly FixtureUpstream[]): FixtureGateway {
  const directory = tempDirectory();
  const mcpServers = Object.fromEntries(
    upstreams.map((upstream) => [upstream.configKey, stubEntryFor(upstream, directory)]),
  );
  return gatewayIn(directory, mcpServers);
}

/** A gateway over hand-written config entries, for the shapes a stub cannot produce. */
function gatewayIn(directory: string, mcpServers: Record<string, unknown>): FixtureGateway {
  const configPath = join(directory, 'gateway.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers }));

  const options: McpServerOptions = {
    env: { MCP_GATEWAY_CONFIG: configPath },
    stdout: () => undefined,
    stderr: () => undefined,
  };

  return {
    server: createMcpServer(options),
    handshakeTimes: (configKey) => handshakeTimes(join(directory, `${configKey}.handshakes.log`)),
    pidFile: (configKey) => join(directory, `${configKey}.pid`),
  };
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-call-'));
  tempDirectories.push(directory);
  return directory;
}

/** The config entry that spawns this fixture's stub, under the key that becomes its prefix. */
function stubEntryFor(upstream: FixtureUpstream, directory: string): Record<string, unknown> {
  const fixturePath = join(directory, `${upstream.configKey}.fixture.json`);
  writeFileSync(fixturePath, JSON.stringify(upstream));

  return {
    command: process.execPath,
    args: [stubScript(), fixturePath],
    env: {
      STUB_UPSTREAM_PID_FILE: join(directory, `${upstream.configKey}.pid`),
      STUB_UPSTREAM_HANDSHAKE_FILE: join(directory, `${upstream.configKey}.handshakes.log`),
    },
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

  const path = join(mkdtempSync(join(tmpdir(), 'mcp-gateway-call-stub-')), 'stub-upstream.js');
  writeFileSync(path, outputText);
  return path;
}

async function callReply(server: McpServer, request: CallRequest): Promise<CallReply> {
  const params = request.name === undefined ? {} : { name: request.name, arguments: request.args };
  return (await server.handle(
    requestLine({ id: request.id, method: 'tools/call', params }),
  )) as CallReply;
}

async function listReply(server: McpServer, id: number): Promise<unknown> {
  return await server.handle(requestLine({ id, method: 'tools/list', params: {} }));
}

function requestLine(request: { id: number; method: string; params?: unknown }): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    method: request.method,
    params: request.params ?? {},
  });
}

/** The exact code, and the spec's rule that no gateway-local code sits in MCP's own range. */
function expectErrorCode(reply: CallReply, expected: number): void {
  const code = reply.error?.code;
  expect(code).toBe(expected);
  expect(isReservedByMcp(code)).toBe(false);
}

/** MCP reserves -32020…-32099 for itself; the gateway draws from -32000…-32019. */
function isReservedByMcp(code: number | undefined): boolean {
  if (code === undefined) return false;
  return code <= -32020 && code >= -32099;
}

/** A live process answers signal 0; a reaped one raises ESRCH. */
function processIsGone(pidFile: string): boolean {
  if (!existsSync(pidFile)) return true;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function handshakeTimes(logPath: string): number[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map(Number);
}
