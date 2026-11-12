import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * `grant-origin` — the human-run CLI that provisions `origin_grant` rows
 * (`SPEC-todo-origin` §9.12).
 *
 * A grant is one **user** allowing one **producer app** to write one origin, so
 * the row is keyed `(ownerSub, clientId)`. This script is the only sanctioned
 * writer of the table outside the service: no request creates a grant, and no
 * service code path ever calls it.
 *
 * The table DDL below is byte-equivalent to what TypeORM's better-sqlite3
 * `synchronize` generates from `OriginGrant` (verified against a live boot, and
 * asserted in `test/grant-cli.e2e-spec.ts`), so a later service boot finds nothing
 * to change. A drift between the two means the first boot after provisioning
 * mutates the table, which this CLI must never cause.
 *
 * Every echoed value is collapsed to one printable line and capped, because a flag
 * value is operator-supplied text and a newline in it would forge a log line.
 */

const ORIGIN_GRANT_DDL =
  'CREATE TABLE "origin_grant" ("ownerSub" text NOT NULL, "clientId" text NOT NULL, ' +
  '"originService" text NOT NULL, "grantedAt" datetime NOT NULL, ' +
  'CONSTRAINT "UQ_origin_grant_owner_client" UNIQUE ("ownerSub", "clientId"), ' +
  'PRIMARY KEY ("ownerSub", "clientId"))';

const DEFAULT_DB_PATH = 'apps/todo-service/data/todo.db';

/** Longest value this script will echo; the tail past it is dropped, not kept. */
const MAX_ECHO = 64;

/** The three values a grant carries, as the operator names them. */
export interface GrantRequest {
  ownerSub: string;
  clientId: string;
  originService: string;
}

/** One stored grant, as `--list` prints it and as the table holds it. */
export interface GrantRow extends GrantRequest {
  grantedAt: string;
}

/** What one write did — the word the CLI prints. */
export type GrantOutcome = 'created' | 'updated';
export type RevokeOutcome = 'revoked' | 'missing';

type Env = NodeJS.ProcessEnv;

/**
 * One line of printable ASCII, the repo's log-forging guard shape
 * (`packages/service-kit/src/audit/audit-fields.ts`'s `oneLine`): everything
 * outside the printable range, including newlines, folds to a space, and the ends
 * are trimmed.
 */
export function oneLine(value: string): string {
  return value.replace(/[^\u0020-\u007e]+/g, ' ').trim();
}

/**
 * A flag value made safe to echo: one printable line, capped at {@link MAX_ECHO}.
 * A flag value is operator-supplied text — a newline in it would forge a log line
 * and an unbounded one would bury the output.
 */
export function sanitizeEcho(value: string): string {
  return oneLine(value).slice(0, MAX_ECHO);
}

/**
 * The form TypeORM writes a `Date` column as on sqlite
 * (`DateUtils.mixedDateToUtcDatetimeString`): UTC wall-clock with millisecond
 * precision. Matching it keeps a provisioned row hydrating exactly like one the
 * service wrote.
 */
function sqliteDate(when: Date): string {
  return when.toISOString().slice(0, 23).replace('T', ' ');
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'origin_grant'")
    .get() as { name: string } | undefined;
  return row !== undefined;
}

/** Create `origin_grant` when absent. Never alters an existing table. */
export function ensureOriginGrantTable(db: Database.Database): void {
  if (!tableExists(db)) db.exec(ORIGIN_GRANT_DDL);
}

function findGrant(
  db: Database.Database,
  ownerSub: string,
  clientId: string,
): GrantRow | undefined {
  return db
    .prepare(
      'SELECT "ownerSub", "clientId", "originService", "grantedAt" FROM "origin_grant" ' +
        'WHERE "ownerSub" = ? AND "clientId" = ?',
    )
    .get(ownerSub, clientId) as GrantRow | undefined;
}

/**
 * Insert the grant, or overwrite the origin of an existing `(ownerSub, clientId)`.
 * A grant is a current permission, not an event log: re-granting the same pair a
 * different origin is an update, never a second row.
 */
export function grantOrigin(db: Database.Database, grant: GrantRequest): GrantOutcome {
  const existed = findGrant(db, grant.ownerSub, grant.clientId) !== undefined;
  db.prepare(
    'INSERT INTO "origin_grant" ("ownerSub", "clientId", "originService", "grantedAt") ' +
      'VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT ("ownerSub", "clientId") DO UPDATE SET ' +
      '"originService" = excluded."originService", "grantedAt" = excluded."grantedAt"',
  ).run(grant.ownerSub, grant.clientId, grant.originService, sqliteDate(new Date()));
  return existed ? 'updated' : 'created';
}

/** Delete the grant for one pair; a pair holding none is reported, not an error. */
export function revokeGrant(
  db: Database.Database,
  ownerSub: string,
  clientId: string,
): RevokeOutcome {
  const result = db
    .prepare('DELETE FROM "origin_grant" WHERE "ownerSub" = ? AND "clientId" = ?')
    .run(ownerSub, clientId);
  return result.changes > 0 ? 'revoked' : 'missing';
}

/** Every grant, ordered by owner then client so a listing is stable. */
export function listGrants(db: Database.Database): GrantRow[] {
  return db
    .prepare(
      'SELECT "ownerSub", "clientId", "originService", "grantedAt" FROM "origin_grant" ' +
        'ORDER BY "ownerSub" ASC, "clientId" ASC',
    )
    .all() as GrantRow[];
}

/**
 * `--name value` and `--name=value`, the repo's flag shape
 * (`apps/note-service/scripts/backfill-owner.ts`'s `parseOnly`). A split, never a
 * regex: the value may legitimately contain any character.
 */
