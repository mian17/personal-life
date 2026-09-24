import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnService, waitForHttp, type SpawnedService } from './services';
import { E2E_OWNER, servicePidsFile, testPorts } from './config';

/**
 * Playwright global setup: build and launch the three services on dedicated test
 * ports, mirroring the Docker topology.
 *
 * The app runs the *production* build so middleware's identity gate is active
 * (it is skipped under NODE_ENV=development). It points at the dev IdP and the
 * test note-service. Ports are 31xx to avoid clashing with any running stack.
 *
 * Services are stopped by global-teardown.ts, which reads the recorded PIDs.
 */

const REPO = process.env.E2E_REPO_ROOT ?? '/home/night/WebstormProjects/personal-life';
const { idpPort, notePort, appPort } = testPorts();
// Scratch state for the e2e run lives under apps/app (gitignored), never under
// any service's `data/` directory — so note-service's real life.db directory and
// apps/idp/data stay untouched by the test run.
const E2E_DIR = join(REPO, 'apps/app/.e2e-state');

async function build(workspace: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    execFile('npm', ['run', 'build', '-w', workspace], { cwd: REPO }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

export default async function globalSetup(): Promise<void> {
  const services: SpawnedService[] = [];
  const { mkdirSync, rmSync, cpSync } = await import('node:fs');
  rmSync(E2E_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DIR, { recursive: true });

  // IdP: scratch DB + seeded user + the app client's redirect/secret.
  // The app-under-test uses `localhost` (see playwright.config.ts): Next
  // normalizes loopback 127.0.0.1 → localhost in middleware redirects, so the
  // app's browser origin must be `localhost` for the login/attempt cookies and
  // the callback to stay on one origin. Production uses a real hostname and is
  // unaffected.
  const appOrigin = `http://localhost:${appPort}`;
  const idpEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PORT: String(idpPort),
    HOST: '127.0.0.1',
    DB_PATH: `${E2E_DIR}/idp.db`,
    KEYS_PATH: `${E2E_DIR}/idp-keys.json`,
    IDP_ISSUER: `http://127.0.0.1:${idpPort}`,
    OIDC_APP_CLIENT_SECRET: 'app-dev-client-secret-not-a-secret',
    OIDC_APP_REDIRECT_URIS: `${appOrigin}/auth/callback`,
    SEED_USERNAME: 'e2e-user',
    SEED_PASSWORD: 'e2e-password-not-a-secret',
  };

  const { execFileSync } = await import('node:child_process');
  await build('apps/idp');
  execFileSync('npm', ['run', 'seed', '-w', 'apps/idp'], { cwd: REPO, env: { ...process.env, ...idpEnv } });
  services.push(
    await spawnService({
      name: 'idp',
      command: 'node',
      args: ['dist/main.js'],
      cwd: `${REPO}/apps/idp`,
      env: idpEnv,
    }),
  );

  // note-service: its own scratch DB so life.db is never touched. JWT-only
  // (Task 10): it verifies against the test IdP's JWKS, no static token.
  await build('apps/note-service');
  services.push(
    await spawnService({
      name: 'note-service',
      command: 'node',
      args: ['dist/main.js'],
      cwd: `${REPO}/apps/note-service`,
      env: {
        NODE_ENV: 'production',
        PORT: String(notePort),
        HOST: '127.0.0.1',
        DB_PATH: `${E2E_DIR}/note-service.db`,
        IDP_ISSUER: `http://127.0.0.1:${idpPort}`,
        NOTE_SERVICE_AUDIENCE: 'note-service',
      },
    }),
  );

  // App: production build (gate active), pointed at the test IdP + service.
  await build('apps/app');
  // `output: 'standalone'` does not include static assets; the Dockerfile copies
  // them in. Do the same so the built app serves CSS/JS like production.
  mkdirSync(`${REPO}/apps/app/.next/standalone/apps/app/.next`, { recursive: true });
  cpSync(`${REPO}/apps/app/.next/static`, `${REPO}/apps/app/.next/standalone/apps/app/.next/static`, {
    recursive: true,
  });
  mkdirSync(`${REPO}/apps/app/.next/standalone/apps/app/public`, { recursive: true });
  cpSync(`${REPO}/apps/app/public`, `${REPO}/apps/app/.next/standalone/apps/app/public`, {
    recursive: true,
  });
  services.push(
    await spawnService({
      name: 'app',
      command: 'node',
      args: ['.next/standalone/apps/app/server.js'],
      cwd: `${REPO}/apps/app`,
      env: {
        NODE_ENV: 'production',
        PORT: String(appPort),
        HOSTNAME: '127.0.0.1',
        API_URL: `http://127.0.0.1:${notePort}`,
        IDP_ISSUER: `http://127.0.0.1:${idpPort}`,
        OIDC_APP_CLIENT_ID: 'app',
        OIDC_APP_CLIENT_SECRET: 'app-dev-client-secret-not-a-secret',
        OIDC_APP_REDIRECT_URI: `${appOrigin}/auth/callback`,
        // The access gate is exercised for real: Next always sets
        // x-forwarded-host, so with an owner configured every request must carry
        // the matching tailscale-user-login header. The Playwright context sends
        // it via extraHTTPHeaders (see playwright.config.ts).
        OWNER_LOGIN: E2E_OWNER,
      },
    }),
  );

  await waitForHttp(`http://127.0.0.1:${idpPort}/jwks`);
  await waitForHttp(`http://127.0.0.1:${notePort}/health`);
  await waitForHttp(`http://127.0.0.1:${appPort}/auth/login`, 60_000);

  writeFileSync(join(__dirname, servicePidsFile), JSON.stringify({ pids: services.map((s) => s.child.pid) }));
}
