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
    tagsPort: Number(process.env.E2E_TAGS_PORT ?? 3104),
    todoPort: Number(process.env.E2E_TODO_PORT ?? 3105),
    feedbackPort: Number(process.env.E2E_FEEDBACK_PORT ?? 3106),
    appPort: Number(process.env.E2E_APP_PORT ?? 3100),
  };
}

/** Dev-mode (`next dev`) harness ports. */
export function devPorts() {
  return {
    idpPort: Number(process.env.E2E_DEV_IDP_PORT ?? 3203),
    notePort: Number(process.env.E2E_DEV_NOTE_PORT ?? 3201),
    tagsPort: Number(process.env.E2E_DEV_TAGS_PORT ?? 3204),
    todoPort: Number(process.env.E2E_DEV_TODO_PORT ?? 3205),
    feedbackPort: Number(process.env.E2E_DEV_FEEDBACK_PORT ?? 3206),
    appPort: Number(process.env.E2E_DEV_APP_PORT ?? 3200),
  };
}

/**
 * The two replicas for the Redis hop proof (Task 3). Kept clear of the 31xx
 * shared-stack and 32xx dev-stack ports, and of 3199 (the degraded-app
 * instance), so no two harnesses can collide on a port. Both replicas share the
 * single harness IdP (`testPorts().idpPort`, itself overridable via
 * `E2E_IDP_PORT`) and the one test Redis (`TEST_REDIS_URL`).
 */
export function hopPorts() {
  return {
    appAPort: Number(process.env.E2E_HOP_A_PORT ?? 3310),
    appBPort: Number(process.env.E2E_HOP_B_PORT ?? 3311),
  };
}

/**
 * The shared Redis the hop proof runs against. This is the spec's gate: unset →
 * the hop spec skips entirely (default e2e stays zero-Redis); set to a test-owned
 * endpoint (e.g. `redis://127.0.0.1:6399`) → the two replicas are booted with it.
 */
export function testRedisUrl(): string | undefined {
  return process.env.TEST_REDIS_URL?.trim() || undefined;
}

/** Where global-setup records the spawned PIDs for global-teardown. */
export const prodPidsFile = 'service-pids-prod.json';
export const devPidsFile = 'service-pids-dev.json';

/**
 * The throwaway Postgres feedback-service gets in the harness: a fixed-name
 * `postgres:17-alpine` container on an ephemeral loopback port, never the
 * compose `postgres` and never a service's real `data/` directory.
 */
export const FEEDBACK_PG_CONTAINER =
  process.env.E2E_FEEDBACK_PG_CONTAINER?.trim() || 'feedback-pg-e2e';

export function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

/** The Tailscale owner used by the Playwright context (access gate). */
export const E2E_OWNER = 'e2e-owner@example.com';

/** Seeded identity for both harnesses. */
export const E2E_USER = 'e2e-user';
export const E2E_PASSWORD = 'e2e-password-not-a-secret';
export const E2E_APP_SECRET = 'app-dev-client-secret-not-a-secret';
