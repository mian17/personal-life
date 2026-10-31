/**
 * One upstream reached over stdio (SPEC-mcp-gateway §1 "`tools/call` is lazy", §4, §9.5): a
 * single spawn-handshake-request-close round trip, because 50 resident child processes is the
 * failure mode. Two operations, one per method the gateway serves: `listUpstreamTools` reads an
 * upstream's `tools/list` table, `callUpstreamTool` performs one `tools/call`.
 *
 * Every structural failure is the same `UpstreamError`, carrying the gateway-local `-32000` and
 * the upstream's config key and command: an unspawnable command, a line that is not JSON-RPC, a
 * JSON-RPC error reply, a child that dies before answering, and a timeout (spec §1 "Error
 * mapping by class"). An `isError: true` result is *not* a failure here — it is the upstream's
 * answer about its own business and travels back as the result it is.
 *
 * Nothing is inspected beyond what the gateway must read (`result`, `error`, `tools`): a reply's
 * payload passes through byte-identical, unknown fields and all. Notifications are nobody's
 * answer, so they are never handed out as replies — except `notifications/tools/list_changed`,
 * the one notice the gateway acts on (spec §1 "Cache invalidation"): it is recorded in the
 * `UpstreamNotices` the caller supplied, because an upstream saying its table moved is the only
 * word the gateway will ever get on a slice it is not re-reading.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import type { UpstreamEntry } from './config';

/** The child the gateway talks to: stdin and stdout are pipes, stderr is discarded. */
type UpstreamChild = ChildProcessByStdio<Writable, Readable, null>;

/** Gateway-local code for every upstream structural failure (spec §9.7). */
export const UPSTREAM_ERROR_CODE = -32000;

/**
 * The two round-trip budgets. A handshake is cheap, so 5 s catches a wedged upstream without
 * slowing the concurrent `tools/list` fan-out; a `tools/call` may be real work, so 60 s.
 *
 * ponytail: constants, not config knobs (spec §9.5). Upgrade path: add env overrides beside
 * these defaults if a real upstream ever proves either number wrong.
 */
export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const CALL_TIMEOUT_MS = 60_000;

/** After the polite close and SIGTERM, SIGKILL is the guarantee that no child outlives the call. */
const KILL_BACKSTOP_MS = 1_000;

/** The one notification the gateway acts on; every other notification stays the upstream's own. */
const TOOL_LIST_CHANGED_METHOD = 'notifications/tools/list_changed';

/** The opening the gateway sends; ids only correlate a reply with its request. */
const INITIALIZE_REQUEST_ID = 1;
const REQUEST_ID = 2;

const CLIENT_VERSION: string = (require('../package.json') as { version: string }).version;

const INITIALIZE_PARAMS = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-gateway', version: CLIENT_VERSION },
};

/** A structural upstream failure: `-32000`, naming the upstream it happened to. */
export class UpstreamError extends Error {
  readonly code = UPSTREAM_ERROR_CODE;
  readonly configKey: string;
  readonly command: string;

  constructor(entry: UpstreamEntry, reason: string) {
    super(`upstream "${entry.configKey}" (${entry.command}) ${reason}`);
    this.name = 'UpstreamError';
    this.configKey = entry.configKey;
    this.command = entry.command;
  }
}

/**
 * What an upstream said about itself while the gateway had it open. A caller passes one in to hear
 * it; a caller that does not care passes nothing and the news is dropped.
 */
export interface UpstreamNotices {
  toolTableChanged: boolean;
}

/** That upstream's `tools/list` array, in the order the upstream declared it. */
export async function listUpstreamTools(
  entry: UpstreamEntry,
  notices?: UpstreamNotices,
): Promise<unknown[]> {
  const request: UpstreamRequest = {
    id: REQUEST_ID,
    method: 'tools/list',
    params: {},
    timeoutMs: HANDSHAKE_TIMEOUT_MS,
    notices,
  };
  return toolsOf(await requestOnce(entry, request), entry);
}

