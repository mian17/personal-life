import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NUTRIENTS, format, type NutrientVector } from '@life/nutrition';
import { Button, EmptyState, List, ListItem, PageShell } from '@life/ui';
import { ApiError } from '@/lib/api-error';

const mockEstimatePhoto = jest.fn();

// The only meal-service read/write surface the re-log may touch: no photo/estimate
// path is exported here, so a re-log that reached for Gemini would fail loudly.
jest.mock('@/lib/meal-api', () => ({
  listSavedMeals: jest.fn(),
  getSavedMeal: jest.fn(),
  listMealFoods: jest.fn(),
  createMealEntry: jest.fn(),
  deleteSavedMeal: jest.fn(),
  estimatePhoto: mockEstimatePhoto,
  FOOD_ID_MAX: 64,
  restoredFoodName: jest.requireActual('@/lib/meal-api').restoredFoodName,
}));

jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

import {
  createMealEntry,
  deleteSavedMeal,
  getSavedMeal,
  listMealFoods,
  listSavedMeals,
  type MealFood,
  type SavedMeal,
} from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { notFound } from 'next/navigation';
import SavedMealPage from '@/app/(meals)/meals/saved/[id]/page';
import SavedMealsPage from '@/app/(meals)/meals/saved/page';
import { relogMealAction } from '@/app/(meals)/meals/actions';
import { deleteSavedMealAction } from '@/app/(meals)/meals/saved/actions';

const mockedListSavedMeals = listSavedMeals as jest.MockedFunction<typeof listSavedMeals>;
const mockedGetSavedMeal = getSavedMeal as jest.MockedFunction<typeof getSavedMeal>;
const mockedListMealFoods = listMealFoods as jest.MockedFunction<typeof listMealFoods>;
const mockedCreateMealEntry = createMealEntry as jest.MockedFunction<typeof createMealEntry>;
const mockedDeleteSavedMeal = deleteSavedMeal as jest.MockedFunction<typeof deleteSavedMeal>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;
const mockedNotFound = notFound as unknown as jest.Mock;

function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  return {
    ...(Object.fromEntries(NUTRIENTS.map((n) => [n.key, 0])) as NutrientVector),
    ...overrides,
  };
}

function savedMeal(overrides: Partial<SavedMeal> = {}): SavedMeal {
  return {
    id: 's1',
    name: 'Overnight oats',
    mealGroup: 'breakfast',
    items: [{ id: 'i1', foodId: 'oats', quantity: 1, nutrients: vector({ calories: 380 }) }],
    version: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
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

function isElement(node: unknown): node is ReactElement<Record<string, unknown>> {
  return node != null && typeof node === 'object' && 'type' in node && 'props' in node;
}

/** Depth-first search through every prop value (children included). */
function find(
  node: unknown,
  type: unknown,
  match?: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isElement(node)) return undefined;
  if ((type === undefined || node.type === type) && (!match || match(node))) return node;
  for (const value of Object.values(node.props)) {
    const hit = find(value, type, match);
    if (hit) return hit;
  }
  return undefined;
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isElement(node)) return text(node.props.children);
  return '';
}

describe('saved meals list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the empty state when the owner has saved nothing', async () => {
    mockedListSavedMeals.mockResolvedValue([]);

    const el = await SavedMealsPage();

    expect(el.type).toBe(PageShell);
    expect(find(el, EmptyState)).toBeDefined();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('No saved meals yet');
    expect(find(el, List)).toBeUndefined();
  });

  it('renders one row per saved meal linking to its detail route, summed from stored vectors', async () => {
    mockedListSavedMeals.mockResolvedValue([
      savedMeal({ id: 's1' }),
      savedMeal({
        id: 's2',
        name: 'Chicken salad',
        items: [
          { id: 'i2', foodId: 'chicken', quantity: 2, nutrients: vector({ calories: 200 }) },
          { id: 'i3', foodId: null, quantity: 1, nutrients: vector({ calories: 150 }) },
        ],
      }),
    ]);

    const el = await SavedMealsPage();
    const html = renderToStaticMarkup(el);

    expect(find(el, List)).toBeDefined();
    expect(find(el, EmptyState)).toBeUndefined();
    expect(html).toContain('href="/meals/saved/s1"');
    expect(html).toContain('href="/meals/saved/s2"');
    expect(html).toContain('Overnight oats');
    expect(html).toContain('Chicken salad');
    // 200 + 150, straight from the stored vectors.
    expect(html).toContain(format('calories', 350));
    expect(html).not.toContain('No saved meals yet');
  });

  it('leads with a back control to /meals and carries no nav actions', async () => {
    mockedListSavedMeals.mockResolvedValue([savedMeal()]);

    const el = await SavedMealsPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('href="/meals"');
    expect(html).not.toContain('aria-label="Daily target"');
    expect(html).not.toContain('aria-label="Settings"');
  });

  it('gives each row a delete control wired to the server action', async () => {
    mockedListSavedMeals.mockResolvedValue([
      savedMeal({ id: 's1', name: 'Overnight oats' }),
      savedMeal({ id: 's2', name: 'Chicken salad' }),
    ]);

    const el = await SavedMealsPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('aria-label="Delete Overnight oats"');
    expect(html).toContain('aria-label="Delete Chicken salad"');

    const deleteButton = find(
      el,
      Button,
      (b) => b.props['aria-label'] === 'Delete Overnight oats',
    );
    expect(deleteButton!.props.type).toBe('submit');

    // The wrapping form's action deletes THIS row's id, then refreshes the list.
    const form = find(
      el,
      'form',
      (f) => typeof f.props.action === 'function',
    );
    expect(form).toBeDefined();
    await (form!.props.action as () => Promise<void>)();
    expect(mockedDeleteSavedMeal).toHaveBeenCalledWith('s1');
  });
});

