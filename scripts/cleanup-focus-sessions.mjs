#!/usr/bin/env node
/**
 * One-time repair: list (and plan the removal of) the fake focus blocks the chip bug wrote.
 *
 * What the bug was: a focus-length chip (15/25/50) retuned the length of the phase already
 * counting down, and the recorder read the finished block against the retuned length instead
 * of the one it was started with. Tapping a chip mid-phase therefore synthesised minutes that
 * were never focused — a 25-minute block retuned to 50 reported 50, a 3-minute block retuned
 * to 25 reported 22 — and each tap produced another row. The rows are wrong because the time
 * they claim was never spent; the fix for the counting itself is `5c291e4`.
 *
 * Run this AFTER the fixed app is deployed, never before: the old bundle keeps writing fake
 * rows, so a cleanup that lands first simply runs again tomorrow with new rows in it.
 *
 * Read-only by design. `focus-service` deliberately exposes no delete route a recorded block
 * could travel (`apps/focus-service/src/sessions/sessions.controller.ts`: "a recorded block is
 * never revised or deleted"), so this script writes nothing, ever. It reads through the
 * service — the only path that scopes rows to the caller's own `sub` — prints every candidate
 * with the evidence for why it is suspect, and, on `--delete`, prints the exact SQL the owner
 * runs by hand. The script never decides which rows are fake: the owner reviews a dry run and
 * names the rows they chose.
 *
 * Usage:
 *   node scripts/cleanup-focus-sessions.mjs                       dry run, today
 *   node scripts/cleanup-focus-sessions.mjs --from 2026-11-07 --to 2026-11-08
 *   node scripts/cleanup-focus-sessions.mjs --ids a,b,c           dry run, only those rows
 *   node scripts/cleanup-focus-sessions.mjs --delete --ids a,b,c  print the DELETE plan
 *
 * Credentials follow `seed-stack.mjs`: dev services answer as `dev-user` before any token is
 * checked, so a throwaway credential file in a temp directory holds a fabricated token and the
 * directory is removed on exit. Against a stack that verifies tokens, `npm run ops -- login`
 * writes the store this reads.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rowsOf } from './seed-stack.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'packages', 'ops', 'dist', 'cli', 'run.js');
const FOCUS_PORT = 3107;
const SERVICE = 'focus';

/** The service's own default database file (`app.module.ts`); a relative `FOCUS_DB_PATH` is read there. */
function dbPath() {
  const configured = process.env.FOCUS_DB_PATH ?? join('data', 'focus.db');
  return isAbsolute(configured) ? configured : join('apps', 'focus-service', configured);
}

/** The page cap (`MAX_PAGE_LIMIT`); the walk costs one call per 200 rows in the window. */
const PAGE_LIMIT = 200;

/**
 * Every amount a chip can write: focus 15/25/50 (`pomodoro-page.tsx` FOCUS_PRESETS), short
 * break 5/10/15, long break 15/25/30. A row whose minutes land on one of these is not proof
 * of anything — the owner can focus exactly 25 minutes — but the bug's rows cluster on them.
 */
const CHIP_MINUTES = new Set([5, 10, 15, 25, 30, 50]);

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_TOKEN = 'cleanup-focus-sessions-placeholder-never-sent-to-a-verifier';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const USAGE = `usage: node scripts/cleanup-focus-sessions.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                                                 [--ids a,b,c] [--delete]

  (no flags)   dry run over today: every row printed, nothing deleted
  --from/--to  the window to review, defaults to today for both ends
  --ids        review only these rows, e.g. the ones picked after a dry run
  --delete     print the exact DELETE plan for the selected rows; needs --ids
`;

