/**
 * Transport suite (SPEC.md §7): the HTTP status → `OpsError` mapping table and
 * cursor-pagination passthrough, driven against the recording stub API
 * (`test/support/stub-api.ts`). No test contacts a real service.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  failureFromResponse,
  OpsError,
  renderOpsError,
  type OpsErrorCode,
} from '../src/transport/errors';
import { createExecutor, type Executor } from '../src/transport/executor';
import { main as runCli } from '../src/cli/run';
import { sampleRegistry } from '../src/fixtures/sample';
import { storeTokens } from '../src/auth/token-store';
import { sampleApiToken, startStubApi, type StubApi } from './support/stub-api';

const OPERATION = 'sample.get';
const OWNER_SUBJECT = 'owner-a';
const VALID_TOKEN = sampleApiToken;
const ONE_SECOND_MS = 1_000;
const ONE_HOUR_MS = 3_600_000;
/** The `ExecutorOptions.deadlineMs` default (§3.4), asserted in the rendered timeout detail. */
const DEFAULT_DEADLINE_MS = 30_000;

interface StatusCase {
  status: number;
  code: OpsErrorCode;
}

const STATUS_CASES: StatusCase[] = [
  { status: 401, code: 'unauthenticated' },
  { status: 404, code: 'notFound' },
  { status: 409, code: 'conflict' },
  { status: 503, code: 'requestFailed' },
];

interface DetailCase {
  name: string;
  body: string;
  statusText: string;
  detail: string;
}

const DETAIL_CASES: DetailCase[] = [
  { name: 'a message field', body: '{"message":"boom"}', statusText: 'Boom', detail: 'boom' },
  { name: 'a bare string', body: '"boom"', statusText: 'Boom', detail: 'boom' },
  { name: 'a list of strings', body: '["a","b"]', statusText: 'Boom', detail: 'a; b' },
  { name: 'a message list', body: '{"message":["a","b"]}', statusText: 'Boom', detail: 'a; b' },
  { name: 'plain text', body: 'not json', statusText: 'Boom', detail: '503 Boom' },
  { name: 'an empty body', body: '', statusText: 'Boom', detail: '503 Boom' },
];

const SEEDED_IDS = ['row-a', 'row-b', 'row-c'];

describe('the status mapping', () => {
  for (const statusCase of STATUS_CASES) {
    it(`reads ${statusCase.status} as ${statusCase.code}`, async () => {
      const error = await failureFromResponse(
        OPERATION,
        new Response('{"message":"boom"}', { status: statusCase.status, statusText: 'Boom' }),
      );

      expect(error.code).toBe(statusCase.code);
      expect(error.status).toBe(statusCase.status);
    });
  }
});

describe('the failure detail', () => {
  for (const detailCase of DETAIL_CASES) {
    it(`reads ${detailCase.name}`, async () => {
      const error = await failureFromResponse(
        OPERATION,
        new Response(detailCase.body, { status: 503, statusText: detailCase.statusText }),
      );

      expect(error.message).toBe(`sample.get failed (requestFailed): ${detailCase.detail}`);
    });
  }
});

