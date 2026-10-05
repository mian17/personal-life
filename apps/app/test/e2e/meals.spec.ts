import { expect, test, type Page } from '@playwright/test';
import { logIn } from './journey';

/**
 * The meals day view, driven as a user (`SPEC-meal-capture-ui` Testing
 * Strategy). Everything runs against the real `meal-service` the harness spawns
 * and the app reaches through `MEAL_API_URL` — no fixture data is posted from
 * the spec, so a broken service URL fails these five concerns loudly.
 *
 * Selectors are the FROZEN surface only (roles, visible text, aria-labels); this
 * spec changes no app code to make one pass. The uploaded photo is bytes the
 * harness cannot read — the photo door's own failure path, which is the point
 * of that concern — so no provider is called.
 */

/**
 * The day view's entry doors, exactly as they render. The photo FAB opens the
 * editor (manual entry is that same editor's fallback, not a separate door);
 * `Saved meals` is the toolbar nav icon.
 */
const PHOTO_DOOR = 'Log meal from photo';
const SAVED_DOOR = 'Saved meals';

/** A saved-meal name per run, so a rerun can never collide with the last one. */
const SAVED_MEAL = `Overnight oats ${Date.now().toString(36)}`;

/** An image the provider could not read (real JPEG bytes, meaningless content). */
const PHOTO = {
  name: 'meal.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAp/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
};

/** Logs in and lands on the meals day view, waiting for its heading. */
async function openMeals(page: Page): Promise<void> {
  await logIn(page);
  await page.goto('/meals');
  await expect(page.getByRole('heading', { name: /^Meals —/ })).toBeVisible({ timeout: 30_000 });
}

/** Opens the editor the given door leads to, by clicking that door. */
async function openDoor(page: Page, door: string): Promise<void> {
  await page.getByRole('link', { name: door, exact: true }).click();
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

test.describe('meals day view', () => {
  test('the entry doors are reachable from the day view', async ({ page }) => {
    await openMeals(page);

    // Every door renders as a link, at once.
    for (const door of [PHOTO_DOOR, SAVED_DOOR]) {
      await expect(page.getByRole('link', { name: door, exact: true })).toBeVisible();
    }
    // The manual door is gone: the photo door's own editor *is* manual entry.
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
    expect(await dayTotal(page)).toBe(summed);
  });
});