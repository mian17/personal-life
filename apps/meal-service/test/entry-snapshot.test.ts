import { BadRequestException, NotFoundException } from '@nestjs/common';
import { decryptField } from '@life/crypto';
import { MealCache, generationKey } from '../src/cache/meal-cache';
import { KeysService } from '../src/keys/keys.service';
import { NUTRIENTS, scale, sum, type Food as FoodModel, type NutrientVector } from '@life/nutrition';
import type { Entry } from '../src/entries/entry.entity';
import { EntriesCache } from '../src/entries/entries-cache';
import { EntriesService, type EntryDto } from '../src/entries/entries.service';
import type { UpdateEntryDto } from '../src/entries/dto/update-entry.dto';
import type { CreateEntryDto } from '../src/entries/dto/create-entry.dto';
import type { CacheClient, CacheSetOptions } from '@life/cache';

/**
 * Unit-level contract for entry snapshot immutability (`SPEC-meal-service`
 * Testing Strategy: "Entry snapshot immutability — editing a food must not
 * rewrite history"). The DB is a repository fake, Redis is a recording
 * client, and DEK custody is real crypto, so these tests prove:
 *
 * - a stored row holds the confirmed snapshot as an `enc.v1.` envelope that
 *   opens against its exact AAD and never stores plaintext;
 * - editing the source food afterwards leaves the stored envelope and the read
 *   output byte-identical (the entries service never touches a food row);
 * - a snapshot changes only through an explicit corrected `nutrients` write;
 * - a day's total is `sum()` over the day's entries, and deleting one moves it;
 * - the day always comes from the client: the service never reads a process
 *   clock (lesson 0019).
 */

const SUB = 'sub-1';
const OTHER_SUB = 'sub-2';
const DAY = '2026-09-03';

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

type StoredEntry = Entry & { createdAt: Date; updatedAt: Date };

/** Repository fake: owner-scoped, honours the `IsNull()` deleted-at predicate. */
class FakeEntryRepo {
  rows: StoredEntry[] = [];

  constructor(private readonly events: string[] = []) {}

  create = jest.fn((data: Partial<StoredEntry>): StoredEntry => ({
    ...data,
  } as StoredEntry));

  save = jest.fn(async (row: StoredEntry): Promise<StoredEntry> => {
    this.events.push('db:save');
    row.createdAt ??= new Date('2026-01-01T00:00:00.000Z');
    row.updatedAt ??= new Date('2026-01-01T00:00:00.000Z');
    const index = this.rows.findIndex((r) => r.id === row.id);
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    return row;
  });

  find = jest.fn(
    async (opts: { where: { ownerSub: string; date: string } }): Promise<StoredEntry[]> =>
      this.rows
        .filter(
          (r) =>
            r.ownerSub === opts.where.ownerSub &&
            r.date === opts.where.date &&
            !r.deletedAt,
        )
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id)),
  );

  findOne = jest.fn(
    async (opts: { where: { id: string; ownerSub: string } }): Promise<StoredEntry | null> =>
      this.rows.find(
        (r) => r.id === opts.where.id && r.ownerSub === opts.where.ownerSub && !r.deletedAt,
      ) ?? null,
  );
}

/** `user_keys` fake: real DEK wrap/unwrap, in-memory rows. */
class FakeUserKeysRepo {
  rows = new Map<string, { sub: string; wrappedDek: Buffer; kekVersion: number }>();

  findOne = jest.fn(async (opts: { where: { sub: string } }) => this.rows.get(opts.where.sub) ?? null);

  insert = jest.fn(async (row: { sub: string; wrappedDek: Buffer }) => {
    this.rows.set(row.sub, { ...row, kekVersion: 1 });
  });
}

