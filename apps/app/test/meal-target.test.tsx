import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { format } from '@life/nutrition';
import { EditorChrome, IconButton, Input, Select, SettingsRow, StatusText } from '@life/ui';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// The form's editor chrome reads the router on render (Back via `router.back()`),
// so the hook must resolve off the raw module the compiled client component reads.
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

jest.mock('@/lib/meal-api', () => ({
  getMealTarget: jest.fn(),
  putMealProfile: jest.fn(),
}));

import { revalidatePath } from 'next/cache';
import { getMealTarget, putMealProfile, type MealTarget } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { ApiError } from '@/lib/api-error';
import TargetPage from '@/app/(meals)/meals/target/page';
import { TargetProfileForm } from '@/app/(meals)/meals/target/form';
import { saveProfileAction } from '@/app/(meals)/meals/target/actions';

const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;
const mockedGetMealTarget = getMealTarget as jest.MockedFunction<typeof getMealTarget>;
const mockedPutMealProfile = putMealProfile as jest.MockedFunction<typeof putMealProfile>;
const mockedRevalidatePath = revalidatePath as jest.MockedFunction<typeof revalidatePath>;

// The compiled client component reads its hooks off the raw `react` module at call
// time, so spying there intercepts a direct `TargetProfileForm(...)` call (the
// position-keyed harness used by the app's other editor/form tests).
const ReactModule = jest.requireActual<typeof import('react')>('react');

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
    proteinG: 112,
    fatG: 42,
    carbG: 345,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Tree extends ReactElement {
  props: { children?: ReactNode };
}

/** Position-keyed `useState` store, persistent across `renderTree` calls. */
function stateHarness() {
  const store: unknown[] = [];
  const spy = jest.spyOn(ReactModule, 'useState');

  function renderTree(initial: MealTarget | null = null): Tree {
    let index = 0;
    spy.mockImplementation(((value: unknown) => {
      const i = index++;
      if (i >= store.length) {
        store[i] = typeof value === 'function' ? (value as () => unknown)() : value;
      }
      const set = (next: unknown) => {
        store[i] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(store[i]) : next;
      };
      return [store[i], set];
    }) as unknown as typeof ReactModule.useState);
    return TargetProfileForm({ initial }) as unknown as Tree;
  }

  return { renderTree, restore: () => spy.mockRestore() };
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

/** The labelled control, found by its `aria-label`. */
function field(tree: Tree, label: string): ReactElement<Record<string, unknown>> {
  const found = find(tree, undefined, (el) => el.props['aria-label'] === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return found;
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isElement(node)) return text(node.props.children);
  return '';
}

/** Type into a labelled field (the store persists, so re-render to read it back). */
function type(tree: Tree, label: string, value: string): void {
  (field(tree, label).props.onChange as (event: unknown) => void)({ target: { value } });
}

describe('target profile form composition', () => {
  beforeEach(() => jest.clearAllMocks());

  it('collects the profile inputs from @life/ui primitives, never a raw control', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      expect(field(tree, 'Age').type).toBe(Input);
      expect(field(tree, 'Height (cm)').type).toBe(Input);
      expect(field(tree, 'Weight (kg)').type).toBe(Input);
      // Every closed choice is a Select over the service enum.
      expect(field(tree, 'Sex').type).toBe(Select);
      expect(field(tree, 'Activity').type).toBe(Select);
      expect(field(tree, 'Goal').type).toBe(Select);

      const html = renderToStaticMarkup(tree);
      expect(html).toContain('ui-input');
      expect(html).toContain('ui-select');
      // The toolbar save is an IconButton now — no bare submit button remains.
      expect(html).toContain('ui-icon-btn');
      expect(html).not.toContain('Set target');
    } finally {
      harness.restore();
    }
  });

  it('frames the fields in the editor chrome: one back control and one save', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      const chrome = find(tree, EditorChrome);
      expect(chrome).toBeDefined();
      // Back is the chrome's own control, not an in-body link.
      expect((chrome!.props.back as { label: string }).label).toBe('Back');

      // Exactly one save trigger: the IconButton in `actions`, body provides none.
      const save = find(chrome!.props.actions, IconButton);
      expect(save).toBeDefined();
      expect(save!.props.label).toBe('Save');
      expect(find(tree, 'button', (el) => el.props.type === 'submit')).toBeUndefined();

      const html = renderToStaticMarkup(tree);
      expect(html).toContain('Daily target');
    } finally {
      harness.restore();
    }
  });

  it('shows every profile field as a visible label beside its control', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();

      // The visible labels are `SettingsRow` copy; each row still hosts the
      // labelled control, so sighted and assistive users read the same field.
      for (const label of ['Age', 'Sex', 'Height (cm)', 'Weight (kg)', 'Activity', 'Goal']) {
        const row = find(tree, SettingsRow, (el) => text(el.props.label) === label);
        expect(row).toBeDefined();
        expect(field(tree, label)).toBeDefined();
      }
    } finally {
      harness.restore();
    }
  });

  it('offers exactly the service activity and goal enums', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();
      const values = (label: string) =>
        (field(tree, label).props.options as Array<{ value: string }>).map((option) => option.value);

      // `ACTIVITY_LEVELS` and `GOALS` in apps/meal-service/src/targets.
      expect(values('Activity')).toEqual(['sedentary', 'light', 'moderate', 'active', 'veryActive']);
      expect(values('Goal')).toEqual(['lose', 'maintain', 'gain']);
      expect(values('Sex')).toEqual(['male', 'female']);
    } finally {
      harness.restore();
    }
  });
});

