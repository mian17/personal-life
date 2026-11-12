import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { KeysService, UserKeys } from '@life/service-kit';
import { NUTRIENTS, type NutrientVector } from '@life/nutrition';
import { EntriesCache } from '../src/entries/entries-cache.js';
import { EntriesService } from '../src/entries/entries.service.js';
import type { CreateEntryDto } from '../src/entries/dto/create-entry.dto.js';
import { Entry } from '../src/entries/entry.entity.js';
import { MealCache } from '../src/cache/meal-cache.js';
import { MealTodoProducerService } from '../src/outbox/producer/meal-todo-producer.service.js';
import { MealTodoToggle } from '../src/outbox/producer/meal-toggle.entity.js';
import { Outbox } from '../src/outbox/outbox.entity.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { Target } from '../src/targets/target.entity.js';
import { TargetService } from '../src/targets/target.service.js';

/**
 * The producer's contract (`SPEC-todo-origin` §7, `SPEC-todo-origin` §9.16,
 * `docs/roadmap/research/outbox-atomicity.md` §1): meal-service enqueues the
 * intents a granted owner is owed, pins every tick to its occurrence, and never
 * lets that work fail the meal log it accompanies.
 *
 * Hermetic: a throwaway SQLite file in a private `mkdtemp` directory, a real
 * `KeysService` over a real `user_keys` table (so the entry write path is the
 * production one), and no network — the poller is never built, so nothing is
 * ever delivered.
 */

const TEST_DIR = mkdtempSync(join(tmpdir(), 'meal-producer-'));
const TEST_DB = join(TEST_DIR, 'test-producer.db');

const SUB = 'user-a';
const NO_TARGET_SUB = 'user-b';
const DAY = '2026-09-03';
const CALORIES = 2200.4;
const DISCLOSURE = 'Meal logging will create and tick three daily todos.';

/** A complete vector: `overrides` on top of zeroes. */
function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = overrides[key] ?? 0;
  return out;
}

function body(overrides: Partial<CreateEntryDto> = {}): CreateEntryDto {
  return {
    date: DAY,
    mealGroup: 'breakfast',
    foodId: 'food-1',
    quantity: 1,
    nutrients: vector({ calories: 300 }),
    ...overrides,
  };
}

/** The target service, or one whose read always fails (the failure gate). */
function targetService(dataSource: DataSource): TargetService {
  return new TargetService(dataSource.getRepository(Target), new MealCache(null));
}

function failingTargets(): TargetService {
  return {
    getTarget: () => Promise.reject(new Error('target read failed')),
  } as unknown as TargetService;
}

/** An outbox whose write always fails — the producer's own step breaking. */
function failingOutbox(): OutboxService {
  return {
    enqueue: () => Promise.reject(new Error('outbox write failed')),
  } as unknown as OutboxService;
}

