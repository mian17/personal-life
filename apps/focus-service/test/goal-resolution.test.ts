import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { FocusCache } from '../src/cache/focus-cache';
import { SetGoalDto } from '../src/goals/dto/set-goal.dto';
import { Goal } from '../src/goals/goal.entity';
import { GoalsService, resolveGoal } from '../src/goals/goals.service';

/**
 * `SPEC-focus-service` §1, §6, §8.5 — the goal slice's own rules:
 *
 * - a day resolves to the newest row on or before it, `null` before every row;
 * - a second set for the same day replaces that row and leaves every other day's
 *   row untouched;
 * - a missing or impossible day is a 400, never a default.
 *
 * The service runs against an in-memory repository and a pass-through cache: the
 * SQL and Redis themselves are covered by Task 5's `*.e2e-spec.ts` suites.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

async function validateGoal(body: Record<string, unknown>): Promise<SetGoalDto> {
  return pipe.transform(body, { type: 'body', metatype: SetGoalDto });
}

/** Rows keyed by owner and day, the way the unique index would hold them. */
function createFakeGoals(): Repository<Goal> {
  const rows: Goal[] = [];
  return {
    upsert: async (goal: Omit<Goal, 'id' | 'createdAt'>) => {
      const sameDay = rows.find(
        (row) => row.ownerSub === goal.ownerSub && row.validFrom === goal.validFrom,
      );
      if (sameDay) sameDay.minutes = goal.minutes;
      else rows.push({ ...goal, id: String(rows.length + 1), createdAt: new Date() } as Goal);
    },
    find: async ({ where }: { where: { ownerSub: string } }) =>
      rows
        .filter((row) => row.ownerSub === where.ownerSub)
        .sort((left, right) => left.validFrom.localeCompare(right.validFrom)),
  } as unknown as Repository<Goal>;
}

/** The cache's contract for this suite: reads fall through to the loader. */
const passThroughCache = {
  getThrough: (_sub: string, _rest: string, load: () => Promise<unknown>) => load(),
  bumpGeneration: async () => 1,
} as unknown as FocusCache;

function createService(): GoalsService {
  return new GoalsService(createFakeGoals(), passThroughCache);
}

const EARLIER_DAY = '2026-10-27';
const A_DAY = '2026-10-28';
const OWNER = 'owner-1';

describe('resolveGoal', () => {
  const rows = [
    { validFrom: EARLIER_DAY, minutes: 30 },
    { validFrom: A_DAY, minutes: 40 },
  ];

  it('answers the newest row that took effect on or before the day', () => {
    expect(resolveGoal(rows, '2026-10-29')).toBe(40);
  });

  it('keeps a past day on the goal that applied then', () => {
    expect(resolveGoal(rows, A_DAY)).toBe(40);
    expect(resolveGoal(rows, EARLIER_DAY)).toBe(30);
    expect(resolveGoal(rows, '2026-10-26')).toBeNull();
  });

  it('answers null when no row was ever set', () => {
    expect(resolveGoal([], A_DAY)).toBeNull();
  });
});

describe('SetGoalDto — the client day is required', () => {
  it('accepts a whole day with whole minutes', async () => {
    await expect(validateGoal({ date: A_DAY, minutes: 30 })).resolves.toMatchObject({
      date: A_DAY,
      minutes: 30,
    });
  });

  it('refuses a body with no date instead of falling back to a default day', async () => {
    await expect(validateGoal({ minutes: 30 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GoalsService', () => {
  it('refuses an impossible day instead of guessing one', async () => {
    await expect(
      createService().setGoal(OWNER, { date: '2026-02-31', minutes: 30 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces the same day and leaves the prior day alone', async () => {
    const goals = createService();
    await goals.setGoal(OWNER, { date: EARLIER_DAY, minutes: 30 });
    await goals.setGoal(OWNER, { date: A_DAY, minutes: 30 });
    await goals.setGoal(OWNER, { date: A_DAY, minutes: 40 });

    await expect(goals.findAll(OWNER)).resolves.toEqual([
      { validFrom: EARLIER_DAY, minutes: 30 },
      { validFrom: A_DAY, minutes: 40 },
    ]);
  });

  it('answers an empty list for an owner who never set a goal', async () => {
    await expect(createService().findAll('fresh-owner')).resolves.toEqual([]);
  });

  it('keeps one owner’s goals out of another owner’s list', async () => {
    const goals = createService();
    await goals.setGoal(OWNER, { date: A_DAY, minutes: 40 });

    await expect(goals.findAll('fresh-owner')).resolves.toEqual([]);
  });
});
