import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseName } from './paths';
import { resolvePaths, selectPaths } from './paths';
import { snapshotAndVerify, verifyDatabase } from './snapshot';

/**
 * `db:restore` core (`SPEC-db-backup-restore` "Restore behavior", "Restore safety
 * check", "No silent data loss"). Replaces selected live SQLite files from a chosen
 * snapshot directory, but only after a fail-closed stack probe says the stack is
 * stopped and after taking a verified, pinned pre-restore snapshot of every file it
 * is about to overwrite. Non-interactive (D11); the snapshot primitive lives in
 * `./snapshot`.
 */

export type StackState = 'up' | 'down' | 'unknown';

/** Injected seam so tests never open a real port; production is the TCP probe below. */
export type StackProbe = (port: number) => StackState | Promise<StackState>;

export interface RestoreResult {
  preRestoreDir: string | null;
  replaced: Array<{
    name: DatabaseName;
    source: string;
    snapshot: string;
    preRestore: string | null;
  }>;
}

const DATABASE_NAMES: readonly DatabaseName[] = ['life', 'tags', 'todo', 'idp', 'meal'];
const STACK_PORTS: readonly number[] = [3002, 3003];
const STACK_PROBE_TIMEOUT_MS = 1000;

/** Exit 1: a usage or precondition failure. */
class RestoreError extends Error {}
/** Exit 2: the stack appears up or its state cannot be determined (D5). */
class StackRunningError extends Error {}

interface PreRestoreEntry {
  name: DatabaseName;
  file: string;
  source: string;
  bytes: number;
  quickCheck: 'ok';
}

interface PreRestoreManifest {
  mode: 'pre-restore';
  createdAt: string;
  pinned: true;
  databases: PreRestoreEntry[];
}

/** `--flag value` or `--flag=value`; `undefined` when the flag is absent. */
function parseFlag(argv: string[], flag: string): string | undefined {
  const index = argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return undefined;
  return argv[index] === flag ? argv[index + 1] : argv[index].slice(flag.length + 1);
}

/** `--only life,idp`; unknown names rejected before any write. */
function parseOnly(argv: string[]): DatabaseName[] | undefined {
  const raw = parseFlag(argv, '--only');
  if (raw === undefined) return undefined;
  if (!raw) throw new RestoreError('--only requires a comma-separated database list');
  return raw.split(',').map((part) => {
    const name = part.trim();
    if (!(DATABASE_NAMES as readonly string[]).includes(name)) {
      throw new RestoreError(`unknown database name: ${name}`);
    }
    return name as DatabaseName;
  });
}

/** Required `--from`; a missing flag (or `--from=` with no value) is a usage error. */
function parseFrom(argv: string[]): string {
  const from = parseFlag(argv, '--from');
  if (!from) throw new RestoreError('--from requires a snapshot directory');
  return from;
}

/**
 * The real, read-only stack probe (spec "Restore safety check"): TCP-connect
 * `127.0.0.1:port` with a one-second timeout. Accepted → `up`; `ECONNREFUSED` →
 * `down`; any other error or a timeout → `unknown`. It never kills, stops, or spawns
 * anything.
 */
export function defaultProbe(port: number): Promise<StackState> {
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
 * Restore the selected databases from `from`. Every selected snapshot is verified
 * before use, the stack must probe `down` on all ports, and each overwritten target
 * gets a verified pre-restore snapshot first. Any failure before or during the
 * replacement of a target leaves that target untouched.
 */
interface ChosenTarget {
  name: DatabaseName;
  source: string;
  file: string;
}

/** The selected snapshot directory, which must exist and live under `backup/`. */
function resolveSnapshotDir(cwd: string, backupRoot: string, from: string): string {
  const fromDir = resolve(cwd, from);
  if (!existsSync(fromDir) || !statSync(fromDir).isDirectory()) {
    throw new RestoreError(`snapshot directory does not exist: ${fromDir}`);
  }
  const rel = relative(backupRoot, fromDir);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new RestoreError(`snapshot directory must be under ${backupRoot}: ${fromDir}`);
  }
  return fromDir;
}

/**
 * Selection: named subset, or every database file present in the snapshot dir.
 */
function chooseTargets(
  env: NodeJS.ProcessEnv,
  fromDir: string,
  only: readonly DatabaseName[] | undefined,
): ChosenTarget[] {
  const resolved = resolvePaths(env);
  const chosenPaths = only
    ? selectPaths(resolved, only)
    : resolved.filter((entry) => existsSync(join(fromDir, basename(entry.source))));
  return chosenPaths.map((entry) => ({
    name: entry.name,
    source: entry.source,
    file: basename(entry.source),
  }));
}

/** Preconditions, checked before any write: every snapshot exists and is verified. */
function assertSnapshotsUsable(chosen: readonly ChosenTarget[], fromDir: string): void {
  for (const entry of chosen) {
    const snapshot = join(fromDir, entry.file);
    if (!existsSync(snapshot)) throw new RestoreError(`snapshot file does not exist: ${snapshot}`);
    if (resolve(snapshot) === resolve(entry.source)) {
      throw new RestoreError(`snapshot resolves to the live target: ${snapshot}`);
    }
  }
  for (const entry of chosen) {
    verifyDatabase(join(fromDir, entry.file));
  }
}