/** The upstream's `tools/call` result object, exactly as it answered it. */
export async function callUpstreamTool(
  entry: UpstreamEntry,
  name: string,
  args: unknown,
): Promise<unknown> {
  const request: UpstreamRequest = {
    id: REQUEST_ID,
    method: 'tools/call',
    params: { name, arguments: args },
    timeoutMs: CALL_TIMEOUT_MS,
  };
  return await requestOnce(entry, request);
}

/** One request the gateway makes, with its own budget. */
interface UpstreamRequest {
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
  readonly timeoutMs: number;
  readonly notices?: UpstreamNotices;
}

/** A spawned upstream, its reader, and the config entry the error messages name. */
interface UpstreamProcess extends ReadableUpstream {
  readonly nextReply: NextReply;
}

/** The child one conversation runs over, and where the notices its reader hears are recorded. */
interface ReadableUpstream {
  readonly entry: UpstreamEntry;
  readonly child: UpstreamChild;
  readonly notices: UpstreamNotices;
}

/** The part of a JSON-RPC message the gateway reads; every other field rides along untouched. */
interface JsonRpcMessage {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

type NextReply = (timeoutMs: number) => Promise<JsonRpcMessage>;

interface PendingReply {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: UpstreamError) => void;
}

/**
 * Spawn, handshake, one request, one reply, closed child — the child is closed on the failure
 * path too, because a leaked upstream per failed call is the same bug as a resident one.
 */
async function requestOnce(entry: UpstreamEntry, request: UpstreamRequest): Promise<unknown> {
  const upstream = startUpstream(entry, request.notices);
  try {
    await openConversation(upstream, request.timeoutMs);
    return await askUpstream(upstream, request);
  } finally {
    await stopUpstream(upstream);
  }
}

/**
 * The opening every MCP upstream expects before it answers anything else: one `initialize` round
 * trip, then the `notifications/initialized` note. The initialize result is discarded — the
 * upstream's protocol version and capabilities are not the gateway's to interpret.
 */
async function openConversation(upstream: UpstreamProcess, timeoutMs: number): Promise<void> {
  await askUpstream(upstream, {
    id: INITIALIZE_REQUEST_ID,
    method: 'initialize',
    params: INITIALIZE_PARAMS,
    timeoutMs,
  });
  writeMessage(upstream, { jsonrpc: '2.0', method: 'notifications/initialized' });
}

/** Send one request and yield its `result`, or raise the upstream's `error` reply. */
async function askUpstream(upstream: UpstreamProcess, request: UpstreamRequest): Promise<unknown> {
  writeMessage(upstream, {
    jsonrpc: '2.0',
    id: request.id,
    method: request.method,
    params: request.params,
  });

  const reply = await upstream.nextReply(request.timeoutMs);
  if (reply.error !== undefined) {
    throw new UpstreamError(
      upstream.entry,
      `answered ${request.method} with ${describedError(reply.error)}`,
    );
  }
  return reply.result;
}

