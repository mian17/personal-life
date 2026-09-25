import { expect, test } from '@playwright/test';
import { E2E_OWNER } from './config';
import { startDegradedApp, type DegradedApp } from './degraded-app';

/**
 * Behavior 12 at browser level: when the IdP is unreachable, `GET /auth/login`
 * renders the honest 503 "identity service unavailable" page — not a 500 with a
 * stack trace.
 *
 * The shared harness app points at a live IdP, so this boots an isolated
 * production app instance with `IDP_ISSUER` aimed at a dead port (see
 * `degraded-app.ts`). The shared IdP service is never stopped or restarted.
 *
 * Raw `fetch` (not the request fixture) so the `tailscale-user-login` header is
 * exactly what the access gate needs.
 */
test.describe('IdP unreachable at /auth/login (degraded)', () => {
  let degraded: DegradedApp;

  test.beforeAll(async () => {
    degraded = await startDegradedApp();
  });

  test.afterAll(async () => {
    await degraded.stop();
  });

  test('renders the 503 "identity service unavailable" page, not a stack trace', async () => {
    const res = await fetch(`${degraded.origin}/auth/login`, {
      redirect: 'manual',
      headers: { 'tailscale-user-login': E2E_OWNER },
    });

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    // Honest, static page — never a raw error/stack.
    expect(res.headers.get('retry-after')).toBe('30');

    const body = await res.text();
    expect(body).toContain('Identity service unavailable');
    expect(body).not.toMatch(/at .*\(.*:\d+:\d+\)/); // Node stack frame shape
    expect(body.toLowerCase()).not.toContain('stack');
    // No half-started login attempt cookie is set on the failure path.
    expect(res.headers.get('set-cookie') ?? '').not.toContain('app_auth_attempt=');
  });
});
