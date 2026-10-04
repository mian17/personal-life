import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NUTRIENTS, NUTRIENT_LABELS, UNKNOWN, format, type Nutrient, type NutrientVector } from '@life/nutrition';
import { Button, Dialog, FilePicker, IconButton, Input, ListItem, SettingsRow, StatusText, Textarea } from '@life/ui';

const mockBack = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

jest.mock('@/lib/client', () => ({
  callService: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

import { callService } from '@/lib/client';
import {
  MealEditor,
  type EditorItem,
  type NutritionFields,
} from '@/app/(meals)/meals/entry/[id]/editor';
import type { MealEntry } from '@/lib/meal-api';

const mockCallService = callService as unknown as jest.Mock;

// The compiled component reads its hooks off the raw `react` module exports at
// call time, so spying there intercepts a direct `MealEditor(...)` call. State is
// position-keyed and persists across `renderTree` calls; `useRouter().back` is
// mocked above. (`apps/app` runs node-env, so handlers are observed through the
// element tree rather than a DOM renderer — the pattern used by the other app
// editor tests.)
const ReactModule = jest.requireActual<typeof import('react')>('react');

function vector(overrides: Partial<NutrientVector> = {}): NutrientVector {
  return {
    ...(Object.fromEntries(NUTRIENTS.map((n) => [n.key, 0])) as NutrientVector),
    ...overrides,
  };
}

function entry(overrides: Partial<MealEntry> = {}): MealEntry {
  return {
    id: 'e1',
    date: '2026-10-03',
    mealGroup: 'lunch',
    foodId: 'Salad',
    quantity: 1,
    nutrients: vector({ calories: 100 }),
    version: 2,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

interface EditorTree extends ReactElement {
  props: { children: ReactNode; banner?: ReactNode; actions?: ReactNode };
}

/**
 * The seven display groups of the expanded region — the same app-owned grouping
 * `entry/[id]/page.tsx` derives. Every one of the 27 keys appears exactly once.
 */
const GROUPS: { title: string; keys: Nutrient[] }[] = [
  { title: 'Macros', keys: ['calories', 'fat', 'carbohydrates', 'protein'] },
  { title: 'Fat breakdown', keys: ['monounsaturatedFat', 'polyunsaturatedFat', 'saturatedFat', 'transFat'] },
  { title: 'Cholesterol & sodium', keys: ['cholesterol', 'sodium'] },
  { title: 'Carb breakdown', keys: ['fiber', 'sugar'] },
  { title: 'Vitamins', keys: ['vitaminA', 'vitaminC', 'thiaminB1', 'riboflavinB2', 'niacinB3', 'folateB9', 'vitaminB6', 'vitaminB12'] },
  { title: 'Minerals', keys: ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc'] },
  { title: 'Other', keys: ['caffeine'] },
];

function unitOf(key: Nutrient): string {
  return NUTRIENTS.find((n) => n.key === key)!.unit;
}

function nutrientField(key: Nutrient) {
  return { key, label: NUTRIENT_LABELS[key], unit: unitOf(key) };
}

/**
 * The server-derived `@life/nutrition` display data the meals route passes the
 * client editor — the same shape `entry/[id]/page.tsx` builds.
 */
const NUTRITION: NutritionFields = {
  fields: (['calories', 'fat', 'carbohydrates', 'protein'] as const).map(nutrientField),
  extraCount: 23,
  groups: GROUPS.map(({ title, keys }) => ({ title, fields: keys.map(nutrientField) })),
  unknown: UNKNOWN,
  empty: Object.fromEntries(NUTRIENTS.map(({ key }) => [key, 0])) as NutrientVector,
  totalUnit: NUTRIENTS.find(({ key }) => key === 'calories')!.unit,
};

function stateHarness() {
  const store: unknown[] = [];
  const spy = jest.spyOn(ReactModule, 'useState');
  // `MealEditor` runs `useSnackbar` (a `useContext` hook); a direct call is
  // outside React, so stub it here — every render path needs it, not just the
  // save test. Captured messages are exposed for assertions.
  const shown: { message: string }[] = [];
  const ctxSpy = jest
    .spyOn(ReactModule, 'useContext')
    .mockImplementation((() => ({
      showSnackbar: (options: { message: string }) => shown.push(options),
    })) as unknown as typeof ReactModule.useContext);

  function renderTree(initialEntry: MealEntry | null = null, date = '2026-10-03'): EditorTree {
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
    return MealEditor({ entry: initialEntry, date, nutrition: NUTRITION }) as unknown as EditorTree;
  }

  return {
    renderTree,
    shown,
    restore: () => {
      spy.mockRestore();
      ctxSpy.mockRestore();
    },
  };
}

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

function field(tree: EditorTree, label: string): ReactElement<Record<string, unknown>> {
  const found =
    find(tree, Input, (el) => el.props['aria-label'] === label) ??
    find(tree, Textarea, (el) => el.props['aria-label'] === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return found;
}

function button(tree: EditorTree, match: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> {
  const found = find(tree, Button, match) ?? find(tree, IconButton, match);
  if (!found) throw new Error('control not found');
  return found;
}

/** Depth-first collect of every element of a type (used for set-equality checks). */
function findAll(node: unknown, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isElement(node)) return [];
  const rest = Object.values(node.props).flatMap((value) => findAll(value, type));
  return node.type === type ? [node, ...rest] : rest;
}

/**
 * The run total's `StatusText` — located by its `<number> kcal` content, not by
 * tree position, so the `Items` hint (also a `StatusText`, under `Items` before
 * the total) never gets mistaken for it.
 */
function runTotal(tree: EditorTree): ReactElement<Record<string, unknown>> {
  const found = find(tree, StatusText, (el) => /kcal$/.test(text(el)));
  if (!found) throw new Error('no run total rendered');
  return found;
}

/** Concatenate every string in a rendered node subtree. */
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isElement(node)) return text(node.props.children);
  return '';
}

const image = new File(['bytes'], 'meal.jpg', { type: 'image/jpeg' });

describe('MealEditor photo door', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the image to the one photo path and seeds the suggestion as item values', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({
      readable: true,
      items: [
        { dish: 'Omelette', ingredients: ['egg'], portionGrams: 120, nutrients: vector({ calories: 250 }) },
      ],
    });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      if (!picker) throw new Error('no FilePicker mounted');

      await (picker.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      expect(mockCallService).toHaveBeenCalledTimes(1);
      const [base, path, init] = mockCallService.mock.calls[0];
      expect(base).toBe('http://127.0.0.1:3106');
      expect(path).toBe('/api/estimates/photo');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        imageBase64: Buffer.from('bytes').toString('base64'),
        mimeType: 'image/jpeg',
        hint: undefined,
      });

      const seeded = harness.renderTree();
      expect(field(seeded, 'Dish for item 1').props.value).toBe('Omelette');
      expect(field(seeded, 'Calories for Omelette').props.value).toBe('250');
      const total = runTotal(seeded);
      expect(text(total)).toBe(format('calories', 250));
    } finally {
      harness.restore();
    }
  });

  it('passes the optional hint as steering input, never as a correction', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({ readable: false, reason: 'could-not-read' });
    try {
      const first = harness.renderTree();
      (field(first, 'Photo hint (optional)').props.onChange as (e: unknown) => void)({
        target: { value: 'leftover from last night' },
      });

      const hinted = harness.renderTree();
      const picker = find(hinted, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const body = JSON.parse(mockCallService.mock.calls[0][2].body);
      expect(body.hint).toBe('leftover from last night');
    } finally {
      harness.restore();
    }
  });

  it('opens manual mode empty — no invented numbers — when the photo cannot be read', async () => {
    const harness = stateHarness();
    mockCallService.mockRejectedValue(new Error('gemini down'));
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const failed = harness.renderTree();
      expect(field(failed, 'Dish for item 1').props.value).toBe('');
      const calories = field(failed, 'Calories for item 1');
      expect(calories.props.value).toBe('');
      expect(calories.props.placeholder).toBe(UNKNOWN);
      expect(text(failed.props.banner)).toContain("Couldn't read that photo");
      // No confirmed item, so nothing was invented: the fields stay unknown and
      // neither save control is enabled.
      expect(button(failed, (el) => el.props.label === 'Save meal').props.disabled).toBe(true);
      expect(
        find(failed, Button, (el) => text(el.props.children).includes('Save as meal'))!.props.disabled,
      ).toBe(true);
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor unknown affordance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the em dash for a value that is not confirmed, never a fabricated 0', () => {
    const harness = stateHarness();
    try {
      // A fresh manual item: named, but no value confirmed — the unknown state.
      const first = harness.renderTree();
      (field(first, 'Dish for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Mystery dish' },
      });
      const tree = harness.renderTree();

      const calories = field(tree, 'Calories for Mystery dish');
      expect(calories.props.value).toBe('');
      expect(calories.props.placeholder).toBe(UNKNOWN);
      // Nothing is confirmed, so nothing was invented: the per-item field is
      // empty (em dash) and the run total is a true zero — the same figure the
      // day view renders for an entry set with no confirmed calories.
      expect(text(runTotal(tree))).toBe(format('calories', 0));

      const html = renderToStaticMarkup(tree);
      expect(html).toContain(`placeholder="${UNKNOWN}"`);
      // An unconfirmed meal cannot be saved or frozen.
      expect(button(tree, (el) => el.props.label === 'Save meal').props.disabled).toBe(true);
      expect(
        find(tree, Button, (el) => text(el.props.children).includes('Save as meal'))!.props.disabled,
      ).toBe(true);
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor save persists corrected values', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PATCHes the corrected vector for an existing entry', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({});
    try {
      const first = harness.renderTree(entry());
      (field(first, 'Calories for Salad').props.onChange as (e: unknown) => void)({
        target: { value: '175' },
      });

      const corrected = harness.renderTree(entry());
      await (button(corrected, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      expect(mockCallService).toHaveBeenCalledTimes(1);
      const [base, path, init] = mockCallService.mock.calls[0];
      expect(base).toBe('http://127.0.0.1:3106');
      expect(path).toBe('/api/entries/e1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({
        quantity: 1,
        nutrients: vector({ calories: 175 }),
        expectedVersion: 2,
      });
      expect(mockBack).toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it('creates one entry per corrected item for a new meal', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({});
    try {
      const first = harness.renderTree();
      (field(first, 'Dish for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Toast' },
      });
      const named = harness.renderTree();
      (field(named, 'Calories for Toast').props.onChange as (e: unknown) => void)({
        target: { value: '90' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const [base, path, init] = mockCallService.mock.calls[0];
      expect(base).toBe('http://127.0.0.1:3106');
      expect(path).toBe('/api/entries');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        date: '2026-10-03',
        mealGroup: 'lunch',
        foodId: 'Toast',
        quantity: 1,
        nutrients: vector({ calories: 90 }),
      });
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor save-as-meal control', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the corrected snapshot to POST /api/saved-meals through a primitive Button', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({ id: 's1' });
    try {
      const tree = harness.renderTree(entry({ nutrients: vector({ calories: 250 }) }));

      const control = button(tree, (el) => text(el.props.children).includes('Save as meal'));
      expect(control.type).toBe(Button);

      await (control.props.onClick as () => Promise<void>)();

      const [base, path, init] = mockCallService.mock.calls[0];
      expect(base).toBe('http://127.0.0.1:3106');
      expect(path).toBe('/api/saved-meals');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        name: 'Salad',
        mealGroup: 'lunch',
        items: [{ foodId: 'Salad', quantity: 1, nutrients: vector({ calories: 250 }) }],
      });

      // Exactly one owner for the message — the snackbar, not an inline line.
      expect(harness.shown).toEqual([{ message: 'Saved to your meals.' }]);
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor labelled fields and the all-nutrients region', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives every inline field a visible label with its unit', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      // The visible label lives on a SettingsRow beside its control — the
      // emitted text, not the aria-label a sighted user never sees. The dish is
      // the parent line now, so it reads through the row's own placeholder.
      const html = renderToStaticMarkup(tree);
      for (const label of ['Portions', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)']) {
        expect(html).toContain(label);
      }
      expect(html).toContain('placeholder="Dish name"');
    } finally {
      harness.restore();
    }
  });

  it('renders one All nutrients (27) trigger per item with its modal closed', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();
      const triggers = findAll(tree, Button).filter((el) =>
        text(el.props.children).includes('All nutrients (27)'),
      );
      expect(triggers).toHaveLength(1);
      expect(text(triggers[0].props.children)).toBe('All nutrients (27)');

      const dialogs = findAll(tree, Dialog);
      expect(dialogs).toHaveLength(1);
      expect(dialogs[0].props.title).toBe('All nutrients');
      expect(dialogs[0].props.size).toBe('full');
      expect(dialogs[0].props.open).toBe(false);

      const html = renderToStaticMarkup(tree);
      expect(html).toContain('ui-dialog--full');
    } finally {
      harness.restore();
    }
  });

  it('expanded, lists all 27 nutrients exactly once across the seven groups', () => {
    const harness = stateHarness();
    try {
      const first = harness.renderTree(entry());
      // Tapping the trigger runs its `onClick` — `setOpenNutrients(index)` —
      // through the same store the harness drives; the re-render then shows the
      // item's modal open.
      (button(first, (el) => text(el.props.children).includes('All nutrients')).props.onClick as () => void)();

      const dialog = findAll(harness.renderTree(), Dialog).find((el) => el.props.open === true);
      expect(dialog).toBeDefined();
      // The rows inside the open modal — the same field rows the inline form
      // shows. Element text (not a substring scan) is the unit: the 27 rows are
      // `SettingsRow`s whose label is the nutrient + its unit.
      const rows = findAll(dialog!.props.children as ReactElement, SettingsRow);
      const labels = rows.map((row) => text(row.props.label));

      const expected = (Object.keys(NUTRIENT_LABELS) as Nutrient[]).map(
        (key) => `${NUTRIENT_LABELS[key]} (${unitOf(key)})`,
      );
      // Set-equality against the package vocabulary: nothing dropped, misspelled
      // or invented — a dropped key fails, an extra row fails.
      expect(new Set(labels)).toEqual(new Set(expected));
      expect(labels).toHaveLength(27);
      // And every label appears EXACTLY once (no duplicate/mis-grouped field).
      for (const label of expected) {
        expect(labels.filter((l) => l === label)).toHaveLength(1);
      }
      expect(labels).toContain('Caffeine (mg)');

      // `Caffeine` renders under its own `Other` group, not dropped or merged.
      const bodyHtml = renderToStaticMarkup(dialog!.props.children as ReactElement);
      expect(bodyHtml).toContain('Other');
    } finally {
      harness.restore();
    }
  });

  it('shows real micro numbers and the estimated hint for a photo item, the em dash for a manual one', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({
      readable: true,
      items: [
        {
          dish: 'Omelette',
          ingredients: ['egg'],
          portionGrams: 120,
          nutrients: vector({ calories: 250, sodium: 480, caffeine: 12 }),
        },
      ],
    });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);
      const tree = harness.renderTree();

      // The estimate's micro is a real number, not the em dash.
      const sodium = field(tree, 'Sodium in Cholesterol & sodium for Omelette');
      expect(sodium.props.value).toBe('480');
      expect(sodium.props.placeholder).toBe(UNKNOWN);

      // A photo estimate seeds all 27, so its trigger counts the estimated extras.
      const trigger = button(tree, (el) => text(el.props.children).includes('All nutrients'));
      expect(text(trigger.props.children)).toBe('All nutrients (27) · 23 estimated');

      // A manual item keeps the em dash and the plain label.
      const manual = stateHarness();
      try {
        const manualTree = manual.renderTree();
        const manualSodium = field(manualTree, 'Sodium in Cholesterol & sodium for item 1');
        expect(manualSodium.props.value).toBe('');
        expect(manualSodium.props.placeholder).toBe(UNKNOWN);
        const manualTrigger = button(manualTree, (el) =>
          text(el.props.children).includes('All nutrients'),
        );
        expect(text(manualTrigger.props.children)).toBe('All nutrients (27)');
      } finally {
        manual.restore();
      }
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor composition', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mounts the upload atom, the hint field and the save-as-meal control from primitives', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();
      expect(find(tree, FilePicker)).toBeDefined();
      expect(field(tree, 'Photo hint (optional)').type).toBe(Textarea);
      expect(
        find(tree, Button, (el) => text(el.props.children).includes('Save as meal')),
      ).toBeDefined();

      // The rendered control surface comes entirely from primitives (each
      // carries its own `ui-*` class); the source-level "no raw element" rule is
      // enforced by the Contract-1 grep in the tech-lead review, not by markup.
      const html = renderToStaticMarkup(tree);
      expect(html).toContain('ui-file-picker');
      expect(html).toContain('ui-textarea');
      expect(html).toContain('ui-btn');
    } finally {
      harness.restore();
    }
  });

  it('renders the dish as the row title with the nutrients nested beneath it', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();
      // The dish is the row's title (the parent line), not a child field row.
      const row = findAll(tree, ListItem)[0];
      expect(text(row.props.title)).toBe('');
      expect(isElement(row.props.title) && row.props.title.props['aria-label']).toBe(
        'Dish for item 1',
      );
      // The dish input is the row title; every other field is a nested child.
      expect(field(tree, 'Dish for item 1').props.value).toBe('');
      expect(findAll(tree, SettingsRow)[0].props.label).toBe('Portions');

      // The emitted markup carries the nested variant the CSS turns into a
      // column: the remove button sits on the title line beside the dish input
      // (the `titleAction` slot, not a `deleteAction` sibling beside the body),
      // so the nutrient rows below take the full width.
      const html = renderToStaticMarkup(tree);
      expect(html).toContain('ui-list-item--nested');
      expect(html).toContain('ui-list-item__nested-body');
      expect(html).toContain('ui-list-item__title-action');
      expect(html.indexOf('Remove item')).toBeGreaterThan(-1);
      const titleLine = html.indexOf('ui-list-item__title-action');
      const body = html.indexOf('ui-list-item__nested-body');
      expect(titleLine).toBeLessThan(body);
      expect(html.indexOf('Remove item', titleLine)).toBeLessThan(body);
    } finally {
      harness.restore();
    }
  });

  it('keeps EditorItem raw vectors scaled and serialisable', () => {
    const item: EditorItem = {
      dish: 'Rice',
      quantity: 2,
      nutrients: vector({ calories: 400 }),
      known: ['calories'],
    };
    expect(item.nutrients).toEqual(vector({ calories: 400 }));
  });
});
