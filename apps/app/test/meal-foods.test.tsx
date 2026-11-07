import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NUTRIENTS, format, sum, type NutrientVector } from '@life/nutrition';
import { Button, ConfirmButton, IconButton, Input, ManagerBlock, Row, Select, SettingsRow, StatusText } from '@life/ui';
import { ApiError } from '@/lib/api-error';

// The whole meal-service surface this test may touch. No photo/estimate export:
// a catalog form that reached for a model would fail loudly, not silently pass.
jest.mock('@/lib/meal-api', () => ({
  collectMealFoods: jest.fn(),
  getMealFood: jest.fn(),
  listDayEntries: jest.fn(),
  createMealFood: jest.fn(),
  updateMealFood: jest.fn(),
  deleteMealFood: jest.fn(),
  FOOD_NAME_MAX: 120,
  SERVING_LABEL_MAX: 60,
  PORTIONS_MAX: 20,
  AMOUNT_MAX: 5000,
  restoredFoodName: jest.requireActual('@/lib/meal-api').restoredFoodName,
}));

jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: mockBack, refresh: jest.fn() }),
  notFound: jest.fn(),
  redirect: jest.fn(),
}));

import {
  AMOUNT_MAX,
  FOOD_NAME_MAX,
  PORTIONS_MAX,
  createMealFood,
  deleteMealFood,
  getMealFood,
  collectDayEntries,
  collectMealFoods,
  updateMealFood,
  type MealEntry,
  type MealFood,
} from '@/lib/meal-api';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import FoodsPage from '@/app/(meals)/meals/foods/page';
import NewFoodPage from '@/app/(meals)/meals/foods/new/page';
import EditFoodPage from '@/app/(meals)/meals/foods/[id]/page';
import { FoodForm, type FoodFormBounds } from '@/app/(meals)/meals/foods/food-form';
import { FOOD_NUTRITION } from '@/app/(meals)/meals/foods/fields';
import { createFoodAction, deleteFoodAction, updateFoodAction } from '@/app/(meals)/meals/actions';

const mockedCollectMealFoods = collectMealFoods as jest.MockedFunction<typeof collectMealFoods>;
const mockedGetMealFood = getMealFood as jest.MockedFunction<typeof getMealFood>;
const mockedCreateMealFood = createMealFood as jest.MockedFunction<typeof createMealFood>;
const mockedUpdateMealFood = updateMealFood as jest.MockedFunction<typeof updateMealFood>;
const mockedDeleteMealFood = deleteMealFood as jest.MockedFunction<typeof deleteMealFood>;

// `FoodForm` reads its hooks off the raw `react` module exports at call time, so
// spying there intercepts a direct call (outside React; `testEnvironment: node`).
const ReactModule = jest.requireActual<typeof import('react')>('react');

function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  return {
    ...(Object.fromEntries(NUTRIENTS.map((n) => [n.key, 0])) as NutrientVector),
    ...overrides,
  };
}

