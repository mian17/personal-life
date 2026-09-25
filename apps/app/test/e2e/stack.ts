import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnService, waitForHttp, type SpawnedService } from './services';
import { E2E_APP_SECRET, E2E_OWNER, E2E_PASSWORD, E2E_USER, repoRoot } from './config';

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
    OIDC_APP_REDIRECT_URIS: `http://localhost:${cfg.appPort}/auth/callback,http://127.0.0.1:${cfg.appPort}/auth/callback`,
    SEED_USERNAME: E2E_USER,
    SEED_PASSWORD: E2E_PASSWORD,
  };
}

function noteEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: String(cfg.notePort),
    HOST: '127.0.0.1',
    DB_PATH: `${cfg.stateDir}/note-service.db`,
    IDP_ISSUER: `http://127.0.0.1:${cfg.idpPort}`,
    NOTE_SERVICE_AUDIENCE: 'note-service',
  };
}

function appEnv(cfg: StackConfig): NodeJS.ProcessEnv {
  const origin = cfg.appOrigin;
  return {
    NODE_ENV: cfg.mode === 'production' ? 'production' : 'development',
    PORT: String(cfg.appPort),
    HOSTNAME: '127.0.0.1',
    API_URL: `http://127.0.0.1:${cfg.notePort}`,
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

  const app = await spawnApp(cfg);
  services.push(app);

  await waitForHttp(`http://127.0.0.1:${cfg.idpPort}/jwks`);
  await waitForHttp(`http://127.0.0.1:${cfg.notePort}/health`);
  await waitForHttp(`${cfg.appOrigin}/auth/login`, 90_000);

  return services;
}

async function spawnApp(cfg: StackConfig): Promise<SpawnedService> {
  if (cfg.mode === 'production') {
    await build('apps/app');
    // `output: 'standalone'` omits static assets; Docker copies them in. Do the
    // same so the built app serves CSS/JS exactly like production.
    const standalone = `${repoRoot()}/apps/app/.next/standalone/apps/app`;
    mkdirSync(`${standalone}/.next`, { recursive: true });
    cpSync(`${repoRoot()}/apps/app/.next/static`, `${standalone}/.next/static`, { recursive: true });
    mkdirSync(`${standalone}/public`, { recursive: true });
    cpSync(`${repoRoot()}/apps/app/public`, `${standalone}/public`, { recursive: true });
    return spawnService({
      name: 'app',
      command: 'node',
      args: ['.next/standalone/apps/app/server.js'],
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
