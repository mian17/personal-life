import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { readManifest } from './backup';
import type { PgManifestEntry } from './backup-pg';
import {
  createComposePgRunner,
  pgDump,
  pgRestoreListOk,
  replaceDatabase,
  resolvePgDatabases,
  selectPgDatabases,
  tableCounts,
} from './pg-client';
import type { PgIdentity, PgRunner } from './pg-client';
import { defaultProbe } from './restore';
import type { StackProbe, StackState } from './restore';

/**
 * `db:restore:pg` core (`SPEC-feedback-infra.md` "Restore behavior", "Restore safety
 * check", `SPEC-focus-service` §2). Replaces the whole selected database from a chosen
 * snapshot, but only after fail-closed preconditions (snapshot verified by
 * `pg_restore --list`, stack probed stopped) and after taking a verified, pinned
 * pre-restore snapshot of the database it is about to overwrite. Post-write table counts
 * are compared against that database's manifest entry; a mismatch exits 1 and names the
 * undo path. Non-interactive, no stdin.
 */

const STACK_PORTS: readonly number[] = [3002, 3003];

/** Exit 1: a usage or precondition / post-check failure. */
class RestorePgError extends Error {}
/** Exit 2: the stack appears up or its state cannot be determined. */
class StackRunningError extends Error {}

export interface RestorePgResult {
  preRestoreDir: string;
  replaced: Array<{ name: string; file: string; snapshot: string; preRestore: string }>;
}

interface PreRestorePgManifest {
  mode: 'pre-restore';
  createdAt: string;
  pinned: true;
  databases: PgManifestEntry[];
}

/** `--flag value` or `--flag=value`; `undefined` when the flag is absent. */
function parseFlag(argv: string[], flag: string): string | undefined {
  const index = argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return undefined;
  return argv[index] === flag ? argv[index + 1] : argv[index].slice(flag.length + 1);
}

/** Required `--from`; a missing flag (or `--from=` with no value) is a usage error. */
function parseFrom(argv: string[]): string {
  const from = parseFlag(argv, '--from');
  if (!from) throw new RestorePgError('--from requires a snapshot directory');
  return from;
}

/** Raw `--only` value (`undefined` when the flag is absent); names resolved later. */
function parseOnly(argv: string[]): string | undefined {
  const raw = parseFlag(argv, '--only');
  if (raw === undefined) return undefined;
  if (!raw) throw new RestorePgError('--only requires a database name');
  return raw;
}

/**
 * The authoritative "database in use" signal, run inside the container: other backends
 * on the target database. `0` → `down`, non-zero → `up`, query failure or unparsable
 * output → `unknown` (fail closed).
 */
function databaseInUse(runner: PgRunner, db: PgIdentity): StackState {
  const datname = db.database.replaceAll("'", "''");
  const result = runner.exec([
    'psql',
    '-U',
    db.user,
    '-d',
    db.database,
    '-t',
    '-A',
    '-c',
    `SELECT count(*) FROM pg_stat_activity WHERE datname = '${datname}' AND pid <> pg_backend_pid();`,
  ]);
  if (result.status !== 0) return 'unknown';
  const count = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isInteger(count)) return 'unknown';
  return count === 0 ? 'down' : 'up';
}

interface SnapshotDirectory {
  root: string;
  backupRoot: string;
  fromDir: string;
}

/** A database to restore, bound to its archive inside the snapshot directory. */
interface RestoreTarget extends PgIdentity {
  file: string;
  snapshotPath: string;
}

/** Resolve the snapshot directory and hold it inside `backup/`. */
function resolveSnapshotDir(env: NodeJS.ProcessEnv, from: string): SnapshotDirectory {
  const root = resolve(env.INIT_CWD ?? process.cwd());
  const backupRoot = join(root, 'backup');
  const fromDir = resolve(root, from);
  if (!existsSync(fromDir) || !statSync(fromDir).isDirectory()) {
    throw new RestorePgError(`snapshot directory does not exist: ${fromDir}`);
  }
  const rel = relative(backupRoot, fromDir);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new RestorePgError(`snapshot directory must be under ${backupRoot}: ${fromDir}`);
  }
  return { root, backupRoot, fromDir };
}

