import { NUTRIENTS, format, type NutrientVector } from '@life/nutrition';
import { formatLongDate } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/meal-api', () => ({
  collectDayEntries: jest.fn(),
  listDayEntries: jest.fn(),
  getMealTarget: jest.fn(),
  collectMealFoods: jest.fn(),
  collectMealFoodsIncludingDeleted: jest.fn(),
  restoredFoodName: jest.requireActual('@/lib/meal-api').restoredFoodName,
}));

import { ApiError } from '@/lib/api-error';
import {
  collectDayEntries,
  listDayEntries,
  getMealTarget,
  collectMealFoods,
  collectMealFoodsIncludingDeleted,
  type MealEntry,
  type MealFood,
  type MealTarget,
} from '@/lib/meal-api';
import { mealDay } from '@/app/(meals)/meals/day';
import {
  DayEntriesScroll,
  appendNextPage,
  groupedRows,
  type DayEntryRow,
  type DayEntriesPage,
} from '@/app/(meals)/meals/day-entries-scroll';
import { GROUPS } from '@/app/(meals)/meals/meal-groups';
import MealDatePage from '@/app/(meals)/meals/[date]/page';

const mockedCollectDayEntries = collectDayEntries as jest.MockedFunction<typeof collectDayEntries>;
const mockedListDayEntries = listDayEntries as jest.MockedFunction<typeof listDayEntries>;
const mockedGetMealTarget = getMealTarget as jest.MockedFunction<typeof getMealTarget>;
const mockedCollectMealFoods = collectMealFoods as jest.MockedFunction<typeof collectMealFoods>;
const mockedCollectMealFoodsIncludingDeleted = collectMealFoodsIncludingDeleted as jest.MockedFunction<
  typeof collectMealFoodsIncludingDeleted
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
    mockedCollectDayEntries.mockResolvedValue([]);
    // The row list reads page 1 through the cursor-taking read; for the fixtures that model a
    // one-page day it is simply the whole day the totals were summed from.
    mockedListDayEntries.mockImplementation(async (date) => {
      const entries = await mockedCollectDayEntries(date);
      return { entries, nextCursor: null, total: entries.length };
    });
    mockedGetMealTarget.mockRejectedValue(new ApiError(404, 'API 404 on /api/target'));
    mockedCollectMealFoods.mockResolvedValue([]);
    mockedCollectMealFoodsIncludingDeleted.mockResolvedValue([]);
  });

  it('renders the day total as the sum of confirmed entries, against the target', async () => {
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', nutrients: vector({ calories: 420 }) }),
      entry({ id: 'b', nutrients: vector({ calories: 180 }) }),
    ]);
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    // The headline is now `Kpi`'s two slots, so the figure and what it is
    // measured against cannot share one literal: the value slot holds the eaten
    // number, the unit slot the rest of the day summary. The value is grouped
    // the way the reference draws it (`1,180`), which the formatter does not do.
    expect(html).toMatch(/ui-kpi__value[^>]*>600</);
    // The reference writes the unit last: `of 2,000 kcal`.
    expect(html).toContain('of 2,000 kcal');
    expect(html).not.toContain('kcal of 2,000');
    expect(html).not.toContain('No meals logged today.');
  });

  it('draws the energy track only, never a macro bar', async () => {
    mockedCollectDayEntries.mockResolvedValue([
      entry({
        id: 'a',
        nutrients: vector({ calories: 600, protein: 62, carbohydrates: 131, fat: 39 }),
      }),
    ]);
    mockedGetMealTarget.mockResolvedValue(
      target({ calories: 2000, proteinG: 120, carbG: 220, fatG: 68 }),
    );

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    // The card is a calorie read-out: one energy track against the target, and no
    // macro track of its own — the grams live on the target screen.
    expect(html.match(/<progress/g)).toHaveLength(1);
    expect(html).toContain('aria-label="30 percent of the daily energy target"');
    expect(html).not.toContain('ui-progress--row');
    expect(html).toContain('Logged so far');
  });

  it('keeps the energy track with no target set, and no macro tracks either', async () => {
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', nutrients: vector({ calories: 300, protein: 20 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('No daily energy target set');
    // Empty fill: there is no goal to divide by, so nothing claims a share.
    expect(html.match(/aria-valuenow="0"/g)).toHaveLength(1);
  });

  it('names the day card read-out the way the reference does: "Logged so far"', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(/ui-kpi__label[^>]*>Logged so far</);
  });

  it('says "No target set" when the owner has no profile yet (target 404 is not an error)', async () => {
    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(/ui-kpi__value[^>]*>0</);
    expect(html).toContain('kcal — No target set');
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

  it('keeps every meal on the page, an empty one reading Not logged', async () => {
    mockedCollectDayEntries.mockResolvedValue([
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
      // The heading keeps the label; the subtotal moved into the section's
      // count slot, so the two no longer share one `Label — n kcal` literal.
      expect(html).toContain(`>${label}</h2>`);
      expect(html).toMatch(new RegExp(`ui-section__count[^>]*>${format('calories', kcal)}<`));
    }
    // A group with nothing logged stays on the page rather than vanishing, so
    // the day reads as the four meals it is made of.
    expect(html).toContain('>Dinner</h2>');
    expect(html).toMatch(/ui-section__count[^>]*>Not logged</);
    expect(html).toContain('Nothing yet.');
    expect(html).toContain('No meals logged in this meal yet.');
    const order = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((label) => html.indexOf(label));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the portion in meta and draws the calories as a trailing pill', async () => {
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: 'Toast', quantity: 2, nutrients: vector({ calories: 123 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('Toast');
    expect(html).toMatch(/ui-list-item__sub[^"]*"><span class="ui-list-item__meta[^"]*">× 2</);
    // The kcal is the reference's `.row__trail` neutral pill, read once.
    expect(html).toMatch(/ui-pill[^>]*>123 kcal</);
  });

  it('titles a catalog entry with the resolved food name, never the raw id', async () => {
    const uuid = '8bac894d-9a96-4102-8c49-ad9978ddfde4';
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: uuid, quantity: 2, nutrients: vector({ calories: 123 }) }),
    ]);
    mockedCollectMealFoodsIncludingDeleted.mockResolvedValue([food({ id: uuid, name: 'Chicken' })]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(
      /ui-list-item__title[^"]*">Chicken<\/span><span class="ui-list-item__sub[^"]*"><span class="ui-list-item__meta[^"]*">× 2</,
    );
    expect(html).toMatch(/ui-pill[^>]*>123 kcal</);
    expect(html).not.toContain(uuid);
  });

  it('resolves the day view through the include-deleted read (a deleted food still names the entry)', async () => {
    const uuid = '8bac894d-9a96-4102-8c49-ad9978ddfde4';
    const deletedUuid = '4c2a0000-1111-2222-3333-444455556666';
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: uuid, quantity: 2, nutrients: vector({ calories: 123 }) }),
      entry({ id: 'b', foodId: deletedUuid, quantity: 1, nutrients: vector({ calories: 200 }) }),
    ]);
    mockedCollectMealFoodsIncludingDeleted.mockResolvedValue([
      food({ id: uuid, name: 'Chicken' }),
      food({ id: deletedUuid, name: 'Milk, Brand X' }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(mockedCollectMealFoodsIncludingDeleted).toHaveBeenCalledTimes(1);
    expect(mockedCollectMealFoods).not.toHaveBeenCalled();
    expect(html).toContain('Chicken');
    expect(html).toContain('Milk, Brand X');
    expect(html).not.toContain(deletedUuid);
  });

  it('falls back to calories as the title when a dish is blank', async () => {
    mockedCollectDayEntries.mockResolvedValue([
      entry({ id: 'a', foodId: '   ', nutrients: vector({ calories: 123 }) }),
    ]);

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(
      /ui-list-item__title[^"]*">123 kcal<\/span><span class="ui-list-item__sub[^"]*"><span class="ui-list-item__meta[^"]*">× 1</,
    );
    // The pill is skipped when the title already IS the figure, so the row never
    // reads the same kcal twice.
    expect(html).not.toMatch(/ui-pill[^>]*>123 kcal</);
  });

  it('renders the [date] route through the same view for the route day', async () => {
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));
    const el = await MealDatePage({ params: Promise.resolve({ date: '2026-10-02' }) });
    const html = renderToStaticMarkup(el);

    expect(mockedCollectDayEntries).toHaveBeenCalledWith('2026-10-02');
    expect(mockedGetMealTarget).toHaveBeenCalledWith('2026-10-02');
    // The page header is the shared shell's: title over the day's long date.
    expect(html).toContain('>Meals</h1>');
    expect(html).toContain(formatLongDate('2026-10-02'));
    expect(html).toContain('aria-label="Log a meal"');
    expect(html).toContain('No meals logged on this day.');
  });
});

