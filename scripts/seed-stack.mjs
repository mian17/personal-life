#!/usr/bin/env node
/**
 * Fill the running dev stack with a small, recognisable data set.
 *
 * Why this exists: a fresh dev stack is empty, so every screen shows its empty
 * state and nothing exercises the joins between resources (a note carrying a tag,
 * a todo in a list, a meal entry against a food, a saved meal of frozen items).
 * This script seeds exactly that, small enough to read at a glance.
 *
 * Two rules shape it:
 *  - It drives the `@life/ops` CLI, one child process per call, and nothing else.
 *    The CLI already validates input locally, compiles the wire request, and
 *    renders the service body; a second hand-rolled HTTP client here would be a
 *    client free to drift from the one the app and the MCP server use. It never
 *    imports `packages/ops/src` (TypeScript) and never touches a database.
 *  - It is safe to run twice: every resource is read first and a row whose marker
 *    already exists is skipped, so a second run reports `created 0` throughout.
 *
 * Auth: dev services answer as `dev-user` before any token is checked
 * (`packages/service-kit/src/auth/auth.guard.ts`, `NODE_ENV === 'development'`), so
 * this needs no login. `npm run ops -- login` is deliberately not used: it opens a
 * browser and blocks on the `127.0.0.1:8080` callback, which must never happen
 * inside a script. Instead a throwaway credential file in a temp directory holds a
 * fabricated token — a real store is never read, never written, and the fabricated
 * token is never printed. The directory is removed on exit, failure included.
 *
 * Dates are client-local and relative to today, so a rerun on a later day adds that
 * day's rows instead of being a no-op; the marker is what makes a rerun on the same
 * day a no-op.
 *
 * Run: npm run seed:stack   (after `npm run build`; `npm run dev:build` builds it)
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'packages', 'ops', 'dist', 'cli', 'entry.js');

/** The dev stack's port map (`scripts/dev-infra.sh` + the root `dev`/`dev:build`). */
const PORTS = new Map([
  ['app', 3100],
  ['notes', 3101],
  ['idp', 3102],
  ['tags', 3104],
  ['todo', 3105],
  ['meal', 3106],
  ['focus', 3107],
  ['feedback', 3108],
]);

const PROBE_ATTEMPTS = 30;
const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 2000;

/** Not a credential: dev services accept any bearer because they skip the check. */
const PLACEHOLDER_TOKEN = 'seed-stack-placeholder-never-sent-to-a-verifier';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The 27 keys a nutrient vector carries, in `NUTRIENT_KEYS` order
 * (`packages/ops/src/services/meal.ts:34-62`). The vector is passed to the CLI as
 * JSON text and validated there against that same table, so a key that drifts
 * fails loudly instead of seeding a half vector the service would reject.
 */
const NUTRIENT_KEYS = [
  'calories',
  'fat',
  'monounsaturatedFat',
  'polyunsaturatedFat',
  'saturatedFat',
  'transFat',
  'cholesterol',
  'sodium',
  'carbohydrates',
  'fiber',
  'sugar',
  'protein',
  'vitaminA',
  'vitaminC',
  'thiaminB1',
  'riboflavinB2',
  'niacinB3',
  'folateB9',
  'vitaminB6',
  'vitaminB12',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'caffeine',
];

