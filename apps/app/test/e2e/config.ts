import { join } from 'node:path';

/**
 * Harness ports. The production-build stack uses 31xx and the dev-mode stack
 * uses 32xx, so the two can never collide with each other or with a running
 * `npm run dev` stack on 300x.
 *
 * Both stacks are run in separate Playwright invocations (see the `test:e2e`
 * script) because `next dev` and `next build` share `apps/app/.next` and cannot
 * coexist on disk.
 */
export function testPorts() {
  return {
    idpPort: Number(process.env.E2E_IDP_PORT ?? 3103),
    notePort: Number(process.env.E2E_NOTE_PORT ?? 3101),
    appPort: Number(process.env.E2E_APP_PORT ?? 3100),
  };
}

/** Dev-mode (`next dev`) harness ports. */
export function devPorts() {
  return {
    idpPort: Number(process.env.E2E_DEV_IDP_PORT ?? 3203),
    notePort: Number(process.env.E2E_DEV_NOTE_PORT ?? 3201),
    appPort: Number(process.env.E2E_DEV_APP_PORT ?? 3200),
  };
}

/** Where global-setup records the spawned PIDs for global-teardown. */
export const prodPidsFile = 'service-pids-prod.json';
export const devPidsFile = 'service-pids-dev.json';

export function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

/** The Tailscale owner used by the Playwright context (access gate). */
export const E2E_OWNER = 'e2e-owner@example.com';

/** Seeded identity for both harnesses. */
export const E2E_USER = 'e2e-user';
export const E2E_PASSWORD = 'e2e-password-not-a-secret';
export const E2E_APP_SECRET = 'app-dev-client-secret-not-a-secret';
