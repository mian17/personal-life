/**
 * Bulk executor suite (SPEC-bulk-ops §2.6, §2.7): the fan-out is a strategy inside
 * the one executor, so this suite drives `run(kind, input)` against a recording
 * `fetch` and judges three things — the envelope a caller reads, the order the
 * items went out in, and the call-level failures that must reach no request at all.
 * The registry is the fixture one that opted into bulk, so no shipped resource is
 * involved (§2.2).
 */
import type { BulkEnvelope } from '../src/core/bulk.js';
import { createExecutor, type Executor, type OpsResult } from '../src/transport/executor.js';
import { resources } from './support/bulk-service-module.js';

/** The opted-in fixture resource, declared first in the fixture module. */
const journals = resources[0];

const BASE_URL = 'http://journals.test';
const TOKEN = 'stub.access.token';
const COLLECTION_PATH = '/api/journals';

describe('the envelope one bulk call returns', () => {
  it('carries exactly the §2.7 keys and the counts its entries imply', async () => {
    const service = startRecordingFetch((request) => journalCreated(request.body));

    try {
      const result = await executorWith({ token: TOKEN }).run('createMany', {
        items: [{ title: 'First' }, { title: 'Second' }],
      });

      const envelope = result.body as BulkEnvelope;
      expect(result.status).toBe(200);
      expect(Object.keys(envelope)).toEqual(['total', 'succeeded', 'failed', 'results']);
      expect(envelope.total).toBe(envelope.results.length);
      expect(envelope.succeeded + envelope.failed).toBe(envelope.total);
      expect(envelope).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
      expect(service.requests.map((request) => request.method)).toEqual(['POST', 'POST']);
      expect(service.requests.map((request) => request.path)).toEqual([
        COLLECTION_PATH,
        COLLECTION_PATH,
      ]);
      expect(envelope.results).toEqual([
        { index: 0, status: 'succeeded', item: { title: 'First' }, ref: { id: 'created-First' } },
        { index: 1, status: 'succeeded', item: { title: 'Second' }, ref: { id: 'created-Second' } },
      ]);
    } finally {
      service.stop();
    }
  });

  it('fails one item inline, still runs the rest, and echoes every item once', async () => {
    const service = startRecordingFetch((request) =>
      request.path.endsWith('/j2')
        ? replied(404, { message: 'Journal not found' })
        : replied(200, { id: idOf(request) }),
    );
    const items = ['j1', 'j2', 'j3'];

    try {
      const envelope = await envelopeOf(executorWith({ token: TOKEN }).run('getMany', { items }));

      expect(envelope).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
      expect(envelope.results.map((result) => result.index)).toEqual([0, 1, 2]);
      expect(envelope.results.map((result) => result.item)).toEqual(items);
      expect(envelope.results[1]).toEqual({
        index: 1,
        status: 'failed',
        item: 'j2',
        error: 'journals.get failed (notFound): Journal not found',
      });
      expect(envelope.results[1]).not.toHaveProperty('ref');
      expect(envelope.results[0]).not.toHaveProperty('error');
    } finally {
      service.stop();
    }
  });

  it('omits `ref` when the single-row body is undefined, as a bodiless delete leaves it', async () => {
    const service = startRecordingFetch(() => new Response(null, { status: 200 }));

    try {
      const envelope = await envelopeOf(
        executorWith({ token: TOKEN }).run('deleteMany', {
          items: ['j1'],
        }),
      );

      expect(envelope.results[0]).toEqual({ index: 0, status: 'succeeded', item: 'j1' });
    } finally {
      service.stop();
    }
  });
});

describe('the order the items are sent in', () => {
  it('sends a write batch one item at a time, in submitted order', async () => {
    const service = startRecordingFetch(async () => {
      await afterTick();
      return replied(200, { ok: true });
    });
    const items = [
      { id: 'j1', title: 'One' },
      { id: 'j2', title: 'Two' },
      { id: 'j3', title: 'Three' },
    ];

    try {
      const envelope = await envelopeOf(
        executorWith({ token: TOKEN }).run('updateMany', { items }),
      );

      expect(service.mostOpenAtOnce).toBe(1);
      expect(service.requests.map((request) => request.method)).toEqual([
        'PATCH',
        'PATCH',
        'PATCH',
      ]);
      expect(service.requests.map((request) => request.path)).toEqual([
        `${COLLECTION_PATH}/j1`,
        `${COLLECTION_PATH}/j2`,
        `${COLLECTION_PATH}/j3`,
      ]);
      expect(envelope.results.map((result) => result.item)).toEqual(items);
    } finally {
      service.stop();
    }
  });

  it('lets a read batch overlap its items and still reports submitted order', async () => {
    const service = startRecordingFetch(async (request) => {
      await afterTick();
      return replied(200, { id: idOf(request) });
    });
    const items = ['j1', 'j2', 'j3'];

    try {
      const envelope = await envelopeOf(executorWith({ token: TOKEN }).run('getMany', { items }));

      expect(service.mostOpenAtOnce).toBe(items.length);
      expect(envelope.results.map((result) => result.index)).toEqual([0, 1, 2]);
      expect(envelope.results.map((result) => result.item)).toEqual(items);
    } finally {
      service.stop();
    }
  });
});

