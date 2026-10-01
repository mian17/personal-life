import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * The repository's single SQLite snapshot/verify primitive (`SPEC-db-backup-restore`
 * D3): open the source read-only, `PRAGMA quick_check` it, `VACUUM INTO` the target,
 * reopen the target read-only, `quick_check` it, and prove any requested row counts
 * match. The source handle is `readonly: true`, so this step provably cannot mutate
 * an input (D4) — safe against a live, in-use database and under cron.
 *
 * This generalises the two copies previously inlined in `apps/tags-service`
 * (`import.ts`) and `apps/note-service` (`backfill-owner.ts`).
 */

export interface SnapshotOptions {
  /** Table names whose source row count must equal the copy's. */
  rowCountTables?: readonly string[];
}

export interface SnapshotResult {
  backupPath: string;
  quickCheck: 'ok';
  rowCounts: Record<string, number>;
}

/** UTC, millisecond resolution, filename-safe; never overwrites (suffix fallback). */
export function uniqueSnapshotPath(sourceDbPath: string, suffix: string): string {
  // Collisions (two runs in the same millisecond) fall through to a numeric suffix
  // rather than ever returning an existing path.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = `${sourceDbPath}.${suffix}-${stamp}`;
  let n = 1;
  while (existsSync(candidate)) {
    candidate = `${sourceDbPath}.${suffix}-${stamp}-${n}`;
    n += 1;
  }
  return candidate;
}

function quickCheck(db: Database.Database): string {
  const row = db.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
  return row?.quick_check ?? 'no result';
}

function count(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

/**
 * Open `dbPath` read-only and require `PRAGMA quick_check` = `ok`. Returns `'ok'`
 * or throws.
 */
export function verifyDatabase(dbPath: string): 'ok' {
  if (!existsSync(dbPath)) {
    throw new Error(`database does not exist: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const result = quickCheck(db);
    if (result !== 'ok') {
      throw new Error(`PRAGMA quick_check failed for ${dbPath}: ${result}`);
    }
  } finally {
    db.close();
  }
  return 'ok';
}

/**
 * Snapshot `sourceDbPath` to `targetPath` and prove the copy. Creates the target's
 * directory when missing. Any failure throws — the caller never proceeds as if the
 * snapshot were verified.
 */
export function snapshotAndVerify(
  sourceDbPath: string,
  targetPath: string,
  options: SnapshotOptions = {},
): SnapshotResult {
  // Fail closed: a missing source aborts before anything is written.
  if (!existsSync(sourceDbPath)) {
    throw new Error(`database does not exist: ${sourceDbPath}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });

  const tables = options.rowCountTables ?? [];
  const rowCounts: Record<string, number> = {};

  const source = new Database(sourceDbPath, { readonly: true });
  try {
    const result = quickCheck(source);
    if (result !== 'ok') {
      throw new Error(`source failed PRAGMA quick_check: ${sourceDbPath}`);
    }
    for (const table of tables) {
      rowCounts[table] = count(source, table);
    }
    // VACUUM INTO refuses an existing target — exactly the guarantee we want.
    source.prepare('VACUUM INTO ?').run(targetPath);
  } finally {
    source.close();
  }

  if (!existsSync(targetPath)) {
    throw new Error(`snapshot was not created: ${targetPath}`);
  }

  const copy = new Database(targetPath, { readonly: true });
  try {
    const result = quickCheck(copy);
    if (result !== 'ok') {
      throw new Error(`snapshot failed PRAGMA quick_check: ${targetPath}`);
    }
    for (const table of tables) {
      const copied = count(copy, table);
      if (copied !== rowCounts[table]) {
        throw new Error(
          `snapshot ${table} count mismatch: source=${rowCounts[table]} copy=${copied} (${targetPath})`,
        );
      }
    }
  } finally {
    copy.close();
  }

  return { backupPath: targetPath, quickCheck: 'ok', rowCounts };
}
