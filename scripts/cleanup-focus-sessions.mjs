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
 * never revised or deleted"), so this script writes nothing, ever. It reads the service's
 * SQLite file directly, `readonly` and `fileMustExist`, and prints every candidate with the
 * evidence for why it is suspect; on `--delete` it prints the exact SQL the owner runs by
 * hand. The script never decides which rows are fake: the owner reviews a dry run and names
 * the rows they chose.
 *
 * Why the file and not the API: the container publishes no host port (`compose.yaml` —
 * `focus-service` has no `ports:` at all, it is reachable only as `focus-service:3107` on the
 * compose network), and production runs `NODE_ENV=production`, where every request is
 * verified offline against the IdP's JWKS — the `dev-user` bypass that makes a fabricated
 * token work in the dev stack does not exist there. A token that cannot be minted, sent to a
 * port that is not published, over a network the host is not on: the repair has no HTTP path
 * on the owner's host. The bind-mounted file solves all three at once.
 *
 * What that costs: reading the file skips the `ownerSub` filter the API applies, so rows
 * written before the owner stamp existed (`ownerSub: null`) are visible here and the `DELETE`
 * is scoped by the reviewed ids and days instead of by owner. On a single-owner self-hosted
 * stack that is the point — the legacy rows are the ones most likely to be fake — but it is a
 * real widening of the blast radius, so the plan prints every `ownerSub` it saw and the ids
 * are still named one by one.
 *
 * Usage:
 *   node scripts/cleanup-focus-sessions.mjs                       dry run, today
 *   node scripts/cleanup-focus-sessions.mjs --from 2026-11-07 --to 2026-11-08
 *   node scripts/cleanup-focus-sessions.mjs --ids a,b,c           dry run, only those rows
 *   node scripts/cleanup-focus-sessions.mjs --delete --ids a,b,c  print the DELETE plan
 *   node scripts/cleanup-focus-sessions.mjs --db /tmp/fixture.db  read some other database
 *
 * The database is `apps/focus-service/data/focus.db` from the repository root — the host half
 * of the container's `/data` bind mount. `FOCUS_DB_PATH` overrides it exactly as the service
 * reads it: absolute wins, a relative value is resolved under `apps/focus-service`.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every amount a chip can write: focus 15/25/50 (`pomodoro-page.tsx` FOCUS_PRESETS), short
 * break 5/10/15, long break 15/25/30. A row whose minutes land on one of these is not proof
 * of anything — the owner can focus exactly 25 minutes — but the bug's rows cluster on them.
 */
