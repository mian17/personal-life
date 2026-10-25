import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { connect } from 'net';
import { isAbsolute, join, relative, resolve, dirname } from 'path';
import { readManifest } from './backup';
import type { PgManifestEntry } from './backup-pg';
import {
  createComposePgRunner,
  pgDump,
  pgRestoreListOk,
  replaceDatabase,
  resolveFeedbackDb,
  tableCounts,
} from './pg-client';
import type { PgIdentity, PgRunner } from './pg-client';
import type { StackProbe, StackState } from './restore';

/**
 * `db:restore:pg` core (`SPEC-feedback-infra.md` "Restore behavior", "Restore safety
 * check"). Replaces the whole feedback database from a chosen snapshot, but only after
 * fail-closed preconditions (snapshot verified by `pg_restore --list`, stack probed
 * stopped) and after taking a verified, pinned pre-restore snapshot of the database it is
 * about to overwrite. Post-write table counts are compared against the snapshot's
 * manifest; a mismatch exits 1 and names the undo path. Non-interactive, no stdin.
 */

const STACK_PORTS: readonly number[] = [3002, 3003];
const STACK_PROBE_TIMEOUT_MS = 1000;

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

/** Raw `--only` value (`undefined` when the flag is absent); validated against the URL's database. */
function parseOnly(argv: string[]): string | undefined {
  const raw = parseFlag(argv, '--only');
  if (raw === undefined) return undefined;
  if (!raw) throw new RestorePgError('--only requires a database name');
  return raw;
}

/**
 * Default stack probe (spec "Restore safety check"): the same read-only TCP probe as
 * `src/restore.ts`'s — `127.0.0.1` ports, one-second timeout, `connect` → `up`,
 * `ECONNREFUSED` → `down`, anything else / timeout → `unknown`. Never kills or spawns.
 * (`ponytail:` the SQLite variant owns the identical probe but keeps it private, so this
 * is a local copy; export `defaultProbe` from `src/restore.ts` once editing that file is
 * allowed.)
 */
function defaultProbe(port: number): Promise<StackState> {
  return new Promise((settle) => {
    const socket = connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (state: StackState) => {
      if (done) return;
      done = true;
      socket.destroy();
      settle(state);
    };
    socket.setTimeout(STACK_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish('up'));
    socket.once('timeout', () => finish('unknown'));
    socket.once('error', (err: NodeJS.ErrnoException) =>
      finish(err.code === 'ECONNREFUSED' ? 'down' : 'unknown'),
    );
  });
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

/**
 * Restore the database named by `FEEDBACK_DB_URL` from the snapshot directory `from`.
 * Every precondition fails closed before the live database is touched: the `*.dump` must
 * exist and pass `pg_restore --list`, and the stack must probe stopped on ports 3002/3003
 * *and* show no other database client. A verified, pinned pre-restore snapshot is taken
 * first; post-write counts are compared against the snapshot manifest's `tables`
 * (missing/unreadable manifest → comparison skipped, never a crash), and a mismatch
 * throws while naming the pre-restore dump as the recovery path.
 */
/** `--only` may only name the URL's database; anything else is a usage error. */
function assertOnlyMatchesDatabase(only: string | undefined, database: string): void {
  if (only === undefined) return;
  for (const part of only.split(',')) {
    const name = part.trim();
    if (name !== database) throw new RestorePgError(`unknown database name: ${name}`);
  }
}

interface SnapshotDir {
  root: string;
  backupRoot: string;
  fromDir: string;
  file: string;
  snapshotPath: string;
}

/** Resolve the snapshot directory (under `backup/`) and the archive inside it. */
function resolveSnapshotDir(env: NodeJS.ProcessEnv, from: string, database: string): SnapshotDir {
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
  const file = `${database}.dump`;
  const snapshotPath = join(fromDir, file);
  if (!existsSync(snapshotPath)) {
    throw new RestorePgError(`snapshot file does not exist: ${snapshotPath}`);
  }
  return { root, backupRoot, fromDir, file, snapshotPath };
}

/** Every stack port must probe `down`; `up` or `unknown` fails closed. */
async function assertStackStopped(probe: StackProbe): Promise<void> {
  for (const port of STACK_PORTS) {
    const state = await probe(port);
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

/** Write the pinned pre-restore manifest, making the undo path discoverable. */
function writePreRestoreManifest(
  preRestoreDir: string,
  at: Date,
  entry: PgManifestEntry,
): void {
  const preManifest: PreRestorePgManifest = {
    mode: 'pre-restore',
    createdAt: at.toISOString(),
    pinned: true,
    databases: [entry],
  };
  writeFileSync(join(preRestoreDir, 'manifest.json'), `${JSON.stringify(preManifest, null, 2)}\n`);
  writeFileSync(join(preRestoreDir, 'PINNED'), '');
}

/**
 * Post-write verification against the chosen snapshot's manifest; a missing or
 * unreadable manifest leaves the expectation unknown → skip, never crash the restore.
 */
function assertRowCountsMatch(
  runner: PgRunner,
  db: PgIdentity,
  fromDir: string,
  preRestorePath: string,
): void {
  const snapshotManifest = readManifest(fromDir) as { databases?: PgManifestEntry[] } | null;
  const expected = snapshotManifest?.databases?.[0]?.tables;
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

export async function runRestorePg(options: {
  from: string;
  only?: string;
  env?: NodeJS.ProcessEnv;
  runner?: PgRunner;
  probe?: StackProbe;
  now?: () => Date;
}): Promise<RestorePgResult> {
  const env = options.env ?? process.env;
  const probe = options.probe ?? defaultProbe;
  const db = resolveFeedbackDb(env);
  assertOnlyMatchesDatabase(options.only, db.database);

  const { root, backupRoot, fromDir, file, snapshotPath } = resolveSnapshotDir(
    env,
    options.from,
    db.database,
  );
  const at = options.now ? options.now() : new Date();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const runner =
    options.runner ?? createComposePgRunner({ composeFile: join(root, 'compose.yaml') });

  const containerPath = `/tmp/db-restore-${stamp}/${file}`;
  await assertSafeToRestore(runner, probe, db, snapshotPath, containerPath);

  const preRestoreDir = join(backupRoot, `pre-restore-${stamp}`);
  const preRestore = takePreRestoreSnapshot(runner, db, preRestoreDir, file, stamp);

  // Replace the live database (drop/recreate + pg_restore, `src/pg-client.ts`).
  replaceDatabase(runner, db, containerPath);
  writePreRestoreManifest(preRestoreDir, at, preRestore.entry);
  assertRowCountsMatch(runner, db, fromDir, preRestore.path);

  return {
    preRestoreDir,
    replaced: [{ name: db.database, file, snapshot: snapshotPath, preRestore: preRestore.path }],
  };
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