/** One row as the server builds it, for the shell's own fixtures. */
function row(overrides: Partial<DayEntryRow> = {}): DayEntryRow {
  return { id: 'r1', mealGroup: 'lunch', title: 'Toast', meta: '× 1', pill: '120 kcal', ...overrides };
}

/**
 * The row list pages; the figures do not. `apps/app` jest runs on `jest-environment-node`, so
 * nothing here can press the control: the append is driven from the fixture side, and the
 * live click is measured by the parent.
 */
describe('meals day view paging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMealTarget.mockResolvedValue(target({ calories: 2000 }));
    mockedCollectMealFoods.mockResolvedValue([]);
    mockedCollectMealFoodsIncludingDeleted.mockResolvedValue([]);
  });

  it('takes the row list from page 1 of the cursor read, uncursored', async () => {
    const pageOne = entry({ id: 'p1', foodId: 'Toast', nutrients: vector({ calories: 420 }) });
    const later = entry({ id: 'p2', foodId: 'Yoghurt', nutrients: vector({ calories: 180 }) });
    mockedCollectDayEntries.mockResolvedValue([pageOne, later]);
    mockedListDayEntries.mockResolvedValue({
      entries: [pageOne],
      nextCursor: 'cursor-2',
      total: 2,
    });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(mockedListDayEntries).toHaveBeenCalledWith('2026-10-03');
    expect(html).toContain('Toast');
    // The row on page 2 is not on screen yet, so it is not in this markup.
    expect(html).not.toContain('Yoghurt');
  });

  it('offers one load-more control while page 1 carries a next cursor', async () => {
    const pageOne = entry({ id: 'p1', nutrients: vector({ calories: 420 }) });
    mockedCollectDayEntries.mockResolvedValue([pageOne]);
    mockedListDayEntries.mockResolvedValue({ entries: [pageOne], nextCursor: 'cursor-2', total: 2 });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html.match(/>Load more</g)).toHaveLength(1);
  });

  it('renders no load-more control when the whole day fits on page 1', async () => {
    const pageOne = entry({ id: 'p1', nutrients: vector({ calories: 420 }) });
    mockedCollectDayEntries.mockResolvedValue([pageOne]);
    mockedListDayEntries.mockResolvedValue({ entries: [pageOne], nextCursor: null, total: 1 });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).not.toContain('Load more');
  });

  it('computes the headline, the read-out and the energy track from the complete day, not the loaded rows', async () => {
    // The day holds 600 kcal across two entries; page 1 carries only the 420 one. A headline
    // derived from the loaded rows would read 420 / 21%, so these two figures are the proof
    // that paging cannot move them.
    const pageOne = entry({ id: 'p1', nutrients: vector({ calories: 420 }) });
    const onPageTwo = entry({ id: 'p2', mealGroup: 'dinner', nutrients: vector({ calories: 180 }) });
    mockedCollectDayEntries.mockResolvedValue([pageOne, onPageTwo]);
    mockedListDayEntries.mockResolvedValue({ entries: [pageOne], nextCursor: 'cursor-2', total: 2 });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toMatch(/ui-kpi__value[^>]*>600</);
    expect(html).toContain('of 2,000 kcal');
    expect(html).toContain('aria-label="30 percent of the daily energy target"');
    expect(html).not.toMatch(/ui-kpi__value[^>]*>420</);
  });

  it('gives each group its whole-day subtotal even when that meal\'s rows sit on a page not loaded yet', async () => {
    const pageOne = entry({ id: 'b1', mealGroup: 'breakfast', nutrients: vector({ calories: 300 }) });
    const breakfastLater = entry({ id: 'b2', mealGroup: 'breakfast', nutrients: vector({ calories: 200 }) });
    mockedCollectDayEntries.mockResolvedValue([pageOne, breakfastLater]);
    mockedListDayEntries.mockResolvedValue({ entries: [pageOne], nextCursor: 'cursor-2', total: 2 });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    // 500 is the meal's whole-day figure; the 300 on screen is only what page 1 loaded.
    expect(html).toMatch(new RegExp(`ui-section__count[^>]*>${format('calories', 500)}<`));
    // A meal with no entry anywhere in the day keeps its empty box.
    expect(html).toContain('No meals logged in this meal yet.');
  });

  it('keeps the whole-day empty state when the day has no entries at all', async () => {
    mockedCollectDayEntries.mockResolvedValue([]);
    mockedListDayEntries.mockResolvedValue({ entries: [], nextCursor: null, total: 0 });

    const html = renderToStaticMarkup(await mealDay('2026-10-03', 'No meals logged today.'));

    expect(html).toContain('No meals logged today.');
    expect(html).not.toContain('Nothing yet.');
    expect(html).not.toContain('Load more');
  });
});

