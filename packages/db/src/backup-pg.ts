import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pruneRoutineSnapshots } from './backup';
import {
  createComposePgRunner,
  pgDump,
  pgRestoreListOk,
  resolveFeedbackDb,
  tableCounts,
} from './pg-client';
import type { PgRunner } from './pg-client';

/**
 * `db:backup:pg` core (`SPEC-feedback-infra.md` "Backup behavior"). Dumps the
 * Postgres database named by `FEEDBACK_DB_URL` via `pg_dump -Fc --no-owner`
 * inside the DB container, verifies with `pg_restore --list`, records
 * per-table counts, and archives `<database>.dump` + `manifest.json` into one
 * UTC-stamped `backup/` directory. Retention reuses `pruneRoutineSnapshots`
 * unchanged (shared routine pool with the SQLite variant). Non-interactive.
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

/** `--only feedback` (or `--only=feedback`); anything but the URL's database is rejected here, before any write. */
function parseOnly(argv: string[], database: string): void {
  const index = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
  if (index === -1) return;
  const raw = argv[index] === '--only' ? argv[index + 1] : argv[index].slice('--only='.length);
  if (!raw) throw new Error('--only requires a comma-separated database list');
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name !== database) {
      throw new Error(`unknown database name: ${name}`);
    }
  }
}

/**
 * Run one backup. Unknown `--only` names and an existing destination throw
 * before anything is written; a routine run prunes after its own snapshot is
 * verified. The URL comes from the passed `env` (`FEEDBACK_DB_URL`, explicit) —
 * a test var is never read implicitly.
 */
export function runBackupPg(options: {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  runner?: PgRunner;
  now?: () => Date;
}): BackupPgResult {
  const env = options.env ?? process.env;
  const db = resolveFeedbackDb(env);
  parseOnly(options.argv, db.database);
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
  const file = `${db.database}.dump`;
  const containerPath = `/tmp/db-backup-${stamp}/${db.database}.dump`;
  pgDump(runner, containerPath, db);
  if (!pgRestoreListOk(runner, containerPath)) {
    throw new Error(`pg_restore --list failed for ${containerPath}`);
  }
  const tables = tableCounts(runner, db);
  const target = join(destination, file);
  runner.copyOut(containerPath, target);

  const entry: PgManifestEntry = {
    name: db.database,
    file,
    source: db.database,
    bytes: statSync(target).size,
    pgRestoreList: 'ok',
    tables,
  };
  const manifest: PgBackupManifest = {
    mode: pinned ? 'deliberate' : 'routine',
    createdAt: at.toISOString(),
    pinned,
    databases: [entry],
  };
  writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (pinned) writeFileSync(join(destination, 'PINNED'), '');

  if (!pinned) {
    const { failed } = pruneRoutineSnapshots(backupRoot);
    for (const dir of failed) console.warn(`db:backup:pg: could not prune ${dir}`);
  }

  return { destination, mode: manifest.mode, snapshots: [entry] };
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
