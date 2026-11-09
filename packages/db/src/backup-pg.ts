import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { finalizeBackup } from './backup.js';
import {
  createComposePgRunner,
  pgDump,
  pgRestoreListOk,
  resolvePgDatabases,
  selectPgDatabases,
  tableCounts,
} from './pg-client.js';
import type { PgIdentity, PgRunner } from './pg-client.js';

/**
 * `db:backup:pg` core (`SPEC-feedback-infra.md` "Backup behavior"). Dumps every Postgres
 * database `resolvePgDatabases` reports (feedback only — `focus-service` is SQLite) via
 * `pg_dump -Fc --no-owner` inside the DB container, verifies each with
 * `pg_restore --list`, records per-table counts, and archives `<database>.dump` +
 * `manifest.json` into one UTC-stamped `backup/` directory. `--only <name>` restricts the
 * run to the named databases. Retention reuses `pruneRoutineSnapshots` unchanged (shared
 * routine pool with the SQLite variant). Non-interactive.
 */

export type BackupPgMode = 'routine' | 'deliberate';

export interface PgManifestEntry {
  name: string;
  file: string;
  source: string;
  bytes: number;
  pgRestoreList: 'ok';
  tables: Record<string, number>;
}

export interface PgBackupManifest {
  mode: BackupPgMode;
  createdAt: string;
  pinned: boolean;
  databases: PgManifestEntry[];
}

export interface BackupPgResult {
  destination: string;
  mode: BackupPgMode;
  snapshots: PgManifestEntry[];
}

/** `--only feedback` (or `--only=…`); `undefined` selects every database. */
function parseOnly(argv: string[]): string | undefined {
  const index = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
  if (index === -1) return undefined;
  const raw = argv[index] === '--only' ? argv[index + 1] : argv[index].slice('--only='.length);
  if (!raw) throw new Error('--only requires a comma-separated database list');
  return raw;
}

interface BackupTarget {
  runner: PgRunner;
  destination: string;
  containerDirectory: string;
}

/**
 * Dump, verify and copy out one database, answering its manifest entry. Every archive
 * lands in the run's container directory; file names carry the database name.
 */
function dumpDatabase(target: BackupTarget, db: PgIdentity): PgManifestEntry {
  const file = `${db.database}.dump`;
  const containerPath = join(target.containerDirectory, file);
  pgDump(target.runner, containerPath, db);
  if (!pgRestoreListOk(target.runner, containerPath)) {
    throw new Error(`pg_restore --list failed for ${containerPath}`);
  }
  const tables = tableCounts(target.runner, db);
  const archived = join(target.destination, file);
  target.runner.copyOut(containerPath, archived);
  return {
    name: db.database,
    file,
    source: db.database,
    bytes: statSync(archived).size,
    pgRestoreList: 'ok',
    tables,
  };
}

/**
 * Run one backup. Unknown `--only` names and an existing destination throw before anything
 * is written; a routine run prunes after its own snapshot is verified. The URL comes from
 * the passed `env` (`FEEDBACK_DB_URL`, explicit) — a test var is never read
 * implicitly.
 */
export function runBackupPg(options: {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  runner?: PgRunner;
  now?: () => Date;
}): BackupPgResult {
  const env = options.env ?? process.env;
  const databases = selectPgDatabases(parseOnly(options.argv), resolvePgDatabases(env));
  const pinned = options.argv.includes('--pin');

  const at = options.now ? options.now() : new Date();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const root = resolve(env.INIT_CWD ?? process.cwd());
  const backupRoot = join(root, 'backup');
  const destination = join(backupRoot, pinned ? `${stamp}-pinned` : stamp);
  if (existsSync(destination)) {
    throw new Error(`destination already exists: ${destination}`);
  }
  mkdirSync(destination, { recursive: true });

  const runner =
    options.runner ?? createComposePgRunner({ composeFile: join(root, 'compose.yaml') });
  // `pg_dump -f` never creates its parent directory, so the container dump directory is
  // made once, before the first dump (`restore-pg.ts` does the same).
  const target: BackupTarget = {
    runner,
    destination,
    containerDirectory: `/tmp/db-backup-${stamp}`,
  };
  runner.exec(['mkdir', '-p', target.containerDirectory]);
  const snapshots = databases.map((db) => dumpDatabase(target, db));

  const mode: BackupPgMode = pinned ? 'deliberate' : 'routine';
  finalizeBackup({
    destination,
    backupRoot,
    pinned,
    mode,
    createdAt: at.toISOString(),
    entries: snapshots,
    warnPrefix: 'db:backup:pg',
  });

  return { destination, mode, snapshots };
}

/**
 * CLI body. Returns the exit code instead of terminating the process (the
 * `backup.ts` pattern). Never reads stdin; one summary line per database.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  runner?: PgRunner,
  now?: () => Date,
): number {
  try {
    const result = runBackupPg({ argv, env, runner, now });
    for (const snapshot of result.snapshots) {
      console.log(
        `db:backup:pg [${result.mode}] ${snapshot.file} -> ${join(result.destination, snapshot.file)}` +
          ` pg_restore_list=${snapshot.pgRestoreList}`,
      );
    }
    return 0;
  } catch (err) {
    console.error(`db:backup:pg failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}
