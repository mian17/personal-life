import { NUTRIENTS, format, type NutrientVector } from '@life/nutrition';
import { formatDate } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/meal-api', () => ({
  listDayEntries: jest.fn(),
  getMealTarget: jest.fn(),
  listMealFoods: jest.fn(),
  listMealFoodsIncludingDeleted: jest.fn(),
  restoredFoodName: jest.requireActual('@/lib/meal-api').restoredFoodName,
}));

import { ApiError } from '@/lib/api-error';
import {
  listDayEntries,
  getMealTarget,
  listMealFoods,
  listMealFoodsIncludingDeleted,
  type MealEntry,
  type MealFood,
  type MealTarget,
} from '@/lib/meal-api';
import { mealDay } from '@/app/(meals)/meals/day';
import MealDatePage from '@/app/(meals)/meals/[date]/page';

const mockedListDayEntries = listDayEntries as jest.MockedFunction<typeof listDayEntries>;
const mockedGetMealTarget = getMealTarget as jest.MockedFunction<typeof getMealTarget>;
const mockedListMealFoods = listMealFoods as jest.MockedFunction<typeof listMealFoods>;
const mockedListMealFoodsIncludingDeleted = listMealFoodsIncludingDeleted as jest.MockedFunction<
  typeof listMealFoodsIncludingDeleted
>;

function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  return { ...(Object.fromEntries(NUTRIENTS.map((n) => [n.key, 0])) as NutrientVector), ...overrides };
}

