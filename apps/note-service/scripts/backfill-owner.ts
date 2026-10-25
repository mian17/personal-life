import Database from 'better-sqlite3';
import { snapshotAndVerify, uniqueSnapshotPath } from '@life/db';
import { resolve } from 'node:path';

/**
 * `owner-backfill` — the one-time, human-run migration that assigns every legacy
 * `ownerSub IS NULL` row to the oldest user in the identity database
 * (SPEC-owner-backfill.md).
 *
 * This is the one sanctioned writer of `life.db` outside the service, and the one
 * sanctioned (read-only) reader of `idp.db`. It is never run automatically at
 * startup and never run by tests against real data.
 *
 * Ordering is the contract:
 *   1. `VACUUM INTO` a verified backup — the first action; no write precedes it.
 *   2. Schema surgery: `note.ownerSub` + `IDX_note_owner_sub`; `note_tag`
 *      reconciliation to the association-only entity; `tag` rebuild that
 *      (see below); `user_keys` creation — all DDL byte-equivalent to the entities.
 *      drops the legacy inline `UNIQUE(name)`; per-owner name uniqueness is
 *      service-enforced now (SPEC-notes-at-rest, plan D7 — encrypted names cannot
 *      satisfy a DB unique index), and the DDL stays byte-equivalent to TypeORM's
 *      expectation (so first boot mutates nothing).
 *   3. Resolve the oldest user from `idp.db`, opened read-only.
 *   4. `UPDATE ... WHERE ownerSub IS NULL` for `note` and `tag`. Owned rows are
 *      never re-stamped; a re-run stamps 0 and performs no writes.
 *
 * The steps are exported (and synchronous — better-sqlite3 is synchronous) so the
 * suite can drive each one directly. `main()` is the CLI wrapper: it returns an
 * exit code instead of terminating the process, which keeps it honest under test.
 */

const DEFAULT_NOTE_DB_PATH = 'apps/note-service/data/life.db';

export interface ResolvedPaths {
  noteDbPath: string;
  idpDbPath: string;
}

export interface BackupResult {
  backupPath: string;
  /** Always `true` when returned; verification failures throw instead. */
  verified: true;
  noteCount: number;
  quickCheck: 'ok';
}

export interface SchemaResult {
  /** True when any DDL was executed this run. */
  mutated: boolean;
  actions: string[];
}

export interface StampResult {
  noteStamped: number;
  tagStamped: number;
  noteAlreadyOwned: number;
  tagAlreadyOwned: number;
}

export interface RunResult {
  noteDbPath: string;
  idpDbPath: string;
  backup: BackupResult;
  schema: SchemaResult;
  /** The `sub` every legacy row was assigned. */
  sub: string;
  stamped: StampResult;
}

type Env = NodeJS.ProcessEnv;

/**
 * Resolve the two DB paths against `INIT_CWD ?? cwd`. npm sets a workspace
 * script's cwd to the workspace, so the documented repo-root command only works
 * when the relative env values are anchored at the directory npm was invoked
 * from. `IDP_DB_PATH` has no default: explicit is safe.
 */
export function resolvePaths(env: Env = process.env): ResolvedPaths {
  const root = env.INIT_CWD ?? process.cwd();
  const noteDbPath = resolve(root, env.NOTE_DB_PATH || DEFAULT_NOTE_DB_PATH);
  const idpRaw = env.IDP_DB_PATH;
  if (!idpRaw) {
    throw new Error(
      'IDP_DB_PATH is required (the identity DB holding the oldest user); ' +
        'invoke as: IDP_DB_PATH=apps/idp/data/idp.db npm run backfill-owner -w apps/note-service',
    );
  }
  const idpDbPath = resolve(root, idpRaw);
  return { noteDbPath, idpDbPath };
}

function count(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number };
  return row.c;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function hasIndexNamed(db: Database.Database, table: string, name: string): boolean {
  const rows = db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === name);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