describe('Meal todo producer (e2e)', () => {
  let dataSource: DataSource;
  let producer: MealTodoProducerService;
  let entries: EntriesService;

  const outboxRows = () => dataSource.getRepository(Outbox).find();
  const payloads = async (destination: string) =>
    (await outboxRows())
      .filter((row) => row.destination === destination)
      .map((row) => JSON.parse(row.payload) as Record<string, unknown>);

  /** The entry service over the real DB, with the producer it was given. */
  const entryServiceWith = (todoProducer: MealTodoProducerService) =>
    new EntriesService(
      dataSource.getRepository(Entry),
      new EntriesCache(new MealCache(null)),
      new KeysService(dataSource.getRepository(UserKeys), Buffer.alloc(32, 0x2c)),
      todoProducer,
    );

  /** A target row, so a profile change can be simulated between two logs. */
  const addTarget = (validFrom: string, calories: number) =>
    dataSource.getRepository(Target).insert({
      ownerSub: SUB,
      validFrom,
      age: 30,
      sex: 'female',
      heightCm: 170,
      weightKg: 65,
      activity: 'moderate',
      goal: 'maintain',
      bmr: 1400,
      tdee: calories,
      calories,
      proteinG: 120,
      fatG: 70,
      carbG: 250,
    });

  /** The owner's consent row: its presence is what turns production on. */
  const grant = (ownerSub = SUB) =>
    dataSource.getRepository(MealTodoToggle).insert({
      ownerSub,
      enabledAt: new Date(),
      disclosure: DISCLOSURE,
      disclosureHash: createHash('sha256').update(DISCLOSURE).digest('hex'),
    });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: TEST_DB,
      entities: [Entry, Outbox, MealTodoToggle, Target, UserKeys],
      synchronize: true,
    });
    await dataSource.initialize();
    await addTarget('2026-01-01', CALORIES);
    producer = new MealTodoProducerService(
      new OutboxService(dataSource),
      targetService(dataSource),
    );
    entries = entryServiceWith(producer);
  });

  afterEach(async () => {
    await dataSource.getRepository(Outbox).clear();
    await dataSource.getRepository(MealTodoToggle).clear();
    await dataSource.getRepository(Entry).clear();
    // The base row is dated 2026-01-01; anything from DAY on is a test's change.
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(Target)
      .where('validFrom >= :day', { day: DAY })
      .execute();
  });

  afterAll(async () => {
    await dataSource.destroy();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('enqueues nothing at all while the owner has not granted the integration', async () => {
    await entries.create(SUB, body());
    await producer.ensureDailyTasks(SUB, DAY, dataSource.manager);

    expect(await outboxRows()).toHaveLength(0);
  });

  it('enqueues one create per meal group, titled from the day calorie target', async () => {
    await grant();

    await producer.ensureDailyTasks(SUB, DAY, dataSource.manager);

    const creates = await payloads('todos.create');
    expect(creates).toHaveLength(3);
    expect(creates.map((payload) => payload.originId).sort()).toEqual([
      'meal:breakfast',
      'meal:dinner',
      'meal:lunch',
    ]);
    for (const payload of creates) {
      expect(payload.repeat).toBe('daily');
      expect(payload.dueDate).toBe(DAY);
    }
    expect(creates.map((payload) => payload.title).sort()).toEqual([
      'Eat Breakfast to reach 2200 kcal',
      'Eat Dinner to reach 2200 kcal',
      'Eat Lunch to reach 2200 kcal',
    ]);
  });

  it('re-enqueues the same three creates on a second call instead of deduplicating', async () => {
    await grant();

    await producer.ensureDailyTasks(SUB, DAY, dataSource.manager);
    await producer.ensureDailyTasks(SUB, DAY, dataSource.manager);

    const creates = await payloads('todos.create');
    expect(creates).toHaveLength(6);
    const perOrigin = creates.reduce<Record<string, number>>((counts, payload) => {
      const id = String(payload.originId);
      counts[id] = (counts[id] ?? 0) + 1;
      return counts;
    }, {});
    expect(perOrigin).toEqual({
      'meal:breakfast': 2,
      'meal:lunch': 2,
      'meal:dinner': 2,
    });
  });

  it('ticks only the group whose entry was logged, pinned to the logged day', async () => {
    await grant();

    await entries.create(SUB, body({ mealGroup: 'breakfast' }));

    const ticks = await payloads('todos.complete');
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toEqual({ title: 'Eat Breakfast to reach 2200 kcal', occurrence: DAY });
    expect(await payloads('todos.create')).toHaveLength(0);
  });

  it('sends the same title on a second tick the same day', async () => {
    await grant();

    await entries.create(SUB, body({ mealGroup: 'breakfast' }));
    await entries.create(SUB, body({ mealGroup: 'breakfast' }));

    const ticks = await payloads('todos.complete');
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ title: 'Eat Breakfast to reach 2200 kcal', occurrence: DAY });
    expect(ticks[1]).toEqual({ title: 'Eat Breakfast to reach 2200 kcal', occurrence: DAY });
  });

  it('still logs the meal when the owner has no target profile, but enqueues no tick', async () => {
    await grant(NO_TARGET_SUB);

    const created = await entries.create(NO_TARGET_SUB, body({ mealGroup: 'breakfast' }));
    // The producer call is asserted directly as well as through the entry: only
    // that pins the guard, since the entry path has a guard of its own above it.
    await expect(
      producer.noteEntryLogged(NO_TARGET_SUB, 'breakfast', DAY, dataSource.manager),
    ).resolves.toBeUndefined();

    expect(created.id).toBeDefined();
    expect(await dataSource.getRepository(Entry).count()).toBe(1);
    expect(await payloads('todos.complete')).toHaveLength(0);
  });

  it('carries the new calorie number when the target changes between two logs', async () => {
    await grant();

    await entries.create(SUB, body({ mealGroup: 'breakfast' }));
    await addTarget(DAY, 2500);
    await entries.create(SUB, body({ mealGroup: 'breakfast' }));

    const ticks = await payloads('todos.complete');
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ title: 'Eat Breakfast to reach 2200 kcal', occurrence: DAY });
    expect(ticks[1]).toEqual({ title: 'Eat Breakfast to reach 2500 kcal', occurrence: DAY });
  });

  it('does not tick a snack, which has no daily task', async () => {
    await grant();

    await entries.create(SUB, body({ mealGroup: 'snack' }));

    expect(await outboxRows()).toHaveLength(0);
  });

  it('still returns the created entry when the producer cannot write its intent', async () => {
    await grant();
    const degraded = entryServiceWith(
      new MealTodoProducerService(failingOutbox(), targetService(dataSource)),
    );

    const created = await degraded.create(SUB, body());

    expect(created.id).toBeDefined();
    expect(created.mealGroup).toBe('breakfast');
    expect(await dataSource.getRepository(Entry).count()).toBe(1);
    expect(await outboxRows()).toHaveLength(0);
  });

  it('still returns the created entry when the producer throws before its own guard', async () => {
    const throwing = {
      ensureDailyTasks: async () => {},
      noteEntryLogged: () => {
        throw new Error('producer seam exploded');
      },
    } as unknown as MealTodoProducerService;
    const unguarded = entryServiceWith(throwing);

    const created = await unguarded.create(SUB, body());

    expect(created.id).toBeDefined();
    expect(await dataSource.getRepository(Entry).count()).toBe(1);
  });

  it('skips the daily creates when the target read fails, without throwing', async () => {
    await grant();
    const degraded = new MealTodoProducerService(new OutboxService(dataSource), failingTargets());

    await expect(degraded.ensureDailyTasks(SUB, DAY, dataSource.manager)).resolves.toBeUndefined();

    expect(await outboxRows()).toHaveLength(0);
  });
});
