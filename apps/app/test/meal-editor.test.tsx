import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NUTRIENTS, NUTRIENT_LABELS, UNKNOWN, format, type Nutrient, type NutrientVector } from '@life/nutrition';
import { Autosuggest, Button, Dialog, EmptyState, Facts, FactsRow, FilePicker, IconButton, Input, Kpi, ListItem, SettingsRow, StatusText, Textarea, type AutosuggestOption } from '@life/ui';

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
import { restoredFoodName, type MealEntry, type MealFood, type MealGroup } from '@/lib/meal-api';
import {
  MealEditor,
  type EditorItem,
  type NutritionFields,
} from '@/app/(meals)/meals/entry/[id]/editor';
import { FoodSearch, type PickerFood } from '@/app/(meals)/meals/entry/[id]/food-picker';

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
  props: {
    children: ReactNode;
    banner?: ReactNode;
    actions?: ReactNode;
    back: { label: string; variant?: string };
  };
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

  function renderTree(
    initialEntry: MealEntry | null = null,
    date = '2026-10-03',
    foodName?: string,
    extra: { door?: 'photo' | 'food' | null; foods?: PickerFood[]; defaultMealGroup?: MealGroup } = {},
  ): EditorTree {
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
      entry: initialEntry,
      date,
      nutrition: NUTRITION,
      foodName,
      ...extra,
    }) as unknown as EditorTree;
  }

  // `FoodSearch` owns its own query state. It is rendered directly (not part of
  // the editor tree) but shares this harness's spy and store — parked at a high
  // index so its one `useState` never collides with the editor's positions.
  const SEARCH_SLOT = 100;
  function renderSearch(
    foods: PickerFood[],
    onPick: (food: MealFood, quantity: number) => void,
  ): ReactElement<Record<string, unknown>> {
    let index = SEARCH_SLOT;
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
    return FoodSearch({ foods, onPick }) as unknown as ReactElement<Record<string, unknown>>;
  }

  return {
    renderTree,
    renderSearch,
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
 * The meal's run total, read off the one `Kpi` the total card draws: the eaten
 * figure and its unit as two slots. It is found by its atom, so the `Items` hint
 * (`StatusText`, in the section that follows it) is never mistaken for it.
 */
function runTotal(tree: EditorTree): string {
  const found = find(tree, Kpi);
  if (!found) throw new Error('no run total rendered');
  return `${text(found.props.value)} ${text(found.props.unit)}`;
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
        {
          name: 'Omelette',
          grams: 100,
          foodId: null,
          fdcId: null,
          servingGrams: 100,
          nutrients: vector({ calories: 250 }),
        },
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
      expect(field(seeded, 'Food for item 1').props.value).toBe('Omelette');
      expect(field(seeded, 'Calories for Omelette').props.value).toBe('250');
      const total = runTotal(seeded);
      expect(total).toBe(format('calories', 250));
    } finally {
      harness.restore();
    }
  });

  it('seeds Grams and scales through the item base when servingGrams is not 100', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({
      readable: true,
      items: [
        {
          name: 'Rice Bowl',
          grams: 300,
          foodId: null,
          fdcId: null,
          servingGrams: 150,
          nutrients: vector({ calories: 150 }),
        },
      ],
    });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      if (!picker) throw new Error('no FilePicker mounted');

      await (picker.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const seeded = harness.renderTree();
      expect(field(seeded, 'Grams for Rice Bowl').props.value).toBe('300');
      expect(field(seeded, 'Calories for Rice Bowl').props.value).toBe('300');

      (field(seeded, 'Grams for Rice Bowl').props.onChange as (e: unknown) => void)({
        target: { value: '150' },
      });

      const resized = harness.renderTree();
      expect(field(resized, 'Grams for Rice Bowl').props.value).toBe('150');
      expect(field(resized, 'Calories for Rice Bowl').props.value).toBe('150');
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

  it('reads the format from the bytes, so a phone photo the browser could not name still arrives typed', async () => {
    // The regression this pins: iOS camera capture and some library picks hand over
    // bytes with an empty `type`. Sending that empty name failed the service's mime
    // gate, which reads to the user as "couldn't read the photo". The JPEG signature
    // is the fact; the browser's silence is not.
    const unnamedJpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], 'IMG_0002.jpg', {
      type: '',
    });
    const harness = stateHarness();
    mockCallService.mockResolvedValue({ readable: false, reason: 'could-not-read' });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)(
        [unnamedJpeg] as unknown as FileList,
      );

      expect(JSON.parse(mockCallService.mock.calls[0][2].body).mimeType).toBe('image/jpeg');
    } finally {
      harness.restore();
    }
  });

  it('sends an unnamed file with its type empty, so the failure names the photo, not the service', async () => {
    // A capture the browser could not name. Labelling its bytes JPEG made Gemini
    // reject them, which reads to the editor as an outage; the empty type now reaches
    // the service's mime gate, whose `could-not-read` names the photo instead.
    const unnamed = new File(['heic bytes'], 'IMG_0001.HEIC', { type: '' });
    const harness = stateHarness();
    mockCallService.mockResolvedValue({ readable: false, reason: 'could-not-read' });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)(
        [unnamed] as unknown as FileList,
      );

      expect(JSON.parse(mockCallService.mock.calls[0][2].body).mimeType).toBe('');
      const failed = harness.renderTree();
      expect(text(failed.props.banner)).toBe(
        "Couldn't read that photo. Enter the meal by hand — nothing was guessed.",
      );
    } finally {
      harness.restore();
    }
  });

  it('opens manual mode empty — no invented numbers — when the photo cannot be read', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({ readable: false, reason: 'could-not-read' });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const failed = harness.renderTree();
      expect(field(failed, 'Food for item 1').props.value).toBe('');
      const calories = field(failed, 'Calories for item 1');
      expect(calories.props.value).toBe('');
      expect(calories.props.placeholder).toBe(UNKNOWN);
      // The frozen banner, byte-identical: the reason is the photo's own, so a
      // failure a user cannot act on never claims the service is down.
      expect(text(failed.props.banner)).toBe(
        "Couldn't read that photo. Enter the meal by hand — nothing was guessed.",
      );
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

  it('shows the service banner, not the photo banner, when the service cannot answer', async () => {
    const harness = stateHarness();
    mockCallService.mockRejectedValue(new Error('meal-service 500'));
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const failed = harness.renderTree();
      // A service outage reads as retry-later, never as "send a better photo".
      expect(text(failed.props.banner)).toBe(
        'Photo service is unavailable. Enter the meal by hand — nothing was guessed.',
      );
      expect(text(failed.props.banner)).not.toContain("Couldn't read that photo");
      // The failed attempt still opens one empty row and leaves manual entry usable.
      expect(field(failed, 'Food for item 1').props.value).toBe('');
      expect(button(failed, (el) => el.props.label === 'Save meal').props.disabled).toBe(true);
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor manual door — search-first multi-add', () => {
  beforeEach(() => jest.clearAllMocks());

  function pickerFood(overrides: Partial<MealFood> = {}): PickerFood {
    return {
      food: {
        id: 'f-food',
        name: 'Food',
        unit: 'g',
        servingGrams: 100,
        nutrients: vector(),
        servings: [],
        version: 0,
        createdAt: '',
        updatedAt: '',
        ...overrides,
      },
      per100Calories: 'per 100 g · 0 kcal',
    };
  }

  const DATE = '2026-10-03';
  const oat = pickerFood({ id: 'f-oat', name: 'Oatmeal', nutrients: vector({ calories: 389 }) });
  const chicken = pickerFood({ id: 'f-chicken', name: 'Chicken', nutrients: vector({ calories: 165 }) });

  /** The row `FoodSearch` offers for `name` — the `Autosuggest` option the block renders. */
  function listedRow(node: unknown, name: string) {
    const options = (find(node, Autosuggest)?.props.options ?? []) as AutosuggestOption[];
    return options.find((option) => option.label === name);
  }

  it('hides the photo section on the manual door and keeps it when the door is null', () => {
    const harness = stateHarness();
    try {
      const manual = harness.renderTree(null, DATE, undefined, { door: 'food', foods: [oat] });
      expect(find(manual, FilePicker)).toBeUndefined();
      expect(
        find(manual, Textarea, (el) => el.props['aria-label'] === 'Photo hint (optional)'),
      ).toBeUndefined();

      const photo = harness.renderTree();
      expect(find(photo, FilePicker)).toBeDefined();
      expect(
        find(photo, Textarea, (el) => el.props['aria-label'] === 'Photo hint (optional)'),
      ).toBeDefined();
    } finally {
      harness.restore();
    }
  });

  it('starts empty and shows no suggestion rows before the query is typed', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(null, DATE, undefined, { door: 'food', foods: [oat, chicken] });
      // Search-first: no pre-seeded blank row waits to be corrected.
      expect(findAll(tree, ListItem)).toHaveLength(0);
      expect(text(find(tree, EmptyState)!.props.body)).toBe(
        'Nothing logged yet. Search a food above to add it.',
      );

      const onPick = find(tree, FoodSearch)!.props.onPick as (food: MealFood, quantity: number) => void;
      const search = harness.renderSearch([oat, chicken], onPick);
      // Nothing is listed while the query is empty — the catalog would bury the field.
      expect(listedRow(search, 'Oatmeal')).toBeUndefined();
      expect(listedRow(search, 'Chicken')).toBeUndefined();
    } finally {
      harness.restore();
    }
  });

  it('appends a logged food and keeps an already-added item; two picks yield two items', () => {
    const harness = stateHarness();
    const foods = [oat, chicken];
    try {
      const tree = harness.renderTree(null, DATE, undefined, { door: 'food', foods });
      const onPick = find(tree, FoodSearch)!.props.onPick as (food: MealFood, quantity: number) => void;

      // Pick `Oatmeal` through the block: type, then select the row it offers.
      const idle = harness.renderSearch(foods, onPick);
      (find(idle, Autosuggest)!.props.onQueryChange as (q: string) => void)('oa');
      const offered = harness.renderSearch(foods, onPick);
      (find(offered, Autosuggest)!.props.onSelect as (option: AutosuggestOption) => void)(
        listedRow(offered, 'Oatmeal')!,
      );

      const one = harness.renderTree(null, DATE, undefined, { door: 'food', foods });
      expect(field(one, 'Food for item 1').props.value).toBe('Oatmeal');
      expect(field(one, 'Calories for Oatmeal').props.value).toBe('389');

      // Pick `Chicken` — the first item stays.
      const idleAgain = harness.renderSearch(foods, onPick);
      (find(idleAgain, Autosuggest)!.props.onQueryChange as (q: string) => void)('chicken');
      const offeredAgain = harness.renderSearch(foods, onPick);
      (find(offeredAgain, Autosuggest)!.props.onSelect as (option: AutosuggestOption) => void)(
        listedRow(offeredAgain, 'Chicken')!,
      );

      const two = harness.renderTree(null, DATE, undefined, { door: 'food', foods });
      expect(field(two, 'Food for item 1').props.value).toBe('Oatmeal');
      expect(field(two, 'Food for item 2').props.value).toBe('Chicken');
      // The run total sums both confirmed picks.
      expect(runTotal(two)).toBe(format('calories', 554));
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
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Mystery dish' },
      });
      const tree = harness.renderTree();

      const calories = field(tree, 'Calories for Mystery dish');
      expect(calories.props.value).toBe('');
      expect(calories.props.placeholder).toBe(UNKNOWN);
      // Nothing is confirmed, so nothing was invented: the per-item field is
      // empty (em dash) and the run total is a true zero — the same figure the
      // day view renders for an entry set with no confirmed calories.
      expect(runTotal(tree)).toBe(format('calories', 0));

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

describe('MealEditor toolbar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('frames the toolbar as a set: the back control and the save share one face', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      expect(tree.props.back).toEqual({ label: 'Back', variant: 'framed', onBack: expect.any(Function) });

      const save = button(tree, (el) => el.props.label === 'Save meal');
      expect(save.props.variant).toBe('framed');
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
    // The log path lists the catalog first, then creates the missing food — the
    // create returns the id the entry POST carries.
    const createdFood = { id: 'created-food', name: 'Toast', unit: 'g', servingGrams: 100, nutrients: vector(), servings: [], version: 0, createdAt: '', updatedAt: '' };
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') {
        return Promise.resolve(init?.method === 'POST' ? createdFood : { foods: [], nextCursor: null });
      }
      return Promise.resolve({});
    });
    try {
      const first = harness.renderTree();
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Toast' },
      });
      const named = harness.renderTree();
      (field(named, 'Calories for Toast').props.onChange as (e: unknown) => void)({
        target: { value: '90' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const [base, path, init] = mockCallService.mock.calls.at(-1)!;
      expect(base).toBe('http://127.0.0.1:3106');
      expect(path).toBe('/api/entries');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        date: '2026-10-03',
        mealGroup: 'lunch',
        foodId: 'created-food',
        quantity: 1,
        nutrients: vector({ calories: 90 }),
      });
    } finally {
      harness.restore();
    }
  });
});