/** The stack must probe `down` on every port; `up`/`unknown` fail closed.
 * Probed concurrently: the ports are independent checks, and a sequential loop
 * would only add latency before the same refusal. */
async function assertStackStopped(probe: StackProbe): Promise<void> {
  const states = await Promise.all(STACK_PORTS.map(async (port) => probe(port)));
  for (const [index, state] of states.entries()) {
    const port = STACK_PORTS[index];
    if (state === 'up') throw new StackRunningError(`stack appears up on 127.0.0.1:${port}`);
    if (state !== 'down') {
      throw new StackRunningError(`cannot determine stack state on 127.0.0.1:${port}: ${state}`);
    }
  }
}

/**
 * Step 1 — preserve the live target before it is touched, if it exists. Returns the
 * pre-restore path (or `null`) and records the entry for the pinned manifest.
 */
function preserveTarget(
  entry: ChosenTarget,
  preRestoreDir: string,
  preEntries: PreRestoreEntry[],
): string | null {
  if (!existsSync(entry.source)) return null;
  const prePath = join(preRestoreDir, entry.file);
  const result = snapshotAndVerify(entry.source, prePath);
  preEntries.push({
    name: entry.name,
    file: entry.file,
    source: entry.source,
    bytes: statSync(prePath).size,
    quickCheck: result.quickCheck,
  });
  return result.backupPath;
}

/**
 * Step 4 — prove the replacement; a failed `PRAGMA quick_check` names the pre-restore
 * snapshot as the recovery path.
 */
function assertRestored(entry: ChosenTarget, preRestore: string | null): void {
  try {
    verifyDatabase(entry.source);
  } catch (err) {
    throw new RestoreError(
      `restored ${entry.file} failed PRAGMA quick_check` +
        (preRestore ? `; recover from ${preRestore}` : '') +
        `: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
}

/** Steps 1–4 for one target: preserve, copy the verified snapshot over it, prove it. */
function restoreOne(
  entry: ChosenTarget,
  fromDir: string,
  preRestoreDir: string,
  preEntries: PreRestoreEntry[],
): RestoreResult['replaced'][number] {
  const snapshotPath = join(fromDir, entry.file);
  const preRestore = preserveTarget(entry, preRestoreDir, preEntries);

  // Steps 2–3 — drop stale sidecars and copy the verified snapshot over the target.
  rmSync(`${entry.source}-wal`, { force: true });
  rmSync(`${entry.source}-shm`, { force: true });
  mkdirSync(dirname(entry.source), { recursive: true });
  copyFileSync(snapshotPath, entry.source);

  assertRestored(entry, preRestore);
  return { name: entry.name, source: entry.source, snapshot: snapshotPath, preRestore };
}

/** Write the pinned pre-restore manifest; `null` when no target needed a snapshot. */
function writePreRestoreManifest(
  preRestoreDir: string,
  at: Date,
  preEntries: PreRestoreEntry[],
): string | null {
  if (preEntries.length === 0) return null;
  const manifest: PreRestoreManifest = {
    mode: 'pre-restore',
    createdAt: at.toISOString(),
    pinned: true,
    databases: preEntries,
  };
  writeFileSync(join(preRestoreDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(preRestoreDir, 'PINNED'), '');
  return preRestoreDir;
}

export async function runRestore(options: {
  from: string;
  only?: readonly DatabaseName[];
  env?: NodeJS.ProcessEnv;
  probe?: StackProbe;
  now?: () => Date;
}): Promise<RestoreResult> {
  const env = options.env ?? process.env;
  const probe = options.probe ?? defaultProbe;
  const cwd = env.INIT_CWD ?? process.cwd();
  const backupRoot = resolve(cwd, 'backup');

  const fromDir = resolveSnapshotDir(cwd, backupRoot, options.from);
  const chosen = chooseTargets(env, fromDir, options.only);
  assertSnapshotsUsable(chosen, fromDir);
  await assertStackStopped(probe);

  const at = options.now ? options.now() : new Date();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const preRestoreDir = join(backupRoot, `pre-restore-${stamp}`);

  const preEntries: PreRestoreEntry[] = [];
  const replaced = chosen.map((entry) => restoreOne(entry, fromDir, preRestoreDir, preEntries));

  return { preRestoreDir: writePreRestoreManifest(preRestoreDir, at, preEntries), replaced };
}

/**
 * CLI body. Returns the exit code instead of terminating the process (the
 * `cleanup.ts` pattern): 0 success, 1 usage/precondition/post-check failure, 2 stack
 * up or unverifiable. Never reads stdin; one line per restored database.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  probe?: StackProbe,
): Promise<number> {
  try {
    const result = await runRestore({ from: parseFrom(argv), only: parseOnly(argv), env, probe });
    for (const entry of result.replaced) {
      const recovery = entry.preRestore ? ` pre-restore=${entry.preRestore}` : '';
      console.log(`db:restore ${entry.name} <- ${entry.snapshot} quick_check=ok${recovery}`);
    }
    return 0;
  } catch (err) {
    console.error(`db:restore failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return err instanceof StackRunningError ? 2 : 1;
  }
}