function startUpstream(
  entry: UpstreamEntry,
  notices: UpstreamNotices = { toolTableChanged: false },
): UpstreamProcess {
  const child: UpstreamChild = spawn(entry.command, entry.args, {
    cwd: entry.cwd,
    env: { ...process.env, ...entry.env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  swallowStdinFailures(child);

  const readable: ReadableUpstream = { entry, child, notices };
  return { ...readable, nextReply: repliesFrom(readable) };
}

/**
 * A write to a child that already died raises EPIPE; that death is what the reader reports, so
 * the write's own error must not also become an uncaught exception.
 */
function swallowStdinFailures(child: UpstreamChild): void {
  child.stdin.on('error', () => undefined);
}

/**
 * Closing stdin is the polite half; SIGTERM, then the SIGKILL backstop, is the guarantee.
 */
async function stopUpstream(upstream: UpstreamProcess): Promise<void> {
  const child = upstream.child;
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.stdin.end();
  const closed = waitUntilClosed(child);
  child.kill();
  const killBackstop = setTimeout(() => child.kill('SIGKILL'), KILL_BACKSTOP_MS);
  killBackstop.unref();

  await closed;
  clearTimeout(killBackstop);
}

function waitUntilClosed(child: UpstreamChild): Promise<void> {
  return new Promise((resolve) => {
    child.once('close', () => resolve());
  });
}

function writeMessage(upstream: UpstreamProcess, message: Record<string, unknown>): void {
  upstream.child.stdin.write(`${JSON.stringify(message)}\n`);
}

/** The upstream's declared order is its own array order, so the array is returned untouched. */
function toolsOf(result: unknown, entry: UpstreamEntry): unknown[] {
  const tools = isRecord(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) {
    throw new UpstreamError(entry, 'answered tools/list without a tools array');
  }
  return tools;
}

/** The JSON-RPC error as one clause: `error -32601: method not found`. */
function describedError(error: unknown): string {
  if (!isRecord(error)) return `error ${JSON.stringify(error)}`;
  return `error ${String(error.code ?? 'without code')}: ${String(error.message ?? 'without message')}`;
}

/**
 * The messages one upstream writes, handed out one wait at a time (the gateway asks, waits,
 * asks). A request the upstream initiates is skipped — the gateway has nothing to answer — and an
 * announcement that its tool table moved is recorded instead, so `server.ts` can invalidate that
 * upstream's slice. A child that errors, closes, writes a line that is not JSON, or goes quiet
 * fails the pending wait with the typed error, so no caller can hang on a dead upstream.
 */
function repliesFrom(upstream: ReadableUpstream): NextReply {
  const { entry } = upstream;
  const buffered: JsonRpcMessage[] = [];
  let pending: PendingReply | undefined;
  let pendingTimer: NodeJS.Timeout | undefined;
  let failure: UpstreamError | undefined;

  const deliver = (message: JsonRpcMessage): void => {
    if (pending === undefined) {
      buffered.push(message);
      return;
    }
    clearTimeout(pendingTimer);
    pending.resolve(message);
    pending = undefined;
  };

  const fail = (error: UpstreamError): void => {
    failure = failure ?? error;
    if (pending === undefined) return;
    clearTimeout(pendingTimer);
    pending.reject(failure);
    pending = undefined;
  };

  const readLine = (line: string): void => {
    if (line.trim() === '') return;
    const message = parseJsonLine(line);
    if (message === undefined) {
      fail(new UpstreamError(entry, 'wrote a line that is not a JSON-RPC message'));
      return;
    }
    if (isReply(message)) deliver(message);
    else recordNotice(upstream, message);
  };

  readLines(upstream.child, readLine);
  upstream.child.on('error', (error) => {
    fail(new UpstreamError(entry, `cannot start: ${reasonFor(error)}`));
  });
  upstream.child.on('close', () => {
    fail(new UpstreamError(entry, 'closed before answering'));
  });

  return (timeoutMs: number): Promise<JsonRpcMessage> => {
    if (failure !== undefined) return Promise.reject(failure);

    const bufferedMessage = buffered.shift();
    if (bufferedMessage !== undefined) return Promise.resolve(bufferedMessage);

    return new Promise<JsonRpcMessage>((resolve, reject) => {
      pending = { resolve, reject };
      pendingTimer = setTimeout(() => {
        fail(new UpstreamError(entry, `did not answer within ${timeoutMs} ms`));
      }, timeoutMs);
    });
  };
}

function readLines(child: UpstreamChild, onLine: (line: string) => void): void {
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', onLine);
}

/** A reply answers something, so it carries an `id` and no `method`. */
function isReply(message: JsonRpcMessage): boolean {
  return message.id !== undefined && message.method === undefined;
}

/** Keep the one notice the gateway acts on; every other unsolicited message stays ignored. */
function recordNotice(upstream: ReadableUpstream, message: JsonRpcMessage): void {
  if (message.method === TOOL_LIST_CHANGED_METHOD) upstream.notices.toolTableChanged = true;
}

function parseJsonLine(line: string): JsonRpcMessage | undefined {
  try {
    const message: unknown = JSON.parse(line);
    return isRecord(message) ? message : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
