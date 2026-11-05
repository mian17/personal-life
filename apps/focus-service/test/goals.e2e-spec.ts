import request from 'supertest';
import { FakeRedisClient } from './fake-redis';
import { JwtTestHarness } from './jwt-harness';
import {
  startFocusApp,
  startThrowawayDatabase,
  type FocusApp,
  type ThrowawayDatabase,
} from './setup-env';

/**
 * The daily-goal history over HTTP (`SPEC-focus-service` §1, §8 criterion 6): setting
 * a goal for a day never rewrites another day's row, so a past day keeps the goal it
 * was measured against while today re-measures against the current one, and no owner
 * sees another owner's goal.
 */
const FIRST_DAY = '2026-09-03';
const SECOND_DAY = '2026-09-04';
const THIRD_DAY = '2026-09-05';
const OTHER_OWNER = 'user-b';

describe('Daily focus goal (e2e)', () => {
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

  const putGoal = (token: string, body: Record<string, unknown>) =>
    request(running.app.getHttpServer())
      .put('/api/goal')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const getGoals = (token: string) =>
    request(running.app.getHttpServer())
      .get('/api/goal')
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    database = await startThrowawayDatabase('goals');
    jwt = await new JwtTestHarness().start();
    running = await boot();
    ownerToken = await jwt.sign('user-a');
    otherOwnerToken = await jwt.sign(OTHER_OWNER);
  });

  afterEach(async () => {
    await running.dataSource.query('DELETE FROM "focus_session"');
    await running.dataSource.query('DELETE FROM "focus_goal"');
    await running.close();
    running = await boot();
  });

  afterAll(async () => {
    await running?.close();
    await jwt?.stop();
    await database?.stop();
  });

  it('keeps the past day on its own goal while a later day gets a new one', async () => {
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(ownerToken, { date: SECOND_DAY, minutes: 50 }).expect(200);

    const goals = await getGoals(ownerToken).expect(200);
    expect(goals.body).toEqual([
      { validFrom: FIRST_DAY, minutes: 25 },
      { validFrom: SECOND_DAY, minutes: 50 },
    ]);
  });

  it('replaces the same day on a second set and touches no other day', async () => {
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(ownerToken, { date: SECOND_DAY, minutes: 50 }).expect(200);
    const replaced = await putGoal(ownerToken, { date: SECOND_DAY, minutes: 90 }).expect(200);

    expect(replaced.body).toEqual({ validFrom: SECOND_DAY, minutes: 90 });
    expect((await getGoals(ownerToken).expect(200)).body).toEqual([
      { validFrom: FIRST_DAY, minutes: 25 },
      { validFrom: SECOND_DAY, minutes: 90 },
    ]);
  });

  it('refuses a missing or impossible day rather than defaulting to one', async () => {
    await putGoal(ownerToken, { date: '2026-02-31', minutes: 25 }).expect(400);
    await putGoal(ownerToken, { minutes: 25 }).expect(400);
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 0 }).expect(400);
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 181 }).expect(400);

    expect((await getGoals(ownerToken).expect(200)).body).toEqual([]);
  });

  it('answers a goal for one owner only, whatever the other owner set', async () => {
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(otherOwnerToken, { date: THIRD_DAY, minutes: 60 }).expect(200);

    expect((await getGoals(ownerToken).expect(200)).body).toEqual([
      { validFrom: FIRST_DAY, minutes: 25 },
    ]);
    expect((await getGoals(otherOwnerToken).expect(200)).body).toEqual([
      { validFrom: THIRD_DAY, minutes: 60 },
    ]);
  });
});
