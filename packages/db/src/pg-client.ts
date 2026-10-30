import { spawnSync } from 'node:child_process';

/**
 * Postgres client seam (`SPEC-feedback-infra.md` "The client inside the
 * container"). Every `pg_dump` / `pg_restore` / `psql` call runs inside the DB
 * container — the host has no client binaries. Unit tests inject a fake;
 * production uses `createComposePgRunner`, the integration harness uses
 * `createDockerPgRunner`.
 */

export interface PgRunner {
  /** Run argv inside the DB container; returns status + captured stdout/stderr. */
  exec(argv: string[]): { status: number; stdout: string; stderr: string };
  copyIn(hostPath: string, containerPath: string): void;
  copyOut(containerPath: string, hostPath: string): void;
}

/** Database identity parsed from the URL; host/port/password intentionally unused. */
export interface PgIdentity {
  user: string;
  database: string;
}

export const DEFAULT_FEEDBACK_DB_URL = 'postgresql://feedback@postgres-feedback:5432/feedback';

/** Parse a `postgresql://` URL into `{ user, database }` via `new URL()`. */
export function parsePgDbUrl(raw: string): PgIdentity {
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.split('/')[1] ?? '');
  if (!user) throw new Error(`database URL has no user: ${raw}`);
  if (!database) throw new Error(`database URL has no database: ${raw}`);
  return { user, database };
}

/** `FEEDBACK_DB_URL` with the spec default. */
export function resolveFeedbackDb(env: NodeJS.ProcessEnv = process.env): PgIdentity {
  return parsePgDbUrl(env.FEEDBACK_DB_URL ?? DEFAULT_FEEDBACK_DB_URL);
}

/**
 * Every Postgres database the backup and restore tools cover, in archive order.
 * `focus-service` is SQLite (`SPEC-focus-service` Storage), so `feedback` is the only one.
 */
export function resolvePgDatabases(env: NodeJS.ProcessEnv = process.env): PgIdentity[] {
  return [resolveFeedbackDb(env)];
}

/**
 * Databases named by an `--only a,b` value, in the requested order; no value selects every
 * resolved database. An unknown name throws before any dump, copy or write happens.
 */
export function selectPgDatabases(
  only: string | undefined,
  databases: PgIdentity[],
): PgIdentity[] {
  if (only === undefined) return databases;
  return only.split(',').map((part) => {
    const name = part.trim();
    const database = databases.find((candidate) => candidate.database === name);
    if (!database) throw new Error(`unknown database name: ${name}`);
    return database;
  });
}

interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCmd(cmd: string, args: string[]): ExecResult {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function runOrThrow(cmd: string, args: string[]): void {
  const result = runCmd(cmd, args);
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Production default: `docker compose -f <composeFile> exec -T <service> …`
 * and `docker compose -f <composeFile> cp …`. `-T` disables TTY (no stdin read).
 */
export function createComposePgRunner(options: {
  composeFile: string;
  service?: string;
}): PgRunner {
  const service = options.service ?? 'postgres-feedback';
  return {
    exec: (argv: string[]): ExecResult =>
      runCmd('docker', ['compose', '-f', options.composeFile, 'exec', '-T', service, ...argv]),
    copyIn: (hostPath: string, containerPath: string): void => {
      runOrThrow('docker', [
        'compose',
        '-f',
        options.composeFile,
        'cp',
        hostPath,
        `${service}:${containerPath}`,
      ]);
    },
    copyOut: (containerPath: string, hostPath: string): void => {
      runOrThrow('docker', [
        'compose',
        '-f',
        options.composeFile,
        'cp',
        `${service}:${containerPath}`,
        hostPath,
      ]);
    },
  };
}

/** Integration harness runner against a throwaway container (`docker exec/cp`). */
export function createDockerPgRunner(containerName: string): PgRunner {
  return {
    exec: (argv: string[]): ExecResult => runCmd('docker', ['exec', containerName, ...argv]),
    copyIn: (hostPath: string, containerPath: string): void => {
      runOrThrow('docker', ['cp', hostPath, `${containerName}:${containerPath}`]);
    },
    copyOut: (containerPath: string, hostPath: string): void => {
      runOrThrow('docker', ['cp', `${containerName}:${containerPath}`, hostPath]);
    },
  };
}

/** Consistent read-only snapshot (`pg_dump -Fc --no-owner`) to a container path. */
export function pgDump(runner: PgRunner, containerPath: string, db: PgIdentity): void {
  const result = runner.exec([
    'pg_dump',
    '-Fc',
    '--no-owner',
    '-U',
    db.user,
    '-d',
    db.database,
    '-f',
    containerPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`pg_dump failed: ${result.stderr.trim()}`);
  }
}

/** Verification step: `pg_restore --list` exits 0 on a healthy archive. */
export function pgRestoreListOk(runner: PgRunner, containerPath: string): boolean {
  return runner.exec(['pg_restore', '--list', containerPath]).status === 0;
}

/** `SELECT COUNT(*)` for every base table in `public`. */
export function tableCounts(runner: PgRunner, db: PgIdentity): Record<string, number> {
  const listed = runner.exec([
    'psql',
    '-U',
    db.user,
    '-d',
    db.database,
    '-t',
    '-A',
    '-c',
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
  ]);
  if (listed.status !== 0) {
    throw new Error(`table list failed: ${listed.stderr.trim()}`);
  }
  const tables = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const counted = runner.exec([
      'psql',
      '-U',
      db.user,
      '-d',
      db.database,
      '-t',
      '-A',
      '-c',
      `SELECT COUNT(*) FROM public.${quoteIdent(table)};`,
    ]);
    if (counted.status !== 0) {
      throw new Error(`count ${table} failed: ${counted.stderr.trim()}`);
    }
    const n = Number.parseInt(counted.stdout.trim(), 10);
    if (!Number.isInteger(n)) throw new Error(`count ${table} unparseable: ${counted.stdout}`);
    counts[table] = n;
  }
  return counts;
}

/** Full drop/recreate + `pg_restore --no-owner -d` (mirrors SQLite whole-file overwrite). */
export function replaceDatabase(
  runner: PgRunner,
  db: PgIdentity,
  containerPath: string,
): void {
  const drop = runner.exec([
    'psql',
    '-U',
    db.user,
    '-d',
    'postgres',
    '-c',
    `DROP DATABASE IF EXISTS ${quoteIdent(db.database)};`,
  ]);
  if (drop.status !== 0) throw new Error(`drop failed: ${drop.stderr.trim()}`);
  const create = runner.exec([
    'psql',
    '-U',
    db.user,
    '-d',
    'postgres',
    '-c',
    `CREATE DATABASE ${quoteIdent(db.database)} OWNER ${quoteIdent(db.user)};`,
  ]);
  if (create.status !== 0) throw new Error(`create failed: ${create.stderr.trim()}`);
  const restored = runner.exec([
    'pg_restore',
    '--no-owner',
    '-U',
    db.user,
    '-d',
    db.database,
    containerPath,
  ]);
  if (restored.status !== 0) throw new Error(`pg_restore failed: ${restored.stderr.trim()}`);
}
