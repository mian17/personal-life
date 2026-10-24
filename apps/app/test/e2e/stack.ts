import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { bin, childEnv } from '../../../../packages/shared/src/child-process';
import { ensurePortFree, spawnService, waitForHttp, type SpawnedService } from './services';
import { degradedRedirectUris } from './degraded-app';
import {
  E2E_APP_SECRET,
  E2E_OWNER,
  E2E_PASSWORD,
  E2E_USER,
  feedbackMqContainer,
  feedbackPgContainer,
  hopPorts,
  redisContainer,
  repoRoot,
  testRedisUrl,
} from './config';

/**
 * The hop replicas' callbacks, registered on the shared harness IdP so the
 * two-instance proof (Task 3 / `hop.spec.ts`) can drive a real login dance from
 * replica A. Additive only: extra loopback redirect URIs are inert for every
 * other spec, and the IdP still rejects any unregistered callback.
 */
function hopRedirectUris(slot: number): string[] {
  const { appAPort, appBPort } = hopPorts(slot);
  return [
    `http://localhost:${appAPort}/auth/callback`,
    `http://127.0.0.1:${appAPort}/auth/callback`,
    `http://localhost:${appBPort}/auth/callback`,
    `http://127.0.0.1:${appBPort}/auth/callback`,
  ];
}

/**
 * Shared launcher for the two e2e stacks.
 *
 *  - production mode: the real `next build` output (`standalone/server.js`), the
 *    same artifact Docker runs. Used for the access-gate + production-behavior
 *    coverage.
 *  - development mode: `next dev`, i.e. exactly what the human runs with
 *    `npm run dev`. Used because the loopback-cookie bug class only exists in the
 *    dev server's middleware URL normalization.
 *
 * Both point at the dev-style IdP and a scratch note-service. All state lives
 * outside the repository (see `artifactsRoot`), never under any service's real
 * `data/` directory and never inside the dev lane's watched project root.
 */

export interface StackConfig {
  appPort: number;
  idpPort: number;
  notePort: number;
  tagsPort: number;
  todoPort: number;
  /**
   * feedback-service: 31xx in the test harness (3107), never the dev stack's
   * 3207. Optional — omitting it leaves feedback-service out of the stack, which
   * is how the dev harness starts. The slot's three throwaway containers boot
   * either way: the slot owns them, so its teardown removes them.
   */
  feedbackPort?: number;
  mealPort: number;
  /** Browser origin the app is reached on (`localhost` or `127.0.0.1`). */
  appOrigin: string;
  /** Scratch directory for the IdP/note-service DBs and keys. */
  stateDir: string;
  mode: 'production' | 'development';
  /**
   * The slot this stack owns: names its throwaway containers and the degraded
   * app's callback. Defaults to slot 0.
   */
  slot?: number;
}

export function appOriginFor(host: string, appPort: number): string {
  return `http://${host}:${appPort}`;
}

function build(workspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin('npm'),
      ['run', 'build', '-w', workspace],
      { cwd: repoRoot(), env: childEnv({ NODE_ENV: 'production' }) },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Find the app's standalone server directory under `.next/standalone`. Next
 * mirrors the monorepo layout there, so `server.js` sits under some prefix of
 * `apps/app` — exactly `apps/app` from the primary checkout, but
 * `.worktrees/<slug>/apps/app` when the checkout is a git worktree. Walk to
 * whichever `apps/app/server.js` exists rather than assuming the depth.
 */
function findStandaloneAppDir(standaloneRoot: string): string {
  const stack = [standaloneRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    if (existsSync(join(dir, 'server.js')) && dir.endsWith(join('apps', 'app'))) return dir;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        stack.push(join(dir, entry.name));
      }
    }
  }
  throw new Error(`no standalone app server found under ${standaloneRoot}`);
}

function idpEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: cfg.mode === 'production' ? 'production' : 'development',
    PORT: String(cfg.idpPort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/idp.db`,
    KEYS_PATH: `${cfg.stateDir}/idp-keys.json`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    OIDC_APP_CLIENT_SECRET: E2E_APP_SECRET,
    // Both loopback spellings are registered so the dance works whether the
    // browser origin is `localhost` or `127.0.0.1` (exactly the bug class).
    // The hop replicas' callbacks are included so the two-instance proof can
    // reuse this IdP without a third service (see `hopRedirectUris`).
    OIDC_APP_REDIRECT_URIS: [
      `http://localhost:${cfg.appPort}/auth/callback`,
      `http://127.0.0.1:${cfg.appPort}/auth/callback`,
      ...hopRedirectUris(cfg.slot ?? 0),
      ...degradedRedirectUris(cfg.slot ?? 0),
    ].join(','),
    SEED_USERNAME: E2E_USER,
    SEED_PASSWORD: E2E_PASSWORD,
    // Shared ecosystem audience (SPEC-service-kernel): one token serves all
    // three resource services in the harness exactly as in compose.
    OIDC_DEFAULT_RESOURCE: 'https://note-service',
    OIDC_AUDIENCE_MAP:
      'https://note-service=life-api,https://tags-service=life-api,https://todo-service=life-api',
    // The IdP's own `idp_session` cookie follows the same one dev-stack flag as
    // the app's cookies (never NODE_ENV). Dev mode is plain loopback http, so
    // without the flag the browser refuses the Secure cookie and every login
    // silently fails. Production mode leaves it unset and gets Secure.
    ...(cfg.mode === 'production' ? {} : { APP_DEV_SKIP_ACCESS_GATE: '1' }),
  };
}

function noteEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.notePort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/note-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    NOTE_SERVICE_AUDIENCE: 'life-api',
    NOTE_MASTER_KEY: HARNESS_MASTER_KEY,
  };
}

/** Deterministic, obviously-fake harness key (public by design, like a test cert). */
const HARNESS_MASTER_KEY = Buffer.alloc(32, 0x2a).toString('base64');

function tagsEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.tagsPort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/tags-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    TAGS_SERVICE_AUDIENCE: 'life-api',
    TAGS_MASTER_KEY: HARNESS_MASTER_KEY,
  };
}

function todoEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.todoPort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/todo-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    TODO_SERVICE_AUDIENCE: 'life-api',
    TODO_MASTER_KEY: HARNESS_MASTER_KEY,
  };
}

function feedbackEnv(cfg: StackConfig, feedbackPort: number, dbUrl: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(feedbackPort),
    HOST: '127.0.0.1',
    FEEDBACK_DB_URL: dbUrl,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    FEEDBACK_IDP_JWKS_URL: `http://127.0.0.1:${cfg.idpPort}/jwks`,
    FEEDBACK_SERVICE_AUDIENCE: 'life-api',
    FEEDBACK_MASTER_KEY: HARNESS_MASTER_KEY,
    REDIS_URL: undefined,
    RABBITMQ_URL: undefined,
  };
}

function mealEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.mealPort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/meal-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    MEAL_SERVICE_AUDIENCE: 'life-api',
    MEAL_MASTER_KEY: HARNESS_MASTER_KEY,
    // The Gemini client fails closed at construction without all three
    // coordinates, which would turn every estimate into a 500 — so the harness
    // hands over obviously-fake ones. No journey uploads a photo the client
    // would actually send: the unreadable-photo fixture is refused by type at
    // the client's mime gate, before any network call.
    GEMINI_API_KEY: 'not-a-real-key',
    GEMINI_MODEL: 'harness-unreachable',
    GEMINI_API_BASE: 'http://127.0.0.1:9',
  };
}

function appEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  const origin = cfg.appOrigin;
  return {
    NODE_ENV: cfg.mode === 'production' ? 'production' : 'development',
    PORT: String(cfg.appPort),
    HOSTNAME: '127.0.0.1',
    API_URL: `http://127.0.0.1:${cfg.notePort}`,
    TAGS_API_URL: `http://127.0.0.1:${cfg.tagsPort}`,
    TODO_API_URL: `http://127.0.0.1:${cfg.todoPort}`,
    ...(cfg.feedbackPort !== undefined
      ? { FEEDBACK_API_URL: `http://127.0.0.1:${cfg.feedbackPort}` }
      : {}),
    MEAL_API_URL: `http://127.0.0.1:${cfg.mealPort}`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    OIDC_APP_CLIENT_ID: 'app',
    OIDC_APP_CLIENT_SECRET: E2E_APP_SECRET,
    // The browser origin the harness drives; byte-identical to one of the IdP's
    // registered redirect URIs.
    OIDC_APP_REDIRECT_URI: `${origin}/auth/callback`,
    // The access gate is skipped and cookies drop `Secure` only on the dev
    // stack, marked by this flag (NODE_ENV cannot mark it: `next build` forces
    // production). Production mode leaves it unset and exercises the gate for
    // real: Next sets x-forwarded-host and the context sends tailscale-user-login.
    ...(cfg.mode === 'production'
      ? { OWNER_LOGIN: E2E_OWNER }
      : { APP_DEV_SKIP_ACCESS_GATE: '1' }),
  };
}

