import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnService, waitForHttp, type SpawnedService } from './services';
import {
  E2E_APP_SECRET,
  E2E_OWNER,
  E2E_PASSWORD,
  E2E_USER,
  FEEDBACK_PG_CONTAINER,
  hopPorts,
  repoRoot,
} from './config';

/**
 * The hop replicas' callbacks, registered on the shared harness IdP so the
 * two-instance proof (Task 3 / `hop.spec.ts`) can drive a real login dance from
 * replica A. Additive only: extra loopback redirect URIs are inert for every
 * other spec, and the IdP still rejects any unregistered callback.
 */
function hopRedirectUris(): string[] {
  const { appAPort, appBPort } = hopPorts();
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
 * under `apps/app/.e2e-state`, never any service's real `data/` directory.
 */

export interface StackConfig {
  appPort: number;
  idpPort: number;
  notePort: number;
  tagsPort: number;
  todoPort: number;
  /**
   * feedback-service: 31xx in the test harness, never the dev stack's 3206.
   * Optional — omitting it leaves feedback-service (and its throwaway Postgres)
   * out of the stack, which is how the dev harness starts unchanged.
   */
  feedbackPort?: number;
  /** Browser origin the app is reached on (`localhost` or `127.0.0.1`). */
  appOrigin: string;
  /** Scratch directory for the IdP/note-service DBs and keys. */
  stateDir: string;
  mode: 'production' | 'development';
}

export function appOriginFor(host: string, appPort: number): string {
  return `http://${host}:${appPort}`;
}

function build(workspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      ['run', 'build', '-w', workspace],
      { cwd: repoRoot(), env: { ...process.env, NODE_ENV: 'production' } },
      (err) => (err ? reject(err) : resolve()),
    );
  });
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
      ...hopRedirectUris(),
    ].join(','),
    SEED_USERNAME: E2E_USER,
    SEED_PASSWORD: E2E_PASSWORD,
    // Shared ecosystem audience (SPEC-service-kernel): one token serves all
    // three resource services in the harness exactly as in compose.
    OIDC_DEFAULT_RESOURCE: 'https://note-service',
    OIDC_AUDIENCE_MAP:
      'https://note-service=life-api,https://tags-service=life-api,https://todo-service=life-api',
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

/**
 * feedback-service on the harness's own port. Postgres-only on purpose: no
 * `REDIS_URL` (the cache's fail-open direct-DB path) and no `RABBITMQ_URL` (the
 * spec's broker-down tolerance — the submit still succeeds). `undefined` drops a
 * value inherited from the caller's env rather than passing `"undefined"`.
 */
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
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    OIDC_APP_CLIENT_ID: 'app',
    OIDC_APP_CLIENT_SECRET: E2E_APP_SECRET,
    // The browser origin the harness drives; byte-identical to one of the IdP's
    // registered redirect URIs.
    OIDC_APP_REDIRECT_URI: `${origin}/auth/callback`,
    // Production build only: the access gate is exercised for real (Next sets
    // x-forwarded-host and the context sends tailscale-user-login). In dev the
    // access gate is skipped by contract, so OWNER_LOGIN is irrelevant.
    ...(cfg.mode === 'production' ? { OWNER_LOGIN: E2E_OWNER } : {}),
  };
}

/**
 * A throwaway Postgres for feedback-service (the `pg-integration.test.ts`
 * pattern): fixed-name `postgres:17-alpine` container, ephemeral loopback port,
 * never the compose `postgres`. A host without Docker fails fast — this e2e is
 * the feedback chapter's final proof, so a silent skip would hide it.
 */