/**
 * True when `table` carries a single-column UNIQUE on `name` — the legacy
 * `sqlite_autoindex` TypeORM generated for `@Column({ unique: true })`. That
 * index cannot be dropped and `synchronize` clones it forward, which is why the
 * whole table is rebuilt here.
 */
function hasSingleColumnUniqueOnName(db: Database.Database, table: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((idx) => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as Array<{ name: string }>;
    return cols.length === 1 && cols[0].name === 'name';
  });
}

// Byte-for-byte what TypeORM's better-sqlite3 synchronize generates for the
// current `Tag` entity — verified against a live boot. `AUTOINCREMENT` included.
const TAG_TABLE_DDL =
  'CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text)';

// Association-only `note_tag`, byte-equivalent to the T5 `NoteTag` join entity and
// to `import.ts`'s rebuild (PK (noteId, tagId); noteId FK ON DELETE CASCADE ON
// UPDATE NO ACTION; NO FK to `tag`). Keeping this DDL in lockstep is what preserves
// the boot-mutates-nothing contract below.
const NOTE_TAG_DDL =
  'CREATE TABLE "note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, ' +
  'CONSTRAINT "FK_ddfc0b18dcc060cb8899a249910" FOREIGN KEY ("noteId") REFERENCES "note" ("id") ' +
  'ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("noteId", "tagId"))';
const NOTE_TAG_TEMP_DDL = NOTE_TAG_DDL.replace(
  'CREATE TABLE "note_tag"',
  'CREATE TABLE "temporary_note_tag"',
);

/**
 * Step 2. Idempotent schema surgery, every DDL byte-equivalent to TypeORM's
 * expectation so the first boot's `synchronize` finds nothing to change.
 *
 *  a. `note`: `ALTER TABLE ADD COLUMN ownerSub TEXT` when missing (a native
 *     single-column add, no rebuild) and `IDX_note_owner_sub` when missing.
 *  b. `tag`: when it still lacks `ownerSub` or still carries the legacy
 *     single-column UNIQUE(name), rebuild it under `PRAGMA foreign_keys = OFF`,
 *     copy rows with ids preserved, drop the old table (taking the old unique
 *     with it), and rename. No composite unique index is created: tag-name
 *     uniqueness is service-enforced (plan D7). Then
 *     require a clean `PRAGMA foreign_key_check` before re-enabling FK
 *     enforcement. Otherwise skip.
 */
export function applySchema(noteDbPath: string): SchemaResult {
  const db = new Database(noteDbPath);
  try {
    return mergeSteps([
      ensureNoteOwnerColumn(db),
      ensureTagTable(db),
      ensureUserKeysTable(db),
      ensureNoteTagTable(db),
    ]);
  } finally {
    db.close();
  }
}

/** Every step's evidence, in step order; a mutation in any step makes the run a mutation. */
function mergeSteps(steps: SchemaResult[]): SchemaResult {
  return {
    mutated: steps.some((step) => step.mutated),
    actions: steps.flatMap((step) => step.actions),
  };
}

/** Step 2a: `note.ownerSub` and its index — a native single-column add, no rebuild. */
function ensureNoteOwnerColumn(db: Database.Database): SchemaResult {
  const actions: string[] = [];
  if (!hasColumn(db, 'note', 'ownerSub')) {
    db.exec('ALTER TABLE "note" ADD COLUMN "ownerSub" TEXT');
    actions.push('added note.ownerSub');
  }
  if (!hasIndexNamed(db, 'note', 'IDX_note_owner_sub')) {
    db.exec('CREATE INDEX "IDX_note_owner_sub" ON "note"("ownerSub")');
    actions.push('created IDX_note_owner_sub');
  }
  return { mutated: actions.length > 0, actions };
}

/**
 * Step 2b: the `tag` table — created when absent, rebuilt when it still lacks
 * `ownerSub` or still carries the legacy single-column UNIQUE(name), skipped
 * when already migrated.
 */
