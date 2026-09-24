import { defineConfig, devices } from '@playwright/test';
import { E2E_OWNER } from './test/e2e/config';

/**
 * Playwright config for the cross-service login flow.
 *
 * The spec runs against the *production* build of the app (identity + access
 * gates active) with the dev IdP, because Task 8's middleware gate is skipped
 * under `NODE_ENV=development`. `globalSetup` builds and launches idp,
 * note-service, and the app; `globalTeardown` stops them.
 *
 * `extraHTTPHeaders` supplies the Tailscale login header the real proxy would
 * set — the access gate stays active and is genuinely exercised.
 *
 * Ports are intentionally non-default (31xx) so a running Docker stack on
 * 3001/3002/3003 is never disturbed.
 */
export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './test/e2e/global-setup.ts',
  globalTeardown: './test/e2e/global-teardown.ts',
  use: {
    // The app-under-test is reached as `localhost`: Next normalizes loopback
    // 127.0.0.1 → localhost in middleware redirects, so the browser origin must
    // be `localhost` to keep login cookies + the callback on one origin.
    baseURL: process.env.APP_URL ?? 'http://localhost:3100',
    extraHTTPHeaders: { 'tailscale-user-login': E2E_OWNER },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
