import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USER } from '../config';
import { startLogin, submitCredentials } from '../journey';

/**
 * The named reproduction for the dev-mode callback failure.
 *
 * The human's `npm run dev` journey is browsed on `127.0.0.1`. Next's dev
 * middleware normalizes the loopback host in its redirect (`127.0.0.1` →
 * `localhost`), so the `app_auth_attempt` cookie was written on `localhost`
 * while the registered redirect URI brought the browser back to `127.0.0.1` —
 * the callback then answered `400 missing or invalid auth attempt`.
 *
 * Before the fix this spec fails: the callback response is 400. After it is a
 * 303 that mints a session and lands on the notes UI. The broader journey lives
 * in `journey.dev.spec.ts`; this file pins the exact observable.
 */
test.describe('dev-mode callback (reproduction)', () => {
  test('callback completes the dance on the 127.0.0.1-driven journey', async ({ page }) => {
    await startLogin(page);

    const callback = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/auth/callback',
      { timeout: 30_000 },
    );
    await submitCredentials(page, E2E_USER, E2E_PASSWORD);
    const response = await callback;
    expect(response.status(), 'callback must complete the dance (was 400)').toBe(303);

    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });

    // The session cookie lives on the same loopback host the callback used.
    const finalOrigin = `http://${new URL(page.url()).host}`;
    const session = (await page.context().cookies(finalOrigin)).find(
      (c) => c.name === 'app_session',
    );
    expect(session).toBeDefined();
  });
});