/**
 * The shell's own rules, driven from the fixture side: `renderToStaticMarkup` runs the function
 * body but no click, so an appended page is modelled by handing the shell the merged rows it
 * holds after `loadNextPage` resolves.
 */
describe('day entries shell', () => {
  /** The whole day, as the server hands the shell its complete per-group figures. */
  const COMPLETE_DAY = {
    breakfast: { calories: format('calories', 500) },
    lunch: { calories: format('calories', 420) },
    dinner: { calories: null },
    snack: { calories: null },
  } as const;

  it('re-buckets an appended row into the meal it belongs to, not a second group for that meal', () => {
    const merged = [
      row({ id: 'b1', mealGroup: 'breakfast', title: 'Oats' }),
      row({ id: 'l1', mealGroup: 'lunch', title: 'Toast' }),
      // Appended on page 2, and it belongs to a meal already on screen.
      row({ id: 'b2', mealGroup: 'breakfast', title: 'Coffee' }),
    ];

    const buckets = groupedRows(merged);

    expect(buckets.map((bucket) => bucket.group.label)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
    expect(buckets[0].items.map((item) => item.id)).toEqual(['b1', 'b2']);
    expect(buckets[1].items.map((item) => item.id)).toEqual(['l1']);
    expect(buckets[2].items).toEqual([]);
    expect(buckets[3].items).toEqual([]);
  });

  it('renders the groups in GROUPS order from the merged rows, with the complete-day subtotals', () => {
    const merged = [
      row({ id: 'b1', mealGroup: 'breakfast', title: 'Oats' }),
      row({ id: 'l1', mealGroup: 'lunch', title: 'Toast' }),
      row({ id: 'b2', mealGroup: 'breakfast', title: 'Coffee' }),
    ];

    const html = renderToStaticMarkup(
      <DayEntriesScroll
        rows={merged}
        nextCursor={null}
        groups={COMPLETE_DAY}
        loadPage={async (): Promise<DayEntriesPage> => ({ rows: [], nextCursor: null })}
      />,
    );

    const order = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((label) => html.indexOf(`>${label}</h2>`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Both breakfast rows sit under the one Breakfast heading: Coffee is appended after Toast.
    expect(html.indexOf('Oats')).toBeLessThan(html.indexOf('Coffee'));
    expect(html.indexOf('Coffee')).toBeLessThan(html.indexOf('>Lunch</h2>'));
    // The heading reads the whole day's 500 kcal for the meal, not the 420 the two rows carry.
    expect(html).toMatch(new RegExp(`ui-section__count[^>]*>${format('calories', 500)}<`));
    // A meal with nothing logged anywhere in the day still reads Not logged, with its empty box.
    expect(html).toMatch(/ui-section__count[^>]*>Not logged</);
    expect(html).toContain('Nothing yet.');
    expect(GROUPS).toHaveLength(4);
  });

  it('draws no empty box for a meal whose entries all sit on pages not loaded yet', () => {
    // The heading's subtotal already reports this meal's exact figure, and the empty box's copy
    // says nothing was logged in the meal — which would be a lie here.
    const html = renderToStaticMarkup(
      <DayEntriesScroll
        rows={[row({ id: 'l1', mealGroup: 'lunch' })]}
        nextCursor="cursor-2"
        groups={{ ...COMPLETE_DAY, dinner: { calories: format('calories', 700) } }}
        loadPage={async (): Promise<DayEntriesPage> => ({ rows: [], nextCursor: null })}
      />,
    );

    expect(html).toMatch(new RegExp(`ui-section__count[^>]*>${format('calories', 700)}<`));
    // Lunch has a row and Dinner's entries are on a page not loaded yet, so neither claims
    // nothing was logged in the meal; only Snacks, empty across the whole day, says so.
    const dinner = html.slice(html.indexOf('>Dinner</h2>'), html.indexOf('>Snacks</h2>'));
    expect(dinner).not.toContain('Nothing yet.');
    expect(html.match(/Nothing yet\./g)).toHaveLength(1);
  });

  it('renders no load-more control when the cursor is exhausted', () => {
    const html = renderToStaticMarkup(
      <DayEntriesScroll rows={[row()]} nextCursor={null} groups={COMPLETE_DAY} loadPage={jest.fn()} />,
    );

    expect(html).not.toContain('Load more');
  });

  it('appends the next page onto the rows in hand, in arrival order', async () => {
    const current = [row({ id: 'b1', mealGroup: 'breakfast' })];
    const loadPage = jest.fn(async (): Promise<DayEntriesPage> => ({
      rows: [row({ id: 'b2', mealGroup: 'breakfast' })],
      nextCursor: null,
    }));

    const outcome = await appendNextPage('cursor-2', loadPage, current);

    expect(loadPage).toHaveBeenCalledWith('cursor-2');
    expect(outcome).toEqual({
      loaded: true,
      rows: [current[0], expect.objectContaining({ id: 'b2' })],
      cursor: null,
    });
  });

  it('keeps the rows in hand and the cursor when an appended page fails', async () => {
    const current = [row({ id: 'b1' })];
    const loadPage = jest.fn(async (): Promise<DayEntriesPage> => {
      throw new Error('upstream error');
    });

    const outcome = await appendNextPage('cursor-2', loadPage, current);

    // Nothing lost: the rows and the cursor are untouched, so the control re-arms on the same
    // cursor and the shell only adds the banner.
    expect(outcome).toEqual({ loaded: false });
    expect(current).toHaveLength(1);
  });
});