describe('target profile form submits inputs only', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends exactly the six profile inputs plus the shared day — no computed value', async () => {
    mockedGetToday.mockResolvedValue('2026-10-03');
    mockedPutMealProfile.mockResolvedValue(target());
    const harness = stateHarness();
    try {
      const first = harness.renderTree();
      type(first, 'Age', '30');
      const second = harness.renderTree();
      type(second, 'Height (cm)', '175');
      const third = harness.renderTree();
      type(third, 'Weight (kg)', '70');
      const fourth = harness.renderTree();
      (field(fourth, 'Goal').props.onChange as (event: unknown) => void)({ target: { value: 'lose' } });

      const ready = harness.renderTree();
      const form = find(ready, 'form');
      if (!form) throw new Error('no form');
      await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: jest.fn() });

      expect(mockedGetToday).toHaveBeenCalledTimes(1);
      expect(mockedPutMealProfile).toHaveBeenCalledTimes(1);
      const body = mockedPutMealProfile.mock.calls[0][0];
      expect(body).toEqual({
        age: 30,
        sex: 'male',
        heightCm: 175,
        weightKg: 70,
        activity: 'moderate',
        goal: 'lose',
        date: '2026-10-03',
      });
      // The service forbids unknown properties: a computed key here is a 400.
      for (const computed of ['bmr', 'tdee', 'calories', 'proteinG', 'fatG', 'carbG', 'macros']) {
        expect(body).not.toHaveProperty(computed);
      }
      // The write revalidates both the target page and the day view.
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/meals/target');
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/meals');
    } finally {
      harness.restore();
    }
  });

  it('refuses an empty numeric body before it can reach the service', async () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree();
      const form = find(tree, 'form');
      if (!form) throw new Error('no form');
      await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: jest.fn() });

      expect(mockedPutMealProfile).not.toHaveBeenCalled();
      // The empty-state headline is also a `StatusText`; the error is the row
      // carrying the validation copy, so match on its text.
      const alert = find(
        harness.renderTree(),
        StatusText,
        (el) => text(el).includes('Enter your age'),
      );
      expect(alert).toBeDefined();
      expect(text(alert)).toContain('Enter your age');
    } finally {
      harness.restore();
    }
  });
});

describe('saveProfileAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores through PUT /api/target/profile with the day the shared owner resolves', async () => {
    mockedGetToday.mockResolvedValue('2026-10-03');
    mockedPutMealProfile.mockResolvedValue(target());

    await saveProfileAction({ age: 30, sex: 'male', heightCm: 175, weightKg: 70, activity: 'moderate', goal: 'maintain' });

    expect(mockedGetToday).toHaveBeenCalled();
    expect(mockedPutMealProfile).toHaveBeenCalledWith({
      age: 30,
      sex: 'male',
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
      date: '2026-10-03',
    });
  });
});

describe('target page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetToday.mockResolvedValue('2026-10-03');
  });

  it('renders the target applicable to the shared day, through the nutrition formatter', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2400 }));

    const el = await TargetPage();
    const html = renderToStaticMarkup(el);

    expect(mockedGetMealTarget).toHaveBeenCalledWith('2026-10-03');
    // The page is the form itself: no app shell (PageShell/Card/NavBar) wraps it.
    expect(el.type).toBe(TargetProfileForm);
    // The derived-energy card is the headline: `Kpi`'s value slot carries the
    // grouped figure (the shared formatter does not group) and the unit the word,
    // then the three macro totals as `Facts` rows.
    expect(html).toMatch(/ui-kpi__value[^>]*>2,400</);
    expect(html).toContain('>kcal<');
    expect(html).toContain(format('protein', 112));
    expect(html).toContain(format('carbohydrates', 345));
    // The stored profile reads back as pill rows above the fields.
    expect(html).toContain('30 years');
    expect(html).toContain('Moderate');
    expect(html).toContain('Maintain');
    expect(html).not.toContain('No target set yet');
    // The stored profile opens the form as an edit, not as an empty onboarding form.
    expect(html).toContain('aria-label="Age"');
    expect(html).toContain('value="30"');
    expect(html).toContain('Update your profile');
  });

  it('opens the first-run form with defaults on a missing target (404 is not an error)', async () => {
    mockedGetMealTarget.mockRejectedValue(new ApiError(404, 'API 404 on /api/target'));

    const el = await TargetPage();
    const html = renderToStaticMarkup(el);

    // The page is an editor screen now (lesson 0014: the chrome is the shell) —
    // assert the rendered markup, not the element tree: `el` is the form element
    // and `find` only walks element props, not the function it points at.
    expect(html).toContain('ui-editor-toolbar');
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('>Daily target</h1>');
    expect(html).toContain('aria-label="Save"');
    expect(html).toContain('No target set yet');
    expect(html).toContain('Set your target');
  });
});
