/**
 * A fixture stdio upstream for `test/upstream.test.ts` (SPEC-mcp-gateway §6): a real child
 * process, so the spawn, handshake, and close path is exercised instead of mocked. It answers a
 * JSON fixture named on the command line and misbehaves exactly as that fixture says — `answer`
 * normally, `exit-early` before any reply, `silent` forever, `garbled` with a line that is not
 * JSON. `announceToolListChange` makes it announce `notifications/tools/list_changed` just before
 * its `tools/list` answer, the way a real upstream reports that its own table moved. It records
 * its own pid in `STUB_UPSTREAM_PID_FILE`, so a test can prove the gateway reaped it, and the
 * start time of every handshake in `STUB_UPSTREAM_HANDSHAKE_FILE`, so a test can count handshakes
 * and see a fan-out overlap instead of serialise.
 *
 * Node cannot load a `.ts` file on this host, so the test compiles this source with the
 * package's own `typescript` and spawns the result; keep the syntax transpile-only (no enums,
 * no parameter properties).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

interface StubFixture {
  readonly mode?: 'answer' | 'exit-early' | 'silent' | 'garbled';
  readonly tools?: readonly unknown[];
  readonly results?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly handshakeDelayMs?: number;
  readonly announceToolListChange?: boolean;
}

const TOOL_LIST_CHANGED_METHOD = 'notifications/tools/list_changed';

const fixture: StubFixture = JSON.parse(readFileSync(process.argv[2], 'utf8')) as StubFixture;

if (process.env.STUB_UPSTREAM_PID_FILE) {
  writeFileSync(process.env.STUB_UPSTREAM_PID_FILE, String(process.pid));
}

if (fixture.mode === 'exit-early') process.exit(0);
if (fixture.mode === 'garbled') process.stdout.write('this is not a JSON-RPC message\n');

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', answerLine);

function answerLine(line: string): void {
  if (fixture.mode === 'silent' || fixture.mode === 'exit-early') return;

  const request = JSON.parse(line) as { id: unknown; method: string; params?: StubCallParams };
  if (request.method === 'initialize') return answerInitialize(request.id);
  if (request.method === 'tools/list') return answerToolList(request.id);
  if (request.method === 'tools/call') return reply(request.id, calledResult(request.params));
}

/** A handshake is announced in the handshake file, then answered after the fixture's delay. */
function answerInitialize(id: unknown): void {
  recordHandshake();

  const delayMs = fixture.handshakeDelayMs ?? 0;
  if (delayMs === 0) return reply(id, initializeResult());
  setTimeout(() => reply(id, initializeResult()), delayMs);
}

function recordHandshake(): void {
  if (!process.env.STUB_UPSTREAM_HANDSHAKE_FILE) return;
  appendFileSync(process.env.STUB_UPSTREAM_HANDSHAKE_FILE, `${Date.now()}\n`);
}

interface StubCallParams {
  readonly name: string;
  readonly arguments?: unknown;
}

function initializeResult(): unknown {
  return {
    protocolVersion: '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: { name: 'stub-upstream', version: '0.0.0' },
  };
}

/** The fixture's answer for that tool, with the call it received echoed back for the assertions. */
function calledResult(params: StubCallParams | undefined): unknown {
  const fixtureResult = fixture.results?.[params?.name ?? ''] ?? { content: [], isError: true };
  return { ...fixtureResult, request: params };
}

/** The table the fixture declares, announced as moved first when the fixture says so. */
function answerToolList(id: unknown): void {
  if (fixture.announceToolListChange) announceToolListChange();
  reply(id, { tools: fixture.tools ?? [] });
}

function announceToolListChange(): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: TOOL_LIST_CHANGED_METHOD })}\n`);
}

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
