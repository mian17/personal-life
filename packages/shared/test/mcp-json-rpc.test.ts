import { EventEmitter } from 'node:events';
import {
  answerUntilStdinCloses,
  errorAnswer,
  idOf,
  isRecord,
  parseLine,
  readMessage,
  readRequest,
  type RpcRequest,
  type StdioLoop,
} from '../src/mcp-json-rpc';

/**
 * The JSON-RPC stdio seam the MCP servers share. The loop is driven in-process
 * through a fake `process.stdin`, so no child process is ever spawned and every
 * assertion is on a recorded answer rather than on a stream.
 */

/** Stand-in for `process.stdin`: the two members the loop touches, plus delivery. */
class FakeStdin extends EventEmitter {
  setEncoding(): this {
    return this;
  }

  deliver(chunk: string): void {
    this.emit('data', chunk);
  }

  close(): void {
    this.emit('end');
  }
}

/** Let every pending handler settle before the recorded answers are asserted. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Recording {
  readonly loop: StdioLoop;
  readonly handled: unknown[];
  readonly stdout: string[];
  readonly stderr: string[];
  readonly rendered: unknown[];
}

/** A loop whose every channel is recorded, so a test asserts what the server saw and replied. */
function recordingLoop(
  handle: (message: unknown) => Promise<unknown> = async () => null,
): Recording {
  const handled: unknown[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const rendered: unknown[] = [];
  const loop: StdioLoop = {
    server: {
      handle: (message) => {
        handled.push(message);
        return handle(message);
      },
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    renderFailure: (error) => {
      rendered.push(error);
      return `failure: ${(error as Error).message}`;
    },
  };
  return { loop, handled, stdout, stderr, rendered };
}

/** `process.stdin` is a getter on `process`, so it is swapped through its descriptor. */
const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
let stdin: FakeStdin;

beforeEach(() => {
  stdin = new FakeStdin();
  Object.defineProperty(process, 'stdin', { configurable: true, value: stdin });
});

afterEach(() => {
  if (realStdinDescriptor) Object.defineProperty(process, 'stdin', realStdinDescriptor);
});

describe('answerUntilStdinCloses: one line in, one line out', () => {
  it('writes the answer to a request as exactly one JSON line', async () => {
    const { loop, stdout, stderr } = recordingLoop(async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: 'pong',
    }));

    const exit = answerUntilStdinCloses(loop);
    stdin.deliver('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    await settle();

    expect(stdout).toEqual(['{"jsonrpc":"2.0","id":1,"result":"pong"}']);
    expect(stdout[0]).not.toContain('\n');
    expect(stderr).toEqual([]);
    stdin.close();
    await expect(exit).resolves.toBe(0);
  });

  it('writes nothing when the handler answers null, so a notification stays silent', async () => {
    const { loop, handled, stdout, stderr } = recordingLoop(async () => null);

    const exit = answerUntilStdinCloses(loop);
    stdin.deliver('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await settle();

    expect(handled).toHaveLength(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    stdin.close();
    await expect(exit).resolves.toBe(0);
  });

  it('sends an escaped failure to stderr through renderFailure, never to stdout', async () => {
    const failure = new Error('upstream exploded');
    const { loop, stdout, stderr, rendered } = recordingLoop(async () => {
      throw failure;
    });

    const exit = answerUntilStdinCloses(loop);
    stdin.deliver('{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n');
    await settle();

    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['failure: upstream exploded']);
    expect(rendered).toEqual([failure]);
    expect(rendered[0]).toBe(failure);
    stdin.close();
    await expect(exit).resolves.toBe(0);
  });

  it('reassembles a line split across two data chunks and answers it once', async () => {
    const { loop, handled, stdout } = recordingLoop(async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: 'pong',
    }));

    const exit = answerUntilStdinCloses(loop);
    stdin.deliver('{"jsonrpc":"2.0","id":1,"meth');
    await settle();
    expect(stdout).toEqual([]);

    stdin.deliver('od":"ping"}\n');
    await settle();
    expect(handled).toEqual(['{"jsonrpc":"2.0","id":1,"method":"ping"}']);
    expect(stdout).toHaveLength(1);
    stdin.close();
    await expect(exit).resolves.toBe(0);
  });

  it('answers two requests arriving in one chunk, in arrival order', async () => {
    const { loop, stdout } = recordingLoop(async (message) => {
      const parsed = JSON.parse(String(message));
      return { id: parsed.id, result: parsed.method };
    });

    const exit = answerUntilStdinCloses(loop);
    stdin.deliver(
      '{"jsonrpc":"2.0","id":1,"method":"first"}\n{"jsonrpc":"2.0","id":2,"method":"second"}\n',
    );
    await settle();

    expect(stdout).toEqual(['{"id":1,"result":"first"}', '{"id":2,"result":"second"}']);
    stdin.close();
    await expect(exit).resolves.toBe(0);
  });

  it('resolves 0 when stdin ends', async () => {
    const { loop, stdout } = recordingLoop();

    const exit = answerUntilStdinCloses(loop);
    stdin.close();

    await expect(exit).resolves.toBe(0);
    expect(stdout).toEqual([]);
  });
});

