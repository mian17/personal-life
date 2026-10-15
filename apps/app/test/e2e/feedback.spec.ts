import { expect, test } from '@playwright/test';
import { logIn } from './journey';

/**
 * The feedback chapter's one targeted e2e run (SPEC-feedback-ui Testing
 * Strategy): from `/notes`, a blank title teaches the rule and creates nothing;
 * a valid submit shows up on `/feedback` under the right app → type group, with
 * both the title and the description lines.
 *
 * Only feedback-owned selectors — no frozen suite is touched.
 */
test('submit feedback from the notes toolbar and read it back in the inbox', async ({ page }) => {
  const title = `e2e feedback title ${Date.now()}`;
  const description = `e2e feedback description ${Date.now()}`;

  await logIn(page);

  // Blank title: 'Title is required.', no row created.
  await page.getByRole('button', { name: 'Send feedback' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Send feedback' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText('Title is required.')).toBeVisible();

  // A title but a blank description still sends nothing.
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText('Description is required.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/feedback');
  await expect(page.getByRole('heading', { level: 1, name: 'Feedback' })).toBeVisible();
  await expect(page.getByText('No feedback yet.')).toBeVisible();

  // Valid submit from the notes toolbar → the entry belongs to the Notes app.
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Send feedback' }).click();
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
