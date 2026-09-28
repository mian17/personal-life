import { expect, test } from '@playwright/test';
import { E2E_OWNER, E2E_PASSWORD, E2E_USER, testRedisUrl } from './config';
import {
  closeTestRedis,
  forceNearExpiry,
  openTestRedis,
  readSessionRecord,
  startHopApps,
  type HopApps,
  type TestRedis,
} from './hop-app';

/**
 * The Redis hop proof (Task 3 of the Redis chapter, SPEC-app-state success
 * criteria 2 and 3): two real app instances sharing ONE Redis and ONE IdP must
 * behave like one service.
 *
 *   - Hop: log in through replica A, present only A's session cookie to replica
 *     B, and get the authenticated Notes UI — no re-login.
 *   - Cross-instance single refresh: force the shared record's access token
 *     near expiry and drive BOTH replicas at once. The IdP rotates the refresh
 *     token and revokes the grant family on reuse, so "both replicas still serve
 *     Notes, and the shared record rotated exactly once" is the observable proof
 *     that the `app:lock:refresh:<id>` lock made exactly one refresh happen.
 *
 * Gated on `TEST_REDIS_URL`: with it unset the whole file skips, so the default
 * e2e run (the 21 existing specs) stays zero-Redis and unchanged.
 */

const REDIS_URL = testRedisUrl();

/**
 * The Redis hop proof is deliberately opt-in. It boots two extra production app
 * instances and requires a live test Redis; without `TEST_REDIS_URL` it must not
 * run (dev/e2e are Redis-free by contract). This `test.skip` is the gate — the
 * visible, code-level proof that the default suite is untouched.
 */
