import { expect, test, type Page } from '@playwright/test';
import { logIn } from './journey';

/**
 * The meals day view, driven as a user (`SPEC-meal-capture-ui` Testing
 * Strategy). Everything runs against the real `meal-service` the harness spawns
 * and the app reaches through `MEAL_API_URL` — no fixture data is posted from
 * the spec, so a broken service URL fails these five concerns loudly.
 *
 * Selectors are the FROZEN surface only (roles, visible text, aria-labels); this
 * spec changes no app code to make one pass. The unreadable-photo journey
 * uploads a type the provider does not carry, so that concern rides the photo
 * door's own `could-not-read` path and calls no provider.
 */

/**
 * The day view's entry doors, exactly as they render. Both wait in the log FAB
 * menu (`Log a meal` trigger): the photo capture door and the manual catalog
 * door. `Saved meals` is the toolbar nav icon.
 */
const PHOTO_DOOR = 'Log meal from photo';
const FOOD_DOOR = 'Log food';
const SAVED_DOOR = 'Saved meals';

/** A saved-meal name per run, so a rerun can never collide with the last one. */
const SAVED_MEAL = `Overnight oats ${Date.now().toString(36)}`;

/** A photo the provider does not read: the client rejects a type it cannot carry before any network call, so the photo door's own `could-not-read` path runs deterministically (no provider round-trip). */
const PHOTO = {
  name: 'meal.tiff',
  mimeType: 'image/tiff',
  buffer: Buffer.from('SUkqAgAAAQAB', 'base64'),
};

/** Logs in and lands on the meals day view, waiting for its heading. */
async function openMeals(page: Page): Promise<void> {
  await logIn(page);
  await page.goto('/meals');
  await expect(page.getByRole('heading', { name: /^Meals —/ })).toBeVisible({ timeout: 30_000 });
}

/** Opens the editor the given door leads to: the door waits in the log FAB menu. */
async function openDoor(page: Page, door: string): Promise<void> {
  const option = page.getByRole('menuitem', { name: door, exact: true });
  // A test that already opened the menu leaves it open; only click the trigger
  // when the door is still hidden, so a toggle never closes what it means to open.
  if (!(await option.isVisible())) {
    await page.getByRole('button', { name: 'Log a meal' }).click();
  }
  await option.click();
  await page.waitForURL(/\/meals\/entry\/new/, { timeout: 15_000 });
}

/**
 * The day's own total: the only `role="status"` on the day view (`<Card><StatusText>`).
 * The status text is the day summary (`"1220 kcal — No target set"`), so the
 * leading calorie figure is read off, not the whole string parsed.
 */
