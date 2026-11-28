import { jest } from '@jest/globals';
import request from 'supertest';
import { ENC_PREFIX } from '@life/crypto';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startMeditationApp,
  startThrowawayDatabase,
  type MeditationApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * The settings slice over HTTP (`SPEC-meditation-app` §1, §4 assumption 6): one row
 * per owner holding the daily goal, the planned length, and the bell configuration,
 * stored as an `enc.v1.` envelope in `meditation.db` so it survives a restart, with
 * the goal clamped to the 15-minute grid and the bells validated against their bounds.
 *
 * The suite runs the direct-DB path (`REDIS_URL` unset), so a value read back after a
 * restart came from the file, not from a cache. The cached ciphertext shape and the
 * generation bump are the cache suite's subject (`meditation-cache.e2e-spec.ts`).
 */
jest.setTimeout(60_000);

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

const BELLS_OFF = { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null };

interface StoredSettingsRow {
  ownerSub: string;
  content: string;
}

describe('Settings (e2e)', () => {
  let database: ThrowawayDatabase;
  let jwt: JwtTestHarness;
  let service: MeditationApp;
  let ownerToken: string;
  let otherOwnerToken: string;

  /** Boot against the same SQLite file, which is how a restart is simulated. */
  const boot = async (): Promise<MeditationApp> => {
    process.env.REDIS_URL = '';
    return startMeditationApp({ databasePath: database.path, jwksUrl: jwt.jwksUrl });
  };

  const putSettings = (token: string, body: Record<string, unknown>) =>
    request(service.app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const getSettings = (token: string) =>
    request(service.app.getHttpServer()).get('/settings').set('Authorization', `Bearer ${token}`);

  const storedRows = async (): Promise<StoredSettingsRow[]> =>
    service.dataSource.query(
      'SELECT "ownerSub", content FROM "meditation_settings" ORDER BY "ownerSub"',
    );

  beforeAll(async () => {
    database = await startThrowawayDatabase('settings');
    jwt = await new JwtTestHarness().start();
    service = await boot();
    ownerToken = await jwt.sign(OWNER);
    otherOwnerToken = await jwt.sign(OTHER_OWNER);
  });

  afterEach(async () => {
    await service.dataSource.query('DELETE FROM "meditation_settings"');
  });

  afterAll(async () => {
    await service.close();
    await jwt.stop();
    await database.stop();
  });

  it('answers a fresh owner with the fifteen-minute defaults and writes no row', async () => {
    const response = await getSettings(ownerToken).expect(200);

    expect(response.body).toEqual({
      goalMinutes: 15,
      plannedMinutes: 15,
      bells: { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null },
    });
    expect(await storedRows()).toEqual([]);
  });

  it('round-trips a thirty-minute goal through PUT and GET', async () => {
    await putSettings(ownerToken, { goalMinutes: 30, bells: BELLS_OFF }).expect(200);

    const response = await getSettings(ownerToken).expect(200);

    expect(response.body.goalMinutes).toBe(30);
    expect(response.body.plannedMinutes).toBe(30);
  });

  it('survives a service restart, read back from meditation.db', async () => {
    await putSettings(ownerToken, { goalMinutes: 30, bells: BELLS_OFF }).expect(200);

    await service.close();
    service = await boot();

    const response = await getSettings(ownerToken).expect(200);
    expect(response.body.goalMinutes).toBe(30);
  });

  it('stores the row as an enc.v1. envelope with no plaintext settings in it', async () => {
    await putSettings(ownerToken, { goalMinutes: 30, bells: BELLS_OFF }).expect(200);

    const [row] = await storedRows();

    expect(row.ownerSub).toBe(OWNER);
    expect(row.content.startsWith(ENC_PREFIX)).toBe(true);
    expect(row.content).not.toContain('goalMinutes');
    expect(row.content).not.toContain('plannedMinutes');
  });

  it('clamps the goal at both edges and onto the fifteen-minute grid', async () => {
    const storedGoal = async (goalMinutes: number): Promise<number> => {
      const response = await putSettings(ownerToken, { goalMinutes, bells: BELLS_OFF }).expect(200);
      return response.body.goalMinutes as number;
    };

    expect(await storedGoal(7)).toBe(15);
    expect(await storedGoal(495)).toBe(480);
    expect(await storedGoal(22)).toBe(15);
    expect(await storedGoal(23)).toBe(30);
  });

  it('keeps the planned length it was given instead of the goal', async () => {
    const response = await putSettings(ownerToken, {
      goalMinutes: 30,
      plannedMinutes: 45,
      bells: BELLS_OFF,
    }).expect(200);

    expect(response.body).toMatchObject({ goalMinutes: 30, plannedMinutes: 45 });
  });

  it('round-trips bells whose repeat is null, meaning ring until the sitting ends', async () => {
    const bells = { enabled: true, offsetSec: 60, intervalSec: 600, repeat: null };

    await putSettings(ownerToken, { goalMinutes: 30, bells }).expect(200);

    const response = await getSettings(ownerToken).expect(200);
    expect(response.body.bells).toEqual(bells);
  });

  it('round-trips a capped repeat', async () => {
    const bells = { enabled: true, offsetSec: 120, intervalSec: 1200, repeat: 6 };

    await putSettings(ownerToken, { goalMinutes: 30, bells }).expect(200);

    const response = await getSettings(ownerToken).expect(200);
    expect(response.body.bells).toEqual(bells);
  });

  it('rejects an out-of-bounds bell interval with 400 and stores nothing', async () => {
    const tooShort = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, intervalSec: 60 },
    });
    const tooLong = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, intervalSec: 1450 * 60 },
    });

    expect([tooShort.status, tooLong.status]).toEqual([400, 400]);
    expect(await storedRows()).toEqual([]);
  });

  it('rejects an interval off the ten-minute grid with 400', async () => {
    const response = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, intervalSec: 601 },
    });

    expect(response.status).toBe(400);
    expect(await storedRows()).toEqual([]);
  });

  it('rejects a repeat outside 1–6 and a missing repeat with 400', async () => {
    const tooMany = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, repeat: 7 },
    });
    const absent = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { enabled: true, offsetSec: 0, intervalSec: 600 },
    });

    expect([tooMany.status, absent.status]).toEqual([400, 400]);
    expect(await storedRows()).toEqual([]);
  });

  it('rejects an offset past 23:59:59 with 400', async () => {
    const pastMidnight = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, offsetSec: 86_400 },
    });
    const negative = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: { ...BELLS_OFF, offsetSec: -1 },
    });

    expect([pastMidnight.status, negative.status]).toEqual([400, 400]);
  });

  it('rejects an ownerSub in the body, since ownership comes from the token', async () => {
    const response = await putSettings(ownerToken, {
      goalMinutes: 30,
      bells: BELLS_OFF,
      ownerSub: OTHER_OWNER,
    });

    expect(response.status).toBe(400);
    expect(await storedRows()).toEqual([]);
  });

  it('keeps one owner’s settings invisible to another', async () => {
    await putSettings(ownerToken, { goalMinutes: 30, bells: BELLS_OFF }).expect(200);

    const response = await getSettings(otherOwnerToken).expect(200);

    expect(response.body.goalMinutes).toBe(15);
  });
});