function entry(overrides: Partial<MealEntry> = {}): MealEntry {
  return {
    id: 'e1',
    date: '2026-10-03',
    mealGroup: 'lunch',
    foodId: 'f1',
    quantity: 1,
    nutrients: vector({ calories: 420 }),
    version: 0,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

function food(overrides: Partial<MealFood> = {}): MealFood {
  return {
    id: 'food-1',
    name: 'Food',
    unit: 'g',
    servingGrams: 100,
    nutrients: vector(),
    servings: [],
    version: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function target(overrides: Partial<MealTarget> = {}): MealTarget {
  return {
    id: 't1',
    validFrom: '2026-10-01',
    age: 30,
    sex: 'male',
    heightCm: 175,
    weightKg: 70,
    activity: 'moderate',
    goal: 'maintain',
    bmr: 1600,
    tdee: 2400,
    calories: 2400,
    proteinG: 150,
    fatG: 70,
    carbG: 300,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('meals day view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListDayEntries.mockResolvedValue([]);
    mockedGetMealTarget.mockRejectedValue(new ApiError(404, 'API 404 on /api/target'));
    mockedListMealFoods.mockResolvedValue([]);
    mockedListMealFoodsIncludingDeleted.mockResolvedValue([]);
  });

  it('renders the day total as the sum of confirmed entries, against the target', async () => {
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', nutrients: vector({ calories: 420 }) }),
      entry({ id: 'b', nutrients: vector({ calories: 180 }) }),
    ]);
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain(
      `${format('calories', 600)} / ${format('calories', 2000)}, ${format('calories', 1400)} left`,
    );
    expect(html).not.toContain('No meals logged today.');
  });

  it('says "No target set" when the owner has no profile yet (target 404 is not an error)', async () => {
    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain(`${format('calories', 0)} — No target set`);
  });

  it('links to the target page with "Set target" when no target is set', async () => {
    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('href="/meals/target"');
    expect(html).toContain('Set target');
    expect(html).not.toContain('Edit target');
  });

  it('links to the target page with "Edit target" when a target is set', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('href="/meals/target"');
    expect(html).toContain('Edit target');
    expect(html).not.toContain('Set target');
  });

  it('keeps the log doors behind the FAB on an empty day, with no redundant body doors', async () => {
    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('No meals logged today.');
    // The two doors live in the FAB menu's panel: the trigger ships, the closed
    // panel ships no hrefs (the open-panel options are covered by
    // test/meal-log.test.tsx and the e2e journey).
    expect(html).toContain('aria-label="Log a meal"');
    expect(html).toContain('aria-haspopup="menu"');
    // Manual entry is the photo door's own fallback, never a second body door.
    expect(html).not.toContain('Log manually');
    expect(html).not.toContain('href="/meals/entry/new"');
    // Saved meals is a toolbar icon only — no body button (the `ui-icon-link`
    // markup proves it; a body door would render a `ui-btn` anchor).
    expect(html).not.toContain('>Saved meals</a>');
  });

  it('groups entries under their meal with a subtotal, in Breakfast/Lunch/Dinner/Snacks order', async () => {
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 's1', mealGroup: 'snack', nutrients: vector({ calories: 100 }) }),
      entry({ id: 'b1', mealGroup: 'breakfast', nutrients: vector({ calories: 300 }) }),
      entry({ id: 'l1', mealGroup: 'lunch', nutrients: vector({ calories: 500 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    for (const [label, kcal] of [
      ['Breakfast', 300],
      ['Lunch', 500],
      ['Snacks', 100],
    ] as const) {
      expect(html).toContain(`${label} — ${format('calories', kcal)}`);
    }
    expect(html).not.toContain('Dinner');
    const order = ['Breakfast', 'Lunch', 'Snacks'].map((label) => html.indexOf(label));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('titles a pre-feature entry (no catalog match) with its stored value, and keeps calories + quantity in meta', async () => {
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: 'Toast', quantity: 2, nutrients: vector({ calories: 123 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('Toast');
    expect(html).toMatch(
      /ui-list-item__title[^"]*">Toast<\/span><span class="ui-list-item__sub[^"]*">123 kcal × 2</,
    );
  });

  it('titles a catalog entry with the resolved food name, never the raw id', async () => {
    const uuid = '8bac894d-9a96-4102-8c49-ad9978ddfde4';
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: uuid, quantity: 2, nutrients: vector({ calories: 123 }) }),
    ]);
    mockedListMealFoodsIncludingDeleted.mockResolvedValue([food({ id: uuid, name: 'Chicken' })]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(
      /ui-list-item__title[^"]*">Chicken<\/span><span class="ui-list-item__sub[^"]*">123 kcal × 2</,
    );
    expect(html).not.toContain(uuid);
  });

  it('resolves the day view through the include-deleted read (a deleted food still names the entry)', async () => {
    const uuid = '8bac894d-9a96-4102-8c49-ad9978ddfde4';
    const deletedUuid = '4c2a0000-1111-2222-3333-444455556666';
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: uuid, quantity: 2, nutrients: vector({ calories: 123 }) }),
      entry({ id: 'b', foodId: deletedUuid, quantity: 1, nutrients: vector({ calories: 200 }) }),
    ]);
    mockedListMealFoodsIncludingDeleted.mockResolvedValue([
      food({ id: uuid, name: 'Chicken' }),
      food({ id: deletedUuid, name: 'Milk, Brand X' }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(mockedListMealFoodsIncludingDeleted).toHaveBeenCalledTimes(1);
    expect(mockedListMealFoods).not.toHaveBeenCalled();
    expect(html).toContain('Chicken');
    expect(html).toContain('Milk, Brand X');
    expect(html).not.toContain(deletedUuid);
  });

  it('falls back to calories as the title when a dish is blank', async () => {
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: '   ', nutrients: vector({ calories: 123 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(
      /ui-list-item__title[^"]*">123 kcal<\/span><span class="ui-list-item__sub[^"]*">× 1</,
    );
  });

  it('renders the [date] route through the same view for the route day', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));
    const el = await MealDatePage({ params: Promise.resolve({ date: '2026-10-02' }) });
    const html = renderToStaticMarkup(el);

    expect(mockedListDayEntries).toHaveBeenCalledWith('2026-10-02');
    expect(mockedGetMealTarget).toHaveBeenCalledWith('2026-10-02');
    expect(html).toContain(`Meals — ${formatDate('2026-10-02')}`);
    expect(html).toContain('aria-label="Log a meal"');
    expect(html).toContain('No meals logged on this day.');
  });
});