/** The shared budget for a throwaway container to answer its readiness probe. */
const READINESS_DEADLINE_MS = 60_000;

/** Obviously-fake harness broker account (public by design, like a test cert). */
const HARNESS_RABBITMQ_USER = 'harness';
const HARNESS_RABBITMQ_PASSWORD = 'test-only';

/**
 * Boots the three throwaway containers the slot owns and returns the Postgres
 * URL feedback-service is wired to. Every harness boots all three, whatever it
 * consumes: the slot owns them, so its teardown is the only thing that removes
 * them. Postgres comes first because feedback-service fails closed without a DB.
 */
async function bootSlotContainers(slot: number): Promise<string> {
  const feedbackDbUrl = await startThrowawayPostgres(slot);
  await startThrowawayRabbitMq(slot);
  await bootSlotRedis(slot);
  return feedbackDbUrl;
}

/**
 * Boots the slot's cache unless an explicit `TEST_REDIS_URL` endpoint stands in
 * for it, in which case the endpoint wins and no container is started.
 */
async function bootSlotRedis(slot: number): Promise<void> {
  if (testRedisUrl() !== undefined) return;

  await startThrowawayRedis(slot);
}

/**
 * A throwaway Postgres for feedback-service (the `pg-integration.test.ts`
 * pattern): slot-named `postgres:17-alpine` container, ephemeral loopback port,
 * never the compose `postgres-feedback`. A host without Docker fails fast — this e2e is
 * the feedback chapter's final proof, so a silent skip would hide it.
 */
async function startThrowawayPostgres(slot: number): Promise<string> {
  const port = await startThrowawayContainer({
    name: feedbackPgContainer(slot),
    image: 'postgres:17-alpine',
    environment: ['POSTGRES_PASSWORD=test-only', 'POSTGRES_DB=feedback'],
    containerPort: 5432,
    readinessCommand: ['pg_isready', '-U', 'postgres'],
  });
  return `postgresql://postgres:test-only@127.0.0.1:${port}/feedback`;
}

/**
 * The slot's throwaway `rabbitmq:4.1-alpine` broker on an ephemeral loopback
 * port. It runs a non-guest account: the stock `guest` one only answers on the
 * container's own loopback, so a published port would leave it unreachable.
 */
async function startThrowawayRabbitMq(slot: number): Promise<string> {
  const port = await startThrowawayContainer({
    name: feedbackMqContainer(slot),
    image: 'rabbitmq:4.1-alpine',
    environment: [
      `RABBITMQ_DEFAULT_USER=${HARNESS_RABBITMQ_USER}`,
      `RABBITMQ_DEFAULT_PASS=${HARNESS_RABBITMQ_PASSWORD}`,
    ],
    containerPort: 5672,
    readinessCommand: ['rabbitmq-diagnostics', '-q', 'ping'],
    readinessUser: 'rabbitmq',
  });
  return `amqp://${HARNESS_RABBITMQ_USER}:${HARNESS_RABBITMQ_PASSWORD}@127.0.0.1:${port}`;
}

/** The slot's throwaway `redis:8-alpine` cache on an ephemeral loopback port. */
async function startThrowawayRedis(slot: number): Promise<string> {
  const port = await startThrowawayContainer({
    name: redisContainer(slot),
    image: 'redis:8-alpine',
    environment: [],
    containerPort: 6379,
    readinessCommand: ['redis-cli', 'ping'],
  });
  return `redis://127.0.0.1:${port}`;
}

/**
 * Force-removes the three containers the slot owns (best-effort). Takes the slot
 * that booted them, so teardown never removes another slot's containers.
 */
export function stopThrowawayContainers(slot: number): void {
  forceRemoveContainer(feedbackPgContainer(slot));
  forceRemoveContainer(feedbackMqContainer(slot));
  forceRemoveContainer(redisContainer(slot));
}

/** Everything one throwaway container boot needs, and nothing about its caller. */
interface ContainerRecipe {
  name: string;
  image: string;
  /** `-e` values, `NAME=value` each. */
  environment: string[];
  /** The one port published on a Docker-chosen loopback port. */
  containerPort: number;
  /** Probe run inside the container until it answers. */
  readinessCommand: string[];
  /**
   * Account the probe runs as, when the image's readiness tool must not run as
   * root. RabbitMQ is the case: a root probe creates its Erlang cookie
   * root-owned and the broker then refuses to start (`eacces`).
   */
  readinessUser?: string;
}

/**
 * Boots one throwaway container for the slot and returns the loopback port
 * Docker assigned it. A stale container left by a crashed run is reclaimed
 * first, and any boot that dies before serving is removed before it throws, so
 * no run has to clean up by hand.
 */
