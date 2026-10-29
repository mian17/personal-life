import { DataSource } from 'typeorm';
import { Goal } from '../src/goals/goal.entity';
import { GoalsService } from '../src/goals/goals.service';
import { FocusCache, generationKey } from '../src/cache/focus-cache';
import { Session } from '../src/sessions/session.entity';
import { SessionsService } from '../src/sessions/sessions.service';
import { FakeRedisClient, UnreachableRedisClient } from './fake-redis';
import { canProvidePostgres, startThrowawayPostgres, type ThrowawayPostgres } from './setup-env';

/**
 * The read-through cache contract for `focus-service` (`SPEC-focus-service`
 * `## Cache Rules`, AGENTS.md Contract 2): keys composed as
 * `focus:<sub>:v<gen>:sessions:<from>:<to>` and `focus:<sub>:v<gen>:goal`, cached
 * values that are the persisted rows themselves, one owner's generation bumped by that
 * owner's writes, and a cache outage that degrades to the database without ever
 * attempting a populate.
 *
 * **Deviation, recorded (spec `## Cache Rules`):** focus rows are non-content — numbers
 * and timestamps only, no free text — so the at-rest ciphertext contract does not
 * apply and this suite asserts the absence of an `enc.v1.` envelope rather than its
 * presence. Rows-as-persisted still holds absolutely: what Redis would hold is the
 * serialized row, never a presentation shape. The sibling pattern is
 * `apps/meal-service/test/entries-cache.e2e-spec.ts`, whose tripwire this suite's
 * deviation replaces.
 *
 * Postgres is real, so "cached value equals the persisted row" is compared against the
 * table itself; Redis is the recording stand-in, so "was the loader consulted" and
 * "was a populate attempted" are observable rather than inferred.
 */

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';
const DAY = '2026-09-03';
const NEXT_DAY = '2026-09-04';
const RANGE = { from: DAY, to: NEXT_DAY };

const describeDb = canProvidePostgres() ? describe : describe.skip;

interface Harness {
  sessions: SessionsService;
  goals: GoalsService;
  redis: FakeRedisClient;
  dataSource: DataSource;
}

async function openDatabase(url: string): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [Session, Goal],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}

