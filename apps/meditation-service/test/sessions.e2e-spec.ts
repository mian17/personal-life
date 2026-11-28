import { jest } from '@jest/globals';
import request from 'supertest';
import { ENC_PREFIX } from '@life/crypto';
import { MEDITATION_CACHE, MeditationCache, generationKey } from '../src/cache/meditation-cache.js';
import { SessionsModule } from '../src/sessions/sessions.module.js';
import { FakeRedisClient } from './fake-redis.js';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startMeditationApp,
  startThrowawayDatabase,
  type MeditationApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * The sitting slice over HTTP (`SPEC-meditation-app` §1, §5): a natural finish stores the
 * planned minutes with `completed: true`, an early keep stores the elapsed minutes capped at
 * the planned length, and an abandon has no route at all — so a record is the only thing that
 * can write, and it can never hold more minutes than the sitting was planned for.
 *
 * Listing and detail serve only live rows, and a `DELETE` stamps `deletedAt` instead of
 * removing anything: the row keeps its place in `meditation.db` and leaves every read.
 *
 * The second suite arms the service's own cache adapter to prove the invalidation half —
 * every write bumps the owner's generation and the next list read misses (`## Cache Rules`).
 */
jest.setTimeout(60_000);

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

/** The day the cached-read suite records on, and the one-day window it reads back. */
const DAY = '2026-11-16';
const WINDOW_KEY = `sessions:${DAY}:${DAY}`;

interface StoredSittingRow {
  id: string;
  ownerSub: string;
  day: string;
  content: string;
  deletedAt: string | null;
}

/** A fifteen-minute sitting that ran for `elapsedSeconds` and was stopped early and kept. */
function keptAfter(elapsedSeconds: number, day = '2026-11-16'): Record<string, unknown> {
  return {
    day,
    startedAt: `${day}T06:00:00.000Z`,
    endedAt: `${day}T06:10:00.000Z`,
    plannedMinutes: 15,
    elapsedSeconds,
    outcome: 'kept',
  };
}

/** The same fifteen-minute sitting, finished on its own planned length. */
function finishedOn(day = '2026-11-16'): Record<string, unknown> {
  return { ...keptAfter(15 * 60, day), endedAt: `${day}T06:15:00.000Z`, outcome: 'finished' };
}

