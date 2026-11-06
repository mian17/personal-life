import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn } from './journey';

/**
 * The feedback chapter's one targeted e2e run (SPEC-feedback-ui Testing
 * Strategy): from the notes Settings screen's Support row, a blank title teaches
 * the rule and creates nothing; a valid submit shows up on `/feedback` under the
 * right app → type group, with both the title and the description lines.
 *
 * The notes entry is the settings row (the header control left with the index
 * restyle), so this spec walks `/notes` → Settings → the row; the dialog's own
 * selectors are unchanged. Only feedback-owned selectors — no frozen suite is
 * touched.
 */
test('submit feedback from the notes toolbar and read it back in the inbox', async ({ page }) => {
  const title = `e2e feedback title ${Date.now()}`;
  const description = `e2e feedback description ${Date.now()}`;

  await logIn(page);

  // Blank title: 'Title is required.', no row created.
  await openNotesFeedback(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Send feedback' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText('Title is required.')).toBeVisible();

  // A title but a blank description still sends nothing.
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText('Description is required.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Emptiness is not asserted here: chapter 2 seeds a row into the same
  // persistent database, so this page is only empty on a fresh stack. The frozen
  // empty-state copy is pinned in `apps/app/test/feedback-inbox.test.tsx`.
  await page.goto('/feedback');
  await expect(page.getByRole('heading', { level: 1, name: 'Feedback' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All', exact: true })).toBeVisible();

  // Valid submit from the notes settings row → the entry belongs to the Notes app.
  await openNotesFeedback(page);
  const form = page.getByRole('dialog');
  await form.getByRole('button', { name: 'Enhancement' }).click();
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Description').fill(description);
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(form).toBeHidden();

  await page.goto('/feedback');
  const notesGroup = page.locator('section.ui-section:has(> div h2:text-is("Notes"))');
  await expect(page.getByText('No feedback yet.')).toHaveCount(0);
  await expect(notesGroup.getByRole('heading', { level: 3, name: 'Enhancement' })).toBeVisible();
  const row = notesGroup.locator('li', { hasText: title });
  await expect(row.getByText(title)).toBeVisible();
  await expect(row.getByText(description)).toBeVisible();
});

/**
 * The status story of SPEC-feedback-status: a new entry opens with an Open
 * pill; the row dropdown flips it to Done with no reload. The filter lives in
 * the URL (`?status=`), so Open navigates to a view that hides the row and Done
 * navigates back to one that shows it under its Done pill.
 *
 * The filter pills are links now that the filter is a URL param, so this is the
 * one deliberate change to the feedback selector surface (button -> link); the
 * row dropdown, the entry pill and the toolbar selectors are untouched.
 */
test('flipping an entry to Done removes it from Open and returns it under Done', async ({ page }) => {
  const entry = {
    title: `e2e feedback status ${Date.now()}`,
    description: `e2e status body ${Date.now()}`,
  };

  await logIn(page);
  await page.goto('/feedback');
  await submitFeedback(page, entry);

  const row = page.locator('li', { hasText: entry.title });
  await expect(entryPill(row)).toHaveText('Open');

  const statusDropdown = row.getByLabel(`Set status for ${entry.title}`);
  await statusDropdown.selectOption('done');
  await expect(entryPill(row)).toHaveText('Done');

  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole('link', { name: 'Done', exact: true }).click();
  await expect(entryPill(row)).toHaveText('Done');
});

/**
 * Opens the feedback dialog from the notes Settings screen's Support row: the
 * header now carries only the Settings control, so the row is reached through it.
 */
async function openNotesFeedback(page: Page): Promise<void> {
  await page.goto('/notes');
  await page.getByLabel('Settings').click();
  await page.waitForURL(/\/notes\/settings$/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Send feedback' }).click();
}

/**
 * Sends one entry from `/feedback`'s own Settings Support row — the inbox header
 * carries only the Settings control now, so the row is its only create entry —
 * then returns to the inbox to read it back.
 */
async function submitFeedback(
  page: Page,
  entry: { title: string; description: string },
): Promise<void> {
  await page.getByLabel('Settings').click();
  await page.waitForURL(/\/feedback\/settings$/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Send feedback' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('button', { name: 'Enhancement' }).click();
  await form.getByLabel('Title').fill(entry.title);
  await form.getByLabel('Description').fill(entry.description);
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(form).toBeHidden();
  await page.goto('/feedback');
}

/** The row's one status pill; its text is the entry's visible status. */
function entryPill(row: Locator) {
  return row.locator('.ui-pill');
}
