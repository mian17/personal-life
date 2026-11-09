import request from 'supertest';
import { MAX_PAGE_LIMIT } from '@life/service-kit';
import { FakeRedisClient } from './fake-redis.js';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startFocusApp,
  startThrowawayDatabase,
  type FocusApp,
  type ThrowawayDatabase,
} from './setup-env.js';

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
    request(running.app.getHttpServer()).get('/api/goal').set('Authorization', `Bearer ${token}`);
  /** One page of the goal history: the same route with the shared paging window. */
  const getGoalPage = (token: string, limit: number, cursor?: string) =>
    request(running.app.getHttpServer())
      .get('/api/goal?limit=' + limit)
      .query(cursor === undefined ? {} : { cursor })
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
    expect(goals.body).toEqual({
      goals: [
        { validFrom: FIRST_DAY, minutes: 25 },
        { validFrom: SECOND_DAY, minutes: 50 },
      ],
      nextCursor: null,
      total: 2,
    });
  });

  it('pages the history with no gap and no duplicate across the boundary', async () => {
    const first = { validFrom: FIRST_DAY, minutes: 25 };
    const second = { validFrom: SECOND_DAY, minutes: 50 };
    const third = { validFrom: THIRD_DAY, minutes: 75 };
    for (const goal of [first, second, third]) {
      await putGoal(ownerToken, { date: goal.validFrom, minutes: goal.minutes }).expect(200);
    }

    const pageOne = await getGoalPage(ownerToken, 2).expect(200);
    expect(pageOne.body.goals).toEqual([first, second]);
    expect(pageOne.body.nextCursor).toEqual(expect.any(String));

    const pageTwo = await getGoalPage(ownerToken, 2, pageOne.body.nextCursor).expect(200);
    expect(pageTwo.body.goals).toEqual([third]);
    expect(pageTwo.body.nextCursor).toBeNull();

    // Every row exactly once, in the order one unpaged read produces.
    const whole = await getGoals(ownerToken).expect(200);
    expect([...pageOne.body.goals, ...pageTwo.body.goals]).toEqual(whole.body.goals);
  });

  it('serves the same cache entry to every page of the history', async () => {
    // Paging is a projection over the cached history, so limit/cursor must not enter
    // the one per-owner `goal` key: two page requests leave one populate behind.
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(ownerToken, { date: SECOND_DAY, minutes: 50 }).expect(200);

    const pageOne = await getGoalPage(ownerToken, 1).expect(200);
    await getGoalPage(ownerToken, 1, pageOne.body.nextCursor).expect(200);

    expect(redis.setCalls).toEqual([`focus:user-a:v2:goal`]);
  });

  it('replaces the same day on a second set and touches no other day', async () => {
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(ownerToken, { date: SECOND_DAY, minutes: 50 }).expect(200);
    const replaced = await putGoal(ownerToken, { date: SECOND_DAY, minutes: 90 }).expect(200);

    expect(replaced.body).toEqual({ validFrom: SECOND_DAY, minutes: 90 });
    expect((await getGoals(ownerToken).expect(200)).body).toEqual({
      goals: [
        { validFrom: FIRST_DAY, minutes: 25 },
        { validFrom: SECOND_DAY, minutes: 90 },
      ],
      nextCursor: null,
      total: 2,
    });
  });

  it("refuses a page size outside the seam's cap rather than clamping silently", async () => {
    // The DTO imports `MAX_PAGE_LIMIT`, so a page can never be asked to exceed it.
    await request(running.app.getHttpServer())
      .get('/api/goal?limit=0')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    const tooLarge = await request(running.app.getHttpServer())
      .get('/api/goal?limit=201')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);

    // One past the imported cap, so the rejection has to name that cap: a clamp would
    // answer 200 with a quietly shortened page instead.
    expect(tooLarge.body.message).toEqual([`limit must not be greater than ${MAX_PAGE_LIMIT}`]);
  });

  it('refuses a missing or impossible day rather than defaulting to one', async () => {
    await putGoal(ownerToken, { date: '2026-02-31', minutes: 25 }).expect(400);
    await putGoal(ownerToken, { minutes: 25 }).expect(400);
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 0 }).expect(400);
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 181 }).expect(400);

    expect((await getGoals(ownerToken).expect(200)).body).toEqual({
      goals: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('answers a goal for one owner only, whatever the other owner set', async () => {
    await putGoal(ownerToken, { date: FIRST_DAY, minutes: 25 }).expect(200);
    await putGoal(otherOwnerToken, { date: THIRD_DAY, minutes: 60 }).expect(200);

    expect((await getGoals(ownerToken).expect(200)).body).toEqual({
      goals: [{ validFrom: FIRST_DAY, minutes: 25 }],
      nextCursor: null,
      total: 1,
    });
    expect((await getGoals(otherOwnerToken).expect(200)).body).toEqual({
      goals: [{ validFrom: THIRD_DAY, minutes: 60 }],
      nextCursor: null,
      total: 1,
    });
  });
});
