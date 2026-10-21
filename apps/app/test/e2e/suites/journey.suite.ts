import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USER } from '../config';
import {
  createNote,
  deleteForever,
  editNote,
  expectLoginWall,
  logIn,
  logOut,
  restoreNote,
  search,
  startLogin,
  submitCredentials,
  trashNote,
} from '../journey';

export interface JourneyOptions {
  /** The app origin this run is based on (Playwright baseURL). */
  origin: string;
  /** The other loopback spelling, to prove both resolve to one journey. */
  alternateOrigin: string;
}

/** A per-run marker so notes from different tests/reruns never collide. */
function marker(): string {
  return `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Registers the human's full manual checklist as automated browser tests. The
 * dev-mode and production-mode harnesses both call this with their own origin,
 * so the two runtimes can never diverge.
 */
export function registerJourney(options: JourneyOptions): void {
  const { origin, alternateOrigin } = options;

  test.describe('full journey checklist', () => {
    test('cold GET / → login redirect → IdP login → notes UI', async ({ page }) => {
      await startLogin(page);
      await submitCredentials(page, E2E_USER, E2E_PASSWORD);
      await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel('New note')).toBeVisible();
    });

    test('wrong password and unknown user fail identically (no enumeration)', async ({ page }) => {
      await startLogin(page);
      await submitCredentials(page, E2E_USER, 'definitely-not-the-password');
      await expect(page.getByRole('alert')).toHaveText('Invalid username or password', {
        timeout: 20_000,
      });

      await submitCredentials(page, 'no-such-user-here', 'whatever-password');
      await expect(page.getByRole('alert')).toHaveText('Invalid username or password', {
        timeout: 20_000,
      });
    });

    test('create → edit → tag → search → reload keeps session → trash → restore → permanent delete', async ({
      page,
    }) => {
      await logIn(page);
      const id = marker();
      const created = `checklist note ${id}`;

      // Create.
      await createNote(page, created);
      await expect(page.getByText(created)).toBeVisible();

      // Edit + inline tag.
      const tagged = `${created} #errand`;
      await editNote(page, created, tagged);
      await expect(page.getByText(tagged, { exact: false })).toBeVisible();
      // The tag is now offered as a filter.
      await expect(page.getByRole('link', { name: 'errand', exact: true })).toBeVisible();

      // Search finds it; a non-matching term hides it.
      await search(page, id);
      await expect(page.getByText(tagged, { exact: false })).toBeVisible();
      await search(page, 'zzz-no-such-note-zzz');
      await expect(page.getByText(tagged, { exact: false })).toHaveCount(0);
      await search(page, id);

      // Reload keeps the session (no login wall).
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
      await expect(page.getByText(tagged, { exact: false })).toBeVisible();

      // Trash it (from the home list), then it disappears from home.
      await trashNote(page, tagged);
      await expect(page.getByText(tagged, { exact: false })).toHaveCount(0);

      // Restore it from the trash page.
      await page.getByLabel('Trash').click();
      await page.waitForURL(/\/notes\/trash$/, { timeout: 15_000 });
      await expect(page.getByText(tagged, { exact: false })).toBeVisible();
      await restoreNote(page, tagged);

      // Trash it again, then permanently delete it.
      await page.getByLabel('Back').click();
      await page.waitForURL(/\/notes$/, { timeout: 15_000 });
      await trashNote(page, tagged);
      await page.getByLabel('Trash').click();
      await page.waitForURL(/\/notes\/trash$/, { timeout: 15_000 });
      await deleteForever(page, tagged);
      await expect(page.getByText('Trash is empty.')).toBeVisible();
    });

    test('logout ends the session; logging back in requires the password again (SSO kill)', async ({
      page,
    }) => {
      await logIn(page);
      await logOut(page, origin);

      // The gate sends a gated request back to the IdP login form.
      await expectLoginWall(page);
      // And the IdP asks for the password again — no silent SSO re-login.
      await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('a fresh browser context sees the login wall (private-window analog)', async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const fresh = await context.newPage();
      await fresh.goto(`${origin}/notes`);
      await fresh.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
      await expect(fresh.locator('input[name="password"]')).toBeVisible();
      await context.close();
    });

    test('callback with a tampered state fails closed (4xx, no session)', async ({ request }) => {
      const res = await request.get('/auth/callback?code=forged&state=forged', {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(400);
      expect(res.headers()['set-cookie'] ?? '').not.toContain('app_session=');
    });

    test('unauthenticated API call degrades to a login redirect, never a 500', async ({ request }) => {
      const res = await request.post('/api/notes/flush', {
        maxRedirects: 0,
        data: { body: 'x', tags: [] },
      });
      expect(res.status()).toBe(307);
      expect(res.headers()['location']).toContain('/auth/login');
    });

    test('the login journey also passes from the alternate loopback origin', async ({ page }) => {
      // Next normalizes loopback hosts, so this proves both spellings reach the
      // same journey (the bug class that hid behind a single-origin harness).
      await page.goto(`${alternateOrigin}/notes`);
      await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
      await submitCredentials(page, E2E_USER, E2E_PASSWORD);
      await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
    });

    test('per-route returnTo: a saved /todos entry logs in and lands on /todos', async ({ page }) => {
      await startLogin(page, '/todos');
      await submitCredentials(page, E2E_USER, E2E_PASSWORD);
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 30_000 });
    });

    test('per-route PWA: each route links its own manifest', async ({ page }) => {
      await logIn(page);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        '/manifest-notes.json',
      );
      await page.goto('/todos');
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        '/manifest-todos.json',
      );
      await page.goto('/meals');
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        '/manifest-meals.json',
      );
      await page.goto('/pomodoro');
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        '/manifest-pomodoro.json',
      );
    });
  });
}