/** A client-local `YYYY-MM-DD`, derived exactly as the page derives the day it records. */
function clientDay(offset = 0) {
  const date = new Date(Date.now() + offset * DAY_MS);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${monthDay}`;
}

/** The three flags this script takes; `--delete` is the only one that is not a value pair. */
function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      ids: { type: 'string' },
      delete: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    from: values.from ?? clientDay(),
    to: values.to ?? clientDay(),
    ids: parseIds(values.ids),
    delete: values.delete,
    help: values.help,
  };
}

/** `--ids a,b,c` → a set; a blank entry is a typo, never an id. */
function parseIds(raw) {
  if (raw === undefined) return undefined;
  const ids = raw.split(',').map((id) => id.trim());
  if (ids.some((id) => id === '')) throw new Error('--ids has an empty entry; pass a,b,c');
  return new Set(ids);
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!existsSync(CLI)) {
    throw new Error('packages/ops/dist is not built; run npm run build first (npm run dev:build does it)');
  }
  assertDay('--from', options.from);
  assertDay('--to', options.to);
  if (options.from > options.to) throw new Error(`--from ${options.from} is after --to ${options.to}`);

  const credentialsDir = mkdtempSync(join(tmpdir(), 'life-cleanup-focus-'));
  try {
    writeCredentials(credentialsDir);
    const rows = await readSessions(options.from, options.to, credentialsDir);
    const selected = selectRows(rows, options.ids);
    report(options, selected);
  } finally {
    rmSync(credentialsDir, { recursive: true, force: true });
  }
}

/** A `YYYY-MM-DD` the service would accept, so a typo fails here and not as a 400. */
function assertDay(flag, value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} ${value} is not a real YYYY-MM-DD day`);
  }
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} ${value} is not a real YYYY-MM-DD day`);
  }
}

/** Every row in the window, oldest first, following the service cursor to exhaustion. */
async function readSessions(from, to, credentialsDir) {
  const collected = [];
  let cursor;
  for (;;) {
    const flags = ['sessions', 'list', '--from', from, '--to', to, '--limit', String(PAGE_LIMIT)];
    if (cursor !== undefined) flags.push('--cursor', cursor);
    const body = runCli(flags, credentialsDir);
    collected.push(...rowsOf(body, `${from}..${to} sessions`));
    cursor = body?.nextCursor ?? null;
    if (cursor === null) return collected.sort(byCreatedAt);
  }
}

function byCreatedAt(a, b) {
  return a.createdAt.localeCompare(b.createdAt);
}

/** The owner's picks, or every row; an id that is not in the window is a typo, not a no-op. */
function selectRows(rows, ids) {
  if (ids === undefined) return rows;
  const unknown = [...ids].filter((id) => !rows.some((row) => row.id === id));
  if (unknown.length > 0) {
    throw new Error(`--ids names rows outside ${rows.length} in this window: ${unknown.join(', ')}`);
  }
  return rows.filter((row) => ids.has(row.id));
}

/** The evidence, then either "nothing deleted" or the plan, then the count. */
function report(options, rows) {
  const window = `${options.from}..${options.to}`;
  console.log(`focus sessions ${window}: ${rows.length} row(s)${options.ids ? ' (--ids selection)' : ''}`);

  if (rows.length > 0) {
    printClusters(rows);
    printSummary(rows);
  } else {
    console.log('no rows in this window');
  }

  console.log();
  if (options.delete) printDeletionPlan(options, rows);
  else {
    console.log('DRY RUN: nothing was deleted.');
    if (rows.length > 0) {
      console.log('to act on a subset: --delete --ids <the ids you chose>');
    }
    console.log(`0 of ${rows.length} candidate row(s) deleted`);
  }
}

/**
 * Rows grouped by the minute they were written, because the bug's own fingerprint is
 * temporal: one gesture produced rows seconds apart, so a minute holding several rows
 * with no time between them is the shape to look at — never proof on its own.
 * `createdAt` is served as stored, in UTC.
 */
function printClusters(rows) {
  for (const [key, group] of rowsByMinute(rows)) {
    console.log();
    console.log(clusterHeader(group, key));
    for (const row of group) console.log(rowLine(row));
  }
}

/** One pass over the rows, in the order they already arrive in. */
function rowsByMinute(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.createdAt.slice(0, 16);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

/** id, day, minutes, when it was written, and whether the amount is one a chip writes. */
function rowLine(row) {
  const marker = CHIP_MINUTES.has(row.minutes) ? '  [chip amount]' : '';
  return `  ${row.id}  ${row.date}  ${String(row.minutes).padStart(3)} min  ${row.createdAt}${marker}`;
}

/** One minute's rows: how many, how tight, and whether they land on chip lengths. */
function clusterHeader(group, key) {
  const spanMs = Date.parse(group.at(-1).createdAt) - Date.parse(group[0].createdAt);
  const chipRows = group.filter((row) => CHIP_MINUTES.has(row.minutes)).length;
  const parts = [
    `${group.length} row(s)`,
    `spanning ${Math.round(spanMs / 1000)}s`,
    `${chipRows} on a chip amount`,
  ];
  const suspect = group.length > 1 && spanMs / 1000 < 60 ? '  <- seconds apart' : '';
  return `${key}  ${parts.join(' | ')}${suspect}`;
}

/** The shape of the window in one line: how many minutes hold more than one row. */
function printSummary(rows) {
  const groups = rowsByMinute(rows);
  const crowded = [...groups.values()].filter((group) => group.length > 1).length;
  console.log();
  console.log(
    `${rows.length} row(s) across ${groups.size} minute(s), ${crowded} of them holding more than one`,
  );
}

/** The selected rows' plan: the one thing `--delete` does, and it is still a plan, not a write. */
function printDeletionPlan(options, rows) {
  if (options.ids === undefined) {
    console.error(
      'REFUSED: --delete needs --ids. A whole day is never deleted silently; review a dry run\n' +
        'first, then name the rows you chose: --delete --ids a,b,c',
    );
    console.log(`0 of ${rows.length} candidate row(s) deleted`);
    process.exitCode = 1;
    return;
  }
  if (rows.length === 0) {
    console.log('nothing selected, so there is no plan to print');
    console.log('0 rows deleted');
    return;
  }

  const owners = [...new Set(rows.map((row) => row.ownerSub ?? '(null)'))];
  const ids = rows.map((row) => `'${row.id}'`).join(',\n    ');
  const days = [...new Set(rows.map((row) => row.date))].sort();
  const dateClause =
    days.length === 1
      ? `"date" = '${days[0]}'`
      : `"date" BETWEEN '${days[0]}' AND '${days.at(-1)}'`;

  console.log('NO DELETE ROUTE EXISTS: focus-service serves only GET and POST on /api/sessions');
  console.log('("a recorded block is never revised or deleted"), so this script cannot delete these');
  console.log('rows and does not touch the database itself. Run the statements below by hand.');
  console.log();
  console.log(`-- 1. confirm the count is ${rows.length} before deleting anything`);
  console.log('BEGIN;');
  console.log(
    `SELECT count(*) FROM "focus_session"\n WHERE "ownerSub" IN (${owners.map((owner) => `'${owner}'`).join(', ')})\n   AND ${dateClause}\n   AND "id" IN (\n    ${ids}\n);`,
  );
  console.log();
  console.log('-- 2. the delete, still scoped to your own sub, these ids and these days');
  console.log(
    `DELETE FROM "focus_session"\n WHERE "ownerSub" IN (${owners.map((owner) => `'${owner}'`).join(', ')})\n   AND ${dateClause}\n   AND "id" IN (\n    ${ids}\n);`,
  );
  console.log();
  console.log('-- 3. commit only when step 1 printed the expected count');
  console.log('COMMIT;');
  console.log();
  console.log(`run from the repo root:  sqlite3 ${dbPath()}`);
  console.log('(FOCUS_DB_PATH overrides that path; a relative value is read from apps/focus-service)');
  console.log('the service caches reads for 60s: restart it, or wait a minute, before the app shows the day again');
  console.log();
  console.log(`0 of ${rows.length} selected row(s) deleted — this script never writes; the plan above is the repair`);
}

/** A child's environment: focus selected on its dev port, plus the throwaway credential store. */
function childEnv(credentialsDir) {
  const base = `http://127.0.0.1:${FOCUS_PORT}`;
  return {
    ...process.env,
    LIFE_OPS_SERVICE: SERVICE,
    LIFE_OPS_API_BASE: base,
    LIFE_OPS_API_BASE_FOCUS: base,
    LIFE_OPS_CREDENTIALS_PATH: join(credentialsDir, 'credentials.json'),
    LIFE_OPS_REFRESH_SKEW_MS: '0',
  };
}

/** One CLI call as a child process; its stable JSON output comes back parsed. */
function runCli(args, credentialsDir) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(credentialsDir),
    });
    return stdout.trim() === '' ? undefined : JSON.parse(stdout);
  } catch (error) {
    const stderr = error?.stderr === undefined ? '' : String(error.stderr).trim();
    throw new Error(`${SERVICE} ${args.join(' ')} failed: ${stderr === '' ? String(error?.message ?? error) : stderr}`);
  }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`cleanup:focus-sessions failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