describe('the executor token gate', () => {
  let stub: StubApi;

  beforeEach(async () => {
    stub = await startStubApi({ ownerSubject: OWNER_SUBJECT, rows: seededRows() });
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('refuses a call with no stored token before any socket opens', async () => {
    const executor = executorWith({ baseUrl: stub.baseUrl, token: undefined });

    await expect(executor.run('get', { id: SEEDED_IDS[0] })).rejects.toThrow(
      'sample.get failed (unauthenticated): no token found, run `life-ops login` first',
    );
    expect(stub.requestLog).toHaveLength(0);
  });
});

describe('cursor pagination', () => {
  let stub: StubApi;

  beforeEach(async () => {
    stub = await startStubApi({ ownerSubject: OWNER_SUBJECT, rows: seededRows() });
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('passes the cursor and the limit through untouched', async () => {
    const firstPage = await listSamples(stub, { limit: 1 });
    const cursor = nextCursorOf(firstPage);
    const secondPage = await listSamples(stub, { limit: 1, cursor });

    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]).not.toEqual(firstPage.items[0]);
    expect(stub.requestLog[1].query).toEqual({ limit: '1', cursor });
  });

  it('walks every stored row one page at a time', async () => {
    const walked: string[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await listSamples(stub, { limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      walked.push(...page.items.map((item) => String(item['id'])));
      cursor = nextCursorOf(page);
      if (cursor === undefined) break;
    }

    expect(walked).toEqual(SEEDED_IDS);
  });
});

describe('the per-call deadline', () => {
  let stub: StubApi;

  beforeEach(async () => {
    stub = await startStubApi({ ownerSubject: OWNER_SUBJECT, rows: seededRows() });
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('sends the default deadline signal on its one fetch when the adapter passes no option', async () => {
    const calls = await fetchCallsOf(() =>
      executorWith({ baseUrl: stub.baseUrl, token: VALID_TOKEN }).run('get', {
        id: SEEDED_IDS[0],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no signal when the deadline is disabled', async () => {
    const calls = await fetchCallsOf(() =>
      executorWith({ baseUrl: stub.baseUrl, token: VALID_TOKEN, deadlineMs: 0 }).run('get', {
        id: SEEDED_IDS[0],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBeUndefined();
  });

  it('keeps mapping a !response.ok reply through failureFromResponse', async () => {
    const executor = executorWith({ baseUrl: stub.baseUrl, token: VALID_TOKEN });

    await expect(executor.run('get', { id: 'missing-row' })).rejects.toThrow(
      'sample.get failed (notFound):',
    );
  });

  it('defaults the deadline to 30 s when the adapter passes no option', async () => {
    const aborted = jest.spyOn(globalThis, 'fetch').mockRejectedValue(abortError());
    try {
      const error = await executorWith({ baseUrl: stub.baseUrl, token: VALID_TOKEN })
        .run('get', { id: SEEDED_IDS[0] })
        .catch((thrown: unknown) => thrown);

      expect(renderOpsError(error as OpsError)).toBe(
        `sample.get failed (timeout): sample.get did not answer within ${DEFAULT_DEADLINE_MS} ms`,
      );
    } finally {
      aborted.mockRestore();
    }
  });

  it('honours LIFE_OPS_DEADLINE_MS at the CLI, so a hung call fails there after it', async () => {
    const silentApi = await startSilentApi();
    const credentialHome = mkdtempSync(join(tmpdir(), 'life-ops-cli-deadline-'));
    const savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
    process.env.LIFE_OPS_CREDENTIALS_PATH = join(credentialHome, 'credentials.json');
    await storeTokens({
      accessToken: VALID_TOKEN,
      refreshToken: 'stub.refresh.token',
      expiresAt: Date.now() + ONE_HOUR_MS,
    });
    const stderr: string[] = [];
    try {
      const exit = await runCli({
        argv: ['sample', 'get', '--id', 'row-a'],
        service: { registry: sampleRegistry },
        env: { LIFE_OPS_API_BASE: silentApi.baseUrl, LIFE_OPS_DEADLINE_MS: '100' },
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        signIn: async () => {},
      });

      expect(exit).toBe(1);
      expect(stderr.join('\n')).toBe(
        'sample.get failed (timeout): sample.get did not answer within 100 ms',
      );
    } finally {
      if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
      else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
      rmSync(credentialHome, { recursive: true, force: true });
      await silentApi.stop();
    }
  }, ONE_SECOND_MS);
});

interface SamplePage {
  items: Record<string, unknown>[];
  nextCursor?: string;
}

function seededRows() {
  return SEEDED_IDS.map((id, index) => ({
    id,
    title: `Row ${id}`,
    version: 1,
    ownerSub: OWNER_SUBJECT,
    priority: index,
  }));
}

function executorWith(setup: ExecutorSetup): Executor {
  return createExecutor({
    registry: sampleRegistry,
    baseUrl: setup.baseUrl,
    readToken: async () => setup.token,
    deadlineMs: setup.deadlineMs,
  });
}

interface ExecutorSetup {
  baseUrl: string;
  token: string | undefined;
  /** Absent means "take the 30 s default", which is what both adapters rely on. */
  deadlineMs?: number;
}

async function listSamples(stub: StubApi, input: Record<string, unknown>): Promise<SamplePage> {
  const result = await executorWith({ baseUrl: stub.baseUrl, token: VALID_TOKEN }).run(
    'list',
    input,
  );
  return result.body as SamplePage;
}

function nextCursorOf(page: SamplePage): string | undefined {
  return page.nextCursor;
}

interface FetchCall {
  signal: AbortSignal | undefined;
}

/** The requests one call sent, recorded as each leaves, so a test reads the init it passed. */
async function fetchCallsOf(call: () => Promise<unknown>): Promise<FetchCall[]> {
  const calls: FetchCall[] = [];
  const sendFetch = global.fetch;
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ signal: init?.signal ?? undefined });
    return await sendFetch(input, init);
  });
  try {
    await call();
    return calls;
  } finally {
    jest.restoreAllMocks();
  }
}

/** A loopback service that accepts the request and never answers it. */
/** Node's shape for an aborted fetch: a `DOMException`, not an `Error`. */
function abortError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

async function startSilentApi(): Promise<StubApi> {
  const server = createServer(() => {});
  await new Promise<void>((started) => server.listen(0, '127.0.0.1', started));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, requestLog: [], stop: () => closeSilentApi(server) };
}

function closeSilentApi(server: Server): Promise<void> {
  return new Promise((closed, fail) => {
    server.closeAllConnections();
    server.close((error) => (error === undefined ? closed() : fail(error)));
  });
}