/** Sessions exactly as the table holds them, in the loader's own order. */
async function persistedSessions(dataSource: DataSource): Promise<unknown[]> {
  const rows: Array<{
    id: string;
    ownerSub: string | null;
    date: string;
    minutes: number;
    createdAt: Date;
  }> = await dataSource.query(
    `SELECT id, "ownerSub", date, minutes, "createdAt" FROM "focus_session"
     WHERE "ownerSub" = $1 ORDER BY date ASC, "createdAt" ASC, id ASC`,
    [OWNER],
  );
  return rows.map((row) => ({
    id: row.id,
    ownerSub: row.ownerSub,
    date: row.date,
    minutes: row.minutes,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Goal rows exactly as the table holds them, oldest first. */
async function persistedGoals(dataSource: DataSource): Promise<unknown[]> {
  return dataSource.query(
    `SELECT "validFrom", minutes FROM "focus_goal" WHERE "ownerSub" = $1 ORDER BY "validFrom" ASC`,
    [OWNER],
  );
}

describeDb('FocusCache (read-through, generation invalidation, fail-open)', () => {
  let postgres: ThrowawayPostgres;

  beforeAll(async () => {
    postgres = await startThrowawayPostgres('cache');
  });

  afterAll(async () => {
    await postgres?.stop();
  });

  /** A fresh pair of services over an empty database and a recording cache. */
  async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
    const dataSource = await openDatabase(postgres.url);
    await dataSource.query('TRUNCATE TABLE "focus_session", "focus_goal"');
    const redis = new FakeRedisClient();
    const cache = new FocusCache(redis);
    const harness: Harness = {
      sessions: new SessionsService(dataSource.getRepository(Session), cache),
      goals: new GoalsService(dataSource.getRepository(Goal), cache),
      redis,
      dataSource,
    };
    try {
      await run(harness);
    } finally {
      await dataSource.destroy();
    }
  }

  it('serves a repeated range from the cache and stores the persisted rows under one key', async () => {
    await withHarness(async ({ sessions, redis, dataSource }) => {
      await sessions.create(OWNER, { date: DAY, minutes: 25 });

      const first = await sessions.findAll(OWNER, RANGE);
      const second = await sessions.findAll(OWNER, RANGE);

      expect(second).toEqual(first);
      const key = `focus:${OWNER}:v1:sessions:${RANGE.from}:${RANGE.to}`;
      expect(redis.setCalls).toEqual([key]);
      // The cached value is the row as persisted, not a presentation shape.
      expect(JSON.parse(redis.valueFor(key)!)).toEqual(await persistedSessions(dataSource));
      // Deviation, recorded: non-content rows, so no at-rest envelope exists here.
      expect(redis.valueFor(key)).not.toContain('enc.v1.');
    });
  });

  it('serves a repeated goal list from the cache and stores the persisted rows under one key', async () => {
    await withHarness(async ({ goals, redis, dataSource }) => {
      await goals.setGoal(OWNER, { date: DAY, minutes: 25 });
      await goals.setGoal(OWNER, { date: NEXT_DAY, minutes: 50 });

      const first = await goals.findAll(OWNER);
      const second = await goals.findAll(OWNER);

      expect(second).toEqual(first);
      const key = `focus:${OWNER}:v2:goal`;
      expect(redis.setCalls).toEqual([key]);
      expect(JSON.parse(redis.valueFor(key)!)).toEqual(await persistedGoals(dataSource));
      expect(redis.valueFor(key)).not.toContain('enc.v1.');
    });
  });

  it('bumps the owner generation once per session write and once per goal write', async () => {
    await withHarness(async ({ sessions, goals, redis }) => {
      await sessions.create(OWNER, { date: DAY, minutes: 25 });
      expect(redis.incrCalls).toEqual([generationKey(OWNER)]);

      await goals.setGoal(OWNER, { date: DAY, minutes: 25 });
      expect(redis.incrCalls).toEqual([generationKey(OWNER), generationKey(OWNER)]);

      // A write leaves the previous generation's entry unreachable: the next read
      // misses and repopulates under the current generation, v2.
      await goals.findAll(OWNER);
      expect(redis.setCalls).toEqual([`focus:${OWNER}:v2:goal`]);
      expect(redis.incrCalls).not.toContain(generationKey(OTHER_OWNER));
    });
  });

  it('keeps one range out of another range’s key and one owner out of another owner’s counter', async () => {
    await withHarness(async ({ sessions, redis }) => {
      await sessions.create(OWNER, { date: DAY, minutes: 25 });
      await sessions.findAll(OWNER, { from: DAY, to: DAY });
      await sessions.findAll(OWNER, RANGE);

      expect(redis.setCalls).toEqual([
        `focus:${OWNER}:v1:sessions:${DAY}:${DAY}`,
        `focus:${OWNER}:v1:sessions:${DAY}:${NEXT_DAY}`,
      ]);

      await sessions.create(OTHER_OWNER, { date: DAY, minutes: 50 });
      expect(redis.incrCalls).toEqual([generationKey(OWNER), generationKey(OTHER_OWNER)]);
    });
  });

  it('answers a read from the database with no populate attempted when every cache command rejects', async () => {
    const dataSource = await openDatabase(postgres.url);
    await dataSource.query('TRUNCATE TABLE "focus_session", "focus_goal"');
    const unreachable = new UnreachableRedisClient();
    const cache = new FocusCache(unreachable);
    const sessions = new SessionsService(dataSource.getRepository(Session), cache);
    try {
      await sessions.create(OWNER, { date: DAY, minutes: 25 });

      const rows = await sessions.findAll(OWNER, RANGE);
      const again = await sessions.findAll(OWNER, RANGE);

      expect(rows).toHaveLength(1);
      expect(again).toEqual(rows);
      expect(rows).toEqual(await persistedSessions(dataSource));
      // The generation was unreadable, so nothing may be written back at all.
      expect(unreachable.gets.length).toBeGreaterThan(0);
      expect(unreachable.sets).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });
});
