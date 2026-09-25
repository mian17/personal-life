import { expect, test } from '@playwright/test';
import { E2E_OWNER, testPorts } from './config';

/**
 * Production-only: the Tailscale **access gate**. Dev skips it by contract (no
 * Tailscale header on localhost), so this is the mode where it must be proven.
 * The identity gate is covered by the shared journey suite in both modes.
 *
 * Uses raw `fetch` rather than the Playwright request fixture so the
 * `tailscale-user-login` header is exactly what each case specifies (the
 * config-level `extraHTTPHeaders` would otherwise leak in).
 */

const APP = `http://localhost:${testPorts().appPort}`;

async function get(headers: Record<string, string>): Promise<Response> {
  return fetch(`${APP}/`, { redirect: 'manual', headers });
}

test.describe('access gate (production build)', () => {
  test('a request without the owner header is forbidden', async () => {
    const res = await get({});
    expect(res.status).toBe(403);
  });

  test('a request with a different tailscale login is forbidden', async () => {
    const res = await get({ 'tailscale-user-login': 'someone-else@example.com' });
    expect(res.status).toBe(403);
  });

  test('the owner header passes the access gate (then the identity gate applies)', async () => {
    const res = await get({ 'tailscale-user-login': E2E_OWNER });
    // Access passed; with no session the identity gate redirects to login.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
  });
});
