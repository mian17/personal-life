import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { spawnService, waitForHttp, type SpawnedService } from './services';
import {
  E2E_APP_SECRET,
  E2E_OWNER,
  E2E_PASSWORD,
  E2E_USER,
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
  mealPort: number;
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

function mealEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.mealPort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/meal-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    MEAL_SERVICE_AUDIENCE: 'life-api',
    MEAL_MASTER_KEY: HARNESS_MASTER_KEY,
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
    MEAL_API_URL: `http://127.0.0.1:${cfg.mealPort}`,
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

  const app = await spawnApp(cfg);
  services.push(app);

  await waitForHttp(`http://127.0.0.1:${cfg.idpPort}/jwks`);
  await waitForHttp(`http://127.0.0.1:${cfg.notePort}/health`);
  await waitForHttp(`http://127.0.0.1:${cfg.tagsPort}/health`);
  await waitForHttp(`http://127.0.0.1:${cfg.todoPort}/health`);
  await waitForHttp(`http://127.0.0.1:${cfg.mealPort}/health`);
  await waitForHttp(`${cfg.appOrigin}/auth/login`, 90_000);

  return services;
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
