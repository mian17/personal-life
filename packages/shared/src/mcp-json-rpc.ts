/**
 * The JSON-RPC stdio seam both servers share (`SPEC-mcp-gateway` §1,
 * `SPEC-ops-agent-contract` §3.1). The gateway and the ops agent answer a client the same way —
 * split stdin into lines, tell a request from any other line, write the answer to stdout —
 * so that machinery lives here once instead of in a copy per server.
 *
 * The servers differ in exactly one point: how a failure that escaped `handle` becomes its one
 * stderr line (the gateway's own `reasonFor`, ops' `renderFailure`). The loop therefore takes that
 * as a parameter and hardcodes neither. Everything else — the `-32700`/`-32600` reply shapes, the
 * no-answer shapes of a notification and of a failure inside a request, the exit code — is the
 * same on both sides, and each server keeps its own reply wording.
 *
 * Nothing here touches a stream at import time. The reader is handed the server it drives and the
 * writers it answers through, so an in-process test runs the real loop with no child process.
 */

/** `id === undefined` is the notification shape; every other field arrives verbatim. */
export interface RpcRequest {
  id: string | number | undefined;
  method: string;
  params: unknown;
}

/** A JSON-RPC error reply's varying part; a `null` id is what the protocol asks for a bad line. */
export interface RpcFailure {
  id: string | number | null;
  code: number;
  message: string;
}

/** What one delivered message turned out to be. */
export type MessageRead =
  | { kind: 'request'; request: RpcRequest }
  | { kind: 'notARequest' }
  | { kind: 'unparseable' };

/**
 * One server, driven as a stdio service: the handler a line is handed to, the writers its answers
 * and diagnostics go through, and the rule its escaped failures are rendered by.
 */
export interface StdioLoop {
  readonly server: { handle(message: unknown): Promise<unknown> };
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly renderFailure: (error: unknown) => string;
}

/** Serve stdin until it closes, answering every JSON-RPC request; the exit code is always 0. */
export function answerUntilStdinCloses(loop: StdioLoop): Promise<number> {
  return new Promise((finish) => {
    let buffered = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffered += chunk;
      for (;;) {
        const lineEnd = buffered.indexOf('\n');
        if (lineEnd === -1) return;
        const line = buffered.slice(0, lineEnd);
        buffered = buffered.slice(lineEnd + 1);
        void respondToLine(loop, line);
      }
    });
    process.stdin.on('end', () => finish(0));
  });
}

/** A line's answer goes to stdout; a failure that escaped the loop goes to stderr, never stdout. */
async function respondToLine(loop: StdioLoop, line: string): Promise<void> {
  try {
    const response = await loop.server.handle(line);
    if (response !== null) loop.stdout(JSON.stringify(response));
  } catch (error) {
    loop.stderr(loop.renderFailure(error));
  }
}

/** A raw line is parsed first; anything already parsed is read as it stands. */
export function readMessage(message: unknown): MessageRead {
  if (typeof message !== 'string') return readRequest(message);
  const parsed = parseLine(message);
  return parsed.kind === 'unparseable' ? parsed : readRequest(parsed.value);
}

export function parseLine(
  line: string,
): { kind: 'parsed'; value: unknown } | { kind: 'unparseable' } {
  try {
    return { kind: 'parsed', value: JSON.parse(line) as unknown };
  } catch {
    return { kind: 'unparseable' };
  }
}

/** A request needs an object with a string `method`; everything else is not one. */
export function readRequest(parsed: unknown): MessageRead {
  if (!isRecord(parsed)) return { kind: 'notARequest' };
  if (typeof parsed.method !== 'string') return { kind: 'notARequest' };
  return {
    kind: 'request',
    request: { id: requestId(parsed), method: parsed.method, params: parsed.params },
  };
}

function requestId(record: Record<string, unknown>): string | number | undefined {
  const id = record.id;
  if (typeof id === 'string' || typeof id === 'number') return id;
  return undefined;
}

/** The id a reply echoes: the request's own, or `null` when it carried none usable. */
export function idOf(request: RpcRequest): string | number | null {
  return request.id ?? null;
}

/** A framed JSON-RPC error reply, ready to be written as one stdout line. */
export function errorAnswer(failure: RpcFailure): unknown {
  return {
    jsonrpc: '2.0',
    id: failure.id,
    error: { code: failure.code, message: failure.message },
  };
}

/** A JSON object, as opposed to a primitive, `null`, or an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
