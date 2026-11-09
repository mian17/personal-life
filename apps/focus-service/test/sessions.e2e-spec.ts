import request from 'supertest';
import { FakeRedisClient } from './fake-redis.js';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startFocusApp,
  startThrowawayDatabase,
  type FocusApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * The behaviours the service exists for, over HTTP (`SPEC-focus-service` §1, §8
 * criteria 3 and 6): a recorded focus block outlives the cache and the process, and
 * no owner ever observes another owner's rows.
 *
 * Durability is proved the only way it can be: a real SQLite file, a real boot of
 * `AppModule` behind the real guard, then the cache is flushed and the application
 * instance is rebuilt against the *same* file. The rebuilt app answers with the row,
 * so the row lives in the database and nowhere else.
 */

const DAY = '2026-09-03';
const NEXT_DAY = '2026-09-04';
const THIRD_DAY = '2026-09-05';
const OTHER_OWNER = 'user-b';

describe('Focus sessions (e2e)', () => {
  let database: ThrowawayDatabase;
  let jwt: JwtTestHarness;
  let running: FocusApp;
  let redis: FakeRedisClient;
  let ownerToken: string;
  let otherOwnerToken: string;

  const boot = async (): Promise<FocusApp> => {
    redis = new FakeRedisClient();
    return startFocusApp({ databasePath: database.path, jwksUrl: jwt.jwksUrl, redis });
  };

  const postSession = (token: string, body: Record<string, unknown>) =>
    request(running.app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const listSessions = (token: string, from: string, to: string) =>
    request(running.app.getHttpServer())
      .get(`/api/sessions?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${token}`);
  /** One page of a range: the same route with the shared paging window. */
  const listSessionPage = (
    token: string,
    from: string,
    to: string,
    limit: number,
    cursor?: string,
  ) =>
    request(running.app.getHttpServer())
      .get(`/api/sessions?from=${from}&to=${to}&limit=${limit}`)
      .query(cursor === undefined ? {} : { cursor })
      .set('Authorization', `Bearer ${token}`);
  const recordSession = (token: string, body: Record<string, unknown>) =>
    postSession(token, body).expect(201);

  beforeAll(async () => {
    database = await startThrowawayDatabase('sessions');
    jwt = await new JwtTestHarness().start();
    running = await boot();
    ownerToken = await jwt.sign('user-a');
    otherOwnerToken = await jwt.sign(OTHER_OWNER);
  });

  afterEach(async () => {
    // Every case starts from an empty database and an empty cache.
    await running.dataSource.query('DELETE FROM "focus_session"');
    await running.close();
    running = await boot();
  });

  afterAll(async () => {
    await running?.close();
    await jwt?.stop();
    await database?.stop();
  });

  it('still returns a posted session after the cache is flushed and the app is rebuilt', async () => {
    const created = await recordSession(ownerToken, { date: DAY, minutes: 25 });

    const served = await listSessions(ownerToken, DAY, DAY).expect(200);
    const envelope = { sessions: [created.body], nextCursor: null, total: 1 };
    expect(served.body).toEqual(envelope);
    expect(redis.setCalls).toContain(`focus:user-a:v1:sessions:${DAY}:${DAY}`);

    // Flush the cache, drop the process: nothing but the SQLite file survives this.
    const { body: beforeRebuild } = await listSessions(ownerToken, DAY, DAY).expect(200);
    redis.store.clear();
    const rebuiltRedis = new FakeRedisClient();
    await running.close();
    running = await startFocusApp({
      databasePath: database.path,
      jwksUrl: jwt.jwksUrl,
      redis: rebuiltRedis,
    });

    const afterRebuild = await listSessions(ownerToken, DAY, DAY).expect(200);
    expect(afterRebuild.body).toEqual(beforeRebuild);
    expect(afterRebuild.body).toEqual(envelope);
    // The rebuilt app had to reach the database: its fresh cache starts at generation 0.
    expect(rebuiltRedis.setCalls).toEqual([`focus:user-a:v0:sessions:${DAY}:${DAY}`]);
  });

  it('pages a range with no gap and no duplicate across the boundary', async () => {
    // Three days, so the page boundary falls between two `date` values — the order's
    // leading component, not the same-instant tie-break (every row here shares a
    // `createdAt` second, so `id` would order them, not insertion).
    const first = await recordSession(ownerToken, { date: DAY, minutes: 10 });
    const second = await recordSession(ownerToken, { date: NEXT_DAY, minutes: 20 });
    const third = await recordSession(ownerToken, { date: THIRD_DAY, minutes: 30 });

    const pageOne = await listSessionPage(ownerToken, DAY, THIRD_DAY, 2).expect(200);
    expect(pageOne.body.sessions).toEqual([first.body, second.body]);
    expect(pageOne.body.nextCursor).toEqual(expect.any(String));

    const pageTwo = await listSessionPage(
      ownerToken,
      DAY,
      THIRD_DAY,
      2,
      pageOne.body.nextCursor,
    ).expect(200);
    expect(pageTwo.body.sessions).toEqual([third.body]);
    expect(pageTwo.body.nextCursor).toBeNull();

    // Every row exactly once, in the order one unpaged read produces.
    const whole = await listSessions(ownerToken, DAY, THIRD_DAY).expect(200);
    expect([...pageOne.body.sessions, ...pageTwo.body.sessions]).toEqual(whole.body.sessions);
  });

  it('serves the same cache entry to every page of one range', async () => {
    // Paging is a projection over the cached range, so limit/cursor must not enter
    // the key: two page requests leave exactly one populate behind.
    await recordSession(ownerToken, { date: DAY, minutes: 10 });
    await recordSession(ownerToken, { date: NEXT_DAY, minutes: 20 });

    const pageOne = await listSessionPage(ownerToken, DAY, NEXT_DAY, 1).expect(200);
    await listSessionPage(ownerToken, DAY, NEXT_DAY, 1, pageOne.body.nextCursor).expect(200);

    // v2: one write per session, each bumping the owner's generation.
    expect(redis.setCalls).toEqual([`focus:user-a:v2:sessions:${DAY}:${NEXT_DAY}`]);
  });

  it('keeps two owners apart on write and on read', async () => {
    const mine = await recordSession(ownerToken, { date: DAY, minutes: 25 });
    const theirs = await recordSession(otherOwnerToken, { date: NEXT_DAY, minutes: 50 });

    const myRange = await listSessions(ownerToken, DAY, NEXT_DAY).expect(200);
    expect(myRange.body).toEqual({ sessions: [mine.body], nextCursor: null, total: 1 });

    const theirRange = await listSessions(otherOwnerToken, DAY, NEXT_DAY).expect(200);
    expect(theirRange.body).toEqual({ sessions: [theirs.body], nextCursor: null, total: 1 });

    // The same day, asked by the other owner, is not a shared answer.
    expect((await listSessions(otherOwnerToken, DAY, DAY).expect(200)).body).toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
    expect((await listSessions(ownerToken, NEXT_DAY, NEXT_DAY).expect(200)).body).toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('refuses an owner claim in the body: identity comes from the token alone', async () => {
    await postSession(ownerToken, {
      date: DAY,
      minutes: 25,
      ownerSub: OTHER_OWNER,
    }).expect(400);

    expect((await listSessions(otherOwnerToken, DAY, DAY).expect(200)).body).toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
  });
});
