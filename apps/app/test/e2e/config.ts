import { join } from 'node:path';

/**
 * Every harness port sits at `basePort + SLOT_STRIDE * slot`, so two worktrees
 * holding different slots never share a port. The production-build stack uses
 * 31xx and the dev-mode stack 32xx, so the two can never collide with each
 * other or with a running `npm run dev` stack on 300x; slots 0-8 keep every
 * port inside its own band.
 *
 * Both stacks are run in separate Playwright invocations (see the `test:e2e`
 * script) because `next dev` and `next build` share `apps/app/.next` and cannot
 * coexist on disk.
 */
const SLOT_STRIDE = 10;

function portInSlot(basePort: number, slot: number): number {
  return basePort + SLOT_STRIDE * slot;
}

/** An explicit env override always wins over the value derived from the slot. */
function overriddenPort(variable: string, derivedPort: number): number {
  return Number(process.env[variable] ?? derivedPort);
}

/** Production-build harness ports for one slot. */
export function testPorts(slot = 0) {
  return {
    idpPort: overriddenPort('E2E_IDP_PORT', portInSlot(3103, slot)),
    notePort: overriddenPort('E2E_NOTE_PORT', portInSlot(3101, slot)),
    tagsPort: overriddenPort('E2E_TAGS_PORT', portInSlot(3104, slot)),
    todoPort: overriddenPort('E2E_TODO_PORT', portInSlot(3105, slot)),
    mealPort: overriddenPort('E2E_MEAL_PORT', portInSlot(3106, slot)),
    feedbackPort: overriddenPort('E2E_FEEDBACK_PORT', portInSlot(3107, slot)),
    appPort: overriddenPort('E2E_APP_PORT', portInSlot(3100, slot)),
  };
}

/**
 * App port for the degraded instance, one step below the slot's other
 * production ports so it cannot collide with them.
 */
export function degradedAppPort(slot = 0): number {
  return overriddenPort('E2E_DEGRADED_APP_PORT', portInSlot(3108, slot));
}

/** Dev-mode (`next dev`) harness ports for one slot. */
export function devPorts(slot = 0) {
  return {
    idpPort: overriddenPort('E2E_DEV_IDP_PORT', portInSlot(3203, slot)),
    notePort: overriddenPort('E2E_DEV_NOTE_PORT', portInSlot(3201, slot)),
    tagsPort: overriddenPort('E2E_DEV_TAGS_PORT', portInSlot(3204, slot)),
    todoPort: overriddenPort('E2E_DEV_TODO_PORT', portInSlot(3205, slot)),
    mealPort: overriddenPort('E2E_DEV_MEAL_PORT', portInSlot(3206, slot)),
    feedbackPort: overriddenPort('E2E_DEV_FEEDBACK_PORT', portInSlot(3207, slot)),
    appPort: overriddenPort('E2E_DEV_APP_PORT', portInSlot(3200, slot)),
  };
}

/**
 * The two replicas for the Redis hop proof (Task 3). Kept clear of the 31xx
 * shared-stack and 32xx dev-stack ports, so no two harnesses can collide on a
 * port. Both replicas share the single harness IdP (`testPorts().idpPort`,
 * itself overridable via `E2E_IDP_PORT`) and the one test Redis
 * (`TEST_REDIS_URL`).
 */
export function hopPorts(slot = 0) {
  return {
    appAPort: overriddenPort('E2E_HOP_A_PORT', portInSlot(3310, slot)),
    appBPort: overriddenPort('E2E_HOP_B_PORT', portInSlot(3311, slot)),
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
 * The throwaway Postgres feedback-service gets in the harness: a slot-named
 * `postgres:17-alpine` container on an ephemeral loopback port, never the
 * compose `postgres-feedback` and never a service's real `data/` directory.
 */
export function feedbackPgContainer(slot = 0): string {
  return process.env.E2E_FEEDBACK_PG_CONTAINER?.trim() || `feedback-pg-e2e-${slot}`;
}

export function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

/** The Tailscale owner used by the Playwright context (access gate). */
export const E2E_OWNER = 'e2e-owner@example.com';

/** Seeded identity for both harnesses. */
export const E2E_USER = 'e2e-user';
export const E2E_PASSWORD = 'e2e-password-not-a-secret';
export const E2E_APP_SECRET = 'app-dev-client-secret-not-a-secret';
