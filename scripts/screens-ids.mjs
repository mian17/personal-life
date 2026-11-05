#!/usr/bin/env node
/**
 * Read the seeded dev stack back through `@life/ops` and write the ids the screenshot
 * harness needs.
 *
 * Why this exists: `apps/app/test/screens/capture.mjs` resolves a screen's
 * `{placeholder}` route from `apps/app/test/screens/screens.ids.json`, and a seeded
 * row's id is only knowable after `npm run seed:stack` has run against a live stack.
 * This bridge is the one seam between the two: it creates nothing, it deletes
 * nothing, and it never speaks HTTP on its own — every read is a CLI child process,
 * the same client the app and the MCP server use.
 *
 * The rows it looks for are the ones `scripts/seed-stack.mjs` writes, recognised by
 * that script's own markers (`Seed: weekly groceries …`, `Water the garden`,
 * `Oats`, `Seed: oats breakfast`, and for a meal entry the
 * `date|mealGroup|foodId|quantity` tuple it files one under). Markers are matched,
 * never re-created: a stack that was not seeded makes this fail loudly instead of
 * silently inventing a target for the harness.
 *
 * Credentials follow `seed-stack.mjs` exactly: dev services answer as `dev-user`
 * before any token is checked, so a throwaway credential file in a temp directory
 * holds a fabricated token, and the directory is removed on exit.
 *
 * Run: npm run screens:ids   (after `npm run seed:stack` on a running stack)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowsOf } from './seed-stack.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'packages', 'ops', 'dist', 'cli', 'run.js');
const IDS_FILE = join(ROOT, 'apps', 'app', 'test', 'screens', 'screens.ids.json');

/** The dev stack's port map (`scripts/dev-infra.sh` + the root `dev`/`dev:build`). */
const PORTS = new Map([
  ['notes', 3101],
  ['tags', 3104],
  ['todo', 3105],
  ['meal', 3106],
  ['focus', 3107],
  ['feedback', 3108],
]);

/** Not a credential: dev services accept any bearer because they skip the check. */
const PLACEHOLDER_TOKEN = 'screens-ids-placeholder-never-sent-to-a-verifier';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** A client-local `YYYY-MM-DD`, derived exactly as `seed-stack.mjs` derives the entry's day. */
function clientDay() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${monthDay}`;
}

/** The marker texts a seeded note, todo, food and saved meal are recognised by (`seed-stack.mjs`). */
const SEEDED_NOTE = 'Seed: weekly groceries — tomatoes, basil, olive oil';
const SEEDED_SAVED_MEAL = 'Seed: oats breakfast';
const SEEDED_TODO = 'Water the garden';
const SEEDED_FOOD = 'Oats';
const SEEDED_ENTRY = { mealGroup: 'breakfast', quantity: 80 };

/** The CLI's `list` call for a resource, returning the rows the service sent back. */
function listRows(service, resource, flags, credentialsDir) {
  const args = [resource, 'list', ...flags];
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(service, credentialsDir),
    });
    return rowsOf(stdout.trim() === '' ? undefined : JSON.parse(stdout), `${service} ${resource} list`);
  } catch (error) {
    throw new Error(`${service} ${args.join(' ')} failed: ${failureText(error)}`);
  }
}

/** The CLI renders a failure on stderr and exits non-zero; that line is the whole story. */
function failureText(error) {
  const stderr = error?.stderr === undefined ? '' : String(error.stderr).trim();
  return stderr === '' ? String(error?.message ?? error) : stderr;
}

/**
 * A child's environment: one service selected, its base pinned to the probed port,
 * and the throwaway credential store — the same shape `seed-stack.mjs` builds.
 */
function childEnv(service, credentialsDir) {
  const base = `http://127.0.0.1:${PORTS.get(service)}`;
  return {
    ...process.env,
    LIFE_OPS_SERVICE: service,
    LIFE_OPS_API_BASE: base,
    [`LIFE_OPS_API_BASE_${service.toUpperCase()}`]: base,
    LIFE_OPS_CREDENTIALS_PATH: join(credentialsDir, 'credentials.json'),
    LIFE_OPS_REFRESH_SKEW_MS: '0',
  };
}

/** The fabricated store the dev services never read, written `0600` like the real one. */
function writeCredentials(dir) {
  const tokens = {
    accessToken: PLACEHOLDER_TOKEN,
    refreshToken: PLACEHOLDER_TOKEN,
    expiresAt: Date.now() + TEN_YEARS_MS,
  };
  writeFileSync(join(dir, 'credentials.json'), `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
}

/** The first row a marker matches, or `undefined` when the stack was never seeded. */
function findRow(service, resource, flags, matches, credentialsDir) {
  return listRows(service, resource, flags, credentialsDir).find((row) => matches(row));
}

/**
 * The six ids `screens.config.json` needs, in the order the harness reads them. Each
 * entry reads the resource `seed-stack.mjs` wrote and matches that script's marker;
 * `mealDate` is the client-local day the seeded entry was filed under, which is also
 * why `entry` cannot be looked up without `food`.
 */
function readIds(credentialsDir) {
  const food = findRow('meal', 'foods', [], (row) => row.name === SEEDED_FOOD, credentialsDir);
  const mealDate = clientDay();
  const ids = [
    [
      'note',
      findRow('notes', 'notes', [], (row) => row.body === SEEDED_NOTE, credentialsDir)?.id,
    ],
    ['todo', findRow('todo', 'todos', [], (row) => row.title === SEEDED_TODO, credentialsDir)?.id],
    ['mealDate', mealDate],
    [
      'entry',
      findRow(
        'meal',
        'entries',
        ['--date', mealDate],
        (row) =>
          row.date === mealDate &&
          row.mealGroup === SEEDED_ENTRY.mealGroup &&
          row.foodId === food?.id &&
          row.quantity === SEEDED_ENTRY.quantity,
        credentialsDir,
      )?.id,
    ],
    ['food', food?.id],
    [
      'savedMeal',
      findRow('meal', 'saved-meals', [], (row) => row.name === SEEDED_SAVED_MEAL, credentialsDir)?.id,
    ],
  ];
  return ids;
}

async function main() {
  if (!existsSync(CLI)) {
    console.error('packages/ops/dist is not built; run npm run build -w @life/ops first');
    process.exitCode = 1;
    return;
  }

  const credentialsDir = mkdtempSync(join(tmpdir(), 'life-screens-ids-'));
  try {
    writeCredentials(credentialsDir);
    const ids = readIds(credentialsDir);

    // A partial file would let the harness capture a wrong screen silently, so a
    // missing key fails the run before anything is written.
    const missing = ids.filter(([, value]) => value === undefined || value === '').map(([key]) => key);
    for (const [key, value] of ids) console.log(`${key}: ${value ?? '(missing)'}`);
    if (missing.length > 0) {
      console.error(`screens:ids found no seeded row for: ${missing.join(', ')} (run npm run seed:stack)`);
      process.exitCode = 1;
      return;
    }

    const contents = Object.fromEntries(ids.map(([key, value]) => [key, String(value)]));
    mkdirSync(dirname(IDS_FILE), { recursive: true });
    writeFileSync(IDS_FILE, `${JSON.stringify({ ids: contents }, null, 2)}\n`);
    console.log(`wrote ${IDS_FILE}`);
  } finally {
    rmSync(credentialsDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`screens:ids failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