async function dayTotal(page: Page): Promise<number> {
  const text = await page.getByRole('status').innerText();
  const match = /([\d.]+)\s*kcal/.exec(text);
  if (!match) throw new Error(`not a calorie read-out: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/**
 * The confirmed entries the day view actually lists: every row carrying the
 * `N kcal × <portions>` read-out, each read back from its own calorie figure.
 * A row without a `×` is an unconfirmed entry and is skipped; a row that has a
 * `×` but no readable figure before it is spec drift and throws. Reading the
 * day's sum off the page is the only honest check — a pre-known total would
 * have to be re-derived here, which is the drift this replaces.
 */
async function listedEntryCalories(page: Page): Promise<number[]> {
  const rows = await page.getByRole('listitem').allInnerTexts();
  const figures: number[] = [];
  for (const row of rows) {
    if (!row.includes('×')) continue;
    const match = /(?:^|\s)([\d.]+)\s*kcal\s*×/.exec(row.replace(/\n/g, ' '));
    if (!match) throw new Error(`not a calorie read-out: ${JSON.stringify(row)}`);
    figures.push(Number(match[1]));
  }
  return figures;
}

/** A catalog food per run, so a rerun can never collide with the last one. */
const FOOD = `Milk, Brand X ${Date.now().toString(36)}`;

/** The food as the edit form renders it: the UI's read-back of `GET /api/foods/:id`. */
interface StoredFood {
  nutrients: { calories: number };
  servings: { label: string; amount: number }[];
}

/**
 * Opens one food's edit page — the page whose server component calls
 * `GET /api/foods/:id` — so a create is checked against what the service
 * stores, not against the list's summary line.
 */
async function gotoFoodEditPage(page: Page, name: string): Promise<void> {
  // The row link's name is title + meta, so this is a substring match.
  await page.getByRole('link', { name }).click();
  await page.waitForURL(/\/meals\/foods\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Edit food', exact: true })).toBeVisible();
}

/** The food as the open edit page renders it: the UI's read-back of the stored row. */
async function readFoodForm(page: Page): Promise<StoredFood> {
  return {
    nutrients: { calories: Number(await page.getByLabel('Calories per 100').inputValue()) },
    servings: [
      {
        label: await page.getByLabel('Measure 1 label').inputValue(),
        amount: Number(await page.getByLabel('Measure 1 amount in ml').inputValue()),
      },
    ],
  };
}

/** One catalog food as the manual-log journey needs it: everything typed by hand
 * (`SPEC-food-catalog-ui` AC3 — no model fill), so a staple is a single value. */
interface NewCatalogFood {
  name: string;
  unit: string;
  calories: string;
  measureLabel: string;
  measureAmount: string;
}

/**
 * Creates one catalog food through the shipped form; the manual-log door needs a
 * saved staple before it can offer one. Ends on the catalog listing the new food.
 */
async function createFoodViaCatalog(page: Page, food: NewCatalogFood): Promise<void> {
  await page.goto('/meals/foods');
  await page.getByRole('link', { name: 'New food', exact: true }).click();
  await page.waitForURL(/\/meals\/foods\/new$/, { timeout: 15_000 });
  await page.getByLabel('Food name').fill(food.name);
  await page.getByLabel('Unit').selectOption(food.unit);
  await page.getByLabel('Calories per 100').fill(food.calories);
  await page.getByRole('button', { name: 'Add measure', exact: true }).click();
  await page.getByLabel('Measure 1 label').fill(food.measureLabel);
  await page.getByLabel(`Measure 1 amount in ${food.unit}`).fill(food.measureAmount);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });
  await expect(page.getByRole('link', { name: food.name })).toBeVisible({ timeout: 15_000 });
}

/** Lands on the meals day view, waiting for its heading. */
async function openDayView(page: Page): Promise<void> {
  await page.goto('/meals');
  await expect(page.getByRole('heading', { name: /^Meals —/ })).toBeVisible({ timeout: 15_000 });
}

/**
 * The foods catalog acts as one user sentence (`SPEC-food-catalog-ui` Testing
 * Strategy): the toolbar Foods icon reaches the catalog, the FAB opens the
 * create form, create persists and reads back at the edit page's own source,
 * and delete removes the food. History immutability is proven by the manual-log
 * journey, which owns a logged entry; this one owns the catalog CRUD. The two
 * journey titles below are the plan's exact Run-2 `-g` anchors: keep them
 * byte-identical to `tasks/plan.md` when editing, so a renamed test is never
 * silently skipped by a verifier.
 */
test.describe('meals foods catalog', () => {
  test('the foods catalog door adds, edits, and deletes a staple', async ({ page }) => {
    await openMeals(page);

    // The toolbar door opens the catalog: the promised entry point (`Foods`).
    await page.getByRole('link', { name: 'Foods', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Foods', exact: true })).toBeVisible();

    // The FAB opens the create form: name, unit, per-100 facts, one measure.
    // The form starts with no measure rows, so add the row before filling it.
    await page.getByRole('link', { name: 'New food', exact: true }).click();
    await page.waitForURL(/\/meals\/foods\/new$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'New food', exact: true })).toBeVisible();
    await page.getByLabel('Food name').fill(FOOD);
    await page.getByLabel('Unit').selectOption('ml');
    await page.getByLabel('Calories per 100').fill('52');
    await page.getByRole('button', { name: 'Add measure', exact: true }).click();
    await page.getByLabel('Measure 1 label').fill('1 carton');
    await page.getByLabel('Measure 1 amount in ml').fill('1000');

    // Saving lands on the catalog, and the new food is listed.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: FOOD })).toBeVisible({ timeout: 15_000 });

    // Read back at the source: the edit page is the caller of `GET /api/foods/:id`.
    await gotoFoodEditPage(page, FOOD);
    const stored = await readFoodForm(page);
    expect(stored.nutrients.calories).toBe(52);
    expect(stored.servings).toEqual([{ label: '1 carton', amount: 1000 }]);

    // The unit was chosen once: the edit form renders it read-only, never a select.
    await expect(page.getByLabel('Unit')).toHaveCount(0);
    await expect(page.getByText('Facts below are per 100 ml — a blank value is 0.')).toBeVisible();

    // Edit the name; the save must succeed, which requires the service's
    // version check to pass (version + 1, proven in the service tests).
    await page.getByLabel('Food name').fill(`${FOOD} - edited`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: `${FOOD} - edited` })).toBeVisible({
      timeout: 15_000,
    });

    // The delete confirm removes the food and returns to the catalog.
    await page.getByRole('link', { name: `${FOOD} - edited` }).click();
    await page.waitForURL(/\/meals\/foods\/[^/]+$/, { timeout: 15_000 });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete food', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: `${FOOD} - edited` })).toHaveCount(0);
  });
});

/**
 * The manual-log act as one user sentence (`SPEC-manual-log-ui` Testing
 * Strategy): a saved staple, the FAB's manual door, the search-first picker's
 * appended review, the one save path — and then the history guard, because this
 * journey owns the one logged entry. Rewriting the food's facts and deleting it
 * must leave that entry's row and the day total byte-identical.
 */
test.describe('meals manual log', () => {
  test('the manual log door records a catalog staple in a few taps', async ({ page }) => {
    await openMeals(page);

    // A saved staple is the door's only precondition (the empty-catalog state
    // links here); the catalog form creates it.
    await createFoodViaCatalog(page, {
      name: FOOD,
      unit: 'ml',
      calories: '52',
      measureLabel: '1 carton',
      measureAmount: '1000',
    });
    await openDayView(page);

    // The manual door: FAB menu → search-first picker → appended review item.
    await openDoor(page, FOOD_DOOR);
    // The search opens empty: the catalog is not dumped, so no food is offered
    // until the user types (`SPEC-manual-log-ui`). The suggestion list is not
    // rendered at all, so there is no row for the staple.
    await expect(page.getByLabel('Search foods')).toBeVisible();
    await expect(page.getByRole('option', { name: FOOD })).toHaveCount(0);

    // Type the staple's name; its suggestion row appears, and the row itself is
    // the whole tap target that appends the pick to the review below.
    await page.getByLabel('Search foods').fill(FOOD);
    await page.getByRole('option', { name: FOOD }).click();

    // The pick appends one review item at the default 100 ml — one serving over
    // the 100 base — carrying the catalog's own numbers, never the unknown dash
    // (`SPEC-manual-log-ui` assumption 3).
    await expect(page.getByLabel('Food for item 1')).toHaveValue(FOOD);
    await expect(page.getByLabel(`Grams for ${FOOD}`)).toHaveValue('100');
    await expect(page.getByLabel(`Calories for ${FOOD}`)).toHaveValue('52');

    // Correct the portion inline: 250 ml at a per-100 ml base is 2.5 servings,
    // so 52 kcal × 2.5 rescales to 130 — real numbers, never a fabricated 0.
    await page.getByLabel(`Grams for ${FOOD}`).fill('250');
    await expect(page.getByLabel(`Calories for ${FOOD}`)).toHaveValue('130');

    // Breakfast on today, then the one save path every door shares. The
    // group control is a native `select`, so scope by element to the label the
    // editor owns.
    await page.locator('select[aria-label="Meal"]').selectOption('breakfast');
    await page.getByLabel('Save meal').click();
    await page.waitForURL(/\/meals$/, { timeout: 15_000 });

    // The day view lists the logged quantity and totals the snapshot.
    await expect(page.getByRole('listitem').filter({ hasText: '130 kcal × 2.5' })).toBeVisible({
      timeout: 15_000,
    });
    const loggedFigures = await listedEntryCalories(page);
    const loggedTotal = await dayTotal(page);
    expect(loggedFigures).toContain(130);
    expect(loggedTotal).toBe(loggedFigures.reduce((sum, kcal) => sum + kcal, 0));

    // History immutability (AC4/AC5): editing the food's facts rewrites no entry.
    await page.goto('/meals/foods');
    await page.getByRole('link', { name: FOOD }).click();
    await page.waitForURL(/\/meals\/foods\/[^/]+$/, { timeout: 15_000 });
    await page.getByLabel('Calories per 100').fill('99');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });

    await page.goto('/meals');
    await expect(page.getByRole('listitem').filter({ hasText: '130 kcal × 2.5' })).toBeVisible({
      timeout: 15_000,
    });
    expect(await listedEntryCalories(page)).toEqual(loggedFigures);
    expect(await dayTotal(page)).toBe(loggedTotal);

    // And deleting the food rewrites no entry either — the catalog read includes
    // soft-deleted rows, so the id-only join still resolves the dish name while
    // the logged numbers and the day total are untouched.
    await page.goto('/meals/foods');
    await page.getByRole('link', { name: FOOD }).click();
    await page.waitForURL(/\/meals\/foods\/[^/]+$/, { timeout: 15_000 });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete food', exact: true }).click();
    await page.waitForURL(/\/meals\/foods$/, { timeout: 15_000 });

    await page.goto('/meals');
    await expect(page.getByRole('listitem').filter({ hasText: '130 kcal × 2.5' })).toBeVisible({
      timeout: 15_000,
    });
    // The row still renders the deleted food's dish name, not the raw id.
    await expect(
      page.getByRole('listitem').filter({ hasText: FOOD }).filter({ hasText: '130 kcal × 2.5' }),
    ).toBeVisible({ timeout: 15_000 });
    expect(await listedEntryCalories(page)).toEqual(loggedFigures);
    expect(await dayTotal(page)).toBe(loggedTotal);
  });
});

test.describe('meals day view', () => {
  test('the entry doors are reachable from the day view', async ({ page }) => {
    await openMeals(page);

    // Both log doors wait inside the FAB menu; open it, then every door renders
    // as a link at once (`Log manually` still gone: the photo editor's own form
    // is manual entry).
    await page.getByRole('button', { name: 'Log a meal' }).click();
    for (const door of [PHOTO_DOOR, FOOD_DOOR]) {
      await expect(page.getByRole('menuitem', { name: door, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Log manually', exact: true })).toHaveCount(0);

    // The photo door opens the editor with the picker already at hand.
    await openDoor(page, PHOTO_DOOR);
    await expect(page.getByRole('heading', { name: 'Log meal' })).toBeVisible();
    await expect(page.getByLabel('Choose a photo')).toBeVisible();

    // The saved-meal toolbar door opens the saved list.
    await page.goto('/meals');
    await page.getByRole('link', { name: SAVED_DOOR, exact: true }).click();
    await page.waitForURL(/\/meals\/saved$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Saved meals' })).toBeVisible();
  });

  test('an unreadable photo opens manual entry with no invented numbers', async ({ page }) => {
    await openMeals(page);
    await openDoor(page, PHOTO_DOOR);

    await page.getByLabel('Choose a photo').setInputFiles(PHOTO);

    // The failure is announced, and it says exactly what happened.
    const banner = page.locator('.ui-alert-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("Couldn't read that photo.");
    await expect(banner).toContainText('nothing was guessed');

    // No invented numbers: every nutrient field is empty and carries the unknown
    // affordance (em dash), never a fabricated 0.
    for (const label of ['Calories', 'Fat', 'Carbohydrates', 'Protein']) {
      const field = page.getByLabel(`${label} for item 1`);
      await expect(field).toHaveValue('');
      await expect(field).toHaveAttribute('placeholder', '—');
    }
    await expect(page.getByLabel('Food for item 1')).toHaveValue('');

    // Nothing was confirmed, so nothing can be saved or frozen.
    await expect(page.getByLabel('Save meal')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save as meal', exact: true })).toBeDisabled();
  });

  test('a corrected meal saves and the day view reads back the corrected figure', async ({
    page,
  }) => {
    await openMeals(page);
    await openDoor(page, PHOTO_DOOR);

    await page.getByLabel('Food for item 1').fill('Rice bowl');
    await page.getByLabel('Calories for Rice bowl').fill('450');
    // The box is a weight now: 200 g at the 100 g base is 2 servings, so the
    // calories rescale to 450 × 2 — the same corrected figure as before.
    await page.getByLabel('Grams for Rice bowl').fill('200');
    await expect(page.getByLabel('Calories for Rice bowl')).toHaveValue('900');

    // The day view is left, not the editor: it is what the user goes back to.
    await page.getByLabel('Save meal').click();
    await page.waitForURL(/\/meals$/, { timeout: 15_000 });

    // What the day view now reads back is the corrected figure, not the raw one.
    await expect(
      page.getByRole('listitem').filter({ hasText: '900 kcal' }),
    ).toBeVisible({ timeout: 15_000 });
    expect(await listedEntryCalories(page)).toContain(900);
  });

  test('a saved meal re-logs its snapshot in one tap', async ({ page }) => {
    await openMeals(page);
    await openDoor(page, PHOTO_DOOR);

    await page.getByLabel('Food for item 1').fill('Overnight oats');
    await page.getByLabel('Calories for Overnight oats').fill('320');
    await page.getByLabel('Meal name').fill(SAVED_MEAL);
    await page.getByRole('button', { name: 'Save as meal', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to your meals.' })).toBeVisible({
      timeout: 15_000,
    });

    // The saved list shows the meal; its row opens the detail route.
    await page.goto('/meals/saved');
    await page.getByRole('link', { name: SAVED_MEAL }).click();
    await page.waitForURL(/\/meals\/saved\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: SAVED_MEAL })).toBeVisible();
    await expect(page.getByText('Re-log 320 kcal in one tap', { exact: false })).toBeVisible();

    // One tap posts the frozen numbers and lands on the day.
    await page.getByRole('button', { name: 'Log this meal again' }).click();
    await page.waitForURL(/\/meals\/\d{4}-\d{2}-\d{2}$/, { timeout: 15_000 });

    const confirmed = await listedEntryCalories(page);
    expect(confirmed).toContain(320);
  });

  test('the day total is the sum of the confirmed entries', async ({ page }) => {
    // This test owns its fixture: it must not depend on other tests' writes, so
    // it logs its own entry before reading the day total back.
    await openMeals(page);
    await openDoor(page, PHOTO_DOOR);

    const dish = 'Total probe dish';
    const calories = 400;
    await page.getByLabel('Food for item 1').fill(dish);
    await page.getByLabel(`Calories for ${dish}`).fill(String(calories));

    await page.getByLabel('Save meal').click();
    await page.waitForURL(/\/meals$/, { timeout: 15_000 });

    // The entry this test logged is the one the day view must list.
    const confirmed = await listedEntryCalories(page);
    expect(confirmed).toContain(calories);
    expect(confirmed.length).toBeGreaterThan(0);

    const summed = confirmed.reduce((total, kcal) => total + kcal, 0);
    const total = await dayTotal(page);
    // The headline and the rows are the same entries summed the same way — the
    // only gap is display rounding: the headline rounds the exact sum once, each
    // row rounds its own entry, so they may drift by up to half a kcal per row
    // plus half for the headline. Comparing the rounded displays exactly makes
    // this test order-dependent (one integer entry never drifts; a fractional
    // entry left by an earlier journey does). The bound is that display rounding
    // — never a whole entry — so a missing or double-counted entry (off by its
    // own kcal) still fails loudly.
    const rounding = Math.floor((confirmed.length + 1) / 2);
    expect(Math.abs(total - summed)).toBeLessThanOrEqual(rounding);
  });
});