/**
 * The selected databases that this snapshot actually holds, paired with their archive.
 * A snapshot with no archive at all is a usage error, never a silent no-op; a snapshot of
 * one database restores that one, which keeps single-database archives restorable.
 */
function withArchiveIn(
  databases: PgIdentity[],
  fromDir: string,
): RestoreTarget[] {
  const archived = databases.flatMap((db) => {
    const file = `${db.database}.dump`;
    const snapshotPath = join(fromDir, file);
    return existsSync(snapshotPath) ? [{ ...db, file, snapshotPath }] : [];
  });
  if (archived.length > 0) return archived;
  const missing = databases.map((db) => join(fromDir, `${db.database}.dump`)).join(', ');
  throw new RestorePgError(`snapshot file does not exist: ${missing}`);
}

/** Every stack port must probe `down`; `up` or `unknown` fails closed.
 * Probed concurrently: the ports are independent checks, and a sequential loop
 * would only add latency before the same refusal. */
async function assertStackStopped(probe: StackProbe): Promise<void> {
  const states = await Promise.all(
    STACK_PORTS.map((port) => Promise.resolve(probe(port))),
  );
  for (const [index, state] of states.entries()) {
    const port = STACK_PORTS[index];
    if (state === 'up') throw new StackRunningError(`stack appears up on 127.0.0.1:${port}`);
    if (state !== 'down') {
      throw new StackRunningError(`cannot determine stack state on 127.0.0.1:${port}: ${state}`);
    }
  }
}

/**
 * Preconditions, before any write to the live database: verify the archive
 * in-container, probe the stack stopped, and rule out other database clients.
 */
async function assertSafeToRestore(
  runner: PgRunner,
  probe: StackProbe,
  db: PgIdentity,
  snapshotPath: string,
  containerPath: string,
): Promise<void> {
  runner.exec(['mkdir', '-p', dirname(containerPath)]);
  runner.copyIn(snapshotPath, containerPath);
  if (!pgRestoreListOk(runner, containerPath)) {
    throw new RestorePgError(`pg_restore --list failed for ${snapshotPath}`);
  }
  await assertStackStopped(probe);
  const inUse = databaseInUse(runner, db);
  if (inUse === 'up') throw new StackRunningError(`database ${db.database} has other clients`);
  if (inUse !== 'down') {
    throw new StackRunningError(`cannot determine clients of database ${db.database}`);
  }
}

/**
 * A verified, pinned pre-restore snapshot — the undo path — taken before the drop.
 * Returns the manifest entry and the host path of the copied-out archive.
 */
function takePreRestoreSnapshot(
  runner: PgRunner,
  db: PgIdentity,
  preRestoreDir: string,
  file: string,
  stamp: string,
): { entry: PgManifestEntry; path: string } {
  mkdirSync(preRestoreDir, { recursive: true });
  const preContainerPath = `/tmp/db-pre-restore-${stamp}/${file}`;
  runner.exec(['mkdir', '-p', dirname(preContainerPath)]);
  pgDump(runner, preContainerPath, db);
  if (!pgRestoreListOk(runner, preContainerPath)) {
    throw new RestorePgError(
      `pg_restore --list failed for the pre-restore snapshot of ${db.database}`,
    );
  }
  const tables = tableCounts(runner, db);
  const path = join(preRestoreDir, file);
  runner.copyOut(preContainerPath, path);
  return {
    entry: {
      name: db.database,
      file,
      source: db.database,
      bytes: statSync(path).size,
      pgRestoreList: 'ok',
      tables,
    },
    path,
  };
}

/** Write the pinned pre-restore manifest, making every undo path discoverable. */
function writePreRestoreManifest(
  preRestoreDir: string,
  at: Date,
  entries: PgManifestEntry[],
): void {
  const preManifest: PreRestorePgManifest = {
    mode: 'pre-restore',
    createdAt: at.toISOString(),
    pinned: true,
    databases: entries,
  };
  writeFileSync(join(preRestoreDir, 'manifest.json'), `${JSON.stringify(preManifest, null, 2)}\n`);
  writeFileSync(join(preRestoreDir, 'PINNED'), '');
}

/**
 * Post-write verification against the restored database's own manifest entry; a missing
 * or unreadable manifest leaves the expectation unknown → skip, never crash the restore.
 */
