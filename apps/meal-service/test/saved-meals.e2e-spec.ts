import { rmSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { NUTRIENTS, type Nutrient } from '@life/nutrition';
import { SavedMealsService } from '../src/saved-meals/saved-meals.service.js';
import { KeysService, MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * The frozen-snapshot contract for saved meals (`docs/intent/meal-nutrition.md`:
 * "Saved meal = frozen snapshot of corrected values"; `SPEC-meal-service`).
 *
 * A saved meal is a COPY: the service seals the client's corrected values into
 * item rows and never re-derives a nutrient on read. This suite proves the
 * history property directly — a saved meal is byte-identical across reads, its
 * snapshot survives deleting the food it came from, and no Gemini client is
 * ever consulted (re-log is pure BFF composition of frozen numbers).
 *
 * Exercised through `SavedMealsService` (behavior proof, not transport).
 */

const TEST_DB = join(__dirname, 'test-saved-meals.db');
const SUB = 'user-a';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const vector = (calories: number): Record<Nutrient, number> => {
  const out = {} as Record<Nutrient, number>;
  for (const { key } of NUTRIENTS) out[key] = 0;
  out.calories = calories;
  return out;
};

describe('Saved meals — frozen snapshots', () => {
  let app: INestApplication;
  let service: SavedMealsService;
  let keys: KeysService;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    process.env.DB_PATH = TEST_DB;
    process.env.MEAL_MASTER_KEY ??= Buffer.alloc(32, 0x2c).toString('base64');

    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    service = app.get(SavedMealsService);
    keys = app.get(KeysService);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
  });

  it('freezes the corrected values at save time', async () => {
    const created = await service.create(SUB, {
      name: 'Rice bowl',
      mealGroup: 'dinner',
      items: [{ foodId: 'food-x', quantity: 1.5, nutrients: vector(640) }],
    });

    expect(created.items).toHaveLength(1);
    expect(created.items[0].nutrients.calories).toBe(640);
    expect(created.items[0].quantity).toBe(1.5);
    expect(created.name).toBe('Rice bowl');
    expect(created).not.toHaveProperty('ownerSub');
  });

  it('a saved meal is a copy — its snapshot survives deleting the food it came from', async () => {
    const created = await service.create(SUB, {
      name: 'Copy survives',
      mealGroup: 'dinner',
      items: [{ foodId: 'food-to-delete', quantity: 1, nutrients: vector(500) }],
    });

    // foodId is metadata with no relation; the item carries its own sealed copy,
    // so nothing about the source food can rewrite the saved meal.
    const after = await service.findOne(SUB, created.id);
    expect(after.items[0].nutrients.calories).toBe(500);
    expect(after.items[0].foodId).toBe('food-to-delete');
  });

  it('returns the same snapshot on every read (no re-derivation, no clock)', async () => {
    const created = await service.create(SUB, {
      name: 'Stable',
      mealGroup: 'lunch',
      items: [{ quantity: 1, nutrients: vector(300) }],
    });

    const first = await service.findOne(SUB, created.id);
    const second = await service.findOne(SUB, created.id);
    expect(second).toEqual(first);
  });

  it('seals item vectors as ciphertext; the DTO is the only decrypted view', async () => {
    const created = await service.create(SUB, {
      name: 'Sealed',
      mealGroup: 'breakfast',
      items: [{ quantity: 1, nutrients: vector(210) }],
    });

    const dek = await keys.getDekForRead(SUB);
    expect(dek).toBeInstanceOf(Buffer);
    expect(JSON.stringify(created)).not.toContain('enc.v1.');
    expect(created.items[0].nutrients.calories).toBe(210);
  });

  it('scopes every read to the owner (foreign id is a 404, indistinguishable from missing)', async () => {
    const created = await service.create(SUB, {
      name: 'Owned',
      mealGroup: 'dinner',
      items: [{ quantity: 1, nutrients: vector(400) }],
    });

    await expect(service.findOne('user-b', created.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.findOne('user-b', MISSING_ID)).rejects.toMatchObject({ status: 404 });
  });

  it('pages the list with no gap and no duplicate across the boundary', async () => {
    const created: string[] = [];
    for (const name of ['Page one', 'Page two', 'Page three']) {
      const meal = await service.create(SUB, {
        name,
        mealGroup: 'lunch',
        items: [{ quantity: 1, nutrients: vector(100) }],
      });
      created.push(meal.id);
    }

    // Every row this owner holds (earlier cases in this file left some), walked
    // two at a time. The whole-set read is the reference the pages must match.
    const whole = await service.findAll(SUB, { limit: MAX_PAGE_LIMIT });
    expect(whole.nextCursor).toBeNull();

    const walked: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.findAll(SUB, { limit: 2, cursor });
      expect(page.savedMeals.length).toBeGreaterThan(0);
      expect(page.savedMeals.length).toBeLessThanOrEqual(2);
      walked.push(...page.savedMeals.map((meal) => meal.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    // The walked order is the whole set's order: no gap, no duplicate.
    expect(walked).toEqual(whole.savedMeals.map((meal) => meal.id));
    expect(new Set(walked).size).toBe(walked.length);
    for (const id of created) expect(walked).toContain(id);
  });

  it('rejects a partial nutrient vector rather than sealing a wrong snapshot', async () => {
    await expect(
      service.create(SUB, {
        name: 'Partial',
        mealGroup: 'dinner',
        items: [{ quantity: 1, nutrients: { calories: 100 } as Record<Nutrient, number> }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