describe('Sittings (e2e)', () => {
  let database: ThrowawayDatabase;
  let jwt: JwtTestHarness;
  let service: MeditationApp;
  let ownerToken: string;
  let otherOwnerToken: string;

  const boot = async (): Promise<MeditationApp> => {
    process.env.REDIS_URL = '';
    return startMeditationApp({ databasePath: database.path, jwksUrl: jwt.jwksUrl });
  };

  const recordSitting = (token: string, body: Record<string, unknown>) =>
    request(service.app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const listSittings = (token: string, query = '') =>
    request(service.app.getHttpServer())
      .get(`/sessions${query}`)
      .set('Authorization', `Bearer ${token}`);

  const readSitting = (token: string, id: string) =>
    request(service.app.getHttpServer())
      .get(`/sessions/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const removeSitting = (token: string, id: string) =>
    request(service.app.getHttpServer())
      .delete(`/sessions/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const storedRows = async (): Promise<StoredSittingRow[]> =>
    service.dataSource.query(
      'SELECT id, "ownerSub", day, content, "deletedAt" FROM "meditation_session" ORDER BY day, id',
    );

  beforeAll(async () => {
    database = await startThrowawayDatabase('sittings');
    jwt = await new JwtTestHarness().start();
    service = await boot();
    ownerToken = await jwt.sign(OWNER);
    otherOwnerToken = await jwt.sign(OTHER_OWNER);
  });

  afterEach(async () => {
    await service.dataSource.query('DELETE FROM "meditation_session"');
  });

  afterAll(async () => {
    await service.close();
    await jwt.stop();
    await database.stop();
  });

  it('records a natural finish as planned minutes with completed true', async () => {
    const response = await recordSitting(ownerToken, finishedOn()).expect(201);

    expect(response.body).toMatchObject({ plannedMinutes: 15, minutes: 15, completed: true });
    expect(await storedRows()).toHaveLength(1);
  });

  it('records thirty kept seconds as one minute against fifteen planned', async () => {
    const response = await recordSitting(ownerToken, keptAfter(30)).expect(201);

    expect(response.body).toMatchObject({ plannedMinutes: 15, minutes: 1, completed: false });
  });

  it('records ten kept minutes as ten against fifteen planned', async () => {
    const response = await recordSitting(ownerToken, keptAfter(600)).expect(201);

    expect(response.body).toMatchObject({ minutes: 10, completed: false });
  });

  it('never stores more than the planned minutes, however long the body claims', async () => {
    const response = await recordSitting(ownerToken, { ...keptAfter(60 * 60), plannedMinutes: 5 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ plannedMinutes: 5, minutes: 5 });
  });

  it('stores the row as an enc.v1. envelope with no plaintext numbers in it', async () => {
    await recordSitting(ownerToken, finishedOn()).expect(201);

    const [row] = await storedRows();

    expect(row.ownerSub).toBe(OWNER);
    expect(row.content.startsWith(ENC_PREFIX)).toBe(true);
    expect(row.content).not.toContain('plannedMinutes');
    expect(row.content).not.toContain('completed');
  });

  it('writes nothing for an abandoned sitting, which has no route to write through', async () => {
    const abandoned = await request(service.app.getHttpServer())
      .post('/sessions/abandon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(keptAfter(600));

    expect(abandoned.status).toBe(404);
    expect(await storedRows()).toEqual([]);
  });

  it('rejects a body carrying the owner, since ownership comes from the token', async () => {
    const response = await recordSitting(ownerToken, { ...finishedOn(), ownerSub: OTHER_OWNER });

    expect(response.status).toBe(400);
    expect(await storedRows()).toEqual([]);
  });

  it('rejects an unknown outcome and a negative elapsed time with 400', async () => {
    const unknownOutcome = await recordSitting(ownerToken, { ...finishedOn(), outcome: 'abandon' });
    const negative = await recordSitting(ownerToken, keptAfter(-1));

    expect([unknownOutcome.status, negative.status]).toEqual([400, 400]);
    expect(await storedRows()).toEqual([]);
  });

  it('lists the owner’s live sittings newest day first', async () => {
    await recordSitting(ownerToken, finishedOn('2026-11-14')).expect(201);
    await recordSitting(ownerToken, finishedOn('2026-11-16')).expect(201);

    const response = await listSittings(ownerToken).expect(200);

    expect(response.body.total).toBe(2);
    expect(daysOf(response.body.sessions)).toEqual(['2026-11-16', '2026-11-14']);
    expect(response.body.nextCursor).toBeNull();
  });

  it('lists two sittings recorded in the same second newest first', async () => {
    const first = await recordSitting(ownerToken, keptAfter(60)).expect(201);
    const second = await recordSitting(ownerToken, finishedOn()).expect(201);

    // `createdAt` is the column's second-precision default, so two quick sittings share a stamp
    // and only the insert sequence can put them in order — never the random uuid.
    await service.dataSource.query(
      `UPDATE "meditation_session" SET "createdAt" = '2026-11-16 06:00:00'`,
    );

    const response = await listSittings(ownerToken).expect(200);

    expect(idsOf(response.body.sessions)).toEqual([second.body.id, first.body.id]);
  });

  it('keeps an older day last even when it was recorded after a newer one', async () => {
    const newerDay = await recordSitting(ownerToken, finishedOn('2026-11-16')).expect(201);
    const olderDay = await recordSitting(ownerToken, finishedOn('2026-11-14')).expect(201);

    // The insert sequence would put the 14th first, so this is the read that proves `day`
    // outranks it instead of merely agreeing with it.
    const response = await listSittings(ownerToken).expect(200);

    expect(idsOf(response.body.sessions)).toEqual([newerDay.body.id, olderDay.body.id]);
  });

  it('pages through the shared paging seam without repeating a row', async () => {
    await recordSitting(ownerToken, finishedOn('2026-11-14')).expect(201);
    await recordSitting(ownerToken, finishedOn('2026-11-15')).expect(201);
    await recordSitting(ownerToken, finishedOn('2026-11-16')).expect(201);

    const first = await listSittings(ownerToken, '?limit=2').expect(200);
    const second = await listSittings(ownerToken, `?limit=2&cursor=${first.body.nextCursor}`);

    expect(second.status).toBe(200);
    expect([...daysOf(first.body.sessions), ...daysOf(second.body.sessions)]).toEqual([
      '2026-11-16',
      '2026-11-15',
      '2026-11-14',
    ]);
    expect(first.body.total).toBe(3);
    expect(second.body.nextCursor).toBeNull();
  });

  it('serves one sitting by id and 404s another owner’s id', async () => {
    const created = await recordSitting(ownerToken, finishedOn()).expect(201);

    const mine = await readSitting(ownerToken, created.body.id).expect(200);
    const theirs = await readSitting(otherOwnerToken, created.body.id);

    expect(mine.body.id).toBe(created.body.id);
    expect(mine.body.minutes).toBe(15);
    expect(theirs.status).toBe(404);
  });

  it('stamps deletedAt and drops the sitting from every list and detail read', async () => {
    const created = await recordSitting(ownerToken, finishedOn()).expect(201);

    await removeSitting(ownerToken, created.body.id).expect(200);

    const [row] = await storedRows();
    expect(row.deletedAt).not.toBeNull();
    expect((await listSittings(ownerToken).expect(200)).body.total).toBe(0);
    expect((await readSitting(ownerToken, created.body.id)).status).toBe(404);
  });

  it('404s a second delete of the same sitting, leaving the row in place', async () => {
    const created = await recordSitting(ownerToken, finishedOn()).expect(201);

    expect((await removeSitting(ownerToken, created.body.id)).status).toBe(200);
    expect((await removeSitting(ownerToken, created.body.id)).status).toBe(404);
    expect(await storedRows()).toHaveLength(1);
  });

  it('keeps one owner’s sittings invisible to another', async () => {
    await recordSitting(ownerToken, finishedOn()).expect(201);

    const response = await listSittings(otherOwnerToken).expect(200);

    expect(response.body).toEqual({ sessions: [], nextCursor: null, total: 0 });
  });
});

describe('Sittings (e2e, cached)', () => {
  let database: ThrowawayDatabase;
  let jwt: JwtTestHarness;
  let service: MeditationApp;
  let ownerToken: string;

  beforeAll(async () => {
    database = await startThrowawayDatabase('sittings-cached');
    jwt = await new JwtTestHarness().start();
    // No `REDIS_URL`: the adapter is the direct-DB one until a suite arms a fake over it.
    process.env.REDIS_URL = '';
    service = await startMeditationApp({ databasePath: database.path, jwksUrl: jwt.jwksUrl });
    ownerToken = await jwt.sign(OWNER);
  });

  afterEach(async () => {
    await service.dataSource.query('DELETE FROM "meditation_session"');
  });

  afterAll(async () => {
    await service.close();
    await jwt.stop();
    await database.stop();
  });

  const recordSitting = (body: Record<string, unknown>) =>
    request(service.app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);

  const listSittings = () =>
    request(service.app.getHttpServer())
      .get('/sessions')
      .set('Authorization', `Bearer ${ownerToken}`);

  /** The cached sitting read: one day window, the fetch identity the spec's key names. */
  const readDays = () =>
    request(service.app.getHttpServer())
      .get(`/sessions/days?from=${DAY}&to=${DAY}`)
      .set('Authorization', `Bearer ${ownerToken}`);

  const removeSitting = (id: string) =>
    request(service.app.getHttpServer())
      .delete(`/sessions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

  /**
   * Replace the sessions adapter's client with a recording fake. The client is chosen once
   * at module init, so a suite that wants to see the keys swaps it here rather than booting
   * the service against a Redis it does not have.
   */
  const armRecordingCache = (): FakeRedisClient => {
    const redis = new FakeRedisClient();
    const cache = service.app.select(SessionsModule).get<MeditationCache>(MEDITATION_CACHE);
    (cache as unknown as { client: FakeRedisClient }).client = redis;
    return redis;
  };

  it('bumps the owner generation on a record, so the next window read misses', async () => {
    const redis = armRecordingCache();

    const before = await readDays().expect(200);
    const created = await recordSitting(finishedOn()).expect(201);
    const after = await readDays().expect(200);

    expect(before.body[0].liveMinutes).toBe(0);
    expect(after.body[0].liveMinutes).toBe(15);
    expect((await listSittings().expect(200)).body.sessions[0].id).toBe(created.body.id);
    expect(redis.incrCalls).toEqual([generationKey(OWNER)]);
    // The pre-write read populated v0; the record's bump made it unreachable, so the read
    // after it repopulated under v1 instead of serving the stale empty window.
    expect(redis.setCalls).toContain(`meditation:${OWNER}:v0:${WINDOW_KEY}`);
    expect(redis.setCalls).toContain(`meditation:${OWNER}:v1:${WINDOW_KEY}`);
  });

  it('bumps the owner generation on a delete, so the next window read misses', async () => {
    const created = await recordSitting(finishedOn()).expect(201);
    const redis = armRecordingCache();

    expect((await readDays().expect(200)).body[0].liveMinutes).toBe(15);
    await removeSitting(created.body.id).expect(200);
    const after = await readDays().expect(200);

    expect(after.body[0].liveMinutes).toBe(0);
    expect(redis.incrCalls).toEqual([generationKey(OWNER)]);
    expect(redis.setCalls).toContain(`meditation:${OWNER}:v1:${WINDOW_KEY}`);
  });

  it('keeps every cached value ciphertext, never a sitting’s plaintext numbers', async () => {
    await recordSitting(finishedOn()).expect(201);
    const redis = armRecordingCache();

    await readDays().expect(200);

    const cached = redis.writes.find((write) => write.key.endsWith(WINDOW_KEY))?.value ?? '';
    expect(cached).toContain(ENC_PREFIX);
    expect(cached).not.toContain('plannedMinutes');
    expect(cached).not.toContain('completed');
  });
});

function daysOf(sessions: Array<{ day: string }>): string[] {
  return sessions.map((session) => session.day);
}

function idsOf(sessions: Array<{ id: string }>): string[] {
  return sessions.map((session) => session.id);
}