function assertRowCountsMatch(
  runner: PgRunner,
  db: PgIdentity,
  fromDir: string,
  preRestorePath: string,
): void {
  const snapshotManifest = readManifest(fromDir) as { databases?: PgManifestEntry[] } | null;
  const expected = snapshotManifest?.databases?.find((entry) => entry.name === db.database)?.tables;
  if (!expected || Object.keys(expected).length === 0) return;
  const restored = tableCounts(runner, db);
  for (const [table, count] of Object.entries(expected)) {
    const actual = restored[table];
    if (actual !== count) {
      throw new RestorePgError(
        `row count mismatch on ${table}: expected ${count}, got ${actual ?? 'missing'}; ` +
          `recover from ${preRestorePath}`,
      );
    }
  }
}


interface RestoreRun {
  runner: PgRunner;
  probe: StackProbe;
  preRestoreDir: string;
  fromDir: string;
  stamp: string;
  at: Date;
  /** Undo paths taken so far, so the pre-restore manifest names every archive. */
  preRestoreEntries: PgManifestEntry[];
}

/**
 * Restore one database: preconditions, the pinned pre-restore snapshot, the replacement,
 * then the post-write count check against that database's own manifest entry.
 */
async function restoreOne(
  run: RestoreRun,
  target: RestoreTarget,
): Promise<RestorePgResult['replaced'][number]> {
  const containerPath = `/tmp/db-restore-${run.stamp}/${target.file}`;
  await assertSafeToRestore(run.runner, run.probe, target, target.snapshotPath, containerPath);

  const preRestore = takePreRestoreSnapshot(
    run.runner,
    target,
    run.preRestoreDir,
    target.file,
    run.stamp,
  );
  run.preRestoreEntries.push(preRestore.entry);

  // Replace the live database (drop/recreate + pg_restore, `src/pg-client.ts`).
  replaceDatabase(run.runner, target, containerPath);
  writePreRestoreManifest(run.preRestoreDir, run.at, run.preRestoreEntries);
  assertRowCountsMatch(run.runner, target, run.fromDir, preRestore.path);

  return {
    name: target.database,
    file: target.file,
    snapshot: target.snapshotPath,
    preRestore: preRestore.path,
  };
}

export async function runRestorePg(options: {
  from: string;
  only?: string;
  env?: NodeJS.ProcessEnv;
  runner?: PgRunner;
  probe?: StackProbe;
  now?: () => Date;
}): Promise<RestorePgResult> {
  const env = options.env ?? process.env;
  // The SQLite variant owns the identical read-only TCP probe, so this reuses it
  // instead of keeping a local copy.
  const probe = options.probe ?? defaultProbe;
  const selected = selectPgDatabases(options.only, resolvePgDatabases(env));

  const { root, backupRoot, fromDir } = resolveSnapshotDir(env, options.from);
  const targets = withArchiveIn(selected, fromDir);

  const at = options.now ? options.now() : new Date();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const runner =
    options.runner ?? createComposePgRunner({ composeFile: join(root, 'compose.yaml') });

  const preRestoreDir = join(backupRoot, `pre-restore-${stamp}`);
  const run: RestoreRun = {
    runner,
    probe,
    preRestoreDir,
    fromDir,
    stamp,
    at,
    preRestoreEntries: [],
  };
  const replaced: RestorePgResult['replaced'] = [];
  for (const target of targets) {
    replaced.push(await restoreOne(run, target));
  }

  return { preRestoreDir, replaced };
}

/**
 * CLI body. Returns the exit code instead of terminating the process: 0 success,
 * 1 usage/precondition/post-check failure, 2 stack up or unverifiable. Never reads
 * stdin; one line per restored database.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  runner?: PgRunner,
  probe?: StackProbe,
  now?: () => Date,
): Promise<number> {
  try {
    const result = await runRestorePg({
      from: parseFrom(argv),
      only: parseOnly(argv),
      env,
      runner,
      probe,
      now,
    });
    for (const entry of result.replaced) {
      console.log(
        `db:restore:pg ${entry.name} <- ${entry.snapshot} pg_restore_list=ok` +
          ` pre_restore=${entry.preRestore}`,
      );
    }
    return 0;
  } catch (err) {
    console.error(`db:restore:pg failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return err instanceof StackRunningError ? 2 : 1;
  }
}
