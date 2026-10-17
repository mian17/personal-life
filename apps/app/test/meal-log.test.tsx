/**
 * The manual-log door (`SPEC-manual-log-ui`): two FAB options on the day view,
 * the unit/count picker from a catalog row, and the editor seeding the review
 * from the confirmed pick. Node-env: `useState` is position-keyed and persists
 * across `renderTree` calls (the pattern `meal-editor.test.tsx` uses), and
 * handlers are exercised through the element tree, not a DOM.
 */
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NUTRIENTS, NUTRIENT_LABELS, UNKNOWN, type Nutrient, type NutrientVector } from '@life/nutrition';
import { Button, ButtonLink, EmptyState, Input, Pill, SearchField } from '@life/ui';

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
import { FoodPicker, loggedQuantity, type PickerFood } from '@/app/(meals)/meals/entry/[id]/food-picker';
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
    const top = FoodPicker(props) as ReactElement<Record<string, unknown>>;
    // `FoodPicker` returns its step's element (`FoodChoices`/`AmountStep`), not
    // raw fields — expand one level so the step's controls are observable. The
    // inner call keeps consuming the same position-keyed store the hooks own.
    const inner = top.type as unknown as ((p: Record<string, unknown>) => ReactElement) & { name?: string };
    if (typeof inner === 'function' && (inner.name === 'FoodChoices' || inner.name === 'AmountStep' || inner.name === 'EmptyCatalog')) {
      return inner(top.props);
    }
    return top;
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

  it('keeps the quantity rule linear with no conversion: unit value or count × measure over the base', () => {
    const per100 = food({ servingGrams: 100 });
    const carton = { id: 'carton', label: 'carton', amount: 1000, nutrients: vector({ calories: 600 }) };
    // Half, one, and two of the food's own unit — the scale plan pins (0.5×, 1×, 2×).
    expect(loggedQuantity(per100, { kind: 'unit', value: 50 })).toBe(0.5);
    expect(loggedQuantity(per100, { kind: 'unit', value: 100 })).toBe(1);
    expect(loggedQuantity(per100, { kind: 'unit', value: 200 })).toBe(2);
    expect(loggedQuantity(per100, { kind: 'unit', value: 250 })).toBe(2.5);
    // The counted branch is the same line with count as the multiplier.
    expect(loggedQuantity(per100, { kind: 'measure', count: 0.5, measure: carton })).toBe(5);
    expect(loggedQuantity(per100, { kind: 'measure', count: 1, measure: carton })).toBe(10);
    expect(loggedQuantity(per100, { kind: 'measure', count: 2, measure: carton })).toBe(20);
  });

  it('shows the picker while unpicked, then swaps to the seeded review with the pick snapshotted', () => {
    const harness = stateHarness();
    try {
      const picking = harness.renderTree();
      // The pick step owns the screen: the picker element is present and the
      // review's own item rows are not.
      const picker = find(picking, FoodPicker);
      expect(picker).toBeDefined();
      expect(find(picking, Input, (el) => el.props['aria-label'] === 'Food for item 1')).toBeUndefined();

      (picker!.props.onPick as (f: MealFood, q: number) => void)(food(), 2.5);

      const reviewing = harness.renderTree();
      expect(find(reviewing, FoodPicker)).toBeUndefined();
      const dish = find(reviewing, Input, (el) => el.props['aria-label'] === 'Food for item 1');
      expect(dish!.props.value).toBe('Milk');
      // The pick's per-100 vector scaled by the logged quantity: 60 kcal × 2.5.
      const calories = find(reviewing, Input, (el) => el.props['aria-label'] === 'Calories for Milk');
      expect(calories!.props.value).toBe('150');

      // The seeded item carries the food's identity and its headline facts:
      // the catalog id, the per-100 vector scaled by 2.5 (60 kcal → 150), and a
      // `known` set at headline depth — never the 27-key estimate fingerprint.
      const seeded = harness.store[1] as EditorItem[];
      expect(seeded).toHaveLength(1);
      expect(seeded[0].foodId).toBe('f1');
      expect(seeded[0].nutrients.calories).toBe(150);
      expect(seeded[0].known).toEqual(['calories', 'fat', 'carbohydrates', 'protein']);
    } finally {
      harness.restore();
    }
  });

  it('picks a catalog food, offers its named measure, and confirms the counted amount', () => {
    const harness = stateHarness();
    const picked: { food: MealFood; quantity: number }[] = [];
    const pickProps = (): { foods: PickerFood[]; onPick: (f: MealFood, q: number) => void } => ({
      foods: [{ food: food(), per100Calories: 'per 100 ml · 60 kcal' }],
      onPick: (f: MealFood, q: number) => picked.push({ food: f, quantity: q }),
    });
    try {
      // Step one: the catalog row logs on its own button.
      const choose = harness.renderPicker(pickProps());
      expect(find(choose, SearchField)).toBeDefined();
      (find(choose, Button, (el) => el.props['aria-label'] === 'Log Milk')!.props.onClick as () => void)();

      // Step two defaults (AC2): the unit box arrives at 100 of the food's own
      // unit, so confirming without typing logs exactly that serving (100/100).
      const amount = harness.renderPicker(pickProps());
      expect(find(amount, Input, (el) => el.props['aria-label'] === 'Amount in ml')!.props.value).toBe('100');
      (find(amount, Button, (el) => el.props.children === 'Log food')!.props.onClick as () => void)();
      expect(picked).toEqual([{ food: food(), quantity: 1 }]);

      // The named measure replaces the unit box and its count arrives at 1 —
      // an untyped confirm logs one carton (1000/100 = 10).
      const toggled = harness.renderPicker(pickProps());
      (find(toggled, Pill, (el) => el.props.children === 'carton')!.props.onClick as () => void)();

      const counted = harness.renderPicker(pickProps());
      expect(find(counted, Input, (el) => el.props['aria-label'] === 'Number of carton')!.props.value).toBe('1');
      (find(counted, Button, (el) => el.props.children === 'Log food')!.props.onClick as () => void)();

      expect(picked).toEqual([{ food: food(), quantity: 1 }, { food: food(), quantity: 10 }]);
    } finally {
      harness.restore();
    }
  });

  it('narrows the catalog rows in memory as the query changes and reports an empty match', () => {
    const harness = stateHarness();
    const pickProps = (): { foods: PickerFood[]; onPick: (f: MealFood, q: number) => void } => ({
      foods: [
        { food: food(), per100Calories: 'per 100 ml · 60 kcal' },
        { food: food({ id: 'f2', name: 'Oats' }), per100Calories: 'per 100 g · 389 kcal' },
      ],
      onPick: () => undefined,
    });
    try {
      const choose = harness.renderPicker(pickProps());
      expect(find(choose, Button, (el) => el.props['aria-label'] === 'Log Milk')).toBeDefined();
      expect(find(choose, Button, (el) => el.props['aria-label'] === 'Log Oats')).toBeDefined();

      // The emitted query filters the rows in memory — Milk drops, Oats stays.
      (find(choose, SearchField)!.props.onQueryChange as (q: string) => void)('oats');
      const narrowed = harness.renderPicker(pickProps());
      expect(find(narrowed, Button, (el) => el.props['aria-label'] === 'Log Milk')).toBeUndefined();
      expect(find(narrowed, Button, (el) => el.props['aria-label'] === 'Log Oats')).toBeDefined();

      // A query matching nothing swaps the list for the empty-match state.
      (find(narrowed, SearchField)!.props.onQueryChange as (q: string) => void)('zzz');
      const empty = harness.renderPicker(pickProps());
      const note = find(empty, EmptyState, (el) => typeof el.props.body === 'string' && el.props.body.includes('No food name contains'));
      expect(note).toBeDefined();
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