function makeHarness(events: string[] = []) {
  const client = new RecordingClient(events);
  const repo = new FakeEntryRepo(events);
  const userKeys = new FakeUserKeysRepo();
  const keys = new KeysService(userKeys as never, Buffer.alloc(32, 0x2c));
  const service = new EntriesService(repo as never, new EntriesCache(new MealCache(client)), keys);
  return { service, repo, client, keys, events };
}

/** A complete vector: `overrides` on top of zeroes. */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

/** The food an entry came from: complete vector, no crypto involved. */
function food(vector: NutrientVector, servingGrams = 100): FoodModel {
  return { id: 'food-1', name: 'oats', servingGrams, nutrients: vector, portions: [] };
}

function body(overrides: Partial<CreateEntryDto> = {}): CreateEntryDto {
  return {
    date: DAY,
    mealGroup: 'breakfast',
    foodId: 'food-1',
    quantity: 2,
    nutrients: vector({ calories: 200, protein: 10 }),
    ...overrides,
  };
}

/** Open a stored row's envelope with the byte-exact AAD the service must use. */
async function openSnapshot(h: ReturnType<typeof makeHarness>, row: StoredEntry): Promise<NutrientVector> {
  const dek = await h.keys.getDekForRead(row.ownerSub!);
  return JSON.parse(decryptField(dek, row.nutrients, `life.v1|${row.ownerSub}|meal|entry|${row.id}`)) as NutrientVector;
}

describe('Entry snapshot immutability', () => {
  it('stores the confirmed snapshot as ciphertext that opens against its exact AAD', async () => {
    const h = makeHarness();
    const confirmed = scale(food(vector({ calories: 100, protein: 5 })), 2);

    const created = await h.service.create(SUB, body({ nutrients: confirmed }));

    expect(created.nutrients).toEqual(confirmed);
    const stored = h.repo.rows[0];
    expect(stored.nutrients.startsWith('enc.v1.')).toBe(true);
    expect(stored.nutrients).not.toContain('calories');
    expect(await openSnapshot(h, stored)).toEqual(confirmed);
    expect(stored.date).toBe(DAY);
    expect(stored.ownerSub).toBe(SUB);
  });

  it('editing the source food afterwards leaves the stored snapshot untouched', async () => {
    const h = makeHarness();
    const original = vector({ calories: 100, protein: 5 });
    const created = await h.service.create(SUB, body({ nutrients: scale(food(original), 2) }));
    const storedBefore = h.repo.rows[0].nutrients;

    // The catalog food is edited afterwards; the entries service has no food
    // dependency at all, so nothing can rewrite the diary from it.
    const edited = vector({ calories: 900, protein: 90 });
    expect(scale(food(edited), 2).calories).toBe(1800);

    const reread = await h.service.findOne(SUB, created.id);
    expect(reread.nutrients.calories).toBe(200);
    expect(reread.nutrients).toEqual(scale(food(original), 2));
    expect(h.repo.rows[0].nutrients).toBe(storedBefore);
    expect((await h.service.findAll(SUB, DAY))[0].nutrients).toEqual(scale(food(original), 2));
  });

  it('changes the snapshot only through an explicit corrected write', async () => {
    const h = makeHarness();
    const created = await h.service.create(SUB, body());

    // Re-filing the entry moves date/meal without touching the numbers.
    const moved = await h.service.update(SUB, created.id, {
      date: '2026-09-04',
      mealGroup: 'dinner',
    } as UpdateEntryDto);
    expect(moved.nutrients).toEqual(created.nutrients);
    expect(moved.date).toBe('2026-09-04');
    expect(moved.version).toBe(1);

    // A quantity without a corrected vector is refused: the pair can't disagree.
    await expect(
      h.service.update(SUB, created.id, { quantity: 3 } as UpdateEntryDto),
    ).rejects.toBeInstanceOf(BadRequestException);

    const corrected = vector({ calories: 999 });
    const updated = await h.service.update(SUB, created.id, {
      quantity: 3,
      nutrients: corrected,
    } as UpdateEntryDto);
    expect(updated.nutrients).toEqual(corrected);
    expect(updated.quantity).toBe(3);
    expect((await h.service.findOne(SUB, created.id)).nutrients).toEqual(corrected);
  });

  it("a day's total is sum() of its entries and deleting one entry moves the total", async () => {
    const h = makeHarness();
    const first = vector({ calories: 400, protein: 20 });
    const second = vector({ calories: 600, protein: 10 });
    const a = await h.service.create(SUB, body({ mealGroup: 'lunch', nutrients: first }));
    await h.service.create(SUB, body({ mealGroup: 'dinner', foodId: 'food-2', nutrients: second }));

    const listed: EntryDto[] = await h.service.findAll(SUB, DAY);
    expect(listed).toHaveLength(2);
    expect(sum(listed.map((entry) => entry.nutrients))).toEqual(sum([first, second]));

    await h.service.remove(SUB, a.id);

    const after = await h.service.findAll(SUB, DAY);
    expect(after).toHaveLength(1);
    expect(sum(after.map((entry) => entry.nutrients))).toEqual(second);
  });
});

