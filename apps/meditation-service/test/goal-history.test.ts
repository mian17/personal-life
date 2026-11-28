import { BadRequestException } from '@nestjs/common';
import { generateDek } from '@life/crypto';
import type { MeditationCache } from '../src/cache/meditation-cache.js';
import { GoalHistory } from '../src/settings/goal-history.entity.js';
import { GoalHistoryService, resolveGoal } from '../src/settings/goal-history.service.js';

/**
 * `SPEC-meditation-app` §1 — the daily-goal history's own rules:
 *
 * - a day resolves to the newest row on or before it, `null` before every row;
 * - a second set for the same day replaces that row and leaves every other day's row untouched;
 * - the stored and cached shape is an `enc.v1.` envelope, never a plaintext number;
 * - a missing or impossible day is a 400, never a default.
 *
 * The service runs against an in-memory repository and a recording cache: SQLite and Redis
 * themselves are the e2e suites' subject.
 */

/** The in-memory rows, keyed the way the unique `(ownerSub, validFrom)` index would hold them. */
interface StoredGoalRow {
  ownerSub: string;
  validFrom: string;
  content: string;
}

function createFakeGoalRows(): { rows: StoredGoalRow[]; repository: unknown } {
  const rows: StoredGoalRow[] = [];
  return {
    rows,
    repository: {
      upsert: async (goal: StoredGoalRow) => {
        const sameDay = rows.find(
          (row) => row.ownerSub === goal.ownerSub && row.validFrom === goal.validFrom,
        );
        if (sameDay) sameDay.content = goal.content;
        else rows.push({ ...goal });
      },
      find: async ({ where }: { where: { ownerSub: string } }) =>
        rows
          .filter((row) => row.ownerSub === where.ownerSub)
          .sort((left, right) => left.validFrom.localeCompare(right.validFrom)),
    },
  };
}

/** What the cache would hold for one read: the loader's value, as it would be serialized. */
interface CachedEntry {
  key: string;
  value: unknown;
}

/** A cache that always misses, recording what a hit would have stored — the ciphertext check reads it. */
function createRecordingCache(): { entries: CachedEntry[]; cache: unknown } {
  const entries: CachedEntry[] = [];
  const cache = {
    getThrough: async (
      sub: string,
      rest: string,
      load: () => Promise<unknown>,
      options: { cacheable?: (value: never) => boolean } = {},
    ) => {
      const value = await load();
      const cacheable = options.cacheable?.(value as never) ?? true;
      if (cacheable) entries.push({ key: `meditation:${sub}:v1:${rest}`, value });
      return value;
    },
    bumpGeneration: async () => 1,
  };
  return { entries, cache };
}

const DEK = generateDek();

/** The owner's DEK, read and provisioned identically: one key, so a seal and its open agree. */
const keys = {
  getOrCreateDek: async () => DEK,
  getDekForRead: async () => DEK,
} as unknown as ConstructorParameters<typeof GoalHistoryService>[2];

function createService(): {
  service: GoalHistoryService;
  rows: StoredGoalRow[];
  entries: CachedEntry[];
} {
  const { rows, repository } = createFakeGoalRows();
  const { entries, cache } = createRecordingCache();
  const service = new GoalHistoryService(repository as never, cache as MeditationCache, keys);
  return { service, rows, entries };
}

const EARLIER_DAY = '2026-10-27';
const A_DAY = '2026-10-28';
const OWNER = 'owner-1';

describe('resolveGoal', () => {
  it('answers the newest row that took effect on or before the day', () => {
    const rows = [
      { validFrom: EARLIER_DAY, minutes: 30 },
      { validFrom: A_DAY, minutes: 40 },
    ];

    expect(resolveGoal(rows, '2026-10-29')).toBe(40);
  });

  it('keeps a past day on the goal that applied then', () => {
    const rows = [
      { validFrom: EARLIER_DAY, minutes: 30 },
      { validFrom: A_DAY, minutes: 40 },
    ];

    expect(resolveGoal(rows, A_DAY)).toBe(40);
    expect(resolveGoal(rows, EARLIER_DAY)).toBe(30);
  });

  it('answers null before every row, and for an owner who never set a goal', () => {
    expect(resolveGoal([{ validFrom: A_DAY, minutes: 40 }], EARLIER_DAY)).toBeNull();
    expect(resolveGoal([], A_DAY)).toBeNull();
  });
});

describe('GoalHistoryService', () => {
  it('leaves the earlier day resolved to the goal it had when a later day is set', async () => {
    const { service } = createService();
    await service.setGoal(OWNER, EARLIER_DAY, 30);
    await service.setGoal(OWNER, A_DAY, 45);

    const history = await service.findAll(OWNER);
    expect(resolveGoal(history, EARLIER_DAY)).toBe(30);
    expect(resolveGoal(history, A_DAY)).toBe(45);
  });

  it('replaces the same day in place and leaves the history one row per day', async () => {
    const { service, rows } = createService();
    await service.setGoal(OWNER, EARLIER_DAY, 30);
    await service.setGoal(OWNER, A_DAY, 30);
    await service.setGoal(OWNER, A_DAY, 40);

    expect(rows).toHaveLength(2);
    await expect(service.findAll(OWNER)).resolves.toEqual([
      { validFrom: EARLIER_DAY, minutes: 30 },
      { validFrom: A_DAY, minutes: 40 },
    ]);
  });

  it('stores the minutes as an enc.v1. envelope carrying no plaintext number', async () => {
    const { service, rows, entries } = createService();
    await service.setGoal(OWNER, A_DAY, 45);

    expect(rows[0].content.startsWith('enc.v1.')).toBe(true);
    expect(rows[0].content).not.toContain('45');

    // A read populates the one per-owner entry with the rows as persisted; that entry is the
    // shape Redis would hold, so the same two checks cover it.
    await service.findAll(OWNER);
    const cached = JSON.stringify(entries.at(-1)?.value);
    expect(cached).toContain('enc.v1.');
    expect(cached).not.toContain('45');
  });

  it('refuses an impossible day instead of guessing one', async () => {
    const { service } = createService();

    await expect(service.setGoal(OWNER, '2026-02-31', 30)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a missing day, since no service clock may invent one', async () => {
    const { service } = createService();

    await expect(service.setGoal(OWNER, undefined, 30)).rejects.toBeInstanceOf(BadRequestException);
  });
});