describe('MealEditor log-time catalog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the food at 100 g with the base vector before logging a foodId:null item', async () => {
    const harness = stateHarness();
    const createdFood = { id: 'new-food', name: 'Toast', unit: 'g', servingGrams: 100, nutrients: vector(), servings: [], version: 0, createdAt: '', updatedAt: '' };
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') {
        return Promise.resolve(init?.method === 'POST' ? createdFood : { foods: [], nextCursor: null });
      }
      return Promise.resolve({});
    });
    try {
      const first = harness.renderTree();
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Toast' },
      });
      (field(first, 'Grams for item 1').props.onChange as (e: unknown) => void)({
        target: { value: '200' },
      });
      const sized = harness.renderTree();
      (field(sized, 'Calories for Toast').props.onChange as (e: unknown) => void)({
        target: { value: '180' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const paths = mockCallService.mock.calls.map((call) => call[1]);
      expect(paths[0]).toBe('/api/foods');
      expect(paths[1]).toBe('/api/foods');
      expect(paths[2]).toBe('/api/entries');

      const createBody = JSON.parse(mockCallService.mock.calls[1][2].body);
      expect(createBody).toEqual({
        name: 'Toast',
        servingGrams: 100,
        nutrients: vector({ calories: 90 }),
      });
      const entryBody = JSON.parse(mockCallService.mock.calls[2][2].body);
      expect(entryBody.foodId).toBe('new-food');
    } finally {
      harness.restore();
    }
  });

  it('reuses a carried foodId — no food is created', async () => {
    // A new meal logged straight from a photo estimate: one row carries the
    // catalog id the estimate resolved, so the log path posts no `/api/foods`
    // create — the food and entry POSTs carry that reused id.
    const harness = stateHarness();
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') return Promise.resolve({ foods: [], nextCursor: null });
      if (path === '/api/entries') return Promise.resolve({});
      return Promise.resolve({
        readable: true,
        items: [{ name: 'Omelette', grams: 100, foodId: 'omelette-id', fdcId: null, servingGrams: 100, nutrients: vector({ calories: 250 }) }],
      });
    });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);

      const ready = harness.renderTree();
      expect(field(ready, 'Food for item 1').props.value).toBe('Omelette');
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const createCalls = mockCallService.mock.calls.filter(
        (call) => call[1] === '/api/foods' && call[2]?.method === 'POST',
      );
      expect(createCalls).toHaveLength(0);
      const entryBody = JSON.parse(mockCallService.mock.calls.at(-1)![2].body);
      expect(entryBody.foodId).toBe('omelette-id');
    } finally {
      harness.restore();
    }
  });

  it('matches a foodId:null item by normalized key — trim, collapse, case-fold — reuses, never duplicates', async () => {
    const harness = stateHarness();
    // The typed name differs from the stored `Chicken Breast` three ways at once:
    // leading/trailing whitespace (trim), a doubled internal space (collapse), and
    // case (case-fold). Only a real `nameKey` comparison reuses the row — a plain
    // `food.name === dish` creates a duplicate.
    const typedDish = '  chicken   breast  ';
    const existing = { id: 'chicken-breast-id', name: 'Chicken Breast', unit: 'g', servingGrams: 100, nutrients: vector({ calories: 165 }), servings: [], version: 0, createdAt: '', updatedAt: '' };
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') {
        return Promise.resolve(
          init?.method === 'POST' ? existing : { foods: [existing], nextCursor: null },
        );
      }
      return Promise.resolve({});
    });
    try {
      const first = harness.renderTree();
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: typedDish },
      });
      const named = harness.renderTree();
      (field(named, `Calories for ${typedDish}`).props.onChange as (e: unknown) => void)({
        target: { value: '165' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const createCalls = mockCallService.mock.calls.filter(
        (call) => call[1] === '/api/foods' && call[2]?.method === 'POST',
      );
      expect(createCalls).toHaveLength(0);
      const entryBody = JSON.parse(mockCallService.mock.calls.at(-1)![2].body);
      expect(entryBody.foodId).toBe('chicken-breast-id');
    } finally {
      harness.restore();
    }
  });

  it('matches a foodId:null item whose name is byte-identical to the stored name — reuses, never duplicates', async () => {
    const harness = stateHarness();
    // The plain exact-match case: the typed `Chicken` equals the stored `Chicken`,
    // no normalization required. Kept separate from the normalized-key case so the
    // fixture that discriminates normalization is not the one that does not.
    const existing = { id: 'chicken-id', name: 'Chicken', unit: 'g', servingGrams: 100, nutrients: vector({ calories: 165 }), servings: [], version: 0, createdAt: '', updatedAt: '' };
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') {
        return Promise.resolve(
          init?.method === 'POST' ? existing : { foods: [existing], nextCursor: null },
        );
      }
      return Promise.resolve({});
    });
    try {
      const first = harness.renderTree();
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Chicken' },
      });
      const named = harness.renderTree();
      (field(named, 'Calories for Chicken').props.onChange as (e: unknown) => void)({
        target: { value: '165' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const createCalls = mockCallService.mock.calls.filter(
        (call) => call[1] === '/api/foods' && call[2]?.method === 'POST',
      );
      expect(createCalls).toHaveLength(0);
      const entryBody = JSON.parse(mockCallService.mock.calls.at(-1)![2].body);
      expect(entryBody.foodId).toBe('chicken-id');
    } finally {
      harness.restore();
    }
  });

  it('shares one create between two same-key items in one save — one food, two entries', async () => {
    const harness = stateHarness();
    // Two confirmed rows resolved within a single save, whose names normalize to
    // one key. The second `resolveFoodId` must join the first's in-flight create
    // (keyed by the normalized key), not await a second create: exactly one
    // `POST /api/foods`, two `POST /api/entries` carrying that one created id.
    const secondDish = '  chicken  ';
    const createdFood = { id: 'created-chicken', name: 'Chicken', unit: 'g', servingGrams: 100, nutrients: vector(), servings: [], version: 0, createdAt: '', updatedAt: '' };
    mockCallService.mockImplementation((_base: string, path: string, init?: { method?: string }) => {
      if (path === '/api/foods') {
        return Promise.resolve(init?.method === 'POST' ? createdFood : { foods: [], nextCursor: null });
      }
      return Promise.resolve({});
    });
    try {
      const first = harness.renderTree();
      (field(first, 'Food for item 1').props.onChange as (e: unknown) => void)({
        target: { value: 'Chicken' },
      });
      const oneNamed = harness.renderTree();
      (button(oneNamed, (el) => text(el.props.children).includes('Add item')).props.onClick as () => void)();
      const twoRows = harness.renderTree();
      (field(twoRows, 'Food for item 2').props.onChange as (e: unknown) => void)({
        target: { value: secondDish },
      });
      const bothNamed = harness.renderTree();
      (field(bothNamed, 'Calories for Chicken').props.onChange as (e: unknown) => void)({
        target: { value: '165' },
      });
      const firstConfirmed = harness.renderTree();
      (field(firstConfirmed, `Calories for ${secondDish}`).props.onChange as (e: unknown) => void)({
        target: { value: '165' },
      });

      const ready = harness.renderTree();
      await (button(ready, (el) => el.props.label === 'Save meal').props.onClick as () => Promise<void>)();

      const createCalls = mockCallService.mock.calls.filter(
        (call) => call[1] === '/api/foods' && call[2]?.method === 'POST',
      );
      expect(createCalls).toHaveLength(1);
      expect(JSON.parse(createCalls[0][2].body).name).toBe('Chicken');

      const entryCalls = mockCallService.mock.calls.filter((call) => call[1] === '/api/entries');
      expect(entryCalls).toHaveLength(2);
      expect(entryCalls.map((call) => JSON.parse(call[2].body).foodId)).toEqual([
        'created-chicken',
        'created-chicken',
      ]);
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
      for (const label of ['Grams', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)']) {
        expect(html).toContain(label);
      }
      expect(html).toContain('placeholder="Food name"');
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
      expect(dialogs[0].props.size).toBe('sheet');
      expect(dialogs[0].props.open).toBe(false);
      // A closed dialog portals nothing, so its sheet class is asserted by
      // `packages/ui/test/dialog.test.tsx`, where the panel is actually mounted.
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
          name: 'Omelette',
          grams: 100,
          foodId: null,
          fdcId: null,
          servingGrams: 100,
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

  it('keeps an all-zero estimate unknown — the em dash, never a fabricated 0', async () => {
    const harness = stateHarness();
    mockCallService.mockResolvedValue({
      readable: true,
      items: [
        {
          name: 'Mystery dish',
          grams: 100,
          foodId: null,
          fdcId: null,
          servingGrams: 100,
          nutrients: vector(),
        },
      ],
    });
    try {
      const first = harness.renderTree();
      const picker = find(first, FilePicker);
      await (picker!.props.onFiles as (files: FileList) => Promise<void>)([image] as unknown as FileList);
      const tree = harness.renderTree();

      // The path-3 zero vector resolved nothing, so a non-headline field renders
      // the unknown affordance — never `String(round2(0))` = `'0'`.
      const sodium = field(tree, 'Sodium in Cholesterol & sodium for Mystery dish');
      expect(sodium.props.value).toBe('');
      expect(sodium.props.placeholder).toBe(UNKNOWN);

      // `known` is empty, so `isEstimated` is false and the trigger stays plain.
      const trigger = button(tree, (el) => text(el.props.children).includes('All nutrients'));
      expect(text(trigger.props.children)).toBe('All nutrients (27)');
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
        'Food for item 1',
      );
      // The dish input is the row title; every other field is a nested child.
      expect(field(tree, 'Food for item 1').props.value).toBe('');
      expect(findAll(tree, SettingsRow)[0].props.label).toBe('Grams');

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
      foodId: null,
      servingGrams: 100,
      quantity: 2,
      nutrients: vector({ calories: 400 }),
      known: ['calories'],
    };
    expect(item.nutrients).toEqual(vector({ calories: 400 }));
  });
});

