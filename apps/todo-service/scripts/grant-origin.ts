import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * `grant-origin` — the human-run CLI that provisions `origin_grant` rows
 * (`SPEC-todo-origin` §9.12).
 *
 * A grant is one **user** allowing one **producer app** one capability — write the
 * origin's todos, or read the user's tasks — so the row is keyed
 * `(ownerSub, clientId, direction)`. This script is the only sanctioned writer of
 * the table outside the service: no request creates a grant, and no service code
 * path ever calls it.
 *
 * The table DDL below is written by hand and must stay byte-equal to the DDL
 * TypeORM's better-sqlite3 `synchronize` derives from `OriginGrant` —
 * `test/grant-cli.e2e-spec.ts` asserts exactly that, so the two cannot drift
 * unnoticed. It carries the `direction` column (in the primary key, defaulting to
 * `'write'` so every row written before it existed is a write grant), the nullable
 * `scope` a read grant uses, and the two nullable consent columns (`disclosure`,
 * `disclosureHash`) that `GrantsService.grantOwn` fills in when a user turns a
 * producer on; a grant this CLI provisions leaves the consent pair absent, which
 * reads as "not captured", never as "declined". A drift between the hand-written
 * DDL and the entity means the first boot after provisioning silently mutates the
 * table this CLI just wrote, so a later service boot must find nothing to change.
 *
 * Every echoed value is collapsed to one printable line and capped, because a flag
 * value is operator-supplied text and a newline in it would forge a log line.
 */

const ORIGIN_GRANT_DDL =
  'CREATE TABLE "origin_grant" ("ownerSub" text NOT NULL, "clientId" text NOT NULL, ' +
  '"direction" text NOT NULL DEFAULT (\'write\'), "originService" text NOT NULL, ' +
  '"scope" text, "grantedAt" datetime NOT NULL, ' +
  '"disclosure" text, "disclosureHash" text, ' +
  'CONSTRAINT "UQ_origin_grant_owner_client_direction" UNIQUE ' +
  '("ownerSub", "clientId", "direction"), ' +
  'PRIMARY KEY ("ownerSub", "clientId", "direction"))';

const DEFAULT_DB_PATH = 'apps/todo-service/data/todo.db';

/**
 * The directions and read scopes this command line accepts.
 *
 * Restated here rather than imported from the entity on purpose: this script has
 * no runtime dependency on `@life/service-kit` (it imports nothing from it), which
 * is what lets an operator run it against a database the service is not running
 * for. Drift is not left to memory — the DDL guard in `grant-cli.e2e-spec.ts`
 * proves the table this script writes is the one TypeORM derives from the entity.
 */
const GRANT_DIRECTIONS = ['write', 'read'] as const;
const GRANT_SCOPES = ['own-origin', 'all'] as const;

type GrantDirection = (typeof GRANT_DIRECTIONS)[number];
type GrantScope = (typeof GRANT_SCOPES)[number];

/** Longest value this script will echo; the tail past it is dropped, not kept. */
const MAX_ECHO = 64;

/** The values a grant carries, as the operator names them. */
export interface GrantRequest {
  ownerSub: string;
  clientId: string;
  originService: string;
  /** `write` (the default, and what every pre-existing row is) or `read`. */
  direction?: GrantDirection;
  /** How far a `read` grant reaches; ignored for a write grant, which is `null`. */
  scope?: GrantScope | null;
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
  direction: GrantDirection,
): GrantRow | undefined {
  return db
    .prepare(
      'SELECT "ownerSub", "clientId", "direction", "originService", "grantedAt" ' +
        'FROM "origin_grant" ' +
        'WHERE "ownerSub" = ? AND "clientId" = ? AND "direction" = ?',
    )
    .get(ownerSub, clientId, direction) as GrantRow | undefined;
}

/**
 * Insert the grant, or overwrite the origin of an existing
 * `(ownerSub, clientId, direction)`. A grant is a current permission, not an event
 * log: re-granting the same triple a different origin is an update, never a second
 * row — while a read grant for that same pair is a different triple, so it adds a
 * row beside the write grant instead of replacing it.
 */
