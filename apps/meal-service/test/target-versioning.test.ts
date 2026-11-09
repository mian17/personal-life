import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import type { CacheClient, CacheSetOptions } from '@life/cache';
import { MealCache, generationKey } from '../src/cache/meal-cache.js';
import { calculateTarget } from '../src/targets/target.js';
import { UpdateProfileDto } from '../src/targets/dto/update-profile.dto.js';
import type { TargetDto } from '../src/targets/target.service.js';
import { TargetService } from '../src/targets/target.service.js';
import type { Target } from '../src/targets/target.entity.js';

/**
 * Unit-level contract for target versioning (`SPEC-target-onboarding`). The DB
 * is a repository fake and Redis is a recording client, so these tests prove
 * *which row a date resolves to*, *what a PUT inserts*, and *that a GET never
 * touches Redis* — without a database or a live Redis.
 */

const SUB = 'sub-1';

/** A valid input body; each case overrides only what it exercises. */
const PROFILE = {
  age: 30,
  sex: 'male',
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
} as UpdateProfileDto;

interface Row extends Target {
  createdAt: Date;
  updatedAt: Date;
}

/** Recording stand-in for the node-redis client: only the surface `@life/cache` uses. */
class RecordingClient implements CacheClient {
  readonly store = new Map<string, string>();
  readonly setCalls: string[] = [];
  readonly incrCalls: string[] = [];

  constructor(private readonly events: string[] = []) {}

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _options?: CacheSetOptions): Promise<'OK'> {
    this.events.push(`set:${key}`);
    this.setCalls.push(key);
    this.store.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.events.push(`incr:${key}`);
    this.incrCalls.push(key);
    const next = (Number.parseInt(this.store.get(key) ?? '0', 10) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }
}

/** Repository fake: owner-scoped, ordered by `validFrom` as the service requests. */
class FakeTargetRepo {
  rows: Row[] = [];

  constructor(private readonly events: string[] = []) {}

  create = jest.fn(
    (data: Partial<Row>): Row =>
      ({
        ...data,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }) as Row,
  );

  save = jest.fn(async (row: Row): Promise<Row> => {
    this.events.push('db:save');
    this.rows.push(row);
    return row;
  });

  find = jest.fn(async (opts: { where: { ownerSub: string } }): Promise<Row[]> =>
    this.rows
      .filter((r) => r.ownerSub === opts.where.ownerSub)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
  );
}

function makeHarness(events: string[] = []) {
  const client = new RecordingClient(events);
  const repo = new FakeTargetRepo(events);
  const service = new TargetService(repo as any, new MealCache(client));
  return { service, repo, client, events };
}

