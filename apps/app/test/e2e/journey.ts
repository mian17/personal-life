import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USER } from './config';

/**
 * The human's manual checklist, as reusable browser steps. Both harnesses
 * (dev-mode and production-mode) drive the same helpers so the journeys cannot
 * drift between them.
 */

/** A unique-ish note body per test run so stale state can never mask a failure. */
export function noteBody(marker: string, suffix = ''): string {
  return `Checklist note ${marker}${suffix}`;
}

/** Opens the app and waits for the IdP login form. */
export async function startLogin(page: Page, path = '/notes'): Promise<void> {
  await page.goto(path);
  await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
}

/** Fills the IdP login form and submits; returns without waiting to land. */
export async function submitCredentials(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

/** Full happy-path login: cold app → IdP form → callback → notes UI. */
export async function logIn(
  page: Page,
  username = E2E_USER,
  password = E2E_PASSWORD,
): Promise<void> {
  await startLogin(page);
  await submitCredentials(page, username, password);
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
}

/** Asserts the notes UI is NOT reachable and the login wall is shown again. */
export async function expectLoginWall(page: Page): Promise<void> {
  await page.goto('/notes');
  await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
}

/** Logs out through the real app logout route (same navigation the UI would do). */
export async function logOut(page: Page, origin: string): Promise<void> {
  const res = await page.request.post(`${origin}/auth/logout`, {
    maxRedirects: 0,
    headers: { origin },
  });
  expect(res.status()).toBe(303);
  const landing = res.headers()['location'];
  expect(landing).toContain('/logout');
  // Follow the hand-off so the IdP session is destroyed too.
  await page.goto(landing, { waitUntil: 'commit' });
  await page.waitForURL(/\/login$/, { timeout: 30_000 });
}

/** Creates a note via the UI (new-note editor → Save → home). */
export async function createNote(page: Page, body: string): Promise<void> {
  await page.getByLabel('New note').click();
  await page.waitForURL(/\/notes\/new$/, { timeout: 15_000 });
  await page.getByLabel('Note body').fill(body);
  await page.getByLabel('Save').click();
  await page.waitForURL(/\/notes$/, { timeout: 15_000 });
}

/** Opens a note by its visible title link and edits its body. */
export async function editNote(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(escape(title)) }).first().click();
  await page.waitForURL(/\/notes\/[^/]+$/, { timeout: 15_000 });
  const textarea = page.getByLabel('Note body');
  await textarea.fill(body);
  await page.getByLabel('Save').click();
  await page.waitForURL(/\/notes$/, { timeout: 15_000 });
}

/** Types into the home search box and waits for the filtered result. */
export async function search(page: Page, term: string): Promise<void> {
  await page.getByLabel('Search notes').fill(term);
  await page.waitForURL((url) => url.searchParams.get('q') === term, { timeout: 15_000 });
}

/** Moves a note to trash from the home list. */
export async function trashNote(page: Page, title: string): Promise<void> {
  await page.getByLabel(`Delete ${title}`).click();
  await expect(page.getByText(title, { exact: false })).toHaveCount(0, { timeout: 15_000 });
}

/** Restores a note from the trash page. */
export async function restoreNote(page: Page, title: string): Promise<void> {
  await page.getByLabel(`Restore ${title}`).click();
  await expect(page.getByLabel(`Restore ${title}`)).toHaveCount(0, { timeout: 15_000 });
}

/** Permanently deletes a note from the trash page, accepting the confirm dialog. */
export async function deleteForever(page: Page, title: string): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('listitem')
    .filter({ hasText: title })
    .locator('button.trash-delete')
    .click();
  await expect(page.getByText(title, { exact: false })).toHaveCount(0, { timeout: 15_000 });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
