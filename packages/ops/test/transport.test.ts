/**
 * Transport suite (SPEC.md §7): the HTTP status → `OpsError` mapping table and
 * cursor-pagination passthrough, driven against the recording stub API
 * (`test/support/stub-api.ts`). No test contacts a real service.
 */
import { failureFromResponse, type OpsErrorCode } from '../src/transport/errors';
import { createExecutor } from '../src/transport/executor';
import { sampleRegistry } from '../src/fixtures/sample';
import { sampleApiToken, startStubApi, type StubApi } from './support/stub-api';

const OPERATION = 'sample.get';
const OWNER_SUBJECT = 'owner-a';
const VALID_TOKEN = sampleApiToken;

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
    const executor = executorWith(stub.baseUrl, undefined);

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

function executorWith(baseUrl: string, token: string | undefined) {
  return createExecutor({
    registry: sampleRegistry,
    baseUrl,
    readToken: async () => token,
  });
}

async function listSamples(stub: StubApi, input: Record<string, unknown>): Promise<SamplePage> {
  const result = await executorWith(stub.baseUrl, VALID_TOKEN).run('list', input);
  return result.body as SamplePage;
}

function nextCursorOf(page: SamplePage): string | undefined {
  return page.nextCursor;
}