function food(overrides: Partial<MealFood> = {}): MealFood {
  return {
    id: 'food-1',
    name: 'Milk, Brand X',
    unit: 'ml',
    servingGrams: 100,
    nutrients: vector({ calories: 52 }),
    servings: [],
    version: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function loadFoodsPage(query?: string) {
  return FoodsPage({ searchParams: Promise.resolve({ q: query }) });
}

/** Bounds mirror `meal-api`'s env-tunable limits so the form's arithmetic is exercised against real numbers. */
const bounds: FoodFormBounds = {
  nameMax: FOOD_NAME_MAX,
  labelMax: 60,
  portionsMax: PORTIONS_MAX,
  amountMax: AMOUNT_MAX,
};

describe('foods catalog page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists each owner food with its per-100 facts under a Foods heading', async () => {
    mockedCollectMealFoods.mockResolvedValue([
      food(),
      food({ id: 'food-2', name: 'Oats', unit: 'g', nutrients: vector({ calories: 389 }) }),
    ]);

    const el = await loadFoodsPage();
    const html = renderToStaticMarkup(el);

    expect(el.type).toBe(ManagerBlock);
    expect(html).toContain('Foods');
    expect(html).toContain('href="/meals/settings"');
    expect(html).toContain('Milk, Brand X');
    expect(html).toContain(`per 100 ml · ${format('calories', 52)}`);
    expect(html).toContain('Oats');
    expect(html).toContain(`per 100 g · ${format('calories', 389)}`);
    expect(html).toContain('aria-label="Search foods"');
  });

  it('forwards the search query to the service instead of filtering rows here', async () => {
    mockedCollectMealFoods.mockResolvedValue([food()]);

    await loadFoodsPage('milk');

    expect(mockedCollectMealFoods).toHaveBeenCalledWith('milk');
  });

  it('invites the first food when the catalog is empty', async () => {
    mockedCollectMealFoods.mockResolvedValue([]);

    const el = await loadFoodsPage();
    const html = renderToStaticMarkup(el);

    expect(el.type).toBe(ManagerBlock);
    expect(html).toContain('No foods yet.');
    expect(html).not.toContain('aria-label="Delete');
  });

  it('reports an empty result as a miss, not an empty catalog', async () => {
    mockedCollectMealFoods.mockResolvedValue([]);

    const el = await loadFoodsPage('zzz');
    const html = renderToStaticMarkup(el);

    expect(html).toContain('No matches.');
    expect(html).not.toContain('No foods yet.');
  });

  it('opens the catalog body on the shared section rhythm, rows and empty states alike', async () => {
    mockedCollectMealFoods.mockResolvedValue([food()]);
    const listHtml = renderToStaticMarkup(await loadFoodsPage());

    mockedCollectMealFoods.mockResolvedValue([]);
    const missHtml = renderToStaticMarkup(await loadFoodsPage('zzz'));
    const emptyHtml = renderToStaticMarkup(await loadFoodsPage());

    // The whole body — a list of rows or either empty state — sits inside the one
    // unlabelled `Section`, which is what supplies the gap below the search box.
    for (const [html, body] of [
      [listHtml, 'Milk, Brand X'],
      [missHtml, 'No matches.'],
      [emptyHtml, 'No foods yet.'],
    ] as const) {
      const open = html.indexOf('ui-section');
      expect(open).toBeGreaterThan(-1);
      expect(html.indexOf(body)).toBeGreaterThan(open);
      expect(html.lastIndexOf('</section>')).toBeGreaterThan(html.indexOf(body));
      expect(html.indexOf('aria-label="New food"')).toBeGreaterThan(html.indexOf(body));
    }
  });

  it('reaches create and edit through the catalog (AC1 create affordance, AC4 edit rows)', async () => {
    mockedCollectMealFoods.mockResolvedValue([
      food(),
      food({ id: 'food-2', name: 'Oats', unit: 'g', nutrients: vector({ calories: 389 }) }),
    ]);

    const html = renderToStaticMarkup(await loadFoodsPage());

    // The FAB opens the create form; each row links to its edit form.
    expect(html).toContain('href="/meals/foods/new"');
    expect(html).toContain('aria-label="New food"');
    expect(html).toContain('href="/meals/foods/food-1"');
    expect(html).toContain('href="/meals/foods/food-2"');
  });
});

/** Is `node` a rendered React element? */
function isElement(node: unknown): node is ReactElement<Record<string, unknown>> {
  return (
    node != null &&
    typeof node === 'object' &&
    'type' in node &&
    'props' in node &&
    (node as { type?: unknown }).type !== undefined
  );
}

/** Depth-first search through every prop value (children, actions, banner, …). */
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

/** Depth-first collect of every element of a type. */
function findAll(node: unknown, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isElement(node)) return [];
  const rest = Object.values(node.props).flatMap((value) => findAll(value, type));
  return node.type === type ? [node, ...rest] : rest;
}

/** Concatenate every string in a rendered node subtree. */
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isElement(node)) return text(node.props.children);
  return '';
}

