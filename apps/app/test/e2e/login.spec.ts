import { expect, test } from '@playwright/test';

/**
 * The real cross-service login dance, per Task 8: cold browser → app redirects
 * to the IdP → login → callback → working notes UI. Runs against the production
 * app build with the dev IdP + test note-service (see global-setup.ts).
 *
 * Note on SSO: after app logout, the oidc-provider's own SSO session cookie may
 * still auto-resolve a later authorization. Ending that is RP-initiated logout
 * (decision C, deferred); the gate's contract here is only that, with no app
 * session, it redirects to /auth/login.
 */

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const SEED_USER = 'e2e-user';
const SEED_PASSWORD = 'e2e-password-not-a-secret';

/** Drives the cold-browser dance up to (and through) the IdP login form. */
async function logIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  // The gate redirects to /auth/login, which redirects to the IdP; the IdP then
  // routes through its interaction endpoint, which renders the login form.
  await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 20_000 });
  await page.fill('input[name="username"]', SEED_USER);
  await page.fill('input[name="password"]', SEED_PASSWORD);
  await page.click('button[type="submit"]');
  // Resume → callback → app root.
  await page.waitForURL(`${APP_ORIGIN}/`, { timeout: 20_000 });
}

test.describe('RP login flow', () => {
  test('cold browser → IdP login → callback → working notes UI', async ({ page }) => {
    await logIn(page);

    // We are in the app with a session: the notes UI rendered.
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(page.getByLabel('New note')).toBeVisible();
  });

  test('logout ends the app session; the gate then redirects to /auth/login', async ({ page }) => {
    await logIn(page);

    // The app has no logout <form> in the UI (Task 8 keeps the UI unchanged), so
    // drive the same navigation the UI would: POST to the app logout route, which
    // destroys the app session and 303s to the IdP's /logout landing.
    const logout = await page.request.post(`${APP_ORIGIN}/auth/logout`, {
      maxRedirects: 0,
      headers: { origin: APP_ORIGIN },
    });
    expect(logout.status()).toBe(303);
    const idpLanding = logout.headers()['location'];
    expect(idpLanding).toContain('/logout');

    // The app session cookie is gone.
    expect(
      (await page.context().cookies(APP_ORIGIN)).find((c) => c.name === 'app_session'),
    ).toBeUndefined();

    // With no app session, the gate redirects a gated request to /auth/login.
    // (Not followed: the IdP may still have an SSO session — decision C's scope.)
    const gated = await page.request.get(`${APP_ORIGIN}/`, { maxRedirects: 0 });
    expect(gated.status()).toBe(307);
    expect(gated.headers()['location']).toContain('/auth/login');

    // Following the hand-off to the IdP landing clears the IdP session and lands
    // on the IdP's login page (grant revocation happens server-side via Task 6b).
    await page.goto(idpLanding, { waitUntil: 'commit' });
    await page.waitForURL(/\/login$/, { timeout: 20_000 });
  });

  test('callback with a tampered state fails closed (4xx, no session)', async ({ request }) => {
    // Forged callback with no valid attempt cookie: must 4xx and set no session.
    const res = await request.get('/auth/callback?code=forged&state=forged', {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
    expect(res.headers()['set-cookie'] ?? '').not.toContain('app_session=');
  });
});
