import { jest } from '@jest/globals';
import request from 'supertest';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startMeditationApp,
  startThrowawayDatabase,
  type MeditationApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * The day-done boundary proof over HTTP (`SPEC-meditation-app` §6, §8 criterion 2): the
 * evidence is seeded records, not a screenshot. Three sitters are written through the real
 * route — a day at exactly the goal, a day one minute short of it, and a day that only a
 * stamped sitting would tip over — and the window read is asserted at those exact edges.
 *
 * The last case raises the goal and reads the same rows again, proving the flag is derived
 * on every read rather than stored: no `PUT /settings` of its own moves a sitting.
 *
 * The suite runs the direct-DB path (`REDIS_URL` unset); the cache holds rows as persisted
 * and the flag is never cached, which is what lets a goal change reach past days at all.
 */
jest.setTimeout(60_000);

const OWNER = 'user-a';
const DAY_AT_GOAL = '2026-11-14';
const DAY_ONE_SHORT = '2026-11-15';
const DAY_TIPPED_BY_A_DELETED_SITTING = '2026-11-16';
const GOAL_MINUTES = 15;

/** A sitting of `minutes` finished on its own planned length, on `day`. */
function finishedOn(day: string, minutes: number): Record<string, unknown> {
  const startedAt = `${day}T06:00:00.000Z`;
  return {
    day,
    startedAt,
    endedAt: `${day}T06:${String(minutes).padStart(2, '0')}:00.000Z`,
    plannedMinutes: minutes,
    elapsedSeconds: minutes * 60,
    outcome: 'finished',
  };
}

interface ServedDay {
  date: string;
  liveMinutes: number;
  goalMinutes: number;
  done: boolean;
}

describe('Day done (e2e, seeded boundary)', () => {
  let database: ThrowawayDatabase;
  let jwt: JwtTestHarness;
  let service: MeditationApp;
  let ownerToken: string;

  const recordSitting = (body: Record<string, unknown>) =>
    request(service.app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);

  const removeSitting = (id: string) =>
    request(service.app.getHttpServer())
      .delete(`/sessions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

  const readDays = (from: string, to: string) =>
    request(service.app.getHttpServer())
      .get(`/sessions/days?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${ownerToken}`);

  const setGoal = (goalMinutes: number) =>
    request(service.app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        goalMinutes,
        bells: { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null },
      });

  const dayAt = (days: ServedDay[], date: string): ServedDay => {
    const found = days.find((day) => day.date === date);
    if (found === undefined) throw new Error(`window served no day ${date}`);
    return found;
  };

  /** The three seeded days, written once, before any assertion reads them. */
  const seedBoundaryDays = async (): Promise<void> => {
    await recordSitting(finishedOn(DAY_AT_GOAL, GOAL_MINUTES)).expect(201);
    await recordSitting(finishedOn(DAY_ONE_SHORT, GOAL_MINUTES - 1)).expect(201);

    const tippingSitting = await recordSitting(
      finishedOn(DAY_TIPPED_BY_A_DELETED_SITTING, 5),
    ).expect(201);
    await removeSitting(tippingSitting.body.id).expect(200);
    await recordSitting(finishedOn(DAY_TIPPED_BY_A_DELETED_SITTING, GOAL_MINUTES - 5)).expect(201);
  };

  beforeAll(async () => {
    database = await startThrowawayDatabase('day-done');
    jwt = await new JwtTestHarness().start();
    process.env.REDIS_URL = '';
    service = await startMeditationApp({ databasePath: database.path, jwksUrl: jwt.jwksUrl });
    ownerToken = await jwt.sign(OWNER);
    await seedBoundaryDays();
  });

  afterAll(async () => {
    await service.close();
    await jwt.stop();
    await database.stop();
  });

  it('reads a day with exactly the goal live minutes as done', async () => {
    const response = await readDays(DAY_AT_GOAL, DAY_AT_GOAL).expect(200);

    expect(dayAt(response.body, DAY_AT_GOAL)).toEqual({
      date: DAY_AT_GOAL,
      liveMinutes: GOAL_MINUTES,
      goalMinutes: GOAL_MINUTES,
      done: true,
    });
  });

  it('reads a day one minute short of the goal as not done', async () => {
    const response = await readDays(DAY_ONE_SHORT, DAY_ONE_SHORT).expect(200);

    expect(dayAt(response.body, DAY_ONE_SHORT)).toEqual({
      date: DAY_ONE_SHORT,
      liveMinutes: GOAL_MINUTES - 1,
      goalMinutes: GOAL_MINUTES,
      done: false,
    });
  });

  it('reads a day tipped over only by a stamped sitting as not done', async () => {
    const response = await readDays(
      DAY_TIPPED_BY_A_DELETED_SITTING,
      DAY_TIPPED_BY_A_DELETED_SITTING,
    );

    expect(response.status).toBe(200);
    expect(dayAt(response.body, DAY_TIPPED_BY_A_DELETED_SITTING)).toEqual({
      date: DAY_TIPPED_BY_A_DELETED_SITTING,
      liveMinutes: GOAL_MINUTES - 5,
      goalMinutes: GOAL_MINUTES,
      done: false,
    });
  });

  it('refuses a bound that is not a date-only day, rather than serving a widened window', async () => {
    const monthOnly = await readDays('2026-11', DAY_TIPPED_BY_A_DELETED_SITTING);
    const timestamp = await readDays('2026-11-14T06:00:00Z', DAY_TIPPED_BY_A_DELETED_SITTING);
    const compact = await readDays('20261114', DAY_TIPPED_BY_A_DELETED_SITTING);

    expect([monthOnly.status, timestamp.status, compact.status]).toEqual([400, 400, 400]);
  });

  it('refuses a reversed window rather than serving it as an empty one', async () => {
    const response = await readDays(DAY_TIPPED_BY_A_DELETED_SITTING, DAY_AT_GOAL);

    expect(response.status).toBe(400);
  });

  it('refuses a window wider than a year, before walking it', async () => {
    const decade = await readDays('0000-01-01', '9999-12-31');
    const yearAndADay = await readDays('2026-01-01', '2027-01-02');

    expect([decade.status, yearAndADay.status]).toEqual([400, 400]);
  });

  it('serves a window exactly a year wide, so the cap refuses only what it names', async () => {
    const response = await readDays('2026-01-01', '2026-12-31');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(365);
  });

  it('serves a closed window newest day last, with every day present', async () => {
    const response = await readDays(DAY_AT_GOAL, DAY_TIPPED_BY_A_DELETED_SITTING).expect(200);

    expect(response.body.map((day: ServedDay) => day.date)).toEqual([
      DAY_AT_GOAL,
      DAY_ONE_SHORT,
      DAY_TIPPED_BY_A_DELETED_SITTING,
    ]);
  });

  it('flips the same seeded rows to not done when the goal rises, with no sitting written', async () => {
    await setGoal(GOAL_MINUTES * 2).expect(200);

    const response = await readDays(DAY_AT_GOAL, DAY_TIPPED_BY_A_DELETED_SITTING).expect(200);

    expect(dayAt(response.body, DAY_AT_GOAL)).toEqual({
      date: DAY_AT_GOAL,
      liveMinutes: GOAL_MINUTES,
      goalMinutes: GOAL_MINUTES * 2,
      done: false,
    });
    expect(dayAt(response.body, DAY_ONE_SHORT).done).toBe(false);

    await setGoal(GOAL_MINUTES).expect(200);
  });
});
