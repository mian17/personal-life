import request from 'supertest';
import { FakeRedisClient } from './fake-redis';
import { JwtTestHarness } from './jwt-harness';
import {
  canProvidePostgres,
  startFocusApp,
  startThrowawayPostgres,
  type FocusApp,
  type ThrowawayPostgres,
} from './setup-env';

/**
 * The behaviours the service exists for, over HTTP (`SPEC-focus-service` §1, §8
 * criteria 3 and 6): a recorded focus block outlives the cache and the process, and
 * no owner ever observes another owner's rows.
 *
 * Durability is proved the only way it can be: a real Postgres, a real boot of
 * `AppModule` behind the real guard, then the cache is flushed and the application
 * instance is rebuilt against the *same* database. The rebuilt app answers with the
 * row, so the row lives in Postgres and nowhere else.
 */

const DAY = '2026-09-03';
const NEXT_DAY = '2026-09-04';
const OTHER_OWNER = 'user-b';

const describeDb = canProvidePostgres() ? describe : describe.skip;

describeDb('Focus sessions (e2e)', () => {
  let postgres: ThrowawayPostgres;
  let jwt: JwtTestHarness;
  let running: FocusApp;
  let redis: FakeRedisClient;
  let ownerToken: string;
  let otherOwnerToken: string;

  const boot = async (): Promise<FocusApp> => {
    redis = new FakeRedisClient();
    return startFocusApp({ databaseUrl: postgres.url, jwksUrl: jwt.jwksUrl, redis });
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
  const recordSession = (token: string, body: Record<string, unknown>) =>
    postSession(token, body).expect(201);

  beforeAll(async () => {
    postgres = await startThrowawayPostgres('sessions');
    jwt = await new JwtTestHarness().start();
    running = await boot();
    ownerToken = await jwt.sign('user-a');
    otherOwnerToken = await jwt.sign(OTHER_OWNER);
  });

  afterEach(async () => {
    // Every case starts from an empty database and an empty cache.
    await running.dataSource.query('TRUNCATE TABLE "focus_session", "focus_goal"');
    await running.close();
    running = await boot();
  });

  afterAll(async () => {
    await running?.close();
    await jwt?.stop();
    await postgres?.stop();
  });

  it('still returns a posted session after the cache is flushed and the app is rebuilt', async () => {
    const created = await recordSession(ownerToken, { date: DAY, minutes: 25 });

    const served = await listSessions(ownerToken, DAY, DAY).expect(200);
    expect(served.body).toEqual([created.body]);
    expect(redis.setCalls).toContain(`focus:user-a:v1:sessions:${DAY}:${DAY}`);

    // Flush the cache, drop the process: nothing but Postgres survives this.
    const { body: beforeRebuild } = await listSessions(ownerToken, DAY, DAY).expect(200);
    redis.store.clear();
    const rebuiltRedis = new FakeRedisClient();
    await running.close();
    running = await startFocusApp({
      databaseUrl: postgres.url,
      jwksUrl: jwt.jwksUrl,
      redis: rebuiltRedis,
    });

    const afterRebuild = await listSessions(ownerToken, DAY, DAY).expect(200);
    expect(afterRebuild.body).toEqual(beforeRebuild);
    expect(afterRebuild.body).toEqual([created.body]);
    // The rebuilt app had to reach Postgres: its fresh cache starts at generation 0.
    expect(rebuiltRedis.setCalls).toEqual([`focus:user-a:v0:sessions:${DAY}:${DAY}`]);
  });

  it('keeps two owners apart on write and on read', async () => {
    const mine = await recordSession(ownerToken, { date: DAY, minutes: 25 });
    const theirs = await recordSession(otherOwnerToken, { date: NEXT_DAY, minutes: 50 });

    const myRange = await listSessions(ownerToken, DAY, NEXT_DAY).expect(200);
    expect(myRange.body).toEqual([mine.body]);

    const theirRange = await listSessions(otherOwnerToken, DAY, NEXT_DAY).expect(200);
    expect(theirRange.body).toEqual([theirs.body]);

    // The same day, asked by the other owner, is not a shared answer.
    expect((await listSessions(otherOwnerToken, DAY, DAY).expect(200)).body).toEqual([]);
    expect((await listSessions(ownerToken, NEXT_DAY, NEXT_DAY).expect(200)).body).toEqual([]);
  });

  it('refuses an owner claim in the body: identity comes from the token alone', async () => {
    await postSession(ownerToken, {
      date: DAY,
      minutes: 25,
      ownerSub: OTHER_OWNER,
    }).expect(400);

    expect((await listSessions(otherOwnerToken, DAY, DAY).expect(200)).body).toEqual([]);
  });
});
