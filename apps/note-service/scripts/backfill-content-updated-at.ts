import Database from 'better-sqlite3';
import { snapshotAndVerify, uniqueSnapshotPath } from '@life/db';
import { resolveDbPath } from '../src/keys/db';

export { resolveDbPath };

/**
 * `contentUpdatedAt` backfill — the one-time, human-run migration behind the
 * notes list's content order (SPEC-notes-content-order.md). Same shape as
 * `backfill-owner.ts`: never run automatically at startup, never run by tests
 * against real data.
 *
 * Ordering is the contract:
 *   1. `VACUUM INTO` a verified backup — the first action; no write precedes it.
 *   2. `ALTER TABLE "note" ADD COLUMN "contentUpdatedAt" datetime` when missing
 *      (a native single-column add, no rebuild).
 *   3. `UPDATE "note" SET "contentUpdatedAt" = "createdAt" WHERE "contentUpdatedAt" IS NULL`.
 *      It copies `createdAt`, NEVER `updatedAt` — retag, trash, and restore each
 *      bump `updatedAt`, so copying it would reshuffle every touched note at
 *      deploy; copying `createdAt` leaves the pre-deploy order in place, and
 *      only a note whose body is edited afterwards moves.
 *
 * Idempotent: the ALTER is a no-op when the column exists, and a re-run's
 * UPDATE matches zero rows. The steps are exported and synchronous
 * (better-sqlite3) so the suite can drive each one directly. `main()` returns
 * an exit code instead of terminating the process.
 */

export interface BackupResult {
  backupPath: string;
  /** Always `true` when returned; verification failures throw instead. */
  verified: true;
  noteCount: number;
  quickCheck: 'ok';
}

export interface SchemaResult {
  /** True when the column was added this run. */
  mutated: boolean;
  actions: string[];
}

export interface StampResult {
  stamped: number;
  alreadySet: number;
}

export interface RunResult {
  noteDbPath: string;
  backup: BackupResult;
  schema: SchemaResult;
  stamped: StampResult;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function countWhereNull(db: Database.Database, table: string, column: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE "${column}" IS NULL`)
    .get() as { c: number };
  return row.c;
}

/**
 * Step 2. Idempotent schema add — `note.contentUpdatedAt` when missing.
 * DDL byte-equivalent to TypeORM's `synchronize` output for the entity
 * (nullable `datetime`), so the first boot after this finds nothing to change.
 */
export function applySchema(noteDbPath: string): SchemaResult {
  const db = new Database(noteDbPath);
  try {
    if (hasColumn(db, 'note', 'contentUpdatedAt')) {
      return { mutated: false, actions: [] };
    }
    db.exec('ALTER TABLE "note" ADD COLUMN "contentUpdatedAt" datetime');
    return { mutated: true, actions: ['added note.contentUpdatedAt'] };
  } finally {
    db.close();
  }
}

/**
 * Step 3. Backfill legacy rows from `createdAt` (see the header for why never
 * `updatedAt`). Rows already carrying a timestamp are never re-stamped.
 */
export function backfillContentUpdatedAt(noteDbPath: string): StampResult {
  const db = new Database(noteDbPath);
  try {
    const alreadySet = countWhereNull(db, 'note', 'contentUpdatedAt');
    const total = (
      db.prepare('SELECT COUNT(*) AS c FROM "note"').get() as { c: number }
    ).c;
    let stamped = 0;
    if (alreadySet > 0) {
      // `alreadySet` counts NULLs before the write (naming kept symmetric with
      // backfill-owner's StampResult shape).
      stamped = db
        .prepare('UPDATE "note" SET "contentUpdatedAt" = "createdAt" WHERE "contentUpdatedAt" IS NULL')
        .run().changes;
    }
    return { stamped, alreadySet: total - stamped };
  } finally {
    db.close();
  }
}

/** Run all steps in order and return the evidence. Throws on any failure. */
export function runBackfill(env: NodeJS.ProcessEnv = process.env): RunResult {
  const noteDbPath = resolveDbPath(env);
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
  const schema = applySchema(noteDbPath); // Step 2 — ALTER when missing
  const stamped = backfillContentUpdatedAt(noteDbPath); // Step 3 — UPDATE ... WHERE IS NULL

  // Step 4 — verify: the backfill leaves no NULL behind.
  const check = new Database(noteDbPath);
  try {
    const remaining = countWhereNull(check, 'note', 'contentUpdatedAt');
    if (remaining > 0) {
      throw new Error(`verify failed: ${remaining} note rows still lack contentUpdatedAt`);
    }
  } finally {
    check.close();
  }

  return { noteDbPath, backup, schema, stamped };
}

/**
 * CLI wrapper. Prints the evidence on success and returns 0; on any thrown
 * error prints the reason and returns 1. Never calls `process.exit`.
 */
export function main(env: NodeJS.ProcessEnv = process.env): number {
  try {
    const result = runBackfill(env);
    console.log(
      `backup: ${result.backup.backupPath} (verified: quick_check ok, ${result.backup.noteCount} note rows)`,
    );
    console.log(`schema: ${result.schema.actions.join('; ') || 'no changes'}`);
    console.log(
      `stamped=${result.stamped.stamped} already-set=${result.stamped.alreadySet} (source: createdAt, never updatedAt)`,
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
