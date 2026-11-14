import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Outbox } from '@life/service-kit';
import { MealTodoProducerService } from '../src/meal-todo/meal-todo-producer.service.js';
import { MealTodoToggle } from '../src/meal-todo/meal-toggle.entity.js';
import { TODOS_RENAME, TODOS_RENAME_PRODUCER } from '../src/meal-todo/todo-intents.js';
import type { UpdateProfileDto } from '../src/targets/dto/update-profile.dto.js';
import { Target } from '../src/targets/target.entity.js';
import { TargetService } from '../src/targets/target.service.js';

/**
 * The target → rename wiring, asserted through the **real Nest module graph**:
 * `AppModule` is compiled as `main.ts` compiles it, and `TargetService` is
 * resolved from it rather than hand-constructed.
 *
 * That is the point of the suite. The producer suite built
 * `new TargetService(repo, cache, producer)` with the producer passed positionally,
 * which stays green whether or not `TODOS_RENAME_PRODUCER` is provided anywhere — it
 * was green over a live run that saved a target and enqueued zero renames. A test
 * that resolves the service from the module can only see a producer the graph
 * actually hands it, so dropping the provider fails these cases.
 *
 * Hermetic: one throwaway SQLite file, no Redis (`REDIS_URL` unset, direct-DB
 * cache), no network (`MEAL_TODOS_API_URL` unset, so the poller leaves rows pending
 * and the relay never sends).
 */

const TEST_DIR = mkdtempSync(join(tmpdir(), 'meal-rename-wiring-'));
const SUB = 'user-a';
const DAY = '2026-09-03';
const DISCLOSURE = 'Meal logging will create and tick three daily todos.';

function profile(overrides: Record<string, unknown> = {}): UpdateProfileDto {
  return {
    age: 30,
    sex: 'female',
    heightCm: 170,
    weightKg: 65,
    activity: 'moderate',
    goal: 'maintain',
    date: DAY,
    ...overrides,
  } as UpdateProfileDto;
}

describe('Target rename wiring (real module graph)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  const originalEnv = process.env;

  const renames = async () =>
    (await dataSource.getRepository(Outbox).findBy({ destination: TODOS_RENAME })).map(
      (row) => JSON.parse(row.payload) as { title: string; originId: string },
    );

  const enable = () =>
    dataSource.getRepository(MealTodoToggle).insert({
      ownerSub: SUB,
      enabledAt: new Date(),
      disclosure: DISCLOSURE,
      disclosureHash: 'test-disclosure-hash',
    });

  /** A second graph over the same DB, with the producer replaced or blanked. */
  const withProducer = async (value: unknown) => {
    const { AppModule } = await import('../src/app.module.js');
    return Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TODOS_RENAME_PRODUCER)
      .useValue(value as object)
      .compile();
  };

  beforeAll(async () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.MEAL_TODOS_API_URL;
    process.env.DB_PATH = join(TEST_DIR, 'rename-wiring.db');

    const { AppModule } = await import('../src/app.module.js');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterEach(async () => {
    await dataSource.getRepository(Outbox).clear();
    await dataSource.getRepository(MealTodoToggle).clear();
    await dataSource.getRepository(Target).clear();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef.close();
    process.env = originalEnv;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('resolves the token to the single producer instance the module provides', () => {
    expect(moduleRef.get(TODOS_RENAME_PRODUCER, { strict: false })).toBe(
      moduleRef.get(MealTodoProducerService),
    );
  });

  it('enqueues three renames carrying the new number when a target is saved', async () => {
    await enable();

    const saved = await moduleRef.get(TargetService).updateProfile(SUB, profile({ weightKg: 90 }));

    const rows = await renames();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.originId).sort()).toEqual([
      'meal:breakfast',
      'meal:dinner',
      'meal:lunch',
    ]);
    expect(rows.map((row) => row.title).sort()).toEqual([
      `Eat Breakfast to reach ${saved.calories} kcal`,
      `Eat Dinner to reach ${saved.calories} kcal`,
      `Eat Lunch to reach ${saved.calories} kcal`,
    ]);
  });

  it('enqueues no rename while the integration is off, and still saves the target', async () => {
    const saved = await moduleRef.get(TargetService).updateProfile(SUB, profile({ weightKg: 90 }));

    expect(saved.weightKg).toBe(90);
    expect(await renames()).toEqual([]);
  });

  it('still saves the target when the producer throws, and warns with its message', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const degraded = await withProducer({
      refreshTitles: () => {
        throw new Error('producer seam exploded');
      },
    });
    try {
      const saved = await degraded.get(TargetService).updateProfile(SUB, profile({ weightKg: 90 }));

      expect(saved.weightKg).toBe(90);
      expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
        'producer seam exploded',
      );
    } finally {
      await degraded.close();
    }
  });

  it('warns by token name and still saves when no provider is handed over', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const unprovided = await withProducer(undefined);
    try {
      const saved = await unprovided
        .get(TargetService)
        .updateProfile(SUB, profile({ weightKg: 90 }));

      expect(saved.weightKg).toBe(90);
      expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
        'TODOS_RENAME_PRODUCER',
      );
    } finally {
      await unprovided.close();
    }
  });
});
