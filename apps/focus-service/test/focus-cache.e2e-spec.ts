import { DataSource } from 'typeorm';
import { Goal } from '../src/goals/goal.entity.js';
import { GoalsService } from '../src/goals/goals.service.js';
import { FocusCache, generationKey } from '../src/cache/focus-cache.js';
import { Session } from '../src/sessions/session.entity.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { FakeRedisClient, UnreachableRedisClient } from './fake-redis.js';
import { startThrowawayDatabase, type ThrowawayDatabase } from './setup-env.js';

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
 * The database is the real SQLite file (`better-sqlite3`, the service's only engine),
 * so "cached value equals the persisted row" is compared against the table itself;
 * Redis is the recording stand-in, so "was the loader consulted" and "was a populate
 * attempted" are observable rather than inferred.
 */

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';
const DAY = '2026-09-03';
const NEXT_DAY = '2026-09-04';
const RANGE = { from: DAY, to: NEXT_DAY };

interface Harness {
  sessions: SessionsService;
  goals: GoalsService;
  redis: FakeRedisClient;
  dataSource: DataSource;
}

async function openDatabase(databasePath: string): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: databasePath,
    entities: [Session, Goal],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}

/**
 * Sessions exactly as the table holds them, in the loader's own order. SQLite keeps a
 * `datetime` column as `YYYY-MM-DD HH:MM:SS.mmm` text, so the select renders it back to
 * the ISO string TypeORM hydrates into a `Date`.
 */
async function persistedSessions(dataSource: DataSource): Promise<unknown[]> {
  return dataSource.query(
    `SELECT id, "ownerSub", date, minutes, strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt") AS "createdAt"
     FROM "focus_session" WHERE "ownerSub" = ? ORDER BY date ASC, "createdAt" ASC, id ASC`,
    [OWNER],
  );
}

/** Goal rows exactly as the table holds them, oldest first. */
async function persistedGoals(dataSource: DataSource): Promise<unknown[]> {
  return dataSource.query(
    `SELECT "validFrom", minutes FROM "focus_goal" WHERE "ownerSub" = ? ORDER BY "validFrom" ASC`,
    [OWNER],
  );
}

describe('FocusCache (read-through, generation invalidation, fail-open)', () => {
  /** A fresh pair of services over an empty database and a recording cache. */
  async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
    const database: ThrowawayDatabase = await startThrowawayDatabase('cache');
    const dataSource = await openDatabase(database.path);
    const redis = new FakeRedisClient();
    const cache = new FocusCache(redis);
    try {
      await run({
        sessions: new SessionsService(dataSource.getRepository(Session), cache),
        goals: new GoalsService(dataSource.getRepository(Goal), cache),
        redis,
        dataSource,
      });
    } finally {
      await dataSource.destroy();
      await database.stop();
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
      // Paging is a projection over that cached range: the page is the whole set here
      // because it fits in one page, and no cursor is left over.
      expect(first.sessions).toEqual(await persistedSessions(dataSource));
      expect(first.nextCursor).toBeNull();
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
      expect(first.goals).toEqual(await persistedGoals(dataSource));
      expect(first.nextCursor).toBeNull();
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
    const database = await startThrowawayDatabase('cache-fail-open');
    const dataSource = await openDatabase(database.path);
    const unreachable = new UnreachableRedisClient();
    const cache = new FocusCache(unreachable);
    const sessions = new SessionsService(dataSource.getRepository(Session), cache);
    try {
      await sessions.create(OWNER, { date: DAY, minutes: 25 });

      const rows = (await sessions.findAll(OWNER, RANGE)).sessions;
      const again = (await sessions.findAll(OWNER, RANGE)).sessions;

      expect(rows).toHaveLength(1);
      expect(again).toEqual(rows);
      expect(rows).toEqual(await persistedSessions(dataSource));
      // The generation was unreadable, so nothing may be written back at all.
      expect(unreachable.gets.length).toBeGreaterThan(0);
      expect(unreachable.sets).toEqual([]);
    } finally {
      await dataSource.destroy();
      await database.stop();
    }
  });
});