async function startThrowawayContainer(recipe: ContainerRecipe): Promise<number> {
  requireDocker(recipe.image);
  forceRemoveContainer(recipe.name);
  runContainer(recipe);
  await waitForReadiness(recipe);
  return publishedPort(recipe);
}

function requireDocker(image: string): void {
  try {
    runDocker(['version']);
  } catch {
    throw new Error(`e2e needs Docker to run a throwaway container (${image})`);
  }
}

function runContainer(recipe: ContainerRecipe): void {
  runDocker([
    'run',
    '--rm',
    '-d',
    '--name',
    recipe.name,
    ...recipe.environment.flatMap((variable) => ['-e', variable]),
    '-p',
    `127.0.0.1::${recipe.containerPort}`,
    recipe.image,
  ]);
}

async function waitForReadiness(recipe: ContainerRecipe): Promise<void> {
  const deadline = Date.now() + READINESS_DEADLINE_MS;
  while (!answersReadinessProbe(recipe)) {
    if (Date.now() > deadline) {
      forceRemoveContainer(recipe.name);
      throw new Error(
        `${recipe.name} never answered \`${recipe.readinessCommand.join(' ')}\` (${recipe.image})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function answersReadinessProbe(recipe: ContainerRecipe): boolean {
  try {
    runDocker(['exec', ...probeUserArguments(recipe), recipe.name, ...recipe.readinessCommand]);
    return true;
  } catch {
    return false;
  }
}

function probeUserArguments({ readinessUser }: ContainerRecipe): string[] {
  return readinessUser === undefined ? [] : ['--user', readinessUser];
}

function publishedPort(recipe: ContainerRecipe): number {
  let mapping = '';
  try {
    mapping = readDockerOutput(['port', recipe.name, `${recipe.containerPort}/tcp`]);
  } catch {
    // Reported as the one legible error below.
  }
  const hostPort = /:(\d+)$/.exec(mapping.trim().split('\n')[0] ?? '')?.[1];
  if (hostPort === undefined) {
    forceRemoveContainer(recipe.name);
    throw new Error(`${recipe.name} never published ${recipe.containerPort}/tcp on loopback`);
  }
  return Number(hostPort);
}

function forceRemoveContainer(name: string): void {
  try {
    runDocker(['rm', '-f', name]);
  } catch {
    // Already gone, or Docker unavailable at teardown.
  }
}

function runDocker(args: string[]): void {
  execFileSync(bin('docker'), args, { env: childEnv(), stdio: 'ignore' });
}

function readDockerOutput(args: string[]): string {
  return execFileSync(bin('docker'), args, {
    env: childEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Brings up idp + note-service + app for `cfg`. Returns the spawned services in
 * start order so the caller can record/stop them. State is reset first.
 */
export async function startStack(cfg: StackConfig): Promise<SpawnedService[]> {
  // Before touching a build, prove every stack port is actually free. A stale
  // listener is the one harness failure that tests the WRONG build instead of
  // erroring: the fresh server dies with EADDRINUSE while `waitForHttp` happily
  // answers against the stale process — whose chunk hashes are gone from disk
  // (ChunkLoadError on the page — never a product bug).
  const host = new URL(cfg.appOrigin).hostname;
  await ensurePortFree(cfg.appPort, 'app', host);
  await ensurePortFree(cfg.idpPort, 'idp', host);
  await ensurePortFree(cfg.notePort, 'note-service', host);
  await ensurePortFree(cfg.tagsPort, 'tags-service', host);
  await ensurePortFree(cfg.todoPort, 'todo-service', host);
  await ensurePortFree(cfg.mealPort, 'meal-service', host);
  if (cfg.feedbackPort !== undefined) {
    await ensurePortFree(cfg.feedbackPort, 'feedback-service', host);
  }

  rmSync(cfg.stateDir, { recursive: true, force: true });
  mkdirSync(cfg.stateDir, { recursive: true });

  await build('apps/idp');
  execFileSync(bin('npm'), ['run', 'seed', '-w', 'apps/idp'], {
    cwd: repoRoot(),
    env: childEnv(idpEnv(cfg)),
  });

  const services: SpawnedService[] = [];
  try {
    services.push(
      await spawnService({
        name: 'idp',
        command: 'node',
        args: ['dist/main.js'],
        cwd: `${repoRoot()}/apps/idp`,
        env: idpEnv(cfg),
      }),
    );

    await build('apps/note-service');
    services.push(
      await spawnService({
        name: 'note-service',
        command: 'node',
        args: ['dist/main.js'],
        cwd: `${repoRoot()}/apps/note-service`,
        env: noteEnv(cfg),
      }),
    );

    await build('apps/tags-service');
    services.push(
      await spawnService({
        name: 'tags-service',
        command: 'node',
        args: ['dist/main.js'],
        cwd: `${repoRoot()}/apps/tags-service`,
        env: tagsEnv(cfg),
      }),
    );

    await build('apps/todo-service');
    services.push(
      await spawnService({
        name: 'todo-service',
        command: 'node',
        args: ['dist/main.js'],
        cwd: `${repoRoot()}/apps/todo-service`,
        env: todoEnv(cfg),
      }),
    );

    await build('apps/meal-service');
    services.push(
      await spawnService({
        name: 'meal-service',
        command: 'node',
        args: ['dist/main.js'],
        cwd: `${repoRoot()}/apps/meal-service`,
        env: mealEnv(cfg),
      }),
    );

    const feedbackDbUrl = await bootSlotContainers(cfg.slot ?? 0);

    const feedbackPort = cfg.feedbackPort;
    if (feedbackPort !== undefined) {
      await build('apps/feedback-service');
      services.push(
        await spawnService({
          name: 'feedback-service',
          command: 'node',
          args: ['dist/main.js'],
          cwd: `${repoRoot()}/apps/feedback-service`,
          env: feedbackEnv(cfg, feedbackPort, feedbackDbUrl),
        }),
      );
    }

    const app = await spawnApp(cfg);
    services.push(app);

    await waitForHttp(`http://127.0.0.1:${cfg.idpPort}/jwks`);
    await waitForHttp(`http://127.0.0.1:${cfg.notePort}/health`);
    await waitForHttp(`http://127.0.0.1:${cfg.tagsPort}/health`);
    await waitForHttp(`http://127.0.0.1:${cfg.todoPort}/health`);
    await waitForHttp(`http://127.0.0.1:${cfg.mealPort}/health`);
    if (cfg.feedbackPort !== undefined) {
      await waitForHttp(`http://127.0.0.1:${cfg.feedbackPort}/health/live`, 60_000);
    }
    await waitForHttp(`${cfg.appOrigin}/auth/login`, 90_000);

    return services;
  } catch (err) {
    // A setup that fails after some services are up must not leak them: the
    // next run would then boot against this run's stale server — the exact
    // EADDRINUSE + stale-chunk class the port preflight above guards. The
    // slot's containers go too, because Playwright never runs globalTeardown
    // when globalSetup throws.
    for (const service of services) await service.stop();
    stopThrowawayContainers(cfg.slot ?? 0);
    throw err;
  }
}

async function spawnApp(cfg: StackConfig): Promise<SpawnedService> {
  if (cfg.mode === 'production') {
    await build('apps/app');
    // `output: 'standalone'` mirrors the monorepo layout below
    // `apps/app/.next/standalone/`, so the app's server lands under
    // `<...>/apps/app/server.js`. From the primary checkout that prefix is just
    // `apps/app`; run from a git worktree and Next nests the worktree's relative
    // path in between (`.worktrees/<slug>/apps/app`). Locate it instead of
    // assuming the depth, so the same harness serves both.
    const standaloneRoot = `${repoRoot()}/apps/app/.next/standalone`;
    const appDir = findStandaloneAppDir(standaloneRoot);
    // The build omits static assets; Docker copies them in. Do the same so the
    // built app serves CSS/JS exactly like production.
    mkdirSync(`${appDir}/.next`, { recursive: true });
    cpSync(`${repoRoot()}/apps/app/.next/static`, `${appDir}/.next/static`, { recursive: true });
    mkdirSync(`${appDir}/public`, { recursive: true });
    cpSync(`${repoRoot()}/apps/app/public`, `${appDir}/public`, { recursive: true });
    return spawnService({
      name: 'app',
      command: 'node',
      args: [join(appDir, 'server.js')],
      cwd: `${repoRoot()}/apps/app`,
      env: appEnv(cfg),
    });
  }

  // Dev mode (`next dev`), the human's actual runtime.
  return spawnService({
    name: 'app',
    command: 'node',
    args: [
      join(repoRoot(), 'node_modules/next/dist/bin/next'),
      'dev',
      '-p',
      String(cfg.appPort),
      '-H',
      '127.0.0.1',
    ],
    cwd: `${repoRoot()}/apps/app`,
    env: { ...appEnv(cfg), NEXT_TELEMETRY_DISABLED: '1' },
  });
}