async function startThrowawayPostgres(): Promise<string> {
  const docker = (args: string[], capture = false): string =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });

  try {
    docker(['version']);
  } catch {
    throw new Error(
      'e2e needs Docker to run feedback-service against a throwaway Postgres (postgres:17-alpine)',
    );
  }

  docker(['rm', '-f', FEEDBACK_PG_CONTAINER]);
  docker([
    'run',
    '--rm',
    '-d',
    '--name',
    FEEDBACK_PG_CONTAINER,
    '-e',
    'POSTGRES_PASSWORD=test-only',
    '-e',
    'POSTGRES_DB=feedback',
    '-p',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  ]);

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      docker(['exec', FEEDBACK_PG_CONTAINER, 'pg_isready', '-U', 'postgres'], true);
      break;
    } catch {
      if (Date.now() > deadline) {
        stopThrowawayPostgres();
        throw new Error('throwaway Postgres never became ready');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const mapped = docker(['port', FEEDBACK_PG_CONTAINER, '5432/tcp'], true)
    .trim()
    .split('\n')[0] ?? '';
  const port = /:(\d+)$/.exec(mapped)?.[1];
  if (!port) {
    stopThrowawayPostgres();
    throw new Error('throwaway Postgres never published a port');
  }
  return `postgresql://postgres:test-only@127.0.0.1:${port}/feedback`;
}

/** Force-remove the throwaway Postgres container (best-effort). */
export function stopThrowawayPostgres(): void {
  try {
    execFileSync('docker', ['rm', '-f', FEEDBACK_PG_CONTAINER], { stdio: 'ignore' });
  } catch {
    // Already gone, or Docker unavailable at teardown.
  }
}

/**
 * Brings up idp + note-service + app for `cfg`. Returns the spawned services in
 * start order so the caller can record/stop them. State is reset first.
 */
export async function startStack(cfg: StackConfig): Promise<SpawnedService[]> {
  rmSync(cfg.stateDir, { recursive: true, force: true });
  mkdirSync(cfg.stateDir, { recursive: true });

  await build('apps/idp');
  execFileSync('npm', ['run', 'seed', '-w', 'apps/idp'], {
    cwd: repoRoot(),
    env: { ...process.env, ...idpEnv(cfg) },
  });

  const services: SpawnedService[] = [];
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

  // The throwaway Postgres first: feedback-service fails closed without a DB.
  // Skipped when the stack has no feedback port (the dev harness).
  const feedbackPort = cfg.feedbackPort;
  if (feedbackPort !== undefined) {
    const feedbackDbUrl = await startThrowawayPostgres();
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
  if (cfg.feedbackPort !== undefined) {
    await waitForHttp(`http://127.0.0.1:${cfg.feedbackPort}/health/live`, 60_000);
  }
  await waitForHttp(`${cfg.appOrigin}/auth/login`, 90_000);

  return services;
}

/**
 * Locates the emitted standalone server. Next infers `outputFileTracingRoot`
 * from the git root, so in a worktree the traced prefix nests the app under
 * `.next/standalone/.worktrees/<slug>/apps/app/server.js` instead of the
 * `.next/standalone/apps/app/server.js` a primary checkout emits. Walk the
 * standalone tree for a `server.js` whose path ends in `apps/app/server.js`
 * and resolve the app root from it, so both layouts work.
 */
function findStandaloneServer(): string {
  const standalone = `${repoRoot()}/apps/app/.next/standalone`;
  const suffix = join('apps', 'app', 'server.js');
  if (!existsSync(standalone)) {
    throw new Error(
      `No standalone build at ${standalone} — build the app first (npm run build -w @life/app).`,
    );
  }
  const stack: string[] = [standalone];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'server.js' && full.endsWith(suffix)) return full;
    }
  }
  throw new Error(
    `No server.js ending in ${suffix} under ${standalone} — build the app first (npm run build -w @life/app).`,
  );
}

async function spawnApp(cfg: StackConfig): Promise<SpawnedService> {
  if (cfg.mode === 'production') {
    await build('apps/app');
    // `output: 'standalone'` omits static assets; Docker copies them in. Do the
    // same so the built app serves CSS/JS exactly like production.
    const serverJs = findStandaloneServer();
    const standalone = dirname(serverJs);
    mkdirSync(join(standalone, '.next'), { recursive: true });
    cpSync(`${repoRoot()}/apps/app/.next/static`, join(standalone, '.next/static'), { recursive: true });
    mkdirSync(join(standalone, 'public'), { recursive: true });
    cpSync(`${repoRoot()}/apps/app/public`, join(standalone, 'public'), { recursive: true });
    return spawnService({
      name: 'app',
      command: 'node',
      args: [serverJs],
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