describe('parseLine', () => {
  it('returns the parsed value of a JSON line', () => {
    expect(parseLine('{"method":"ping"}')).toEqual({ kind: 'parsed', value: { method: 'ping' } });
  });

  it('reports malformed JSON as unparseable', () => {
    expect(parseLine('{"method":')).toEqual({ kind: 'unparseable' });
  });
});

describe('readRequest', () => {
  it('reads an object with a string method, carrying id and params verbatim', () => {
    const read = readRequest({ jsonrpc: '2.0', id: 'a', method: 'ping', params: { q: 1 } });
    expect(read).toEqual({
      kind: 'request',
      request: { id: 'a', method: 'ping', params: { q: 1 } },
    });
  });

  it('reads an object without a method as notARequest', () => {
    expect(readRequest({ jsonrpc: '2.0', id: 1 })).toEqual({ kind: 'notARequest' });
  });

  it('reads an array, null and a primitive as notARequest', () => {
    expect(readRequest([{ method: 'ping' }])).toEqual({ kind: 'notARequest' });
    expect(readRequest(null)).toEqual({ kind: 'notARequest' });
    expect(readRequest('ping')).toEqual({ kind: 'notARequest' });
  });
});

describe('readMessage', () => {
  it('reads a JSON string line as a request', () => {
    expect(readMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({
      kind: 'request',
      request: { id: 1, method: 'ping', params: undefined },
    });
  });

  it('reads an already-parsed object as it stands', () => {
    const read = readMessage({ id: 2, method: 'tools/list', params: {} });
    expect(read).toEqual({ kind: 'request', request: { id: 2, method: 'tools/list', params: {} } });
  });

  it('reports malformed JSON as unparseable', () => {
    expect(readMessage('{"id":')).toEqual({ kind: 'unparseable' });
  });

  it('reports a JSON array and JSON null as notARequest', () => {
    expect(readMessage('[]')).toEqual({ kind: 'notARequest' });
    expect(readMessage('null')).toEqual({ kind: 'notARequest' });
  });

  it('reads a request with no id as the notification shape (id undefined)', () => {
    const read = readMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(read.kind).toBe('request');
    if (read.kind !== 'request') throw new Error('expected a request');
    expect(read.request.id).toBeUndefined();
  });

  it('preserves a numeric string id rather than casting it', () => {
    const read = readMessage('{"id":"42","method":"ping"}');
    if (read.kind !== 'request') throw new Error('expected a request');
    expect(read.request.id).toBe('42');
  });
});

describe('errorAnswer', () => {
  it('frames code and message under a JSON-RPC 2.0 error', () => {
    expect(errorAnswer({ id: 4, code: -32600, message: 'invalid request' })).toEqual({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -32600, message: 'invalid request' },
    });
  });

  it('echoes a null id for a line that carried no request', () => {
    expect(errorAnswer({ id: null, code: -32700, message: 'parse error' })).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse error' },
    });
  });
});

describe('idOf', () => {
  it('maps an absent id to null, which is what the protocol asks for', () => {
    const request: RpcRequest = { id: undefined, method: 'ping', params: undefined };
    expect(idOf(request)).toBeNull();
  });

  it('preserves a falsy id, including 0 and the empty string', () => {
    expect(idOf({ id: 0, method: 'ping', params: undefined })).toBe(0);
    expect(idOf({ id: '', method: 'ping', params: undefined })).toBe('');
  });
});

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ method: 'ping' })).toBe(true);
  });

  it('rejects null, an array and primitives', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('ping')).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});
