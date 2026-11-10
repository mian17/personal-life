/**
 * `src/upstream.ts` against a real child process (SPEC-mcp-gateway §1, §6): the fixture upstream
 * in `support/stub-upstream.ts` is spawned, handshaken, and closed for each round trip, so these
 * tests cover the path the gateway actually runs — no `child_process` mock anywhere.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import type { UpstreamEntry } from '../src/config.js';
import {
  CALL_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  UPSTREAM_ERROR_CODE,
  UpstreamError,
  callUpstreamTool,
  listUpstreamTools,
} from '../src/upstream.js';

jest.setTimeout(20_000);

describe('the round-trip budgets', () => {
  it('hold the numbers the spec pins', () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBe(5_000);
    expect(CALL_TIMEOUT_MS).toBe(60_000);
  });
});

interface StubFixture {
  mode?: 'answer' | 'exit-early' | 'silent' | 'garbled';
  tools?: readonly unknown[];
  results?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

interface StubUpstream {
  readonly entry: UpstreamEntry;
  readonly pidFile: string;
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the arguments back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    defer_loading: true,
    _meta: { app: 'alpha' },
  },
  { name: 'fail', description: 'Answer with isError', inputSchema: { type: 'object' } },
];

const ECHO_RESULT = {
  content: [{ type: 'text', text: 'ok' }],
  _meta: { cached: false },
  unknownField: { kept: true },
};

describe('listUpstreamTools', () => {
  it('returns the upstream tools unchanged, in the order it declared them', async () => {
    const upstream = stubUpstream({ tools: TOOLS });

    await expect(listUpstreamTools(upstream.entry)).resolves.toEqual(TOOLS);
    expect(processIsGone(upstream.pidFile)).toBe(true);
  });

  it('raises the typed error when the upstream exits before answering', async () => {
    const upstream = stubUpstream({ mode: 'exit-early', tools: TOOLS });

    const failure = await failureOf(listUpstreamTools(upstream.entry));

    expect(failure.code).toBe(UPSTREAM_ERROR_CODE);
    expect(failure.configKey).toBe('alpha');
    expect(failure.message).toContain('alpha');
    expect(failure.message).toContain(process.execPath);
    expect(processIsGone(upstream.pidFile)).toBe(true);
  });

  it('raises the typed error when the upstream answers a line that is not JSON-RPC', async () => {
    const upstream = stubUpstream({ mode: 'garbled', tools: TOOLS });

    const failure = await failureOf(listUpstreamTools(upstream.entry));

    expect(failure.code).toBe(UPSTREAM_ERROR_CODE);
    expect(failure.message).toContain('not a JSON-RPC message');
    expect(processIsGone(upstream.pidFile)).toBe(true);
  });

  it('raises the typed error when the upstream never answers', async () => {
    const upstream = stubUpstream({ mode: 'silent', tools: TOOLS });
    const startedAt = Date.now();

    const failure = await failureOf(listUpstreamTools(upstream.entry));

    expect(failure.code).toBe(UPSTREAM_ERROR_CODE);
    expect(failure.message).toContain(`${HANDSHAKE_TIMEOUT_MS} ms`);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(HANDSHAKE_TIMEOUT_MS);
    expect(processIsGone(upstream.pidFile)).toBe(true);
  });

  it('reads a string error code and message into the failure', async () => {
    const entry = errorReplyingUpstream({ code: -32601, message: 'method not found' });

    const failure = await failureOf(listUpstreamTools(entry));

    expect(failure.message).toContain('answered tools/list with error -32601: method not found');
  });

  it('falls back to the literal text when an error field is not a string', async () => {
    const entry = errorReplyingUpstream({ code: { nested: true }, message: { nested: true } });

    const failure = await failureOf(listUpstreamTools(entry));

    expect(failure.message).toContain(
      'answered tools/list with error without code: without message',
    );
  });
});

describe('callUpstreamTool', () => {
  it('forwards the tool name and arguments and returns the result untouched', async () => {
    const upstream = stubUpstream({ tools: TOOLS, results: { echo: ECHO_RESULT } });
    const args = { text: 'hello', nested: { depth: [1, 2, 3] } };

    await expect(callUpstreamTool(upstream.entry, 'echo', args)).resolves.toEqual({
      ...ECHO_RESULT,
      request: { name: 'echo', arguments: args },
    });
    expect(processIsGone(upstream.pidFile)).toBe(true);
  });

  it('returns an isError result as a result, not as an error', async () => {
    const upstream = stubUpstream({
      tools: TOOLS,
      results: { fail: { content: [{ type: 'text', text: 'no' }], isError: true } },
    });

    await expect(callUpstreamTool(upstream.entry, 'fail', {})).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'no' }],
    });
  });
});

/** A fixture upstream in a fresh temp directory, with the pid file only it writes. */
function stubUpstream(fixture: StubFixture): StubUpstream {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-upstream-'));
  const fixturePath = join(directory, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));

  const pidFile = join(directory, 'stub.pid');
  return {
    entry: {
      configKey: 'alpha',
      command: process.execPath,
      args: [stubScript(), fixturePath],
      env: { STUB_UPSTREAM_PID_FILE: pidFile },
    },
    pidFile,
  };
}

let compiledStub: string | undefined;

/**
 * An upstream that handshakes normally and then rejects `tools/list` with `error` as given, so
 * the gateway's rendering of a JSON-RPC error reply is what the assertion reads.
 */
function errorReplyingUpstream(error: Record<string, unknown>): UpstreamEntry {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-error-'));
  const scriptPath = join(directory, 'error-upstream.js');
  writeFileSync(scriptPath, ERROR_REPLYING_UPSTREAM_SOURCE);

  const errorPath = join(directory, 'error.json');
  writeFileSync(errorPath, JSON.stringify(error));

  return { configKey: 'alpha', command: process.execPath, args: [scriptPath, errorPath], env: {} };
}

const ERROR_REPLYING_UPSTREAM_SOURCE = `
const { readFileSync } = require('node:fs');
const { createInterface } = require('node:readline');

const error = JSON.parse(readFileSync(process.argv[2], 'utf8'));

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    return write({ jsonrpc: '2.0', id: request.id, result: {} });
  }
  if (request.method === 'tools/list') {
    return write({ jsonrpc: '2.0', id: request.id, error });
  }
});

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
`;

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

/** A live process answers signal 0; a reaped one raises ESRCH. */
function processIsGone(pidFile: string): boolean {
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function failureOf(work: Promise<unknown>): Promise<UpstreamError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error('the round trip succeeded where an UpstreamError was expected');
}
