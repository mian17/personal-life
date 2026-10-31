/**
 * `src/server.ts`'s invalidation surface against Task 8's acceptance criteria (SPEC-mcp-gateway
 * §1 "Cache invalidation", §8 "Success criteria"): an upstream announcing its own table moved
 * costs exactly one re-handshake of that upstream alone, an unchanged table says nothing, and a
 * table that moves mid-session produces one `notifications/tools/list_changed` line with no `id`.
 *
 * The drop is never called by hand — the trigger is always the gateway hearing the announcement
 * from a real stub upstream — and every assertion below reads back what the gateway left behind:
 * handshakes the stub counted, slices the cache file holds, lines the gateway wrote to stdout.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import { readToolSlices, toolCacheFileFor } from '../src/cache';
import type { ToolCacheLocation } from '../src/cache';
import { loadGatewayConfig } from '../src/config';
import type { UpstreamSlice } from '../src/merge';
import { createMcpServer } from '../src/server';
import type { McpServer, McpServerOptions } from '../src/server';

jest.setTimeout(20_000);

const LIST_CHANGED_METHOD = 'notifications/tools/list_changed';

const NOTES_TOOLS = [
  { name: 'create', description: 'Create a note', inputSchema: { type: 'object' } },
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object' } },
];

const TODOS_TOOLS = [{ name: 'add', description: 'Add a todo', inputSchema: { type: 'object' } }];

/** The same notes upstream, its table moved: `search` is gone and `rename` arrived. */
const CHANGED_NOTES_TOOLS = [
  { name: 'create', description: 'Create a note', inputSchema: { type: 'object' } },
  { name: 'rename', description: 'Rename a note', inputSchema: { type: 'object' } },
];