function ensureTagTable(db: Database.Database): SchemaResult {
  if (!tableExists(db, 'tag')) {
    db.exec(TAG_TABLE_DDL);
    return { mutated: true, actions: ['created tag table'] };
  }
  if (hasColumn(db, 'tag', 'ownerSub') && !hasSingleColumnUniqueOnName(db, 'tag')) {
    return { mutated: false, actions: ['skipped tag rebuild (already migrated)'] };
  }
  const ownerSelect = hasColumn(db, 'tag', 'ownerSub') ? '"ownerSub"' : 'NULL';
  rebuildWithForeignKeysOff(
    db,
    'tag rebuild',
    () => {
      db.exec(
        'CREATE TABLE "temporary_tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text)',
      );
      db.exec(
        `INSERT INTO "temporary_tag" ("id","name","ownerSub") ` +
          `SELECT "id","name",${ownerSelect} FROM "tag"`,
      );
      db.exec('DROP TABLE "tag"');
      db.exec('ALTER TABLE "temporary_tag" RENAME TO "tag"');
    },
  );
  return { mutated: true, actions: ['rebuilt tag (removed legacy UNIQUE(name))'] };
}

/** Step 2c: `user_keys` — DEK custody (data-privacy chapter). DDL byte-equivalent to the entity. */
function ensureUserKeysTable(db: Database.Database): SchemaResult {
  if (tableExists(db, 'user_keys')) return { mutated: false, actions: [] };
  db.exec(
    'CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, "wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL)',
  );
  return { mutated: true, actions: ['created user_keys'] };
}

/**
 * Step 2d: `note_tag` reconciled to the association-only `NoteTag` entity (the
 * tag vocabulary is external after the tags-extraction migration) — rebuilt when
 * it still references `tag` or carries the legacy join-table indexes, created
 * fresh when absent.
 */
