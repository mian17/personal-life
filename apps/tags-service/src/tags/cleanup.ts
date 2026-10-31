import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotAndVerify, uniqueSnapshotPath } from '@life/db';
import { resolveDbPath } from '@life/shared/node';

/**
 * `cleanup-tags` core (`SPEC-tags-service` `## Maintenance scripts`). Operator-run
 * remediation for orphaned registry rows: a `tag` row referenced by neither
 * `note_tag` (`life.db`) nor `todo_tag` (`todo.db`).
 *
 * The whole point is the set difference on plaintext integer ids — the module
 * selects only the plaintext `id`/`ownerSub` columns (never the encrypted name
 * column), performs no key handling, and never reads the legacy `tag` table in
 * the note DB. Trashed notes/todos count as references (soft-delete is never
 * queried), so restore keeps working.
 *
 * Apply takes the shared verified `VACUUM INTO` snapshot (`@life/db`
 * `snapshotAndVerify`) before one per-owner-scoped delete transaction; plan opens
 * the three DBs read-only and writes nothing. The module never opens a real
 * `apps` data directory path on its own — the caller owns the arguments.
 */

/**
 * Defaults anchored at the repository root via this module's own directory
 * (`apps/tags-service/src/tags`), mirroring `import.ts:56-77`, so the documented
 * repo-root command opens the right files regardless of cwd.
 */
export const DEFAULT_NOTE_DB_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'note-service',
  'data',
  'life.db',
);
export const DEFAULT_TODO_DB_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'todo-service',
  'data',
  'todo.db',
);
export const DEFAULT_TAGS_DB_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'tags-service',
  'data',
  'tags.db',
);

export type CleanupMode = 'plan' | 'apply';

export interface CleanupPaths {
  noteDbPath: string;
  todoDbPath: string;
  tagsDbPath: string;
}

/** The two plaintext columns an orphan is reported by — never `name`. */
export interface CleanupOrphan {
  id: number;
  ownerSub: string;
}