describe('EntriesService — read path discipline', () => {
  it('filters the meal group in memory and never in SQL', async () => {
    const h = makeHarness();
    await h.service.create(SUB, body({ mealGroup: 'breakfast' }));
    await h.service.create(SUB, body({ mealGroup: 'dinner', foodId: 'food-2' }));

    const filtered = await h.service.findAll(SUB, DAY, 'dinner');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].mealGroup).toBe('dinner');

    // The loader's `where` is owner + date only: the meal predicate never
    // reaches SQL, and the snapshot is an envelope anyway.
    const where = h.repo.find.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toMatchObject({ ownerSub: SUB, date: DAY });
    expect(where).not.toHaveProperty('mealGroup');
  });

  it('scopes every read to the owner, so a foreign id is indistinguishable from a missing one', async () => {
    const h = makeHarness();
    const created = await h.service.create(SUB, body());

    await expect(h.service.findOne(OTHER_SUB, created.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.findOne(OTHER_SUB, '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await h.service.findAll(OTHER_SUB, DAY)).toEqual([]);

    await expect(h.service.update(OTHER_SUB, created.id, {} as UpdateEntryDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(h.service.remove(OTHER_SUB, created.id)).rejects.toBeInstanceOf(NotFoundException);
    // B's failed attempts never touched A's row.
    expect((await h.service.findOne(SUB, created.id)).nutrients).toEqual(created.nutrients);
  });

  it('bumps the owner generation strictly after the DB write, and serves a hit from the cache', async () => {
    const h = makeHarness();
    const created = await h.service.create(SUB, body());

    expect(h.client.incrCalls).toEqual([generationKey(SUB)]);
    expect(h.events.indexOf('db:save')).toBeLessThan(
      h.events.indexOf(`incr:${generationKey(SUB)}`),
    );

    // First read after the write: the owner's generation is 1, so the day key
    // embeds it and the value is the row as persisted — ciphertext, never a DTO.
    const fromCache = await h.service.findAll(SUB, DAY);
    expect(fromCache[0].nutrients).toEqual(created.nutrients);
    const key = `meal:${SUB}:v1:entries:${DAY}`;
    expect(h.client.setCalls).toContain(key);
    const cached = JSON.parse(h.client.store.get(key)!) as Array<{ nutrients: string }>;
    expect(cached[0].nutrients.startsWith('enc.v1.')).toBe(true);
    expect(cached[0].nutrients).not.toContain('calories');

    // A second read is a hit: the loader (a DB query) does not run again.
    const dbCallsBefore = h.repo.find.mock.calls.length;
    const again = await h.service.findAll(SUB, DAY);
    expect(again[0].nutrients).toEqual(created.nutrients);
    expect(h.repo.find.mock.calls).toHaveLength(dbCallsBefore);
  });
});