function ensureNoteTagTable(db: Database.Database): SchemaResult {
  const noteTagSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='note_tag'`)
    .get() as { sql: string } | undefined;
  if (!noteTagSql) {
    db.exec(NOTE_TAG_DDL);
    return { mutated: true, actions: ['created note_tag'] };
  }
  const legacyNoteTag =
    noteTagSql.sql.includes('REFERENCES "tag"') ||
    hasIndexNamed(db, 'note_tag', 'IDX_ddfc0b18dcc060cb8899a24991');
  if (!legacyNoteTag) return { mutated: false, actions: [] };
  rebuildWithForeignKeysOff(
    db,
    'note_tag rebuild',
    () => {
      db.exec(NOTE_TAG_TEMP_DDL);
      db.exec(
        'INSERT INTO "temporary_note_tag" ("noteId","tagId") ' +
          'SELECT "noteId","tagId" FROM "note_tag"',
      );
      db.exec('DROP TABLE "note_tag"');
      db.exec('ALTER TABLE "temporary_note_tag" RENAME TO "note_tag"');
    },
  );
  return { mutated: true, actions: ['rebuilt note_tag (association-only, dropped FK to tag)'] };
}

/**
 * A table rebuild: enforcement off around the transaction (`PRAGMA foreign_keys`
 * is a no-op inside one), the rebuild committed, a clean `PRAGMA foreign_key_check`
 * required, and enforcement restored on every path, success or failure.
 */
function rebuildWithForeignKeysOff(
  db: Database.Database,
  label: string,
  rebuild: () => void,
): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    try {
      rebuild();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (violations.length > 0) {
      throw new Error(`${label} left ${violations.length} foreign-key violation(s); aborting`);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Step 3. Resolve the owner: the oldest user in `idp.db`, opened read-only.
 * Deterministic `ORDER BY createdAt ASC, id ASC LIMIT 1`. A missing table, zero
 * users, or an unreadable DB aborts loudly with the remediation; the IdP DB is
 * never written and no user is ever invented.
 */
export function resolveOldestUser(idpDbPath: string): string {
  let db: Database.Database;
  try {
    db = new Database(idpDbPath, { readonly: true });
  } catch (err) {
    throw new Error(
      `identity DB unreadable at ${idpDbPath} (seed the user first): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
  }
  try {
    let row: { id: string } | undefined;
    try {
      row = db
        .prepare('SELECT "id" FROM "user" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1')
        .get() as { id: string } | undefined;
    } catch (err) {
      throw new Error(
        `identity DB has no readable "user" table at ${idpDbPath} (seed the user first): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
    if (!row) {
      throw new Error(`no users in identity DB at ${idpDbPath}; seed the user first`);
    }
    return row.id;
  } finally {
    db.close();
  }
}

/**
 * Step 4. Stamp only `ownerSub IS NULL` rows. When there are none, no UPDATE is
 * issued at all, so a converged re-run performs no writes. Owned rows are never
 * re-stamped.
 */
export function backfillNullOwners(noteDbPath: string, sub: string): StampResult {
  const db = new Database(noteDbPath);
  try {
    const noteAlreadyOwned = count(db, 'note') - countWhereNull(db, 'note');
    const tagAlreadyOwned = count(db, 'tag') - countWhereNull(db, 'tag');

    let noteStamped = 0;
    let tagStamped = 0;
    if (countWhereNull(db, 'note') > 0) {
      noteStamped = db
        .prepare('UPDATE "note" SET "ownerSub" = ? WHERE "ownerSub" IS NULL')
        .run(sub).changes;
    }
    if (countWhereNull(db, 'tag') > 0) {
      tagStamped = db
        .prepare('UPDATE "tag" SET "ownerSub" = ? WHERE "ownerSub" IS NULL')
        .run(sub).changes;
    }
    return { noteStamped, tagStamped, noteAlreadyOwned, tagAlreadyOwned };
  } finally {
    db.close();
  }
}

function countWhereNull(db: Database.Database, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE "ownerSub" IS NULL`)
    .get() as { c: number };
  return row.c;
}

/** Run all four steps in order and return the evidence. Throws on any failure. */
export function runBackfill(env: Env = process.env): RunResult {
  const { noteDbPath, idpDbPath } = resolvePaths(env);
  // Step 1 — aborts on any failure; no write precedes it.
  const result = snapshotAndVerify(noteDbPath, uniqueSnapshotPath(noteDbPath, 'bak'), {
    rowCountTables: ['note'],
  });
  const backup: BackupResult = {
    backupPath: result.backupPath,
    verified: true,
    noteCount: result.rowCounts.note,
    quickCheck: 'ok',
  };
  const schema = applySchema(noteDbPath); // Step 2 — note ALTER + indexes + tag rebuild
  const sub = resolveOldestUser(idpDbPath); // Step 3 — aborts when none
  const stamped = backfillNullOwners(noteDbPath, sub); // Step 4 — UPDATE ... WHERE IS NULL
  return { noteDbPath, idpDbPath, backup, schema, sub, stamped };
}

/**
 * CLI wrapper. Prints the evidence on success and returns 0; on any thrown error
 * prints the reason and returns 1. Never calls `process.exit`, so the suite can
 * assert the exit code without killing the worker.
 */
export function main(env: Env = process.env): number {
  try {
    const result = runBackfill(env);
    console.log(`backup: ${result.backup.backupPath} (verified: quick_check ok, ${result.backup.noteCount} note rows)`);
    console.log(`schema: ${result.schema.actions.join('; ') || 'no changes'}`);
    console.log(
      `owner: ${result.sub} (oldest user in ${result.idpDbPath}); ` +
        `note stamped=${result.stamped.noteStamped} already-owned=${result.stamped.noteAlreadyOwned}; ` +
        `tag stamped=${result.stamped.tagStamped} already-owned=${result.stamped.tagAlreadyOwned}`,
    );
    return 0;
  } catch (err) {
    console.error('backfill failed:', err instanceof Error ? err.message : 'unknown error');
    return 1;
  }
}

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  process.exitCode = main();
}