function row(validFrom: string, calories = 2000): Row {
  return {
    id: `t-${validFrom}`,
    ownerSub: SUB,
    validFrom,
    age: 30,
    sex: 'male',
    heightCm: 180,
    weightKg: 80,
    activity: 'moderate',
    goal: 'maintain',
    bmr: 1780,
    tdee: calories,
    calories,
    proteinG: 128,
    fatG: 48,
    carbG: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('TargetService.getTarget — date resolves to exactly one row', () => {
  it('returns the most recent row with validFrom <= date', async () => {
    const h = makeHarness();
    h.repo.rows = [row('2026-01-01', 2000), row('2026-03-01', 2100), row('2026-05-01', 2200)];

    await expect(h.service.getTarget(SUB, '2026-04-15')).resolves.toMatchObject({
      validFrom: '2026-03-01',
      calories: 2100,
    });
    await expect(h.service.getTarget(SUB, '2026-03-01')).resolves.toMatchObject({
      validFrom: '2026-03-01',
    });
    await expect(h.service.getTarget(SUB, '2026-05-02')).resolves.toMatchObject({
      validFrom: '2026-05-01',
    });
  });

  it('falls back to the oldest row when the date precedes every profile', async () => {
    const h = makeHarness();
    h.repo.rows = [row('2026-01-01', 2000), row('2026-03-01', 2100)];

    await expect(h.service.getTarget(SUB, '2025-12-01')).resolves.toMatchObject({
      validFrom: '2026-01-01',
    });
  });

  it('is owner-scoped and 404s when the caller has no rows', async () => {
    const h = makeHarness();
    h.repo.rows = [{ ...row('2026-01-01'), ownerSub: 'someone-else' }];

    await expect(h.service.getTarget(SUB, '2026-02-01')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.repo.find).toHaveBeenCalledWith({
      where: { ownerSub: SUB },
      order: { validFrom: 'ASC' },
    });
  });

  it('rejects a missing or malformed date string at the boundary', async () => {
    const h = makeHarness();
    await expect(h.service.getTarget(SUB, '2026/01/01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(h.service.getTarget(SUB, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never writes to Redis on a read', async () => {
    const h = makeHarness();
    h.repo.rows = [row('2026-01-01')];

    await h.service.getTarget(SUB, '2026-02-01');

    expect(h.client.setCalls).toHaveLength(0);
    expect(h.client.incrCalls).toHaveLength(0);
  });
});

describe('TargetService.updateProfile — row per change, bump after insert', () => {
  it('inserts a new row, leaves prior rows untouched, and bumps strictly after the insert', async () => {
    const h = makeHarness();
    h.repo.rows = [row('2026-01-01', 2000)];
    const before = h.repo.rows.map((r) => ({ ...r }));

    const dto: UpdateProfileDto = { ...PROFILE, weightKg: 90, date: '2026-03-01' };
    const saved = await h.service.updateProfile(SUB, dto);

    // Prior rows are byte-identical — history is immutable.
    expect(h.repo.rows.slice(0, before.length)).toEqual(before);
    expect(h.repo.rows).toHaveLength(2);
    // The new row stamps the owner from the principal and the client's date.
    expect(saved.validFrom).toBe('2026-03-01');
    expect(saved.weightKg).toBe(90);
    expect(h.repo.save).toHaveBeenCalledTimes(1);
    expect((h.repo.save.mock.calls[0][0] as Row).ownerSub).toBe(SUB);
    // The bump happens after the durable insert.
    expect(h.events.indexOf('db:save')).toBeLessThan(
      h.events.indexOf(`incr:${generationKey(SUB)}`),
    );
    expect(h.client.incrCalls).toEqual([generationKey(SUB)]);
  });

  it('derives computed outputs server-side, ignoring client-influenced values', async () => {
    const h = makeHarness();
    const expected = calculateTarget(
      { age: 30, sex: 'male', heightCm: 180, weightKg: 80, activity: 'moderate' },
      'maintain',
    );

    const saved = await h.service.updateProfile(SUB, { ...PROFILE, date: '2026-01-01' });

    expect(saved).toMatchObject(expected);
  });

  it("a profile change does not alter an earlier date's target", async () => {
    const h = makeHarness();
    const dto: UpdateProfileDto = { ...PROFILE, date: '2026-01-01' };
    await h.service.updateProfile(SUB, dto);
    const old = await h.service.getTarget(SUB, '2026-01-15');

    await h.service.updateProfile(SUB, { ...dto, weightKg: 120, date: '2026-03-01' });

    await expect(h.service.getTarget(SUB, '2026-01-15')).resolves.toEqual(old);
    await expect(h.service.getTarget(SUB, '2026-03-15')).resolves.toMatchObject({
      weightKg: 120,
    });
  });
});

describe('UpdateProfileDto — the client cannot send computed values or an owner', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

  async function validate(body: Record<string, unknown>): Promise<UpdateProfileDto> {
    return pipe.transform(body, { type: 'body', metatype: UpdateProfileDto });
  }

  it("accepts the profile inputs together with the client's date", async () => {
    await expect(validate({ ...PROFILE, date: '2026-03-01' })).resolves.toMatchObject({
      ...PROFILE,
      date: '2026-03-01',
    });
  });

  it("rejects a body with no date (the service never defaults the user's day)", async () => {
    await expect(validate({ ...PROFILE })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...PROFILE, date: '03-01-2026' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a body carrying computed kcal / bmr / tdee / macros', async () => {
    await expect(validate({ ...PROFILE, calories: 9999 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validate({ ...PROFILE, bmr: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...PROFILE, proteinG: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a body carrying ownerSub (ownership is never client-supplied)', async () => {
    await expect(validate({ ...PROFILE, ownerSub: 'sub-2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an out-of-enum activity or goal', async () => {
    await expect(validate({ ...PROFILE, activity: 'extreme' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validate({ ...PROFILE, goal: 'bulk' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