function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index === -1) return undefined;
  const raw = argv[index] === name ? argv[index + 1] : argv[index].slice(name.length + 1);
  return raw === undefined || raw.length === 0 ? undefined : raw;
}

/**
 * The database this run targets. Three sources, three anchors — the default and
 * the overrides are genuinely different paths, so they are not resolved alike:
 *
 *   1. `--db` is **caller-relative**: anchored at `INIT_CWD ?? cwd`, the directory
 *      the operator typed the command in, so a path typed at the repo root keeps
 *      meaning what they typed it to mean after npm moves the script's cwd.
 *   2. `DB_PATH` is **workspace-relative**: anchored at the process cwd, which npm
 *      sets to the workspace. `scripts/setup-dev-env.sh` publishes
 *      `DB_PATH=data/scratch.db`, a path under `apps/todo-service` — resolving it at
 *      `INIT_CWD` (the repo root) opens `<root>/data/scratch.db`, a different file.
 *   3. `DEFAULT_DB_PATH` is **repository-relative** (`apps/todo-service/data/todo.db`),
 *      anchored at the repository root found by walking up from the cwd. Anchoring
 *      it at the cwd would look for `apps/todo-service/apps/todo-service/data/todo.db`
 *      when run from inside the workspace.
 *
 * Rules 1 and 2 differ on purpose: `--db` is a path a human typed (their frame of
 * reference), `DB_PATH` is a value the repository publishes (the workspace's).
 * `cwd` is a test seam; every shipped caller takes the default.
 */
export function resolveDbPath(argv: string[], env: Env, cwd: string = process.cwd()): string {
  const explicitDbPath = flagValue(argv, '--db');
  if (explicitDbPath !== undefined) return resolve(env.INIT_CWD ?? cwd, explicitDbPath);
  if (env.DB_PATH) return resolve(cwd, env.DB_PATH);
  return resolve(repositoryRoot(cwd), DEFAULT_DB_PATH);
}

/**
 * A `package.json` carrying a `workspaces` key marks the repository root the
 * workspace belongs to. Unreadable or unparsable manifests never throw here: a
 * walk that cannot confirm a root keeps looking, and {@link repositoryRoot} falls
 * back to the cwd.
 */
function isRepositoryRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
    return parsed.workspaces !== undefined;
  } catch {
    return false;
  }
}

/** The workspace repository root above `cwd`; an unmarked tree answers with `cwd` itself. */
function repositoryRoot(cwd: string): string {
  const start = resolve(cwd);
  let dir = start;
  while (!isRepositoryRoot(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
  return dir;
}

function usage(): string {
  return (
    'usage: grant-origin --owner <sub> --client <clientId> --origin <originService> [--db <path>]\n' +
    '       grant-origin --owner <sub> --client <clientId> --revoke [--db <path>]\n' +
    '       grant-origin --list [--db <path>]'
  );
}

/**
 * `--list`: one `ownerSub clientId originService grantedAt` line per grant.
 *
 * Two silences are told apart here. An `origin_grant` table that exists but holds
 * no rows is a real "this owner grants nothing": print nothing, exit 0. A database
 * with no such table at all is either the wrong target or one never provisioned,
 * and must say so — staying silent made a run against the wrong database
 * indistinguishable from a run against an empty, correct one.
 */
function reportGrants(db: Database.Database, dbPath: string): void {
  // Read-only by contract: listing a database with no table writes nothing.
  if (!tableExists(db)) {
    console.log(`no "origin_grant" table in ${oneLine(dbPath)}; this database holds no grants`);
    return;
  }
  for (const row of listGrants(db)) {
    console.log(
      `${sanitizeEcho(row.ownerSub)} ${sanitizeEcho(row.clientId)} ` +
        `${sanitizeEcho(row.originService)} ${sanitizeEcho(String(row.grantedAt))}`,
    );
  }
}

/**
 * CLI wrapper: prints what it did and returns an exit code instead of terminating
 * the process, so the suite drives it without a child process. `0` for a completed
 * run, `1` for a bad command line, `2` for a database that is not there — never
 * created implicitly, because an absent file means the wrong target.
 */
export function main(argv: string[], env: Env = process.env, cwd: string = process.cwd()): number {
  const dbPath = resolveDbPath(argv, env, cwd);
  if (!existsSync(dbPath)) {
    // The path is the whole point of the message, so it is only de-forged, never
    // capped — a truncated path names nothing.
    console.error(`origin grant database not found: ${oneLine(dbPath)}`);
    return 2;
  }
  const db = new Database(dbPath);
  try {
    return runCommand(db, argv, dbPath);
  } finally {
    db.close();
  }
}

function runCommand(db: Database.Database, argv: string[], dbPath: string): number {
  if (argv.includes('--list')) {
    reportGrants(db, dbPath);
    return 0;
  }

  const ownerSub = flagValue(argv, '--owner');
  const clientId = flagValue(argv, '--client');
  if (ownerSub === undefined || clientId === undefined) {
    console.error(usage());
    return 1;
  }

  if (argv.includes('--revoke')) {
    console.log(tableExists(db) ? revokeGrant(db, ownerSub, clientId) : 'missing');
    return 0;
  }

  const originService = flagValue(argv, '--origin');
  if (originService === undefined) {
    console.error(usage());
    return 1;
  }
  ensureOriginGrantTable(db);
  const outcome = grantOrigin(db, { ownerSub, clientId, originService });
  console.log(`${outcome} ${sanitizeEcho(ownerSub)} ${sanitizeEcho(clientId)}`);
  return 0;
}
