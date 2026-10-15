import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import type { DatabaseName } from './paths';
import { resolvePaths, selectPaths } from './paths';
import { snapshotAndVerify } from './snapshot';

/**
 * `db:backup` core (`SPEC-db-backup-restore` "Backup behavior"). Snapshots the
 * selected compose-host SQLite files into one UTC-stamped `backup/` directory,
 * read-only against every source (D4), fail-closed on a missing selected input
 * (D10), and non-interactive (D11). The snapshot primitive lives in
 * `./snapshot` — this module only orchestrates.
 */

export type BackupMode = 'routine' | 'deliberate';

export interface ManifestEntry {
  name: DatabaseName;
  file: string;
  source: string;
  bytes: number;
  quickCheck: 'ok';
}

export interface BackupManifest {
  mode: BackupMode;
  createdAt: string;
  pinned: boolean;
  databases: ManifestEntry[];
}

export interface BackupResult {
  destination: string;
  mode: BackupMode;
  snapshots: ManifestEntry[];
}

const DATABASE_NAMES: readonly DatabaseName[] = ['life', 'tags', 'todo', 'idp', 'meal'];
const DEFAULT_KEEP = 10;

/** Raised before anything is written; `paths` are the missing sources. */
class MissingInputsError extends Error {
  constructor(readonly paths: string[]) {
    super(`missing database files: ${paths.join(', ')}`);
    this.name = 'MissingInputsError';
  }
}

/** `--only life,idp` (or `--only=life,idp`); unknown names rejected here, before any write. */
function parseOnly(argv: string[]): DatabaseName[] | undefined {
  const index = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
  if (index === -1) return undefined;
  const raw = argv[index] === '--only' ? argv[index + 1] : argv[index].slice('--only='.length);
  if (!raw) throw new Error('--only requires a comma-separated database list');
  return raw.split(',').map((part) => {
    const name = part.trim();
    if (!(DATABASE_NAMES as readonly string[]).includes(name)) {
      throw new Error(`unknown database name: ${name}`);
    }
    return name as DatabaseName;
  });
}

interface SnapshotManifest {
  mode?: string;
  pinned?: boolean;
}

/** Fail-safe: an unreadable or unparseable manifest leaves provenance unknown → never pruned. */
function readManifest(dir: string): SnapshotManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest;
  } catch {
    return null;
  }
}

/** Candidate for retention only when it is a readable `routine`/unpinned snapshot with no `PINNED` marker. */
function isRoutineSnapshot(backupRoot: string, name: string): boolean {
  if (name.endsWith('-pinned')) return false;
  const dir = join(backupRoot, name);
  if (existsSync(join(dir, 'PINNED'))) return false;
  const manifest = readManifest(dir);
  return manifest?.mode === 'routine' && manifest.pinned === false;
}

/**
 * Keep the newest `keep` routine snapshots (ordered by directory name) and delete
 * older ones. Pinned / deliberate / pre-restore / manifest-less directories are
 * never candidates. Best-effort: a delete failure is reported, never thrown.
 */
export function pruneRoutineSnapshots(
  backupRoot: string,
  keep: number = DEFAULT_KEEP,
): { pruned: string[]; failed: string[] } {
  const pruned: string[] = [];
  const failed: string[] = [];
  if (!existsSync(backupRoot)) return { pruned, failed };

  const routine = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => isRoutineSnapshot(backupRoot, name))
    .sort();

  for (const name of routine.slice(0, Math.max(0, routine.length - keep))) {
    const dir = join(backupRoot, name);
    try {
      rmSync(dir, { recursive: true, force: true });
      pruned.push(dir);
    } catch {
      failed.push(dir);
    }
  }
  return { pruned, failed };
}

/**
 * Run one backup. Missing selected inputs throw before the destination directory
 * is created; a routine run prunes after its own snapshot is verified.
 */
export function runBackup(options: {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): BackupResult {
  const env = options.env ?? process.env;
  const pinned = options.argv.includes('--pin');
  const selected = selectPaths(resolvePaths(env), parseOnly(options.argv));

  const missing = selected.filter((entry) => !existsSync(entry.source)).map((entry) => entry.source);
  if (missing.length > 0) throw new MissingInputsError(missing);

  const at = options.now ? options.now() : new Date();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const backupRoot = resolve(env.INIT_CWD ?? process.cwd(), 'backup');
  const destination = join(backupRoot, pinned ? `${stamp}-pinned` : stamp);
  if (existsSync(destination)) {
    throw new Error(`destination already exists: ${destination}`);
  }
  mkdirSync(destination, { recursive: true });

  const snapshots: ManifestEntry[] = selected.map((entry) => {
    const file = basename(entry.source);
    const target = join(destination, file);
    const result = snapshotAndVerify(entry.source, target);
    return {
      name: entry.name,
      file,
      source: entry.source,
      bytes: statSync(target).size,
      quickCheck: result.quickCheck,
    };
  });

  const manifest: BackupManifest = {
    mode: pinned ? 'deliberate' : 'routine',
    createdAt: at.toISOString(),
    pinned,
    databases: snapshots,
  };
  writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (pinned) writeFileSync(join(destination, 'PINNED'), '');

  if (!pinned) {
    const { failed } = pruneRoutineSnapshots(backupRoot);
    for (const dir of failed) console.warn(`db:backup: could not prune ${dir}`);
  }

  return { destination, mode: manifest.mode, snapshots };
}

/**
 * CLI body. Returns the exit code instead of terminating the process (the
 * `cleanup.ts` pattern). Never reads stdin; one summary line per snapshot.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): number {
  try {
    const result = runBackup({ argv, env });
    for (const snapshot of result.snapshots) {
      console.log(
        `db:backup [${result.mode}] ${snapshot.file} -> ${join(result.destination, snapshot.file)}` +
          ` quick_check=${snapshot.quickCheck}`,
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof MissingInputsError) {
      for (const path of err.paths) console.error(`db:backup: missing ${path}`);
    }
    console.error(`db:backup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}
