import { NUTRIENTS, format, type NutrientVector } from '@life/nutrition';
import { formatDate, PageShell } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/meal-api', () => ({
  listDayEntries: jest.fn(),
  getMealTarget: jest.fn(),
  listMealFoods: jest.fn(),
  listMealFoodsIncludingDeleted: jest.fn(),
  restoredFoodName: jest.fn(),
}));
jest.mock('@/lib/today', () => ({
  getToday: jest.fn(),
}));

import { ApiError } from '@/lib/api-error';
import {
  listDayEntries,
  getMealTarget,
  listMealFoods,
  listMealFoodsIncludingDeleted,
  restoredFoodName,
  type MealEntry,
} from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import MealsPage from '@/app/(meals)/meals/page';

const mockedListDayEntries = listDayEntries as jest.MockedFunction<typeof listDayEntries>;
const mockedGetMealTarget = getMealTarget as jest.MockedFunction<typeof getMealTarget>;
const mockedListMealFoods = listMealFoods as jest.MockedFunction<typeof listMealFoods>;
const mockedIncludeDeleted = listMealFoodsIncludingDeleted as jest.MockedFunction<
  typeof listMealFoodsIncludingDeleted
>;
const mockedRestoredFoodName = restoredFoodName as jest.MockedFunction<typeof restoredFoodName>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

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

describe('/meals day route wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetToday.mockResolvedValue('2026-10-03');
    mockedListDayEntries.mockResolvedValue([]);
    mockedListMealFoods.mockResolvedValue([]);
    mockedIncludeDeleted.mockResolvedValue([]);
    mockedRestoredFoodName.mockImplementation((foodId: string) => foodId);
    mockedGetMealTarget.mockRejectedValue(new ApiError(404, 'API 404 on /api/target'));
  });

  it("reads the day from the shared owner and sends THAT day to the BFF (lesson 0016)", async () => {
    await MealsPage();

    expect(mockedGetToday).toHaveBeenCalled();
    expect(mockedListDayEntries).toHaveBeenCalledWith('2026-10-03');
  });

  it('renders the mocked day, proving it consumes getToday rather than re-deriving', async () => {
    const el = await MealsPage();

    const html = renderToStaticMarkup(el);
    expect(html).toContain(`Meals — ${formatDate('2026-10-03')}`);
  });

  it('renders PageShell and the empty state when the day has no entries', async () => {
    const el = await MealsPage();

    expect(el.type).toBe(PageShell);
    const html = renderToStaticMarkup(el);
    expect(html).toContain('No meals logged today.');
  });

  it('renders the day total as the sum of confirmed entries via @life/nutrition', async () => {
    mockedListDayEntries.mockResolvedValue([
      entry({ id: 'a', nutrients: vector({ calories: 420 }) }),
      entry({ id: 'b', nutrients: vector({ calories: 180 }) }),
    ]);

    const el = await MealsPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain(format('calories', 600));
    expect(html).not.toContain('No meals logged today.');
  });
});
