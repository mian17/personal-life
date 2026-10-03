import { NUTRIENTS, format, type NutrientVector } from '@life/nutrition';
import { formatDate } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/meal-api', () => ({
  listDayEntries: jest.fn(),
  getMealTarget: jest.fn(),
}));

import { ApiError } from '@/lib/api-error';
import { listDayEntries, getMealTarget, type MealEntry, type MealTarget } from '@/lib/meal-api';
import { mealDay } from '@/app/(meals)/meals/page';
import MealDatePage from '@/app/(meals)/meals/[date]/page';

const mockedListDayEntries = listDayEntries as jest.MockedFunction<typeof listDayEntries>;
const mockedGetMealTarget = getMealTarget as jest.MockedFunction<typeof getMealTarget>;

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

  it('keeps all three doors reachable on an empty day', async () => {
    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('No meals logged today.');
    expect(html).toContain('href="/meals/entry/new?door=photo"');
    expect(html).toContain('href="/meals/entry/new"');
    expect(html).toContain('href="/meals/saved"');
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

  it('renders the [date] route through the same view for the route day', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));
    const el = await MealDatePage({ params: Promise.resolve({ date: '2026-10-02' }) });
    const html = renderToStaticMarkup(el);

    expect(mockedListDayEntries).toHaveBeenCalledWith('2026-10-02');
    expect(mockedGetMealTarget).toHaveBeenCalledWith('2026-10-02');
    expect(html).toContain(`Meals — ${formatDate('2026-10-02')}`);
    expect(html).toContain('href="/meals/entry/new?door=photo"');
    expect(html).toContain('No meals logged on this day.');
  });
});