function field(tree: unknown, label: string): ReactElement<Record<string, unknown>> {
  const found = find(tree, Input, (el) => el.props['aria-label'] === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return found;
}

function control(
  tree: unknown,
  match: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  const found = find(tree, IconButton, match) ?? find(tree, Button, match);
  if (!found) throw new Error('control not found');
  return found;
}

/**
 * Direct-call harness for `FoodForm`. State is position-keyed and persists across
 * `renderTree` calls so a handler's `setState` is visible on the next render;
 * `next/navigation`'s `useRouter` is mocked above. (`apps/app` runs node-env, so
 * handlers are observed through the element tree, not a DOM.)
 */
function formHarness() {
  const store: unknown[] = [];
  const spy = jest.spyOn(ReactModule, 'useState');

  function renderTree(food: MealFood | null): ReactElement<Record<string, unknown>> {
    let index = 0;
    spy.mockImplementation(((initial: unknown) => {
      const i = index++;
      if (i >= store.length) {
        store[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const set = (next: unknown) => {
        store[i] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(store[i]) : next;
      };
      return [store[i], set];
    }) as unknown as typeof ReactModule.useState);
    return FoodForm({ food, nutrition: FOOD_NUTRITION, bounds }) as unknown as ReactElement<
      Record<string, unknown>
    >;
  }

  return { renderTree, restore: () => spy.mockRestore() };
}

describe('food form fields', () => {
  it('derives every one of the 27 facts exactly once, grouped for display', () => {
    const keys = FOOD_NUTRITION.groups.flatMap((group) => group.fields.map((f) => f.key));

    expect(keys).toHaveLength(NUTRIENTS.length);
    expect(new Set(keys).size).toBe(NUTRIENTS.length);
  });
});

describe('new food page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders 27 facts pre-filled with the stored "no value" zero and a one-time unit choice', async () => {
    const html = renderToStaticMarkup(await NewFoodPage());

    expect(html).toContain('New food');
    expect(html).toContain('aria-label="Unit"');
    expect((html.match(/per 100"/g) ?? [])).toHaveLength(NUTRIENTS.length);
    expect((html.match(/value="0"/g) ?? [])).toHaveLength(NUTRIENTS.length);
    expect(html).toContain('Add measure');
    expect(html).not.toContain('Delete food');
  });
});

describe('edit food page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens pre-filled, renders the unit read-only, and offers the soft delete', async () => {
    mockedGetMealFood.mockResolvedValue(
      food({ servings: [{ id: 's1', label: '1 carton', amount: 1000, nutrients: vector() }] }),
    );

    const html = renderToStaticMarkup(
      await EditFoodPage({ params: Promise.resolve({ id: 'food-1' }) }),
    );

    expect(mockedGetMealFood).toHaveBeenCalledWith('food-1');
    expect(html).toContain('Edit food');
    expect(html).not.toContain('aria-label="Unit"');
    expect(html).toContain('>ml<');
    expect(html).toContain('value="52"');
    expect(html).toContain('value="1 carton"');
    expect(html).toContain('value="1000"');
    expect(html).toContain('Delete food');
    expect(html).toContain('ui-btn--danger ui-btn--bare');
    expect(html).toContain('ui-section__actions');
  });

  it('turns a missing food into the route 404', async () => {
    mockedGetMealFood.mockRejectedValue(new ApiError(404, 'not found'));

    await expect(
      EditFoodPage({ params: Promise.resolve({ id: 'gone' }) }),
    ).rejects.toThrow('not found');
    expect(notFound).toHaveBeenCalled();
  });
});

describe('food form behaviour', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates in one POST: servingGrams 100, typed facts, and the named measures', async () => {
    mockedCreateMealFood.mockResolvedValue(food());
    const harness = formHarness();
    try {
      let tree = harness.renderTree(null);
      (field(tree, 'Food name').props.onChange as (e: unknown) => void)({
        target: { value: 'Milk, Brand X' },
      });
      tree = harness.renderTree(null);
      (find(tree, Select, (el) => el.props['aria-label'] === 'Unit')!.props
        .onChange as (e: unknown) => void)({ target: { value: 'ml' } });
      (field(tree, 'Calories per 100').props.onChange as (e: unknown) => void)({
        target: { value: '52' },
      });
      tree = harness.renderTree(null);
      (control(tree, (el) => text(el.props.children) === 'Add measure').props.onClick as () => void)();
      tree = harness.renderTree(null);
      (field(tree, 'Measure 1 label').props.onChange as (e: unknown) => void)({
        target: { value: '1 carton' },
      });
      (field(tree, 'Measure 1 amount in ml').props.onChange as (e: unknown) => void)({
        target: { value: '1000' },
      });
      tree = harness.renderTree(null);

      await (control(tree, (el) => el.props.label === 'Save').props.onClick as () => Promise<void>)();

      expect(mockedCreateMealFood).toHaveBeenCalledTimes(1);
      expect(mockedCreateMealFood).toHaveBeenCalledWith({
        name: 'Milk, Brand X',
        unit: 'ml',
        servingGrams: 100,
        nutrients: vector({ calories: 52 }),
        portions: [{ label: '1 carton', amount: 1000 }],
      });
      expect(mockedUpdateMealFood).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/meals/foods');
    } finally {
      harness.restore();
    }
  });

  it('updates without a unit and sends the version it read', async () => {
    mockedUpdateMealFood.mockResolvedValue(food({ version: 1 }));
    const harness = formHarness();
    try {
      let tree = harness.renderTree(food({ version: 4 }));
      (field(tree, 'Food name').props.onChange as (e: unknown) => void)({
        target: { value: 'Milk, Brand Y' },
      });
      tree = harness.renderTree(food({ version: 4 }));

      await (control(tree, (el) => el.props.label === 'Save').props.onClick as () => Promise<void>)();

      expect(mockedCreateMealFood).not.toHaveBeenCalled();
      expect(mockedUpdateMealFood).toHaveBeenCalledTimes(1);
      const [id, payload] = mockedUpdateMealFood.mock.calls[0];
      expect(id).toBe('food-1');
      expect(payload).toEqual({
        name: 'Milk, Brand Y',
        nutrients: vector({ calories: 52 }),
        portions: [],
        expectedVersion: 4,
      });
      expect(payload).not.toHaveProperty('unit');
      expect(mockPush).toHaveBeenCalledWith('/meals/foods');
    } finally {
      harness.restore();
    }
  });

  it('bounds measures at the service maximum and removes a row by index', async () => {
    const nineteen = Array.from({ length: PORTIONS_MAX - 1 }, (_, i) => ({
      id: `s${i}`,
      label: `measure ${i + 1}`,
      amount: 10,
      nutrients: vector(),
    }));
    const harness = formHarness();
    try {
      let tree = harness.renderTree(food({ servings: nineteen }));
      const add = control(tree, (el) => text(el.props.children) === 'Add measure');
      expect(add.props.disabled).toBe(false);

      (add.props.onClick as () => void)();
      tree = harness.renderTree(food({ servings: nineteen }));
      expect(findAll(tree, Row)).toHaveLength(PORTIONS_MAX);
      expect(
        (control(tree, (el) => text(el.props.children) === 'Add measure').props.disabled as boolean),
      ).toBe(true);

      (control(tree, (el) => el.props.label === 'Remove measure 1').props.onClick as () => void)();
      tree = harness.renderTree(food({ servings: nineteen }));
      expect(findAll(tree, Row)).toHaveLength(PORTIONS_MAX - 1);
      expect(
        (control(tree, (el) => text(el.props.children) === 'Add measure').props.disabled as boolean),
      ).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('deletes through the confirm control and returns to the catalog', async () => {
    mockedDeleteMealFood.mockResolvedValue(undefined);
    const harness = formHarness();
    try {
      const tree = harness.renderTree(food());
      const confirm = find(tree, ConfirmButton);
      if (!confirm) throw new Error('no delete control');

      // The click goes through the real atom's guarded handler — the same code
      // the DOM runs — so the confirm decision is what reaches the delete.
      const button = ConfirmButton(
        confirm.props as unknown as Parameters<typeof ConfirmButton>[0],
      );
      const previousWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { confirm: () => true };
      try {
        (button.props.onClick as (e: unknown) => void)({ preventDefault: jest.fn() });
        // The atom's guarded handler returns void, so the delete's own await
        // chain is settled by a macrotask flush before the assertions.
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        (globalThis as { window?: unknown }).window = previousWindow;
      }

      expect(mockedDeleteMealFood).toHaveBeenCalledWith('food-1');
      expect(mockPush).toHaveBeenCalledWith('/meals/foods');
    } finally {
      harness.restore();
    }
  });

  it('a Cancel confirm deletes nothing (the confirm is the only path to delete)', async () => {
    mockedDeleteMealFood.mockResolvedValue(undefined);
    const harness = formHarness();
    try {
      const tree = harness.renderTree(food());
      const confirm = find(tree, ConfirmButton);
      if (!confirm) throw new Error('no delete control');

      const button = ConfirmButton(
        confirm.props as unknown as Parameters<typeof ConfirmButton>[0],
      );
      const previousWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { confirm: () => false };
      try {
        (button.props.onClick as (e: unknown) => void)({ preventDefault: jest.fn() });
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        (globalThis as { window?: unknown }).window = previousWindow;
      }

      expect(mockedDeleteMealFood).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });
});

describe('food catalog actions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('revalidates only the catalog after a soft delete and leaves logged day totals byte-identical', async () => {
    mockedDeleteMealFood.mockResolvedValue(undefined);
    const entries: MealEntry[] = [
      { id: 'e1', date: '2026-10-01', mealGroup: 'lunch', foodId: 'food-1', quantity: 2, nutrients: vector({ calories: 104 }), version: 0, createdAt: '', updatedAt: '' },
      { id: 'e2', date: '2026-10-01', mealGroup: 'snack', foodId: 'food-2', quantity: 1, nutrients: vector({ calories: 30 }), version: 0, createdAt: '', updatedAt: '' },
    ];
    const before = JSON.stringify(sum(entries.map((entry) => entry.nutrients)));

    await deleteFoodAction('food-1');

    expect(mockedDeleteMealFood).toHaveBeenCalledWith('food-1');
    expect(mockedCreateMealFood).not.toHaveBeenCalled();
    expect(mockedUpdateMealFood).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/meals/foods');
    // The entries are untouched: the day's numbers are exactly what they were.
    expect(JSON.stringify(sum(entries.map((entry) => entry.nutrients)))).toBe(before);
  });

  it('never reaches a photo/USDA model on any catalog write', async () => {
    mockedCreateMealFood.mockResolvedValue(food());
    mockedUpdateMealFood.mockResolvedValue(food());
    mockedDeleteMealFood.mockResolvedValue(undefined);

    await createFoodAction({
      name: 'Milk, Brand X',
      unit: 'ml',
      servingGrams: 100,
      nutrients: vector({ calories: 52 }),
      portions: [],
    });
    await updateFoodAction('food-1', {
      name: 'Milk, Brand X',
      nutrients: vector({ calories: 52 }),
      portions: [],
      expectedVersion: 0,
    });
    await deleteFoodAction('food-1');

    expect(mockedCreateMealFood).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMealFood).toHaveBeenCalledTimes(1);
    expect(mockedDeleteMealFood).toHaveBeenCalledTimes(1);
  });
});

describe('food catalog sources', () => {
  it('hand-typed only: no create path reads a photo or a model', () => {
    const files = [
      'app/(meals)/meals/foods/food-form.tsx',
      'app/(meals)/meals/foods/new/page.tsx',
      'app/(meals)/meals/foods/[id]/page.tsx',
    ].map((path) => readFileSync(join(__dirname, '..', path), 'utf8'));
    const actions = readFileSync(join(__dirname, '..', 'app/(meals)/meals/actions.ts'), 'utf8');
    const createPath = actions.slice(
      actions.indexOf('export async function createFoodAction'),
      actions.indexOf('export async function updateFoodAction'),
    );

    for (const source of [...files, createPath]) {
      expect(source).not.toMatch(/estimatePhoto|gemini|usda|fdcId|generateContent/i);
    }
  });
});
