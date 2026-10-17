/**
 * The manual-log door (`SPEC-manual-log-ui`): two FAB options on the day view,
 * the search-first multi-add picker over a catalog row, and the editor seeding
 * the review from the confirmed pick. Node-env: `useState` is position-keyed and
 * persists across `renderTree` calls (the pattern `meal-editor.test.tsx` uses),
 * and handlers are exercised through the element tree, not a DOM.
 */
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NUTRIENTS, NUTRIENT_LABELS, UNKNOWN, type Nutrient, type NutrientVector } from '@life/nutrition';
import { Button, ButtonLink, EmptyState, Input, SearchField } from '@life/ui';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

jest.mock('@/lib/client', () => ({
  callService: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

import { MealDoors } from '@/app/(meals)/meals/meal-doors';
import { MealEditor, type EditorItem, type NutritionFields } from '@/app/(meals)/meals/entry/[id]/editor';
import { FoodSearch, type PickerFood } from '@/app/(meals)/meals/entry/[id]/food-picker';
import type { MealEntry, MealFood } from '@/lib/meal-api';

const ReactModule = jest.requireActual<typeof import('react')>('react');

function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  return {
    ...(Object.fromEntries(NUTRIENTS.map((n) => [n.key, 0])) as NutrientVector),
    ...overrides,
  };
}

function food(overrides: Partial<MealFood> = {}): MealFood {
  return {
    id: 'f1',
    name: 'Milk',
    unit: 'ml',
    servingGrams: 100,
    nutrients: vector({ calories: 60 }),
    servings: [{ id: 'carton', label: 'carton', amount: 1000, nutrients: vector({ calories: 600 }) }],
    version: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const NUTRITION: NutritionFields = {
  fields: (['calories', 'fat', 'carbohydrates', 'protein'] as const).map((key: Nutrient) => ({
    key,
    label: NUTRIENT_LABELS[key],
    unit: NUTRIENTS.find((n) => n.key === key)!.unit,
  })),
  extraCount: 23,
  groups: [],
  unknown: UNKNOWN,
  empty: vector(),
  totalUnit: NUTRIENTS.find(({ key }) => key === 'calories')!.unit,
};

interface EditorTree extends ReactElement {
  props: { children: ReactNode; banner?: ReactNode; actions?: ReactNode };
}

function stateHarness() {
  const store: unknown[] = [];
  const spy = jest.spyOn(ReactModule, 'useState');
  const ctxSpy = jest
    .spyOn(ReactModule, 'useContext')
    .mockImplementation((() => ({
      showSnackbar: () => undefined,
    })) as unknown as typeof ReactModule.useContext);

  function renderTree(props: Record<string, unknown> = {}): EditorTree {
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
    return MealEditor({
      entry: null,
      date: '2026-10-03',
      nutrition: NUTRITION,
      door: 'food',
      foods: [{ food: food(), per100Calories: 'per 100 ml · 60 kcal' }],
      ...props,
    } as unknown as Parameters<typeof MealEditor>[0]) as unknown as EditorTree;
  }

  function renderPicker(props: { foods: PickerFood[]; onPick: (f: MealFood, q: number) => void }): ReactElement {
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
    // `FoodSearch` returns its `Section` tree outright, so the field and rows are
    // observable through the element tree `find` walks.
    return FoodSearch(props) as ReactElement;
  }

  return { renderTree, renderPicker, store, restore: () => { spy.mockRestore(); ctxSpy.mockRestore(); } };
}

function isElement(node: unknown): node is ReactElement<Record<string, unknown>> {
  return (
    node != null &&
    typeof node === 'object' &&
    'type' in node &&
    'props' in node &&
    (node as { type?: unknown }).type !== undefined
  );
}

function find(node: unknown, type: unknown, match?: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
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

describe('manual-log door', () => {
  it('offers exactly the photo and food doors behind the log FAB', () => {
    const spy = jest.spyOn(ReactModule, 'useState').mockImplementation((() => [true, () => undefined]) as unknown as typeof ReactModule.useState);
    try {
      const html = renderToStaticMarkup(ReactModule.createElement(MealDoors));
      expect(html).toContain('href="/meals/entry/new?door=photo"');
      expect(html).toContain('href="/meals/entry/new?door=food"');
      expect(html).toContain('Log meal from photo');
      expect(html).toContain('Log food');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the search picker open and appends each confirmed pick to the review', () => {
    const harness = stateHarness();
    try {
      const picking = harness.renderTree();
      // The food door's review starts empty: the search is the only picker and
      // no review row exists yet.
      const picker = find(picking, FoodSearch);
      expect(picker).toBeDefined();
      expect(find(picking, Input, (el) => el.props['aria-label'] === 'Food for item 1')).toBeUndefined();

      (picker!.props.onPick as (f: MealFood, q: number) => void)(food(), 2.5);

      const reviewing = harness.renderTree();
      // The search stays mounted so the next food can be added straight away.
      expect(find(reviewing, FoodSearch)).toBeDefined();
      const dish = find(reviewing, Input, (el) => el.props['aria-label'] === 'Food for item 1');
      expect(dish!.props.value).toBe('Milk');
      // The pick's per-100 vector scaled by the logged quantity: 60 kcal × 2.5.
      const calories = find(reviewing, Input, (el) => el.props['aria-label'] === 'Calories for Milk');
      expect(calories!.props.value).toBe('150');

      // The appended item carries the food's identity and its headline facts:
      // the catalog id, the per-100 vector scaled by 2.5 (60 kcal → 150), and a
      // `known` set at headline depth — never the 27-key estimate fingerprint.
      // `items` is the editor's first `useState`, so the position-keyed store
      // holds the appended item at index 0.
      const seeded = harness.store[0] as EditorItem[];
      expect(seeded).toHaveLength(1);
      expect(seeded[0].foodId).toBe('f1');
      expect(seeded[0].nutrients.calories).toBe(150);
      expect(seeded[0].known).toEqual(['calories', 'fat', 'carbohydrates', 'protein']);
    } finally {
      harness.restore();
    }
  });

  it('lists nothing until a query arrives, then narrows to matching foods', () => {
    const harness = stateHarness();
    const pickProps = (): { foods: PickerFood[]; onPick: (f: MealFood, q: number) => void } => ({
      foods: [
        { food: food(), per100Calories: 'per 100 ml · 60 kcal' },
        { food: food({ id: 'f2', name: 'Oats' }), per100Calories: 'per 100 g · 389 kcal' },
      ],
      onPick: () => undefined,
    });
    try {
      // An empty query lists no row at all — the whole catalog is not dumped.
      const blank = harness.renderPicker(pickProps());
      expect(find(blank, SearchField)).toBeDefined();
      expect(find(blank, Button, (el) => el.props['aria-label'] === 'Log Milk')).toBeUndefined();
      expect(find(blank, Button, (el) => el.props['aria-label'] === 'Log Oats')).toBeUndefined();

      // The emitted query filters the rows in memory — Milk drops, Oats stays.
      (find(blank, SearchField)!.props.onQueryChange as (q: string) => void)('oats');
      const narrowed = harness.renderPicker(pickProps());
      expect(find(narrowed, Button, (el) => el.props['aria-label'] === 'Log Milk')).toBeUndefined();
      expect(find(narrowed, Button, (el) => el.props['aria-label'] === 'Log Oats')).toBeDefined();

      // A query matching nothing swaps the list for the empty-match state.
      (find(narrowed, SearchField)!.props.onQueryChange as (q: string) => void)('zzz');
      const miss = harness.renderPicker(pickProps());
      expect(find(miss, EmptyState, (el) => typeof el.props.body === 'string' && el.props.body.includes('No food name contains'))).toBeDefined();
    } finally {
      harness.restore();
    }
  });

  it('logs the tapped row at 100 over its base and keeps the query for the next pick', () => {
    const harness = stateHarness();
    const picked: { food: MealFood; quantity: number }[] = [];
    const pickProps = (overrides: Partial<MealFood> = {}): { foods: PickerFood[]; onPick: (f: MealFood, q: number) => void } => ({
      foods: [{ food: food(overrides), per100Calories: 'per 100 ml · 60 kcal' }],
      onPick: (f: MealFood, q: number) => picked.push({ food: f, quantity: q }),
    });
    try {
      // One serving for the canonical 100 g base: 100 / servingGrams = 1.
      const first = harness.renderPicker(pickProps());
      (find(first, SearchField)!.props.onQueryChange as (q: string) => void)('milk');
      const listed = harness.renderPicker(pickProps());
      (find(listed, Button, (el) => el.props['aria-label'] === 'Log Milk')!.props.onClick as () => void)();
      expect(picked).toEqual([{ food: food(), quantity: 1 }]);

      // The query survives the pick, so the row is still there for a second tap.
      const again = harness.renderPicker(pickProps());
      expect(find(again, SearchField)!.props.value).toBe('milk');
      (find(again, Button, (el) => el.props['aria-label'] === 'Log Milk')!.props.onClick as () => void)();
      expect(picked).toEqual([
        { food: food(), quantity: 1 },
        { food: food(), quantity: 1 },
      ]);

      // The default is one 100-unit serving in the food's own unit, not one serving:
      // a 50 g base food is 100 / 50 = 2.
      const halfBase = harness.renderPicker(pickProps({ servingGrams: 50 }));
      (find(halfBase, Button, (el) => el.props['aria-label'] === 'Log Milk')!.props.onClick as () => void)();
      expect(picked[2].quantity).toBe(2);
    } finally {
      harness.restore();
    }
  });

  it('falls back to an EmptyState with an add-food link when the catalog is empty', () => {
    const harness = stateHarness();
    try {
      const empty = harness.renderPicker({ foods: [], onPick: () => undefined });
      const note = find(empty, EmptyState, (el) => typeof el.props.body === 'string' && el.props.body.includes('Add one'));
      expect(note).toBeDefined();
      const addFood = find(empty, ButtonLink);
      expect(addFood!.props.href).toBe('/meals/foods');
    } finally {
      harness.restore();
    }
  });
});