/** A client-local `YYYY-MM-DD` the services accept; they never derive a day themselves. */
function day(offset = 0) {
  const date = new Date(Date.now() + offset * DAY_MS);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${monthDay}`;
}

/** A complete vector: every key starts at 0 and a food states only the amounts it knows. */
function vector(amounts) {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, amounts[key] ?? 0]));
}

/** The one food a meal entry and a saved meal both point at. */
const OATS = {
  name: 'Oats',
  unit: 'g',
  servingGrams: 40,
  nutrients: vector({
    calories: 389,
    fat: 6.9,
    monounsaturatedFat: 2.2,
    polyunsaturatedFat: 2.5,
    saturatedFat: 1.2,
    sodium: 2,
    carbohydrates: 66.3,
    fiber: 10.6,
    sugar: 1,
    protein: 16.9,
    thiaminB1: 0.76,
    riboflavinB2: 0.14,
    niacinB3: 0.96,
    folateB9: 56,
    vitaminB6: 0.12,
    calcium: 54,
    iron: 4.7,
    magnesium: 177,
    phosphorus: 523,
    potassium: 429,
    zinc: 3.97,
  }),
};

const FOODS = [
  OATS,
  {
    name: 'Banana',
    unit: 'g',
    servingGrams: 118,
    nutrients: vector({
      calories: 89,
      fat: 0.3,
      carbohydrates: 22.8,
      fiber: 2.6,
      sugar: 12.2,
      protein: 1.1,
      vitaminC: 8.7,
      folateB9: 20,
      vitaminB6: 0.4,
      magnesium: 27,
      potassium: 358,
    }),
  },
  {
    name: 'Olive oil',
    unit: 'ml',
    servingGrams: 15,
    nutrients: vector({
      calories: 884,
      fat: 100,
      monounsaturatedFat: 73,
      polyunsaturatedFat: 10.5,
      saturatedFat: 13.8,
      sodium: 2,
      potassium: 1,
    }),
  },
  {
    name: 'Chicken breast',
    unit: 'g',
    servingGrams: 172,
    nutrients: vector({
      calories: 165,
      fat: 3.6,
      saturatedFat: 1,
      cholesterol: 85,
      sodium: 74,
      protein: 31,
      niacinB3: 13.7,
      vitaminB6: 0.6,
      magnesium: 29,
      phosphorus: 220,
      potassium: 256,
      zinc: 0.8,
    }),
  },
  {
    name: 'Greek yoghurt',
    unit: 'g',
    servingGrams: 170,
    nutrients: vector({
      calories: 59,
      fat: 0.4,
      sodium: 36,
      carbohydrates: 3.6,
      sugar: 3.2,
      protein: 10,
      riboflavinB2: 0.2,
      vitaminB12: 0.75,
      calcium: 110,
      phosphorus: 135,
      potassium: 141,
    }),
  },
];

/** Three blocks on three days, so the focus report has a range to sum. */
const SESSIONS = [
  { date: day(-1), minutes: 25 },
  { date: day(-2), minutes: 50 },
  { date: day(-3), minutes: 30 },
];

/**
 * Three submissions; `id` is a client-supplied idempotency key (the encrypted
 * envelope's AAD binds it), so each run mints a fresh one — the title is what marks
 * a row as already seeded.
 */
const FEEDBACK = [
  {
    app: 'notes',
    type: 'bug_report',
    title: 'Seed: note list scrolls to the top after saving',
    description: 'Seeded so the feedback inbox is not empty. Safe to ignore.',
  },
  {
    app: 'meals',
    type: 'enhancement',
    title: 'Seed: remember the last meal group',
    description: 'Seeded so the feedback inbox is not empty. Safe to ignore.',
  },
  {
    app: 'feedback',
    type: 'bug_report',
    title: 'Seed: note editor returns to the top after switching apps',
    description:
      'I was writing a longer note on the train and stopped halfway to answer a message. When I came back the cursor was at the very top of the note instead of where I left it, so I had to scroll down and hunt for the sentence I was still writing. The text itself was all there and saved correctly, which is why I waited a week before reporting this. It happens most when I leave the app to check something else and the note stays open in the background for a few minutes. It also happens if I put the phone in my pocket while the editor is focused and come back later. Short notes never move, so it feels like a length threshold rather than a fixed timer. Please keep the cursor and the scroll position where they were when the editor comes back into focus. I would rather wait half a second for the editor to settle than lose my place every time I glance at another app. I am on a Pixel 6 with the current Chrome, if that helps narrow it down. End of verify text.',
  },
];

/** An entry has no free text, so its identity is the tuple it is filed under. */
function entryMarker({ date, mealGroup, foodId, quantity }) {
  return [date, mealGroup, foodId, quantity].join('|');
}

/** A session has no free text either; day plus length identifies the block. */
function sessionMarker({ date, minutes }) {
  return `${date}|${minutes}`;
}

/**
 * The seeding sequence, in dependency order: tags before the notes and todos that
 * carry them, lists before their todos, foods before the entry and saved meal that
 * point at one. A marker is what an already-seeded row is recognised by; a `key`
 * names an id a later step needs.
 */
const STEPS = [
  {
    label: 'tags',
    service: 'tags',
    resource: 'tags',
    listFlags: [],
    rowMarker: (row) => row.name,
    seeds: ['garden', 'reading', 'work', 'errand'].map((name) => ({
      key: `tag:${name}`,
      marker: name,
      flags: () => ['--name', name],
    })),
  },
  {
    label: 'notes',
    service: 'notes',
    resource: 'notes',
    listFlags: [],
    rowMarker: (row) => row.body,
    seeds: [
      {
        marker: 'Seed: weekly groceries — tomatoes, basil, olive oil',
        flags: (ids) => [
          '--body',
          'Seed: weekly groceries — tomatoes, basil, olive oil',
          '--tagIds',
          idOf(ids, 'tag:garden'),
        ],
      },
      {
        marker: 'Seed: books to read next — Piranesi, The Overstory',
        flags: () => ['--body', 'Seed: books to read next — Piranesi, The Overstory'],
      },
      {
        marker: 'Seed: call the plumber about the kitchen tap',
        flags: () => ['--body', 'Seed: call the plumber about the kitchen tap'],
      },
    ],
  },
  {
    label: 'todo lists',
    service: 'todo',
    resource: 'lists',
    listFlags: [],
    rowMarker: (row) => row.name,
    seeds: [
      {
        key: 'list:weekend',
        marker: 'Seed: weekend',
        flags: () => ['--name', 'Seed: weekend'],
      },
    ],
  },
  {
    label: 'todos',
    service: 'todo',
    resource: 'todos',
    listFlags: [],
    rowMarker: (row) => row.title,
    seeds: [
      {
        marker: 'Water the garden',
        flags: (ids) => [
          '--title',
          'Water the garden',
          '--listId',
          idOf(ids, 'list:weekend'),
          '--tagIds',
          idOf(ids, 'tag:garden'),
        ],
      },
      {
        marker: 'Read a chapter',
        flags: (ids) => [
          '--title',
          'Read a chapter',
          '--listId',
          idOf(ids, 'list:weekend'),
          '--important',
        ],
      },
      {
        marker: 'Return the library book',
        flags: () => ['--title', 'Return the library book', '--dueDate', day(3)],
      },
      {
        marker: 'Plan the week',
        flags: () => ['--title', 'Plan the week', '--note', 'Carried over from last week'],
      },
    ],
  },
  {
    label: 'foods',
    service: 'meal',
    resource: 'foods',
    listFlags: [],
    rowMarker: (row) => row.name,
    seeds: FOODS.map((food) => ({
      key: `food:${food.name.toLowerCase().replace(' ', '-')}`,
      marker: food.name,
      flags: () => [
        '--name',
        food.name,
        '--unit',
        food.unit,
        '--servingGrams',
        String(food.servingGrams),
        '--nutrients',
        JSON.stringify(food.nutrients),
      ],
    })),
  },
  {
    label: 'meal entries',
    service: 'meal',
    resource: 'entries',
    listFlags: ['--date', day()],
    rowMarker: (row) => entryMarker(row),
    seeds: [
      {
        marker: (ids) =>
          entryMarker({
            date: day(),
            mealGroup: 'breakfast',
            foodId: idOf(ids, 'food:oats'),
            quantity: 80,
          }),
        flags: (ids) => [
          '--date',
          day(),
          '--mealGroup',
          'breakfast',
          '--foodId',
          idOf(ids, 'food:oats'),
          '--quantity',
          '80',
          '--nutrients',
          JSON.stringify(OATS.nutrients),
        ],
      },
    ],
  },
  {
    label: 'saved meals',
    service: 'meal',
    resource: 'saved-meals',
    listFlags: [],
    rowMarker: (row) => row.name,
    seeds: [
      {
        marker: 'Seed: oats breakfast',
        flags: (ids) => [
          '--name',
          'Seed: oats breakfast',
          '--mealGroup',
          'breakfast',
          '--items',
          JSON.stringify([
            { foodId: idOf(ids, 'food:oats'), quantity: 80, nutrients: OATS.nutrients },
          ]),
        ],
      },
    ],
  },
  {
    label: 'focus sessions',
    service: 'focus',
    resource: 'sessions',
    listFlags: ['--from', day(-7), '--to', day()],
    rowMarker: (row) => sessionMarker(row),
    seeds: SESSIONS.map((session) => ({
      marker: () => sessionMarker(session),
      flags: () => ['--date', session.date, '--minutes', String(session.minutes)],
    })),
  },
  {
    label: 'feedback',
    service: 'feedback',
    resource: 'feedback',
    listFlags: [],
    rowMarker: (row) => row.title,
    seeds: FEEDBACK.map((entry) => ({
      marker: entry.title,
      flags: () => [
        '--id',
        randomUUID(),
        '--app',
        entry.app,
        '--type',
        entry.type,
        '--title',
        entry.title,
        '--description',
        entry.description,
      ],
    })),
  },
];

/**
 * The rows a `list` call returned. Services disagree on the shape — a bare array,
 * or an envelope naming its rows (`{notes}`, `{todos}`) — so read whichever arrived
 * instead of pinning one shape per resource, and fail naming the body otherwise.
 */
export function rowsOf(body, label) {
  if (Array.isArray(body)) return body;
  if (body !== null && typeof body === 'object') {
    const rows = Object.values(body).find(Array.isArray);
    if (rows !== undefined) return rows;
  }
  throw new Error(
    `${label} returned neither an array nor an envelope of rows: ${JSON.stringify(body)}`,
  );
}

/** An id a previous step registered; a missing one is a script bug, never an empty flag. */
export function idOf(ids, key) {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(
      `seed-stack: no id registered for "${key}"; the step that creates it must run first`,
    );
  }
  return id;
}

/** The marker a seed is recognised by: literal for most resources, computed by the two tuple-keyed ones. */
function markerOf(seed, ids) {
  return typeof seed.marker === 'function' ? seed.marker(ids) : seed.marker;
}

/**
 * A child's environment: one service selected, its base pinned to the probed port,
 * and the throwaway credential store. Both base spellings are set because a stale
 * `LIFE_OPS_API_BASE_<NAME>` in the dev env would otherwise outrank the shared one
 * and quietly dial a different port than the probe just confirmed.
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

/** One CLI call as a child process; its stable JSON output comes back parsed. */
function runCli(service, args, credentialsDir) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(service, credentialsDir),
    });
    return stdout.trim() === '' ? undefined : JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${service} ${args.join(' ')} failed: ${failureText(error)}`);
  }
}