test.describe('Redis hop proof (two replicas, one Redis, one IdP)', () => {
  test.skip(
    !REDIS_URL,
    'TEST_REDIS_URL is not set — skipping the Redis-backed two-replica hop proof',
  );

  let apps: HopApps;
  let redis: TestRedis;

  test.beforeAll(async () => {
    if (!REDIS_URL) return; // unreachable when skipped, but keeps types honest
    // Fail fast and legibly if the test Redis is not actually up.
    redis = await openTestRedis(REDIS_URL);
    await redis.ping();
    apps = await startHopApps(REDIS_URL);
  });

  test.afterAll(async () => {
    await apps?.stop();
    if (redis) await closeTestRedis(redis);
  });

  test('a session created on replica A is honored by replica B (no re-login)', async ({
    browser,
  }) => {
    expect(REDIS_URL).toBeTruthy();

    // 1. Cold replica A → IdP login form → credentials → authenticated Notes UI.
    const context = await browser.newContext({
      extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER },
    });
    const page = await context.newPage();
    await page.goto(`${apps.a.origin}/notes`);
    await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
    await page.fill('input[name="username"]', E2E_USER);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });

    // 2. The session cookie was minted on A's origin, and the session lives in
    //    the shared Redis under `app:sess:<id>`.
    const cookies = await context.cookies(apps.a.origin);
    const session = cookies.find((c) => c.name === 'app_session');
    expect(session?.value, 'replica A must mint an app_session cookie').toBeTruthy();
    const sessionId = session!.value;
    const record = await readSessionRecord(redis, sessionId);
    expect(record, 'session must live in the shared Redis').toBeTruthy();
    await context.close();

    // 3. Replica B has no in-process session memory of its own: an
    //    unauthenticated hit is walled (proves B is not accidentally sharing A's
    //    process memory — only Redis can bridge them).
    const wall = await fetch(`${apps.b.origin}/`, {
      redirect: 'manual',
      headers: { 'tailscale-user-login': E2E_OWNER },
    });
    expect(wall.status).toBe(307);
    expect(wall.headers.get('location')).toContain('/auth/login');

    // 4. Present ONLY A's cookie to B: the shared Redis makes B authenticated.
    const bContext = await browser.newContext({
      extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER },
    });
    await bContext.addCookies([sessionCookie(sessionId)]);
    const bPage = await bContext.newPage();
    await bPage.goto(`${apps.b.origin}/notes`);
    await expect(bPage.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
    await bContext.close();
  });

  test('near expiry: one refresh across replicas; the rotation is shared', async ({ browser }) => {
    expect(REDIS_URL).toBeTruthy();

    // 1. Log in on A and snapshot the shared record's tokens.
    const context = await browser.newContext({
      extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER },
    });
    const page = await context.newPage();
    await page.goto(`${apps.a.origin}/notes`);
    await page.waitForURL(/\/interaction\/[^/]+$/, { timeout: 30_000 });
    await page.fill('input[name="username"]', E2E_USER);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });

    const sessionId = (await context.cookies(apps.a.origin)).find(
      (c) => c.name === 'app_session',
    )!.value;
    const before = await readSessionRecord(redis, sessionId);
    expect(before, 'session must live in the shared Redis').toBeTruthy();
    await context.close();

    // 2. Force the shared record's access token inside REFRESH_SKEW_MS (30s). The
    //    IdP's 600s TTL is a hardcoded constant with no env lever (verified:
    //    `apps/idp/src/oidc/access-token.policy.ts`), so rewriting the test-owned
    //    record is the honest way to reach the near-expiry state.
    await forceNearExpiry(redis, sessionId, Date.now());

    // 3. Drive BOTH replicas at once on the same near-expiry session. Each has
    //    its own process and its own in-process single-flight map, so both reach
    //    for the refresh; only the Redis lock keeps them to one IdP refresh.
    const [aCtx, bCtx] = await Promise.all([
      browser.newContext({ extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER } }),
      browser.newContext({ extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER } }),
    ]);
    await Promise.all([
      aCtx.addCookies([sessionCookie(sessionId)]),
      bCtx.addCookies([sessionCookie(sessionId)]),
    ]);
    const [aPage, bPage] = await Promise.all([aCtx.newPage(), bCtx.newPage()]);
    await Promise.all([aPage.goto(`${apps.a.origin}/notes`), bPage.goto(`${apps.b.origin}/notes`)]);

    // Both replicas must serve Notes. If the lock failed, both would present the
    // same rotating refresh token, the IdP's reuse detection would revoke the
    // grant family, and the loser (at least) would be walled → login redirect.
    await expect(aPage.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
    await expect(bPage.getByRole('heading', { name: 'Notes' })).toBeVisible({ timeout: 30_000 });
    await Promise.all([aCtx.close(), bCtx.close()]);

    // 4. The rotation is the observable: the shared record holds new tokens, and
    //    both replicas converged on that one record rather than each rotating.
    const after = await readSessionRecord(redis, sessionId);
    expect(after).toBeTruthy();
    expect(after!.refreshToken, 'refresh token must rotate').not.toBe(before!.refreshToken);
    expect(after!.accessToken, 'access token must be replaced').not.toBe(before!.accessToken);
    expect(after!.accessTokenExpiresAt).toBeGreaterThan(before!.accessTokenExpiresAt);

    // 5. A later request on either replica must not refresh again: the single
    //    recorded rotation is the whole session's story.
    const later = await browser.newContext({
      extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER },
    });
    await later.addCookies([sessionCookie(sessionId)]);
    const laterPage = await later.newPage();
    await laterPage.goto(`${apps.a.origin}/notes`);
    await expect(laterPage.getByRole('heading', { name: 'Notes' })).toBeVisible({
      timeout: 30_000,
    });
    await later.close();
    const settled = await readSessionRecord(redis, sessionId);
    expect(settled!.refreshToken, 'no further rotation after the first refresh').toBe(
      after!.refreshToken,
    );

    // 6. The lock was released cleanly — no stale lockout for the next request.
    expect(await redis.get(`app:lock:refresh:${sessionId}`)).toBeNull();
  });
});

/** A cookie that mirrors what replica A set (host-only on `localhost`). */
function sessionCookie(sessionId: string) {
  return {
    name: 'app_session',
    value: sessionId,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}
