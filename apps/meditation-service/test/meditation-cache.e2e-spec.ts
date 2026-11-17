import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { ENC_PREFIX, encryptField, generateDek } from '@life/crypto';
import {
  CACHE_TTL_SECONDS,
  MEDITATION_CACHE,
  MeditationCache,
  createMeditationCache,
  generationKey,
} from '../src/cache/meditation-cache.js';
import { FakeRedisClient, UnreachableRedisClient } from './fake-redis.js';
import { startThrowawayDatabase, type ThrowawayDatabase } from './setup-env.js';

/**
 * The read-through cache contract for `meditation-service` (`SPEC-meditation-app`
 * `## Cache Rules`, AGENTS.md Contract 2): keys composed as
 * `meditation:<sub>:v<gen>:settings` and
 * `meditation:<sub>:v<gen>:sessions:<from>:<to>`, cached values that are the persisted
 * ciphertext rows themselves, one owner's generation bumped by that owner's writes,
 * and a cache outage that degrades to the database without ever attempting a populate.
 *
 * The rows here are the *cached shape* the domain slices will hand the cache — a row
 * with an `enc.v1.` content envelope. They live in a probe table in a real SQLite file
 * (`better-sqlite3`, the service's only engine) so "cached value equals the persisted
 * row" is compared against the table itself, and the recorded fake Redis proves *when*
 * the loader ran and *what* would have landed in Redis. The domain tables arrive with
 * Tasks [4] and [5]; this suite owns the adapter, not their schema.
 */

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';
const DAY = '2026-09-03';
const NEXT_DAY = '2026-09-04';
const RANGE = { from: DAY, to: NEXT_DAY };

/** A known plaintext no cache entry may ever hold (Redis is AOF-persistent). */
const PLAINTEXT = 'I sat for twenty-five minutes and the bell rang twice';

const DEK = generateDek();

interface CachedRow {
  id: string;
  ownerSub: string;
  /** The `enc.v1.` envelope exactly as the row is persisted. */
  content: string;
}

/** Field AAD for the probe row; the at-rest spec pins the production shape. */
function contentAad(ownerSub: string, id: string): string {
  return `life.v1|${ownerSub}|meditation|content|${id}`;
}

function ciphertextRow(ownerSub: string, id: string, plaintext: string = PLAINTEXT): CachedRow {
  return { id, ownerSub, content: encryptField(DEK, plaintext, contentAad(ownerSub, id)) };
}

/** `cacheable`: a legacy plaintext row is never allowed to enter Redis. */
function isCiphertextRow(row: CachedRow | null): boolean {
  return row === null || row.content.startsWith(ENC_PREFIX);
}

async function openProbeDatabase(databasePath: string): Promise<DataSource> {
  const dataSource = new DataSource({ type: 'better-sqlite3', database: databasePath });
  await dataSource.initialize();
  await dataSource.query(
    `CREATE TABLE "meditation_probe_row"
       (id TEXT PRIMARY KEY, "ownerSub" TEXT NOT NULL, content TEXT NOT NULL)`,
  );
  return dataSource;
}

async function insertRow(dataSource: DataSource, row: CachedRow): Promise<void> {
  await dataSource.query(
    `INSERT INTO "meditation_probe_row" (id, "ownerSub", content) VALUES (?, ?, ?)`,
    [row.id, row.ownerSub, row.content],
  );
}

/** The rows exactly as the table holds them, in the loader's own order. */
async function persistedRows(dataSource: DataSource, ownerSub: string): Promise<CachedRow[]> {
  return dataSource.query(
    `SELECT id, "ownerSub", content FROM "meditation_probe_row"
     WHERE "ownerSub" = ? ORDER BY id ASC`,
    [ownerSub],
  );
}

/** The window loader every session read will use (`sessions:<from>:<to>`). */
function windowLoader(dataSource: DataSource, ownerSub: string): () => Promise<CachedRow[]> {
  return () => persistedRows(dataSource, ownerSub);
}