describe('an upstream announcing its table moved', () => {
  it('drops only the announcing upstream slice, leaving the other slices untouched', async () => {
    const gateway = fixtureGateway([
      { configKey: 'notes', tools: NOTES_TOOLS, announceToolListChange: true },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);

    const reply = await listReply(gateway.server, 1);

    expect(toolNamesOf(reply)).toEqual(['notes__create', 'notes__search', 'todos__add']);
    expect(cachedSlices(gateway)).toEqual([{ configKey: 'todos', tools: TODOS_TOOLS }]);
  });

  it('re-handshakes only the announcing upstream next time, and serves the same table', async () => {
    const gateway = fixtureGateway([
      { configKey: 'notes', tools: NOTES_TOOLS, announceToolListChange: true },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);

    const first = await listReply(gateway.server, 1);
    gateway.changeFixture('notes', { tools: NOTES_TOOLS });

    const second = await listReply(gateway.server, 2);

    expect(gateway.handshakeCount('notes')).toBe(2);
    expect(gateway.handshakeCount('todos')).toBe(1);
    expect(toolNamesOf(second)).toEqual(toolNamesOf(first));
    expect(cachedConfigKeys(gateway).sort()).toEqual(['notes', 'todos']);
    expect(listChangedLines(gateway.stdoutLines)).toHaveLength(0);
  });
});

describe('notifying the client of a mid-session change', () => {
  it('emits one list_changed line with no id when the merged table changes', async () => {
    const gateway = fixtureGateway([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', mode: 'exit-early' },
    ]);

    await listReply(gateway.server, 1);
    expect(gateway.handshakeCount('todos')).toBe(0);
    expect(listChangedLines(gateway.stdoutLines)).toHaveLength(0);

    gateway.changeFixture('todos', { tools: TODOS_TOOLS });
    const reply = await listReply(gateway.server, 2);

    expect(toolNamesOf(reply)).toEqual(['notes__create', 'notes__search', 'todos__add']);
    expect(gateway.handshakeCount('notes')).toBe(1);
    expect(gateway.handshakeCount('todos')).toBe(1);

    const notifications = listChangedLines(gateway.stdoutLines);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).not.toContain('\n');
    expect(JSON.parse(notifications[0])).toEqual({ jsonrpc: '2.0', method: LIST_CHANGED_METHOD });
    expect(JSON.parse(notifications[0])).not.toHaveProperty('id');
  });

  it('emits one list_changed line when an announced change moves a cached upstream', async () => {
    const gateway = fixtureGateway([
      { configKey: 'notes', tools: NOTES_TOOLS, announceToolListChange: true },
      { configKey: 'todos', tools: TODOS_TOOLS },
    ]);

    await listReply(gateway.server, 1);
    gateway.changeFixture('notes', { tools: CHANGED_NOTES_TOOLS });

    const reply = await listReply(gateway.server, 2);

    expect(toolNamesOf(reply)).toEqual(['notes__create', 'notes__rename', 'todos__add']);
    expect(listChangedLines(gateway.stdoutLines)).toHaveLength(1);
  });

  it('emits nothing when the table does not move, and nothing twice for one movement', async () => {
    const gateway = fixtureGateway([
      { configKey: 'notes', tools: NOTES_TOOLS },
      { configKey: 'todos', mode: 'exit-early' },
    ]);

    await listReply(gateway.server, 1);
    await listReply(gateway.server, 2);
    expect(listChangedLines(gateway.stdoutLines)).toHaveLength(0);

    gateway.changeFixture('todos', { tools: TODOS_TOOLS });
    await listReply(gateway.server, 3);
    await listReply(gateway.server, 4);

    expect(gateway.handshakeCount('notes')).toBe(1);
    expect(gateway.handshakeCount('todos')).toBe(1);
    expect(listChangedLines(gateway.stdoutLines)).toHaveLength(1);
  });
});

interface StubFixture {
  mode?: 'answer' | 'exit-early';
  tools?: readonly unknown[];
  announceToolListChange?: boolean;
}

interface FixtureUpstream extends StubFixture {
  readonly configKey: string;
}

/** A gateway in front of one stub upstream per fixture, with what a test needs to read back. */
interface FixtureGateway {
  readonly server: McpServer;
  readonly stdoutLines: string[];
  readonly cacheLocation: () => ToolCacheLocation;
  handshakeCount(configKey: string): number;
  changeFixture(configKey: string, fixture: StubFixture): void;
}

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureGateway(upstreams: readonly FixtureUpstream[]): FixtureGateway {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-list-changed-'));
  tempDirectories.push(directory);

  const stubs = upstreams.map((upstream) => stubFor(upstream, directory));
  const configPath = join(directory, 'gateway.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: entriesOf(stubs) }));

  const stdoutLines: string[] = [];
  const options: McpServerOptions = {
    env: { MCP_GATEWAY_CONFIG: configPath },
    stdout: (line) => stdoutLines.push(line),
    stderr: () => undefined,
  };

  return {
    server: createMcpServer(options),
    stdoutLines,
    cacheLocation: () => cacheLocationOf(configPath),
    handshakeCount: (configKey) => handshakeCountOf(stubs, configKey),
    changeFixture: (configKey, fixture) => changeFixtureOf(stubs, configKey, fixture),
  };
}

/** One stub's fixture file, spawn entry, and the log only that stub appends its handshakes to. */
interface Stub {
  readonly configKey: string;
  readonly fixturePath: string;
  readonly handshakeLog: string;
  readonly entry: Record<string, unknown>;
}

function stubFor(upstream: FixtureUpstream, directory: string): Stub {
  const fixturePath = join(directory, `${upstream.configKey}.fixture.json`);
  const handshakeLog = join(directory, `${upstream.configKey}.handshakes.log`);
  writeFileSync(fixturePath, JSON.stringify({ ...upstream }));
  writeFileSync(handshakeLog, '');

  return {
    configKey: upstream.configKey,
    fixturePath,
    handshakeLog,
    entry: {
      command: process.execPath,
      args: [stubScript(), fixturePath],
      env: { STUB_UPSTREAM_HANDSHAKE_FILE: handshakeLog },
    },
  };
}

function entriesOf(stubs: readonly Stub[]): Record<string, unknown> {
  return Object.fromEntries(stubs.map((stub) => [stub.configKey, stub.entry]));
}

/** The slices the cache file holds — what the gateway persisted, not what it served. */
function cachedSlices(gateway: FixtureGateway): UpstreamSlice[] {
  return readToolSlices(gateway.cacheLocation());
}

function cachedConfigKeys(gateway: FixtureGateway): string[] {
  return cachedSlices(gateway).map((slice) => slice.configKey);
}

function handshakeCountOf(stubs: readonly Stub[], configKey: string): number {
  const stub = stubs.find((held) => held.configKey === configKey);
  if (stub === undefined) throw new Error(`no fixture for config key "${configKey}"`);
  return handshakeTimes(stub.handshakeLog).length;
}

function changeFixtureOf(stubs: readonly Stub[], configKey: string, fixture: StubFixture): void {
  const stub = stubs.find((held) => held.configKey === configKey);
  if (stub === undefined) throw new Error(`no fixture for config key "${configKey}"`);
  writeFileSync(stub.fixturePath, JSON.stringify({ ...fixture, configKey }));
}

function cacheLocationOf(configPath: string): ToolCacheLocation {
  const configHash = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configPath }).hash;
  return { path: toolCacheFileFor(configPath), configHash };
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

interface ListReply {
  readonly result?: { readonly tools: readonly { readonly name: string }[] };
}

function requestLine(id: number, method: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params: {} });
}

async function listReply(server: McpServer, id: number): Promise<ListReply> {
  return (await server.handle(requestLine(id, 'tools/list'))) as ListReply;
}

function toolNamesOf(reply: ListReply): string[] {
  return (reply.result?.tools ?? []).map((tool) => tool.name);
}

function listChangedLines(stdoutLines: readonly string[]): string[] {
  return stdoutLines.filter((line) => line.includes(LIST_CHANGED_METHOD));
}

/** The start time of each handshake the stub recorded, in the order they began. */
function handshakeTimes(handshakeLog: string): number[] {
  return readFileSync(handshakeLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map(Number);
}