/** The CLI renders a failure on stderr and exits non-zero; that line is the whole story. */
function failureText(error) {
  const stderr = error?.stderr === undefined ? '' : String(error.stderr).trim();
  return stderr === '' ? String(error?.message ?? error) : stderr;
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

/**
 * One step: read the resource, then create only what the marker does not already
 * cover. Ids registered here (`tag:garden`, `food:oats`, …) feed the later steps.
 */
async function seedStep(step, ids, credentialsDir) {
  const label = `${step.service} ${step.resource} list`;
  const body = runCli(step.service, [step.resource, 'list', ...step.listFlags], credentialsDir);
  const found = new Map(rowsOf(body, label).map((row) => [step.rowMarker(row), row]));

  let created = 0;
  let skipped = 0;
  for (const seed of step.seeds) {
    const marker = markerOf(seed, ids);
    const existing = found.get(marker);
    const row =
      existing ??
      runCli(step.service, [step.resource, 'create', ...seed.flags(ids)], credentialsDir);
    if (existing === undefined) created += 1;
    else skipped += 1;
    if (seed.key !== undefined) ids.set(seed.key, String(row.id));
  }

  console.log(`${step.label}: created ${created}, skipped ${skipped}`);
  return { label: step.label, created, skipped };
}

/** Runs thunks one after another, never two at once. */
async function inTurn(thunks) {
  await thunks.reduce((turn, run) => turn.then(() => run()), Promise.resolve());
}

/**
 * Wait until one URL answers at all; a redirect is an answer (the app gates `/health`).
 * One probe at a time: a failed probe waits out the interval and probes again, and the last
 * failure is the one reported.
 */
async function waitForHttp(url, attempt = 1) {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await new Promise((done) => setTimeout(done, PROBE_INTERVAL_MS));
    if (attempt === PROBE_ATTEMPTS) {
      throw new Error(
        `${url} never answered ${PROBE_ATTEMPTS} probes, ${PROBE_INTERVAL_MS}ms apart: ${failure}`,
      );
    }
    await waitForHttp(url, attempt + 1);
  }
}