const CHIP_MINUTES = new Set([5, 10, 15, 25, 30, 50]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The whole window in one statement: the file is local, so there is no page, no cursor and
 * no cap to walk. `date` is the client's own `YYYY-MM-DD` text, which orders correctly as
 * text; `createdAt` first so the minutes group in the order they were written.
 */
const SELECT_SESSIONS = `SELECT id, ownerSub, date, minutes, createdAt
  FROM focus_session
 WHERE date >= ? AND date <= ?
 ORDER BY createdAt ASC, id ASC`;

const USAGE = `usage: node scripts/cleanup-focus-sessions.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                                                 [--ids a,b,c] [--delete] [--db PATH]

  (no flags)   dry run over today: every row printed, nothing deleted
  --from/--to  the window to review, defaults to today for both ends
  --ids        review only these rows, e.g. the ones picked after a dry run
  --delete     print the exact DELETE plan for the selected rows; needs --ids
  --db         the SQLite file to read; defaults to apps/focus-service/data/focus.db
`;

/** A client-local `YYYY-MM-DD`, derived exactly as the page derives the day it records. */
function clientDay(offset = 0) {
  const date = new Date(Date.now() + offset * DAY_MS);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${monthDay}`;
}

/** The flags this script takes; `--delete` is the only one that is not a value pair. */
function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      ids: { type: 'string' },
      delete: { type: 'boolean', default: false },
      db: { type: 'string' },
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
    db: databasePath(values.db),
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

/**
 * `--db` wins over `FOCUS_DB_PATH`, which wins over the bind mount's host path. A relative
 * `--db` is the owner's own path, so it resolves from where they typed it; a relative
 * `FOCUS_DB_PATH` resolves under `apps/focus-service`, because that is the service's cwd.
 */
function databasePath(flag) {
  if (flag !== undefined) return resolve(flag);
  const configured = process.env.FOCUS_DB_PATH;
  if (configured === undefined || configured === '') {
    return join(ROOT, 'apps', 'focus-service', 'data', 'focus.db');
  }
  return isAbsolute(configured) ? configured : join(ROOT, 'apps', 'focus-service', configured);
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  assertDay('--from', options.from);
  assertDay('--to', options.to);
  if (options.from > options.to) throw new Error(`--from ${options.from} is after --to ${options.to}`);

  const rows = readSessions(options.db, options.from, options.to);
  const selected = selectRows(rows, options.ids);
  report(options, selected);
}

/** A `YYYY-MM-DD` the data can contain, so a typo fails here and not as an empty window. */
function assertDay(flag, value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} ${value} is not a real YYYY-MM-DD day`);
  }
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} ${value} is not a real YYYY-MM-DD day`);
  }
}

/**
 * Every row in the window, oldest first, in one read. `readonly` and `fileMustExist` mean a
 * missing file is an error rather than a fresh empty database, and nothing here can write
 * even by accident; the existence check is only there to name the path in the message.
 */
function readSessions(path, from, to) {
  if (!existsSync(path)) {
    throw new Error(`no database at ${path}; pass --db <path> or set FOCUS_DB_PATH`);
  }
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return database.prepare(SELECT_SESSIONS).all(from, to).map(withIsoCreatedAt).sort(byCreatedAt);
  } finally {
    database.close();
  }
}

/** The SQL already orders this way for one stored format; re-sort so a mixed file cannot interleave. */
function byCreatedAt(a, b) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * TypeORM stores a `datetime` column as `YYYY-MM-DD HH:MM:SS.mmm` in UTC — its own writer
 * builds that string (`DateUtils.mixedDateToUtcDatetimeString`) and its own reader turns it
 * back by swapping the space for `T` and appending `Z` (`prepareHydratedValue`). better-sqlite3
 * hands the file's text over untranslated, so the same repair happens here, and a value that
 * is already ISO (offset or `Z`, or the space-less `T` form) is left to `Date` to parse.
 */
function withIsoCreatedAt(row) {
  const stored = String(row.createdAt);
  const zoned = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u.test(stored)
    ? `${stored.replace(' ', 'T')}Z`
    : stored;
  const parsed = Date.parse(zoned);
  if (Number.isNaN(parsed)) {
    throw new Error(`row ${row.id} has a createdAt this script cannot read: ${stored}`);
  }
  return { ...row, createdAt: new Date(parsed).toISOString() };
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
 * `createdAt` is printed as UTC, which is how the column is stored.
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

/** A value that survives `sqlite3`'s parser; ids are uuids, this is the belt to that braces. */
function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * The selected rows' plan: the one thing `--delete` does, and it is still a plan, not a write.
 * SQLite is a file the running service holds open, so the write happens with the service
 * stopped — which is also why this cannot be one shell pipeline.
 */
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

  const ids = rows.map((row) => quote(row.id)).join(',\n    ');
  const days = [...new Set(rows.map((row) => row.date))].sort();
  const dateClause =
    days.length === 1 ? `"date" = ${quote(days[0])}` : `"date" BETWEEN ${quote(days[0])} AND ${quote(days.at(-1))}`;
  const owners = [...new Set(rows.map((row) => row.ownerSub ?? '(null)'))];
  const database = options.db;

  console.log('NO DELETE ROUTE EXISTS: focus-service serves only GET and POST on /api/sessions');
  console.log('("a recorded block is never revised or deleted"), so this script cannot delete these');
  console.log('rows and does not touch the database itself. Run the commands below by hand.');
  console.log();
  console.log(`-- these rows carry ownerSub: ${owners.join(', ')}; read from the file directly,`);
  console.log('-- the DELETE is scoped by these ids and these days, not by owner (see the header)');
  console.log();
  console.log('-- 1. stop the service: SQLite must have no open writer while the file is edited');
  console.log('docker compose stop focus-service');
  console.log();
  console.log(`-- 2. open ${database} (the host half of the container's /data mount)`);
  console.log(`sqlite3 ${quote(database)}`);
  console.log();
  console.log(`-- 3. confirm the count is ${rows.length} before deleting anything`);
  console.log('BEGIN;');
  console.log(
    `SELECT count(*) FROM "focus_session"\n WHERE ${dateClause}\n   AND "id" IN (\n    ${ids}\n);`,
  );
  console.log();
  console.log('-- 4. the delete, scoped to these ids and these days');
  console.log(
    `DELETE FROM "focus_session"\n WHERE ${dateClause}\n   AND "id" IN (\n    ${ids}\n);`,
  );
  console.log();
  console.log(`-- 5. commit only when step 3 printed ${rows.length}; otherwise ROLLBACK;`);
  console.log('COMMIT;');
  console.log('.quit');
  console.log();
  console.log('-- no sqlite3 binary? the same count and the same delete through the driver this repo');
  console.log('-- already has: `count` first, then `delete` only if it printed the expected number');
  console.log(
    `node -e '
const D = require("better-sqlite3");
const ids = ${JSON.stringify(rows.map((row) => row.id))};
const where = ${JSON.stringify(`${dateClause} AND "id" IN (`)} + ids.map(() => '?').join(',') + ')';
const db = new D(${JSON.stringify(database)}, { readonly: process.argv[1] !== 'delete' });
if (process.argv[1] === 'delete') {
  console.log(db.prepare('DELETE FROM focus_session WHERE ' + where).run(...ids).changes, 'row(s) deleted');
} else {
  console.log(db.prepare('SELECT count(*) AS c FROM focus_session WHERE ' + where).get(...ids).c, 'row(s) matched');
}
' count`,
  );
  console.log();
  console.log('-- 6. start the service again');
  console.log('docker compose start focus-service');
  console.log();
  console.log('the service caches reads for 60s in redis-focus: wait a minute before the app shows');
  console.log('the day again');
  console.log();
  console.log(`0 of ${rows.length} selected row(s) deleted — this script never writes; the plan above is the repair`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`cleanup:focus-sessions failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
