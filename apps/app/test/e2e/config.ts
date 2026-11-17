import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
    focusPort: overriddenPort('E2E_FOCUS_PORT', portInSlot(3109, slot)),
    meditationPort: overriddenPort('E2E_MEDITATION_PORT', portInSlot(3102, slot)),
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
    focusPort: overriddenPort('E2E_DEV_FOCUS_PORT', portInSlot(3209, slot)),
    meditationPort: overriddenPort('E2E_DEV_MEDITATION_PORT', portInSlot(3202, slot)),
    appPort: overriddenPort('E2E_DEV_APP_PORT', portInSlot(3200, slot)),
  };
}

/**
 * The two replicas for the Redis hop proof (Task 3). Kept clear of the 31xx
 * shared-stack and 32xx dev-stack ports, so no two harnesses can collide on a
 * port. Both replicas share the single harness IdP (`testPorts().idpPort`,
 * itself overridable via `E2E_IDP_PORT`) and the one Redis — the slot's own
 * `redis-e2e-<slot>`, or `TEST_REDIS_URL` when the operator pins one.
 */
export function hopPorts(slot = 0) {
  return {
    appAPort: overriddenPort('E2E_HOP_A_PORT', portInSlot(3310, slot)),
    appBPort: overriddenPort('E2E_HOP_B_PORT', portInSlot(3311, slot)),
  };
}

/**
 * Whether the two-replica Redis hop proof runs. It boots two extra production
 * app instances, so it is opt-in: Redis being around is no longer the signal,
 * and without this flag the default suite never pays for the replicas.
 */
export function hopEnabled(): boolean {
  return process.env.E2E_HOP === '1';
}

/**
 * An explicit test Redis endpoint (e.g. `redis://127.0.0.1:6399`). Setting it
 * suppresses the slot's own `redis-e2e-<slot>` boot; leaving it unset means the
 * harness boots the slot's Redis.
 */
export function testRedisUrl(): string | undefined {
  return process.env.TEST_REDIS_URL?.trim() || undefined;
}

/** Where global-setup records the spawned PIDs for global-teardown. */
export const prodPidsFile = 'service-pids-prod.json';
export const devPidsFile = 'service-pids-dev.json';

/**
 * Absolute path of this worktree's recorded-PID file, kept outside the
 * repository. Worktree-scoped because two worktrees run the harness at the same
 * time: a shared name lets one run's teardown stop the other run's services.
 */
export function pidsFilePath(file: string): string {
  return join(artifactsRoot(), `${basename(repoRoot())}-${file}`);
}

/**
 * The throwaway Postgres feedback-service gets in the harness: a slot-named
 * `postgres:17-alpine` container on an ephemeral loopback port, never the
 * compose `postgres-feedback` and never a service's real `data/` directory.
 */
export function feedbackPgContainer(slot = 0): string {
  return process.env.E2E_FEEDBACK_PG_CONTAINER?.trim() || `feedback-pg-e2e-${slot}`;
}

/**
 * The throwaway RabbitMQ the harness owns per slot: a slot-named
 * `rabbitmq:4.1-alpine` container on an ephemeral loopback port, never the
 * compose `rabbitmq-feedback`.
 */
export function feedbackMqContainer(slot = 0): string {
  return process.env.E2E_FEEDBACK_MQ_CONTAINER?.trim() || `feedback-mq-e2e-${slot}`;
}

/**
 * The throwaway Redis the harness owns per slot: a slot-named `redis:8-alpine`
 * container on an ephemeral loopback port, never a service's real Redis.
 */
export function redisContainer(slot = 0): string {
  return process.env.E2E_REDIS_CONTAINER?.trim() || `redis-e2e-${slot}`;
}

export function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

/**
 * Where a run keeps everything it writes: scratch databases, recorded PIDs, the
 * held-slot file, Playwright's output.
 *
 * Deliberately *outside* the repository. `apps/app` is the dev lane's Turbopack
 * project root and therefore the dev server's watch root; a harness that appends
 * to a SQLite DB or a trace file in there is writing into the tree under test
 * (one measured run: 436 trace-file writes, plus live DB churn). Whether a given
 * watcher reacts depends on the platform — inotify only reports watched
 * directories, recursive watchers report everything — so the only portable rule
 * is to keep the writes out of the tree entirely. Machine-scoped like the slot
 * queue, so concurrent worktrees never share it.
 */
export function artifactsRoot(): string {
  const root = process.env.E2E_ARTIFACTS_DIR?.trim() || join(tmpdir(), 'life-e2e-artifacts');
  mkdirSync(root, { recursive: true });
  return root;
}

/** One harness slot's private corner of {@link artifactsRoot}. */
export function artifactsDir(name: string, slot = 0): string {
  return join(artifactsRoot(), `${name}-${slot}`);
}

/**
 * Playwright's output directory for this worktree, kept outside the repository
 * for the same reason as {@link artifactsRoot}. Scoped by worktree rather than
 * by slot because a Playwright config is loaded before `globalSetup` claims its
 * slot — the slot is not known yet at this point.
 */
export function playwrightOutputDir(folder: string): string {
  return join(artifactsRoot(), `${basename(repoRoot())}-${folder}`);
}

/** The Tailscale owner used by the Playwright context (access gate). */
export const E2E_OWNER = 'e2e-owner@example.com';

/** Seeded identity for both harnesses. */
export const E2E_USER = 'e2e-user';
export const E2E_PASSWORD = 'e2e-password-not-a-secret';
export const E2E_APP_SECRET = 'app-dev-client-secret-not-a-secret';
