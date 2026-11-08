#!/usr/bin/env node
/**
 * Produce the Playwright storage state `capture.mjs` needs, by logging in against a
 * running dev stack.
 *
 * Why this exists: `capture.mjs` attaches to an already-running dev server and refuses
 * to work without a session — the app's identity gate sends every unauthenticated
 * request to the IdP — so it documents a `SCREENS_STORAGE_STATE` file that nothing in
 * the repo produced. Every operator hand-built one in a browser, which is exactly how
 * the `/todos/matrix` defect below went unnoticed for so long.
 *
 * The cookie: `/todos/matrix` calls `readPref('matrix')` and answers `404` when that
 * preference is off, and the preference is a cookie the settings switch writes. A
 * session alone is therefore not enough — a capture run would record `HTTP 404` for
 * that screen. Toggling it here means the storage state captures the matrix on every
 * run, so the 404 is not a per-operator mystery. Do not delete it as noise.
 *
 * The app canonicalizes `127.0.0.1` to `localhost` during login, so the session cookie
 * lands on `localhost` and a browser refuses to send it to the loopback literal — the
 * base URL must be the origin the cookies belong to. The default is `localhost` for
 * that reason (the same note `capture.mjs` carries).
 *
 * Run: node test/screens/login-state.mjs   (from `apps/app`, with the dev stack up)
 *      i.e. `node apps/app/test/screens/login-state.mjs` from the repo root
 *
 *   SCREENS_BASE_URL=http://localhost:3100              # default
 *   SCREENS_STORAGE_STATE=/tmp/screens-storage-state.json
 *                                                      # default; `capture.mjs` reads
 *                                                      # this same variable
 *   SEED_USERNAME, SEED_PASSWORD                        # read from the repo root's
 *                                                      # `.env.development` when
 *                                                      # present, else the dev
 *                                                      # defaults `setup-dev-env.sh`
 *                                                      # writes
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
/** The repo root: the dev env file lives there, not in the workspace. */
const repoRoot = resolve(here, '..', '..', '..', '..');

/** The credentials `scripts/setup-dev-env.sh` seeds a fresh dev stack with. */
const DEV_SEED_USERNAME = 'dev';
const DEV_SEED_PASSWORD = 'test123';

/**
 * The dev env file's `KEY=value` pairs, or `{}` when the file is absent.
 *
 * Absent is normal for a git worktree, where the env file sits in the primary
 * checkout instead, so a missing file falls back to the seed defaults above rather
 * than failing — but it is said out loud, because the fallback is wrong whenever the
 * stack was seeded with anything other than those defaults.
 */
function readDevEnv() {
  const path = join(repoRoot, '.env.development');
  if (!existsSync(path)) {
    console.warn(`no ${path}; using the seed defaults (set SEED_USERNAME/SEED_PASSWORD to override)`);
    return {};
  }
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

const baseUrl = (process.env.SCREENS_BASE_URL?.trim() || 'http://localhost:3100').replace(/\/+$/, '');
const statePath = process.env.SCREENS_STORAGE_STATE?.trim() || join(tmpdir(), 'screens-storage-state.json');
const devEnv = readDevEnv();
const username = process.env.SEED_USERNAME ?? devEnv.SEED_USERNAME ?? DEV_SEED_USERNAME;
const password = process.env.SEED_PASSWORD ?? devEnv.SEED_PASSWORD ?? DEV_SEED_PASSWORD;
/** The origin the session cookie must belong to; the matrix cookie joins it there. */
const origin = new URL(baseUrl);

/** How many hops the login dance may take before giving up on the credentials. */
const loginRounds = 4;

/**
 * Fill and submit the IdP's credentials form when it is on screen, and report whether
 * it was. The dance redirects through the app and the IdP, so the form is looked for
 * once per hop rather than assumed present on the first page.
 */
async function submitCredentialsIfAsked(page) {
  const usernameField = page.locator('input[name="username"]');
  if ((await usernameField.count()) === 0) return false;
  await usernameField.first().fill(username);
  await page.locator('input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForLoadState('load'),
    page.locator('button[type="submit"]').first().click(),
  ]);
  return true;
}

/**
 * Log in by visiting a gated page and answering the IdP until no form is left to fill.
 * `/feedback` is the landing page because it is a plain read — nothing on it changes
 * state, so the hop count stays predictable.
 */
async function signIn(page) {
  await page.goto(`${baseUrl}/feedback`, { waitUntil: 'load' });
  for (let round = 0; round < loginRounds; round += 1) {
    if (!(await submitCredentialsIfAsked(page))) return;
  }
  throw new Error(`still being asked to sign in after ${loginRounds} hops (check SEED_USERNAME/SEED_PASSWORD)`);
}

/** The Eisenhower-matrix preference, spelled the way `prefCookieName('matrix')` does. */
const MATRIX_PREFERENCE_COOKIE = {
  name: 'pref_matrix',
  value: 'on',
  domain: origin.hostname,
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
};

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page);
    console.log(`signed in as ${username}`);

    await context.addCookies([MATRIX_PREFERENCE_COOKIE]);

    // Proven rather than assumed: a 404 here means the matrix cookie did not take, and a
    // storage state that silently omits it would fail the same way on every capture.
    const matrix = await page.goto(`${baseUrl}/todos/matrix`, { waitUntil: 'load' });
    const status = matrix?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`/todos/matrix answered HTTP ${status} after setting pref_matrix`);
    }
    console.log(`/todos/matrix: HTTP ${status}`);

    await context.storageState({ path: statePath });
    console.log(`wrote ${statePath}`);
    console.log(`run the capture with: SCREENS_STORAGE_STATE=${statePath} npm run screens -w apps/app`);
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`screens login-state failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