describe('a call-level failure', () => {
  it('refuses a malformed batch before any request leaves', async () => {
    const service = startRecordingFetch(() => journalCreated({ title: 'unreached' }));

    try {
      await expect(
        executorWith({ token: TOKEN }).run('createMany', { items: [{ body: 'no title' }] }),
      ).rejects.toThrow('journals.createMany failed (invalidInput): items.0.title: required');
      expect(service.requests).toHaveLength(0);
    } finally {
      service.stop();
    }
  });

  it('refuses a batch above the cap this executor was given', async () => {
    const service = startRecordingFetch(() => replied(200, { id: 'j1' }));

    try {
      await expect(
        executorWith({ token: TOKEN, bulkLimit: 2 }).run('getMany', { items: ['j1', 'j2', 'j3'] }),
      ).rejects.toThrow(
        'journals.getMany failed (invalidInput): items: exceeds LIFE_OPS_BULK_LIMIT (2)',
      );
      expect(service.requests).toHaveLength(0);
    } finally {
      service.stop();
    }
  });

  it('refuses a batch with no stored token and envelopes nothing', async () => {
    const service = startRecordingFetch(() => replied(200, { id: 'j1' }));

    try {
      await expect(
        executorWith({ token: undefined }).run('getMany', { items: ['j1'] }),
      ).rejects.toThrow(
        'journals.getMany failed (unauthenticated): no token found, run `npm run ops -- login` first',
      );
      expect(service.requests).toHaveLength(0);
    } finally {
      service.stop();
    }
  });
});

describe('an item whose deadline fires', () => {
  it('fails that item alone and leaves the others executed', async () => {
    const service = startRecordingFetch((request) =>
      request.path.endsWith('/slow') ? neverAnswered(request) : replied(200, { id: idOf(request) }),
    );

    try {
      const envelope = await envelopeOf(
        executorWith({ token: TOKEN, deadlineMs: 20 }).run('getMany', {
          items: ['fast', 'slow'],
        }),
      );

      expect(envelope).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      expect(envelope.results[0]).toEqual({
        index: 0,
        status: 'succeeded',
        item: 'fast',
        ref: { id: 'fast' },
      });
      expect(envelope.results[1]).toEqual({
        index: 1,
        status: 'failed',
        item: 'slow',
        error: 'journals.get failed (timeout): journals.get did not answer within 20 ms',
      });
    } finally {
      service.stop();
    }
  });
});

interface ExecutorSetup {
  token: string | undefined;
  /** Absent means the executor's own default of 30 s. */
  deadlineMs?: number;
  /** Absent means `resolveBulkLimit(process.env)` decides the cap. */
  bulkLimit?: number;
}

function executorWith(setup: ExecutorSetup): Executor {
  return createExecutor({
    registry: journals,
    baseUrl: BASE_URL,
    readToken: async () => setup.token,
    deadlineMs: setup.deadlineMs,
    bulkLimit: setup.bulkLimit,
  });
}

async function envelopeOf(call: Promise<OpsResult>): Promise<BulkEnvelope> {
  const result = await call;
  expect(result.status).toBe(200);
  return result.body as BulkEnvelope;
}

/** What one request asked for, in the terms the wire decides: method, path, body, deadline. */
interface SentRequest {
  method: string;
  path: string;
  body: unknown;
  signal: AbortSignal | undefined;
}

type Answer = (request: SentRequest) => Response | Promise<Response>;

interface RecordingFetch {
  requests: SentRequest[];
  /** The most requests that were in flight together: `1` is the sequencing proof (§2.6). */
  mostOpenAtOnce: number;
  stop: () => void;
}

/** The suite's service side: every request is recorded first, then answered by the test. */
function startRecordingFetch(answer: Answer): RecordingFetch {
  const recording: RecordingFetch = {
    requests: [],
    mostOpenAtOnce: 0,
    stop: () => recordingFetch.mockRestore(),
  };
  let inFlight = 0;
  const recordingFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = sentRequestOf(input, init);
    recording.requests.push(request);
    inFlight += 1;
    recording.mostOpenAtOnce = Math.max(recording.mostOpenAtOnce, inFlight);
    try {
      return await answer(request);
    } finally {
      inFlight -= 1;
    }
  });
  return recording;
}

function sentRequestOf(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): SentRequest {
  return {
    method: init?.method ?? 'GET',
    path: new URL(String(input)).pathname,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    signal: init?.signal ?? undefined,
  };
}

/** The row a create answered with, so an envelope's `ref` is the body the call returned. */
function journalCreated(body: unknown): Response {
  const title = (body as { title: string }).title;
  return replied(201, { id: `created-${title}` });
}

function replied(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function idOf(request: SentRequest): string {
  return request.path.split('/').pop() ?? '';
}

/** Answering costs a tick, so requests that overlap at the executor are visible as overlap. */
async function afterTick(): Promise<void> {
  await new Promise((done) => setImmediate(done));
}

/** A service that accepts the request and never answers it: only the item's deadline can. */
function neverAnswered(request: SentRequest): Promise<Response> {
  return new Promise((_, fail) => {
    request.signal?.addEventListener('abort', () => fail(abortError()), { once: true });
  });
}

/** Node's shape for an aborted fetch: a `DOMException` by name, not an `OpsError`. */
function abortError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}