/** The single-row loader a settings read will use (`settings`), `null` when unset. */
function settingsLoader(dataSource: DataSource, ownerSub: string): () => Promise<CachedRow | null> {
  return async () => {
    const rows = await persistedRows(dataSource, ownerSub);
    return rows[0] ?? null;
  };
}

interface Harness {
  dataSource: DataSource;
  redis: FakeRedisClient;
}

describe('MeditationCache (ciphertext rows, generation invalidation, fail-open)', () => {
  /** A fresh probe table and a recording cache; the database is torn down after. */
  async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
    const database: ThrowawayDatabase = await startThrowawayDatabase('cache');
    const dataSource = await openProbeDatabase(database.path);
    try {
      await run({ dataSource, redis: new FakeRedisClient() });
    } finally {
      await dataSource.destroy();
      await database.stop();
    }
  }

  it('serves a repeated settings read from one ciphertext entry under the settings key', async () => {
    await withHarness(async ({ dataSource, redis }) => {
      const cache = new MeditationCache(redis);
      await insertRow(dataSource, ciphertextRow(OWNER, 'settings-1'));
      const load = jest.fn(settingsLoader(dataSource, OWNER));

      const first = await cache.getThrough(OWNER, 'settings', load, {
        cacheable: isCiphertextRow,
      });
      const second = await cache.getThrough(OWNER, 'settings', load, {
        cacheable: isCiphertextRow,
      });

      expect(second).toEqual(first);
      expect(load).toHaveBeenCalledTimes(1);
      const key = `meditation:${OWNER}:v0:settings`;
      expect(redis.setCalls).toEqual([key]);
      expect(redis.writes[0].options).toEqual({ EX: CACHE_TTL_SECONDS });
      // What Redis would hold is the persisted row, envelope and all.
      expect(JSON.parse(redis.valueFor(key)!)).toEqual((await persistedRows(dataSource, OWNER))[0]);
      expect(redis.valueFor(key)).toContain(ENC_PREFIX);
      expect(redis.valueFor(key)).not.toContain(PLAINTEXT);
    });
  });

  it('serves a repeated session window from one ciphertext entry keyed by its bounds', async () => {
    await withHarness(async ({ dataSource, redis }) => {
      const cache = new MeditationCache(redis);
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-1'));
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-2', 'a shorter sitting'));
      const load = jest.fn(windowLoader(dataSource, OWNER));
      const window = `${RANGE.from}:${RANGE.to}`;

      const first = await cache.getThrough(OWNER, `sessions:${window}`, load, {
        cacheable: (rows: CachedRow[]) => rows.every(isCiphertextRow),
      });
      await cache.getThrough(OWNER, `sessions:${window}`, load, {
        cacheable: (rows: CachedRow[]) => rows.every(isCiphertextRow),
      });

      expect(load).toHaveBeenCalledTimes(1);
      const key = `meditation:${OWNER}:v0:sessions:${window}`;
      expect(redis.setCalls).toEqual([key]);
      expect(JSON.parse(redis.valueFor(key)!)).toEqual(await persistedRows(dataSource, OWNER));
      expect(first).toEqual(await persistedRows(dataSource, OWNER));
      expect(redis.valueFor(key)).toContain(ENC_PREFIX);
      expect(redis.valueFor(key)).not.toContain(PLAINTEXT);
    });
  });

  it('bumps the owner generation on a write so the next read misses and sees the new row', async () => {
    await withHarness(async ({ dataSource, redis }) => {
      const writer = new MeditationCache(redis);
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-1'));

      await writer.getThrough(OWNER, 'settings', settingsLoader(dataSource, OWNER), {
        cacheable: isCiphertextRow,
      });
      expect(redis.setCalls).toEqual([`meditation:${OWNER}:v0:settings`]);

      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-2', 'a second sitting'));
      await writer.bumpGeneration(OWNER);

      const after = await writer.getThrough(OWNER, 'settings', settingsLoader(dataSource, OWNER), {
        cacheable: isCiphertextRow,
      });

      expect(redis.incrCalls).toEqual([generationKey(OWNER)]);
      // The v0 entry is unreachable, so the read repopulated under v1.
      expect(redis.setCalls).toContain(`meditation:${OWNER}:v1:settings`);
      expect(after).toEqual((await persistedRows(dataSource, OWNER))[0]);
    });
  });

  it('keys each session window by its own bounds', async () => {
    await withHarness(async ({ dataSource, redis }) => {
      const cache = new MeditationCache(redis);
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-1'));

      await cache.getThrough(OWNER, `sessions:${DAY}:${DAY}`, windowLoader(dataSource, OWNER));
      await cache.getThrough(OWNER, `sessions:${DAY}:${NEXT_DAY}`, windowLoader(dataSource, OWNER));

      expect(redis.setCalls).toEqual([
        `meditation:${OWNER}:v0:sessions:${DAY}:${DAY}`,
        `meditation:${OWNER}:v0:sessions:${DAY}:${NEXT_DAY}`,
      ]);
    });
  });

  it('bumps only the writing owner’s generation', async () => {
    await withHarness(async ({ redis }) => {
      const cache = new MeditationCache(redis);

      await cache.bumpGeneration(OWNER);
      await cache.bumpGeneration(OTHER_OWNER);

      expect(redis.incrCalls).toEqual([generationKey(OWNER), generationKey(OTHER_OWNER)]);
      expect(generationKey(OWNER)).not.toBe(generationKey(OTHER_OWNER));
    });
  });

  it('serves a legacy plaintext row from the loader without writing it to Redis', async () => {
    await withHarness(async ({ dataSource, redis }) => {
      const cache = new MeditationCache(redis);
      await insertRow(dataSource, { id: 'legacy', ownerSub: OWNER, content: PLAINTEXT });

      const row = await cache.getThrough(OWNER, 'settings', settingsLoader(dataSource, OWNER), {
        cacheable: isCiphertextRow,
      });

      expect(row!.content).toBe(PLAINTEXT);
      expect(redis.writes).toEqual([]);
    });
  });

  it('runs the direct loader and writes nothing when no REDIS_URL is configured', async () => {
    await withHarness(async ({ dataSource }) => {
      const cache = createMeditationCache(undefined);
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-1'));
      const load = jest.fn(windowLoader(dataSource, OWNER));

      const first = await cache.getThrough(OWNER, `sessions:${DAY}:${NEXT_DAY}`, load);
      const second = await cache.getThrough(OWNER, `sessions:${DAY}:${NEXT_DAY}`, load);

      expect(load).toHaveBeenCalledTimes(2);
      expect(second).toEqual(first);
      expect(first).toEqual(await persistedRows(dataSource, OWNER));
    });
  });

  it('degrades to the direct loader with no populate attempted when every cache command rejects', async () => {
    const database = await startThrowawayDatabase('cache-fail-open');
    const dataSource = await openProbeDatabase(database.path);
    const unreachable = new UnreachableRedisClient();
    const cache = new MeditationCache(unreachable);
    try {
      await insertRow(dataSource, ciphertextRow(OWNER, 'sit-1'));

      const rows = await cache.getThrough(
        OWNER,
        `sessions:${DAY}:${NEXT_DAY}`,
        windowLoader(dataSource, OWNER),
      );
      const again = await cache.getThrough(
        OWNER,
        `sessions:${DAY}:${NEXT_DAY}`,
        windowLoader(dataSource, OWNER),
      );

      expect(rows).toEqual(await persistedRows(dataSource, OWNER));
      expect(again).toEqual(rows);
      // The generation was unreadable, so nothing may be written back at all.
      expect(unreachable.gets.length).toBeGreaterThan(0);
      expect(unreachable.sets).toEqual([]);
    } finally {
      await dataSource.destroy();
      await database.stop();
    }
  });

  it('exports the service namespace, its DI token, and the shared TTL', () => {
    expect(MEDITATION_CACHE.description).toBe('MEDITATION_CACHE');
    expect(CACHE_TTL_SECONDS).toBe(60);
    expect(generationKey(OWNER)).toBe(`meditation:gen:${OWNER}`);
  });
});