export function grantOrigin(db: Database.Database, grant: GrantRequest): GrantOutcome {
  const direction = grant.direction ?? 'write';
  const existed = findGrant(db, grant.ownerSub, grant.clientId, direction) !== undefined;
  db.prepare(
    'INSERT INTO "origin_grant" ' +
      '("ownerSub", "clientId", "direction", "originService", "scope", "grantedAt") ' +
      'VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT ("ownerSub", "clientId", "direction") DO UPDATE SET ' +
      '"originService" = excluded."originService", "scope" = excluded."scope", ' +
      '"grantedAt" = excluded."grantedAt"',
  ).run(
    grant.ownerSub,
    grant.clientId,
    direction,
    grant.originService,
    // A write grant is already scoped by `originService`, so it carries no reach.
    direction === 'read' ? (grant.scope ?? null) : null,
    sqliteDate(new Date()),
  );
  return existed ? 'updated' : 'created';
}

/**
 * Delete the pair's grants; a pair holding none is reported, not an error.
 *
 * Every direction goes, because `--revoke` has always meant "this producer holds
 * nothing for this user": leaving a read grant behind while the report says
 * `revoked` would be a lie of omission, and a half-revoked producer is not a state
 * an operator asked for.
 */
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

/** Every grant, ordered by owner, client then direction so a listing is stable. */
export function listGrants(db: Database.Database): GrantRow[] {
  return db
    .prepare(
      'SELECT "ownerSub", "clientId", "direction", "originService", "grantedAt" ' +
        'FROM "origin_grant" ' +
        'ORDER BY "ownerSub" ASC, "clientId" ASC, "direction" ASC',
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
    'usage: grant-origin --owner <sub> --client <clientId> --origin <originService>\n' +
    '                    [--direction write|read] [--scope own-origin|all] [--db <path>]\n' +
    '       grant-origin --owner <sub> --client <clientId> --revoke [--db <path>]\n' +
    '       grant-origin --list [--db <path>]'
  );
}

/**
 * `--list`: one `ownerSub clientId originService grantedAt direction` line per
 * grant.
 *
 * The direction is the fifth token, on **every** line, rather than present only
 * for read grants: a format that changes width per row is a parsing trap, and this
 * script has already shipped a defect where it lied silently.
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
        `${sanitizeEcho(row.originService)} ${sanitizeEcho(String(row.grantedAt))} ` +
        `${sanitizeEcho(row.direction ?? 'write')}`,
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
  const direction = directionFlag(argv);
  if (direction === null) {
    console.error(`--direction must be one of: ${GRANT_DIRECTIONS.join(', ')}`);
    return 1;
  }
  const scope = scopeFlag(argv);
  if (scope === null) {
    console.error(`--scope must be one of: ${GRANT_SCOPES.join(', ')}`);
    return 1;
  }
  ensureOriginGrantTable(db);
  const outcome = grantOrigin(db, { ownerSub, clientId, originService, direction, scope });
  console.log(`${outcome} ${sanitizeEcho(ownerSub)} ${sanitizeEcho(clientId)}`);
  return 0;
}

/**
 * `--direction`, defaulting to `write` — the direction every pre-existing row has,
 * so a command line that does not mention direction keeps meaning what it meant.
 * `null` is a bad value; `undefined` means the flag was not given.
 */
function directionFlag(argv: string[]): GrantDirection | null | undefined {
  return closedFlag(argv, '--direction', GRANT_DIRECTIONS, 'write');
}

/** `--scope`, which only a read grant uses; omitted means the narrowest reach. */
function scopeFlag(argv: string[]): GrantScope | null | undefined {
  return closedFlag(argv, '--scope', GRANT_SCOPES, undefined);
}

/**
 * One flag read against a closed set: `undefined` when absent (the caller's default
 * applies), `null` when present but not a member — the two are different answers,
 * so a mistyped direction is refused rather than silently taken as the default.
 */
function closedFlag<T extends string>(
  argv: string[],
  name: string,
  allowed: readonly T[],
  fallback: T | undefined,
): T | null | undefined {
  const raw = flagValue(argv, name);
  if (raw === undefined) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}