describe('one saved meal detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListMealFoods.mockResolvedValue([]);
  });

  it('renders the frozen items from the stored snapshot, never a re-derivation', async () => {
    mockedGetSavedMeal.mockResolvedValue(savedMeal());

    const el = await SavedMealPage({ params: Promise.resolve({ id: 's1' }) });
    const html = renderToStaticMarkup(el);

    expect(mockedGetSavedMeal).toHaveBeenCalledWith('s1');
    expect(html).toContain('Overnight oats');
    expect(html).toContain(format('calories', 380));
    expect(find(el, ListItem)).toBeDefined();
  });

  it('titles each item with the catalog food name, never the raw id', async () => {
    const uuid = '8bac894d-9a96-4102-8c49-ad9978ddfde4';
    mockedGetSavedMeal.mockResolvedValue(
      savedMeal({
        items: [{ id: 'i1', foodId: uuid, quantity: 1, nutrients: vector({ calories: 380 }) }],
      }),
    );
    mockedListMealFoods.mockResolvedValue([food({ id: uuid, name: 'Chicken' })]);

    const el = await SavedMealPage({ params: Promise.resolve({ id: 's1' }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Chicken');
    expect(html).not.toContain(uuid);
  });

  it('offers the one-tap re-log as a server-action form around a primitive Button', async () => {
    mockedGetSavedMeal.mockResolvedValue(savedMeal());

    const el = await SavedMealPage({ params: Promise.resolve({ id: 's1' }) });

    const control = find(el, Button, (b) => text(b.props.children).includes('Log this meal again'));
    expect(control).toBeDefined();
    expect(control!.props.type).toBe('submit');

    const form = find(el, 'form');
    expect(form).toBeDefined();
    // The form's action is the re-log bound to THIS saved meal's id.
    const bound = form!.props.action as { name?: string };
    expect(typeof bound).toBe('function');
    expect(await (bound as () => Promise<void>)()).toBeUndefined();
    expect(mockedCreateMealEntry).toHaveBeenCalledTimes(1);
    expect(mockedCreateMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ foodId: 'oats', nutrients: vector({ calories: 380 }) }),
    );
  });

  it('defers a missing meal to notFound (a foreign id reads exactly like a missing one)', async () => {
    const missing = new ApiError(404, 'API 404 on /api/saved-meals/x');
    mockedGetSavedMeal.mockRejectedValue(missing);

    await expect(SavedMealPage({ params: Promise.resolve({ id: 'x' }) })).rejects.toBe(missing);
    expect(mockedNotFound).toHaveBeenCalled();
  });

  it('leads with a back control to the saved list, and no nav actions', async () => {
    mockedGetSavedMeal.mockResolvedValue(savedMeal());

    const el = await SavedMealPage({ params: Promise.resolve({ id: 's1' }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('href="/meals/saved"');
    expect(html).not.toContain('aria-label="Daily target"');
    expect(html).not.toContain('aria-label="Settings"');
  });
});

describe('delete saved meal action', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the meal, then refreshes the saved list', async () => {
    mockedDeleteSavedMeal.mockResolvedValue(undefined);

    await deleteSavedMealAction('s1');

    expect(mockedDeleteSavedMeal).toHaveBeenCalledWith('s1');
  });
});

describe('one-tap re-log', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts every frozen item as an entry for the shared today, then lands on that day', async () => {
    mockedGetToday.mockResolvedValue('2026-10-03');
    mockedGetSavedMeal.mockResolvedValue(
      savedMeal({
        mealGroup: 'snack',
        items: [
          { id: 'i1', foodId: 'oats', quantity: 1, nutrients: vector({ calories: 380 }) },
          { id: 'i2', foodId: null, quantity: 2, nutrients: vector({ calories: 250 }) },
        ],
      }),
    );

    await relogMealAction('s1');

    expect(mockedGetToday).toHaveBeenCalled();
    expect(mockedGetSavedMeal).toHaveBeenCalledWith('s1');
    expect(mockedCreateMealEntry).toHaveBeenCalledTimes(2);
    expect(mockedCreateMealEntry).toHaveBeenNthCalledWith(1, {
      date: '2026-10-03',
      mealGroup: 'snack',
      foodId: 'oats',
      quantity: 1,
      nutrients: vector({ calories: 380 }),
    });
    // An item saved without a catalog food falls back to the meal's name.
    expect(mockedCreateMealEntry).toHaveBeenNthCalledWith(2, {
      date: '2026-10-03',
      mealGroup: 'snack',
      foodId: 'Overnight oats',
      quantity: 2,
      nutrients: vector({ calories: 250 }),
    });

    // Not one call to the estimate/photo path: a re-log is the frozen numbers.
    expect(mockEstimatePhoto).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/meals/2026-10-03');
  });

  it('bounds the fallback foodId so a long saved name cannot 400 the write', async () => {
    mockedGetToday.mockResolvedValue('2026-10-03');
    mockedGetSavedMeal.mockResolvedValue(
      savedMeal({ name: 'x'.repeat(120), items: [{ id: 'i1', foodId: null, quantity: 1, nutrients: vector() }] }),
    );

    await relogMealAction('s1');

    expect(mockedCreateMealEntry.mock.calls[0][0].foodId).toHaveLength(64);
  });
});
