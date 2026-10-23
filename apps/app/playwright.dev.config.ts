import { defineConfig, devices } from '@playwright/test';
import { devPorts } from './test/e2e/config';
import { loadHarnessEnv } from './test/e2e/env-file';
import { heldSlot } from './test/e2e/teardown';

loadHarnessEnv();

/**
 * Development-mode harness: `next dev` (the human's `npm run dev` runtime) on
 * scratch DBs, reached on `127.0.0.1`.
 *
 * Run separately from the production harness because `next dev` and `next build`
 * share `apps/app/.next`. `npm run test:e2e:prod-build -w apps/app` then
 * `npm run test:e2e:dev-server -w apps/app` runs both in sequence.
 *
 * The access gate is skipped on the dev stack by the `APP_DEV_SKIP_ACCESS_GATE=1`
 * flag (set by `stack.ts`), so no tailscale header is sent (dev has no Tailscale
 * header anyway); the identity login wall is exercised for real, exactly as the
 * human hits it.
 */
export default defineConfig({
  testDir: './test/e2e/dev',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './test/e2e/global-setup.dev.ts',
  globalTeardown: './test/e2e/global-teardown.dev.ts',
  use: {
    // The slot `global-setup.dev.ts` claimed decides the port, so the browser
    // follows the claim instead of pointing at another worktree's band.
    baseURL: process.env.APP_DEV_URL ?? `http://127.0.0.1:${devPorts(heldSlot()).appPort}`,
    // No tailscale header: the access gate is skipped in dev by contract, and
    // the identity login wall is what this harness exercises for real.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