/** Refuse to seed a stack that is not up: half a stack is how a seed reports a false success. */
async function probeStack() {
  await inTurn(
    [...PORTS].map(
      ([name, port]) =>
        async () =>
          probeOne(name, port),
    ),
  );
}

/** One service's probe, announced the moment it answers. */
async function probeOne(name, port) {
  await waitForHttp(`http://127.0.0.1:${port}/health`);
  console.log(`${name} on ${port}: up`);
}

/** Every step in declaration order, each counted as it reports and feeding the ids below it. */
async function seedEveryStep(steps, ids, credentialsDir) {
  const counts = [];
  const stepsInTurn = steps.map(
    (step) => async () => counts.push(await seedStep(step, ids, credentialsDir)),
  );
  await inTurn(stepsInTurn);
  return counts;
}

/** One line per resource as it is seeded, then the same numbers as a table. */
function printTable(counts) {
  const rows = [
    ['resource', 'created', 'skipped'],
    ...counts.map(({ label, created, skipped }) => [label, String(created), String(skipped)]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) {
    console.log(
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join(' | ')
        .trimEnd(),
    );
  }
}

async function main() {
  if (!existsSync(CLI)) {
    console.error(
      'packages/ops/dist is not built; run npm run build first (npm run dev:build does it)',
    );
    process.exitCode = 1;
    return;
  }

  await probeStack();

  const credentialsDir = mkdtempSync(join(tmpdir(), 'life-ops-seed-'));
  try {
    writeCredentials(credentialsDir);
    const ids = new Map();
    const counts = await seedEveryStep(STEPS, ids, credentialsDir);
    printTable(counts);
  } finally {
    rmSync(credentialsDir, { recursive: true, force: true });
  }
}

// Importable for `scripts/seed-stack.test.mjs`; only the CLI invocation seeds.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`seed:stack failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