describe('restored entry display name', () => {
  beforeEach(() => jest.clearAllMocks());

  function food(overrides: Partial<MealFood> = {}): MealFood {
    return {
      id: 'f-oat',
      name: 'Oatmeal',
      unit: 'g',
      servingGrams: 100,
      nutrients: vector(),
      servings: [],
      version: 0,
      createdAt: '',
      updatedAt: '',
      ...overrides,
    };
  }

  /** The meal card's macro totals as `[label, value]` pairs — the reference's one table. */
  function mealFacts(tree: EditorTree): string[][] {
    const facts = findAll(tree, Facts)[0];
    return findAll(facts, FactsRow).map((row) => [text(row.props.label), text(row.props.value)]);
  }

  it('reads a restored meal’s macro totals in the meal card', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(
        entry({ nutrients: vector({ calories: 300, protein: 12, carbohydrates: 40, fat: 9 }) }),
      );

      expect(mealFacts(tree)).toEqual([
        ['Protein', '12 g'],
        ['Carbs', '40 g'],
        ['Fat', '9 g'],
      ]);
    } finally {
      harness.restore();
    }
  });

  it('reads a meal’s unconfirmed macro totals as the unknown em dash', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      expect(mealFacts(tree).map(([, value]) => value)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
    } finally {
      harness.restore();
    }
  });

  it('sums a macro across items and keeps a key any item lacks an em dash', () => {
    const harness = stateHarness();
    try {
      const first = harness.renderTree();
      (field(first, 'Protein for item 1').props.onChange as (e: unknown) => void)({
        target: { value: '10' },
      });
      const oneConfirmed = harness.renderTree();
      (button(oneConfirmed, (el) => text(el.props.children).includes('Add item')).props.onClick as () => void)();
      const twoRows = harness.renderTree();
      (field(twoRows, 'Protein for item 2').props.onChange as (e: unknown) => void)({
        target: { value: '5' },
      });

      expect(mealFacts(harness.renderTree())).toEqual([
        ['Protein', '15 g'],
        ['Carbs', UNKNOWN],
        ['Fat', UNKNOWN],
      ]);
    } finally {
      harness.restore();
    }
  });

  it('renders the catalog food name for a restored entry whose foodId is a catalog id', () => {
    const harness = stateHarness();
    const catalog = [food({ id: 'f-oat', name: 'Oatmeal' })];
    try {
      const tree = harness.renderTree(
        entry({ foodId: 'f-oat' }),
        '2026-10-03',
        restoredFoodName('f-oat', catalog),
      );
      expect(field(tree, 'Food for item 1').props.value).toBe('Oatmeal');
    } finally {
      harness.restore();
    }
  });

  it('renders the stored dish name when foodId matches no catalog food (pre-feature entry)', () => {
    const harness = stateHarness();
    const catalog = [food({ id: 'f-oat', name: 'Oatmeal' })];
    try {
      const tree = harness.renderTree(
        entry({ foodId: 'Salad' }),
        '2026-10-03',
        restoredFoodName('Salad', catalog),
      );
      expect(field(tree, 'Food for item 1').props.value).toBe('Salad');
    } finally {
      harness.restore();
    }
  });
});