export interface CleanupReport {
  mode: CleanupMode;
  scanned: number;
  referenced: number;
  orphans: number;
  deleted: number;
  /** Always `0` on a returned report; any failure throws instead. */
  errors: number;
  /** Apply: the verified `tags.db` backup path. Plan: `null`. */
  backupPath: string | null;
  /** Invariant: `orphans === orphanRows.length`. Sorted ascending by `id`. */
  orphanRows: readonly CleanupOrphan[];
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

/** Fail-closed: every input must exist as a file before anything else runs. */
function assertInputsExist(paths: CleanupPaths): void {
  for (const path of [paths.tagsDbPath, paths.noteDbPath, paths.todoDbPath]) {
    if (!existsSync(path)) {
      throw new Error(`database does not exist: ${path}`);
    }
  }
}

/** `SELECT DISTINCT "tagId"` guarded by `tableExists` (absent table → empty set). */
function readTagIds(db: Database.Database, table: string): Set<number> {
  if (!tableExists(db, table)) return new Set();
  const rows = db.prepare(`SELECT DISTINCT "tagId" FROM "${table}"`).all() as Array<{
    tagId: number;
  }>;
  return new Set(rows.map((row) => row.tagId));
}

interface OrphanSet {
  scanned: number;
  referenced: number;
  orphanRows: CleanupOrphan[];
}

/** Read-only orphan computation over the three DBs (plaintext integer ids only). */
function computeOrphans(paths: CleanupPaths): OrphanSet {
  assertInputsExist(paths);

  const note = new Database(paths.noteDbPath, { readonly: true });
  const todo = new Database(paths.todoDbPath, { readonly: true });
  const tags = new Database(paths.tagsDbPath, { readonly: true });
  try {
    const referenced = new Set<number>([
      ...readTagIds(note, 'note_tag'),
      ...readTagIds(todo, 'todo_tag'),
    ]);
    const registryRows = tableExists(tags, 'tag')
      ? (tags
          .prepare('SELECT "id","ownerSub" FROM "tag" ORDER BY "id"')
          .all() as CleanupOrphan[])
      : [];

    const orphanRows = registryRows.filter((row) => !referenced.has(row.id));
    return {
      scanned: registryRows.length,
      referenced: registryRows.length - orphanRows.length,
      orphanRows,
    };
  } finally {
    tags.close();
    todo.close();
    note.close();
  }
}

/**
 * Resolve the three DB paths. `NOTE_DB_PATH`/`TODO_DB_PATH`/`TAGS_DB_PATH`
 * overrides resolve against `INIT_CWD ?? cwd` (the `import-tags` convention);
 * otherwise the repo-root-anchored defaults are returned unchanged.
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): CleanupPaths {
  return {
    noteDbPath: resolveDbPath('NOTE_DB_PATH', DEFAULT_NOTE_DB_PATH, env),
    todoDbPath: resolveDbPath('TODO_DB_PATH', DEFAULT_TODO_DB_PATH, env),
    tagsDbPath: resolveDbPath('TAGS_DB_PATH', DEFAULT_TAGS_DB_PATH, env),
  };
}

/** `--dry-run`: report the orphan set without writing (asserted byte-pure). */
export function planCleanup(paths: CleanupPaths): CleanupReport {
  const { scanned, referenced, orphanRows } = computeOrphans(paths);
  return {
    mode: 'plan',
    scanned,
    referenced,
    orphans: orphanRows.length,
    deleted: 0,
    errors: 0,
    backupPath: null,
    orphanRows,
  };
}

/**
 * The full apply flow: fail-closed inputs → orphan set → verified snapshot →
 * one per-owner-scoped delete transaction. Any throw propagates (the
 * transaction rolls back); no destructive step runs before the backup.
 */
export function applyCleanup(paths: CleanupPaths): CleanupReport {
  const { scanned, referenced, orphanRows } = computeOrphans(paths);
  const backupPath = snapshotAndVerify(
    paths.tagsDbPath,
    uniqueSnapshotPath(paths.tagsDbPath, 'pre-cleanup'),
  ).backupPath;

  if (orphanRows.length > 0) {
    const db = new Database(paths.tagsDbPath);
    try {
      const remove = db.prepare('DELETE FROM "tag" WHERE "ownerSub" = ? AND "id" = ?');
      db.transaction(() => {
        for (const row of orphanRows) remove.run(row.ownerSub, row.id);
      })();
    } finally {
      db.close();
    }
  }

  return {
    mode: 'apply',
    scanned,
    referenced,
    orphans: orphanRows.length,
    deleted: orphanRows.length,
    errors: 0,
    backupPath,
    orphanRows,
  };
}

/** One deterministic summary line (counts only, never ids/`name`). */
export function formatCleanupReport(report: CleanupReport): string {
  return (
    `cleanup-tags [${report.mode}]: scanned=${report.scanned} ` +
    `referenced=${report.referenced} orphans=${report.orphans} ` +
    `deleted=${report.deleted} errors=${report.errors}`
  );
}

/** One deterministic detail line: ids and `ownerSub` only, never `name`. */
export function formatOrphanLine(orphan: CleanupOrphan): string {
  return `orphan id=${orphan.id} owner=${orphan.ownerSub}`;
}

export interface CleanupCliDeps {
  env?: NodeJS.ProcessEnv;
  print?: (line: string) => void;
  printError?: (line: string) => void;
}

/**
 * CLI body. Returns the exit code instead of terminating the process so the
 * entry stays honest under test. `--dry-run` plans; default applies. Prints the
 * summary line, then one detail line per orphan in ascending `id` order.
 */
export function main(argv: string[] = process.argv.slice(2), deps: CleanupCliDeps = {}): number {
  const env = deps.env ?? process.env;
  const print = deps.print ?? ((line: string) => console.log(line));
  const printError = deps.printError ?? ((line: string) => console.error(line));
  const dryRun = argv.includes('--dry-run');

  try {
    const paths = resolvePaths(env);
    const report = dryRun ? planCleanup(paths) : applyCleanup(paths);
    print(formatCleanupReport(report));
    for (const row of report.orphanRows) {
      print(formatOrphanLine(row));
    }
    return 0;
  } catch (err) {
    printError(`cleanup-tags failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}
