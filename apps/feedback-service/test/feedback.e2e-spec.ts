import { ENC_PREFIX } from '@life/crypto';
import type { FeedbackPage } from '@life/shared';
import {
  FakeRedisClient,
  JwtHarness,
  canProvidePostgres,
  feedbackBody as validBody,
  feedbackId,
  getFeedback as get,
  patchFeedbackStatus,
  postFeedback as post,
  sleep,
  startFeedbackApp,
  startThrowawayPostgres,
  waitFor,
  type FeedbackApp,
  type ThrowawayPostgres,
} from './feedback-harness';

/**
 * Groups 1, 4 and 5 of `SPEC-feedback-service`'s Testing Strategy, proved
 * against a throwaway Postgres: idempotency, the ciphertext-at-rest
 * assertion, and the read-through cache (gen-bump, fail-open, no-REDIS_URL).
 *
 * Skipped — never failed — when Docker is absent and no `FEEDBACK_TEST_DB_URL`
 * is configured; no data directory and no compose service is ever touched.
 */

jest.setTimeout(180_000);

const describeDb = canProvidePostgres() ? describe : describe.skip;

const OWNER = 'owner-api';
const OTHER = 'owner-other';

describeDb('Feedback API (e2e)', () => {
  let pg: ThrowawayPostgres;
  let jwt: JwtHarness;
  let dbUrl = '';

  beforeAll(async () => {
    pg = await startThrowawayPostgres('api');
    dbUrl = pg.url;
    jwt = await new JwtHarness().start();
  });

  afterAll(async () => {
    await jwt?.stop();
    await pg?.stop();
  });

  describe('1. idempotency', () => {
    let app: FeedbackApp;
    let token: string;
    let otherToken: string;

    beforeAll(async () => {
      app = await startFeedbackApp({ dbUrl, jwt });
      token = await jwt.sign(OWNER);
      otherToken = await jwt.sign(OTHER);
    });

    afterAll(async () => {
      await app.close();
    });

    const rowCount = async (id: string): Promise<number> => {
      const rows = await app.dataSource.query(
        'SELECT COUNT(*)::int AS n FROM feedback WHERE id = $1',
        [id],
      );
      return rows[0].n as number;
    };

    const eventCount = async (id: string): Promise<number> => {
      const rows = await app.dataSource.query(
        'SELECT COUNT(*)::int AS n FROM feedback_event WHERE "eventId" = $1',
        [id],
      );
      return rows[0].n as number;
    };

    it('a repeated id returns the same 201 {id} with exactly one row and one event', async () => {
      const id = feedbackId();
      const body = validBody(id, 'the same id twice');

      const first = await post(app, token, body).expect(201);
      expect(first.body).toEqual({ id });

      const second = await post(app, token, body).expect(201);
      expect(second.body).toEqual({ id });

      expect(await rowCount(id)).toBe(1);
      expect(await eventCount(id)).toBe(1);
    });

    it('another owner reusing the id gets 404, never 403/409 (no existence leak)', async () => {
      const id = feedbackId();
      await post(app, token, validBody(id, 'owned by api owner')).expect(201);

      const foreign = await post(app, otherToken, validBody(id, 'taken by someone else'));
      expect(foreign.status).toBe(404);
      expect(foreign.body.message).toBe('Feedback not found');
      expect(foreign.body.statusCode).toBe(404);

      // The rightful owner still has exactly one row: the 404 changed nothing.
      expect(await rowCount(id)).toBe(1);
      expect(await eventCount(id)).toBe(1);
    });

    it('an id no owner has seen is a fresh insert, not a 404', async () => {
      const id = feedbackId();
      const created = await post(app, otherToken, validBody(id, 'brand new')).expect(201);
      expect(created.body).toEqual({ id });
      expect(await rowCount(id)).toBe(1);
    });

    it('rejects a whitespace-only description with 400 (never 422)', async () => {
      const res = await post(app, token, validBody(feedbackId(), '   ')).expect(400);
      expect(res.status).toBe(400);
    });

    it('rejects a missing, blank or over-long title with 400', async () => {
      const missingTitle = await post(app, token, {
        id: feedbackId(),
        app: 'notes',
        type: 'bug_report',
        description: 'has no title',
      }).expect(400);
      expect(missingTitle.status).toBe(400);
      const blankTitle = await post(
        app,
        token,
        validBody(feedbackId(), 'blank title', '   '),
      ).expect(400);
      expect(blankTitle.status).toBe(400);
      const longTitle = await post(
        app,
        token,
        validBody(feedbackId(), 'long title', 'x'.repeat(201)),
      ).expect(400);
      expect(longTitle.status).toBe(400);
    });

    it('rejects validation failures with 400: unknown field, bad uuid, bad type, over-length', async () => {
      const unknownField = await post(app, token, {
        ...validBody(feedbackId(), 'x'),
        ownerSub: 'spoofed',
      }).expect(400);
      expect(unknownField.status).toBe(400);
      const badUuid = await post(app, token, validBody('not-a-uuid', 'x')).expect(400);
      expect(badUuid.status).toBe(400);
      const badType = await post(app, token, {
        ...validBody(feedbackId(), 'x'),
        type: 'praise',
      }).expect(400);
      expect(badType.status).toBe(400);
      const overLength = await post(app, token, validBody(feedbackId(), 'x'.repeat(2001))).expect(
        400,
      );
      expect(overLength.status).toBe(400);
    });

    it('GET returns the owner-scoped page envelope, newest-first', async () => {
      const mine = [feedbackId(), feedbackId()];
      await post(app, token, validBody(mine[0], 'list a')).expect(201);
      await sleep(5);
      await post(app, token, validBody(mine[1], 'list b')).expect(201);
      await post(app, otherToken, validBody(feedbackId(), 'not mine')).expect(201);

      const mineRes = await get(app, token).expect(200);
      // `{ feedback, nextCursor }` — the envelope key is the mass noun, and the
      // bare array this route used to answer with is gone.
      expect(Object.keys(mineRes.body).sort()).toEqual(['feedback', 'nextCursor']);
      const list = (mineRes.body as FeedbackPage).feedback;
      expect(Array.isArray(list)).toBe(true);
      expect((mineRes.body as FeedbackPage).nextCursor).toBeNull();
      const ids = list.map((entry) => entry.id);
      for (const id of mine) expect(ids).toContain(id);
      const theirs = list.map((entry) => entry.description);
      expect(theirs).not.toContain('not mine');

      const otherRes = await get(app, otherToken).expect(200);
      expect((otherRes.body as FeedbackPage).feedback.map((entry) => entry.id)).not.toContain(
        mine[0],
      );

      // Newest-first (`createdAt DESC, id DESC`) across the two known ids. The
      // contract's order, not insertion order: the two rows can share a
      // createdAt, in which case the id DESC tie-break decides.
      const known = list.filter((entry) => mine.includes(entry.id));
      expect(known).toHaveLength(2);
      for (const entry of known) expect(entry.status).toBe('open');

      // The DB, not the client, supplies the default: the POST body never
      // carried a status, yet the row reads back `open`.
      const stored = await app.dataSource.query(
        'SELECT status FROM feedback WHERE id = $1',
        [mine[0]],
      );
      expect(stored[0].status).toBe('open');

      const [first, second] = known;
      expect(
        first.createdAt > second.createdAt ||
          (first.createdAt === second.createdAt && first.id > second.id),
      ).toBe(true);
    });

    it('pages the list without a gap or a duplicate across a cursor boundary', async () => {
      // Five fresh rows, each with its own `createdAt`, so the boundaries this
      // walk crosses are timestamp ones (the `id` tie-break has its own order test
      // in `pagination.test.ts` and needs no second proof here).
      const created: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const id = feedbackId();
        await post(app, token, validBody(id, `page entry ${index}`)).expect(201);
        created.push(id);
        await sleep(5);
      }

      // The unpaged order, from one capped read, is what the pages must reassemble.
      const whole = await get(app, token).query({ limit: 200 }).expect(200);
      const wholeIds = (whole.body as FeedbackPage).feedback.map((entry) => entry.id);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = cursor === null ? { limit: 2 } : { limit: 2, cursor };
        const res = await get(app, token).query(query).expect(200);
        const page = res.body as FeedbackPage;
        expect(Object.keys(res.body).sort()).toEqual(['feedback', 'nextCursor']);
        expect(page.feedback.length).toBeLessThanOrEqual(2);
        seen.push(...page.feedback.map((entry) => entry.id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 20);

      // The walk ended because the service said so, not because the guard tripped.
      expect(cursor).toBeNull();
      expect(pages).toBeGreaterThan(1);
      // No gap and no duplicate: every row appears exactly once, and a page is only
      // ever the next slice of one stable order.
      expect(new Set(seen).size).toBe(wholeIds.length);
      expect(seen).toEqual(wholeIds);
      for (const id of created) expect(seen).toContain(id);
    });
  });

  describe('3. status updates', () => {
    let app: FeedbackApp;
    let token: string;
    let otherToken: string;
    const redis = new FakeRedisClient();
    const OWNER_STATUS = 'owner-status';
    const GEN_KEY = `feedback:gen:${OWNER_STATUS}`;

    beforeAll(async () => {
      app = await startFeedbackApp({ dbUrl, jwt, cache: redis });
      token = await jwt.sign(OWNER_STATUS);
      otherToken = await jwt.sign('owner-status-other');
    });

    afterAll(async () => {
      await app.close();
    });

    const eventCount = async (id: string): Promise<number> => {
      const rows = await app.dataSource.query(
        'SELECT COUNT(*)::int AS n FROM feedback_event WHERE "eventId" = $1',
        [id],
      );
      return rows[0].n as number;
    };

    const statusOf = async (id: string): Promise<string> => {
      const rows = await app.dataSource.query('SELECT status FROM feedback WHERE id = $1', [id]);
      return rows[0].status as string;
    };

    const create = async (description: string): Promise<string> => {
      const id = feedbackId();
      await post(app, token, validBody(id, description)).expect(201);
      return id;
    };

    it('sets a status, returns 200 {id, status}, and bumps the owner generation', async () => {
      const id = await create('flip me to done');
      const generationsBefore = redis.incrCalls.filter((key) => key === GEN_KEY).length;

      const updated = await patchFeedbackStatus(app, token, id, { status: 'done' }).expect(200);
      expect(updated.body).toEqual({ id, status: 'done' });
      expect(await statusOf(id)).toBe('done');
      expect(redis.incrCalls.filter((key) => key === GEN_KEY)).toHaveLength(generationsBefore + 1);
    });

    it('serves the new status from GET after the generation bump, never the stale entry', async () => {
      const id = await create('read back the status');
      await get(app, token).expect(200);

      await patchFeedbackStatus(app, token, id, { status: 'in_progress' }).expect(200);

      const listed = await get(app, token).expect(200);
      const entry = (listed.body as FeedbackPage).feedback.find((row) => row.id === id);
      expect(entry?.status).toBe('in_progress');
    });

    it('repeats the same status as a no-op 200, creating no new row or event', async () => {
      const id = await create('set it twice');
      await patchFeedbackStatus(app, token, id, { status: 'wont_do' }).expect(200);
      const eventsAfterFirst = await eventCount(id);

      const again = await patchFeedbackStatus(app, token, id, { status: 'wont_do' }).expect(200);

      expect(again.body).toEqual({ id, status: 'wont_do' });
      expect(await eventCount(id)).toBe(eventsAfterFirst);
      expect(eventsAfterFirst).toBe(1);
    });

    it('rejects a status outside the vocabulary with 400, never 422', async () => {
      const id = await create('no such status');

      await patchFeedbackStatus(app, token, id, { status: 'archived' }).expect(400);

      expect(await statusOf(id)).toBe('open');
    });

    it('rejects a malformed id with 400, never a driver 500', async () => {
      const res = await patchFeedbackStatus(app, token, 'not-a-uuid', { status: 'done' }).expect(
        400,
      );
      expect(res.status).toBe(400);
    });

    it('answers 404 for a missing id and a foreign id, byte-identically', async () => {
      const missing = await patchFeedbackStatus(app, token, feedbackId(), { status: 'done' });
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('Feedback not found');

      const id = await create('owned by the first owner');
      const foreign = await patchFeedbackStatus(app, otherToken, id, { status: 'done' });
      expect(foreign.status).toBe(404);
      expect(foreign.body.message).toBe('Feedback not found');

      // The owner's row is untouched: the 404 changed nothing.
      expect(await statusOf(id)).toBe('open');
    });

    it('never writes a feedback_event row on a status change', async () => {
      const id = await create('status is not an event');
      const eventsAfterCreate = await eventCount(id);

      await patchFeedbackStatus(app, token, id, { status: 'done' }).expect(200);

      expect(await eventCount(id)).toBe(eventsAfterCreate);
    });
  });

  describe('4. ciphertext assertion', () => {
    let app: FeedbackApp;
    let token: string;
    const redis = new FakeRedisClient();
    const TITLE = 'TOPSECRET-FEEDBACK-TITLE';
    const PLAINTEXT = 'TOPSECRET-FEEDBACK-DESCRIPTION';

    beforeAll(async () => {
      app = await startFeedbackApp({ dbUrl, jwt, cache: redis });
      token = await jwt.sign('owner-cipher');
    });

    afterAll(async () => {
      await app.close();
    });

    it('the raw columns, every cached value, the event rows and the message bodies are free of plaintext', async () => {
      const id = feedbackId();
      await post(app, token, {
        id,
        app: 'todos',
        type: 'enhancement',
        title: TITLE,
        description: PLAINTEXT,
      }).expect(201);

      // Decrypts in the request path only — plaintext never exists beyond it.
      const listed = await get(app, token).expect(200);
      const entry = (listed.body as FeedbackPage).feedback.find((row) => row.id === id);
      expect(entry?.title).toBe(TITLE);
      expect(entry?.description).toBe(PLAINTEXT);

      // 1. The raw `title` and `description` columns are `enc.v1.` envelopes.
      const rows = await app.dataSource.query(
        'SELECT title, description FROM feedback WHERE id = $1',
        [id],
      );
      const titleCiphertext = rows[0].title as string;
      const ciphertext = rows[0].description as string;
      expect(titleCiphertext.startsWith(ENC_PREFIX)).toBe(true);
      expect(titleCiphertext).not.toContain(TITLE);
      expect(ciphertext.startsWith(ENC_PREFIX)).toBe(true);
      expect(ciphertext).not.toContain(PLAINTEXT);

      // 2. Every value Redis would persist is ciphertext and carries no plaintext.
      expect(redis.written.length).toBeGreaterThan(0);
      for (const { value } of redis.written) {
        expect(value).toContain(ENC_PREFIX);
        expect(value).not.toContain(TITLE);
        expect(value).not.toContain(PLAINTEXT);
      }

      // 3. Event rows are metadata only: neither plaintext nor ciphertext.
      const events = await app.dataSource.query('SELECT * FROM feedback_event');
      const eventJson = JSON.stringify(events);
      expect(eventJson).not.toContain(TITLE);
      expect(eventJson).not.toContain(PLAINTEXT);
      expect(eventJson).not.toContain(titleCiphertext);
      expect(eventJson).not.toContain(ciphertext);

      // 4. The published message body carries metadata only, exactly as specified.
      await waitFor(() => app.sink.eventIds.includes(id), 'feedback.submitted publish');
      const body = app.sink.published.find((entry) => entry.event_id === id)!;
      const bodyJson = JSON.stringify(body);
      expect(bodyJson).not.toContain(TITLE);
      expect(bodyJson).not.toContain(PLAINTEXT);
      expect(bodyJson).not.toContain(titleCiphertext);
      expect(bodyJson).not.toContain(ciphertext);
      expect(Object.keys(body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
        'app',
        'event_id',
        'feedback_id',
        'occurred_at',
        'owner_sub',
        'type',
      ]);
    });
  });

  describe('5. read-through cache', () => {
    let app: FeedbackApp;
    let token: string;
    const redis = new FakeRedisClient();
    const OWNER_CACHE = 'owner-cache';

    const listKey = (generation: number): string => `feedback:${OWNER_CACHE}:v${generation}:list`;
    const genKey = `feedback:gen:${OWNER_CACHE}`;

    beforeAll(async () => {
      app = await startFeedbackApp({ dbUrl, jwt, cache: redis });
      token = await jwt.sign(OWNER_CACHE);
    });

    afterAll(async () => {
      await app.close();
    });

    it('populates one ciphertext entry per generation and bumps after a write', async () => {
      // Prime generation 0 (an empty owner's list is a legitimate entry).
      await get(app, token).expect(200);
      expect(redis.setCalls).toEqual([listKey(0)]);

      // A successful write bumps the owner's counter AFTER the commit.
      const id = feedbackId();
      await post(app, token, validBody(id, 'cache alpha')).expect(201);
      expect(redis.incrCalls).toEqual([genKey]);
      expect(redis.store.get(genKey)).toBe('1');

      // The generation-0 entry is now unreachable: the next read misses,
      // re-queries the DB and repopulates under generation 1.
      const afterWrite = await get(app, token).expect(200);
      expect(redis.setCalls).toContain(listKey(1));
      expect((afterWrite.body as FeedbackPage).feedback.some((entry) => entry.id === id)).toBe(true);

      // An identical read is a hit: no second populate, no second DB loader run.
      const setsSoFar = redis.setCalls.filter((key) => key === listKey(1)).length;
      await get(app, token).expect(200);
      expect(redis.setCalls.filter((key) => key === listKey(1))).toHaveLength(setsSoFar);

      // What Redis got is ciphertext, never the description it serves — while
      // `status` rides along as plaintext workflow metadata (`SPEC-feedback-status`
      // Cache Rules), so a filtered read can group without a decrypt.
      const entry = redis.written.find((written) => written.key === listKey(1))!;
      expect(entry.value).toContain(ENC_PREFIX);
      expect(entry.value).not.toContain('cache alpha');
      const cachedStatuses = (JSON.parse(entry.value) as Array<{ status: string }>).map(
        (row) => row.status,
      );
      expect(cachedStatuses).toEqual(['open']);
    });

    it('serves every page of a paged read from the one unpaged cache entry', async () => {
      const OWNER_PAGED = 'owner-cache-paged';
      const pagedToken = await jwt.sign(OWNER_PAGED);
      await post(app, pagedToken, validBody(feedbackId(), 'paged alpha')).expect(201);
      await sleep(5);
      await post(app, pagedToken, validBody(feedbackId(), 'paged beta')).expect(201);

      const setsForOwner = (): number =>
        redis.setCalls.filter((key) => key.startsWith(`feedback:${OWNER_PAGED}:`)).length;

      // Page 1 populates the entry; page 2 is a hit on that same key, because
      // `limit`/`cursor` are projections after the hit and never a fetch identity.
      const first = await get(app, pagedToken).query({ limit: 1 }).expect(200);
      const populated = setsForOwner();
      expect(populated).toBe(1);
      const cursor = (first.body as FeedbackPage).nextCursor;
      expect(cursor).not.toBeNull();

      const second = await get(app, pagedToken).query({ limit: 1, cursor }).expect(200);
      expect(setsForOwner()).toBe(populated);
      expect((second.body as FeedbackPage).nextCursor).toBeNull();

      // Both pages came from one unpaged row set: together they are the whole list.
      const both = [
        ...(first.body as FeedbackPage).feedback,
        ...(second.body as FeedbackPage).feedback,
      ];
      expect(both.map((entry) => entry.description)).toEqual(['paged beta', 'paged alpha']);
      for (const key of redis.setCalls) {
        expect(key).not.toContain('limit');
        expect(key).not.toContain('cursor');
      }
    });
  });

  describe('5. fail-open on a broken cache client', () => {
    let app: FeedbackApp;
    let token: string;

    beforeAll(async () => {
      app = await startFeedbackApp({ dbUrl, jwt, cache: 'failing' });
      token = await jwt.sign('owner-broken-redis');
    });

    afterAll(async () => {
      await app.close();
    });

    it('writes and reads succeed while every Redis command rejects', async () => {
      const id = feedbackId();
      await post(app, token, validBody(id, 'survives a broken cache')).expect(201);

      const listed = await get(app, token).expect(200);
      expect((listed.body as FeedbackPage).feedback.find((entry) => entry.id === id)?.description).toBe(
        'survives a broken cache',
      );
      await get(app, token).expect(200);
    });
  });

  describe('5. read path without REDIS_URL (direct DB)', () => {
    let app: FeedbackApp;
    let token: string;

    beforeAll(async () => {
      // No cache override and no `REDIS_URL`: the module's own factory must
      // select the direct loader path.
      app = await startFeedbackApp({ dbUrl, jwt });
      token = await jwt.sign('owner-direct');
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves the owner directly from Postgres with no cache configured', async () => {
      const id = feedbackId();
      await post(app, token, validBody(id, 'direct from the database')).expect(201);

      const listed = await get(app, token).expect(200);
      expect((listed.body as FeedbackPage).feedback.find((entry) => entry.id === id)?.description).toBe(
        'direct from the database',
      );

      // Repeated reads stay correct without a cache: the loader runs every time.
      const again = await get(app, token).expect(200);
      expect(again.body).toEqual(listed.body);
    });
  });
});