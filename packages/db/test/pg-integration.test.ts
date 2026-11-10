import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackupPg } from '../src/backup-pg.js';
import type { PgBackupManifest } from '../src/backup-pg.js';
import { createDockerPgRunner } from '../src/pg-client.js';
import type { PgRunner } from '../src/pg-client.js';
import { runRestorePg } from '../src/restore-pg.js';

/**
 * `db:restore:pg` integration (`SPEC-feedback-infra.md` "Testing Strategy"): a throwaway
 * `postgres:17-alpine` container, a real `pg_dump`/`pg_restore`, the undo proof — seed,
 * back up, mutate, restore, and the prior state returns with the manifest's row counts.
 *
 * Skipped (never failed) when Docker or the image is unavailable, with the reason on
 * stderr; a container that does start but never answers is a failure, not a skip. Never
 * touches an application data directory or the production compose services: the
 * container name is fixed and force-removed on both sides of the run.
 */

jest.setTimeout(300_000);

const CONTAINER = 'feedback-pg-test';
const IMAGE = 'postgres:17-alpine';
const BACKUP_STAMP = '2026-10-01T12-34-56-789Z';
const RESTORE_STAMP = '2026-10-01T13-00-00-000Z';

/**
 * Every `docker` call is bounded. `spawnSync` parks the event loop, so a stalled daemon
 * or a cold registry pull outlives any jest timer and ends as a silent hook timeout
 * rather than a diagnostic. These are the slowest each phase may be; a normal run
 * finishes far below them (measured timings in the PR description).
 */
const PULL_TIMEOUT_MS = 240_000;
const RUN_TIMEOUT_MS = 60_000;
const EXEC_TIMEOUT_MS = 15_000;
const READY_DEADLINE_MS = 120_000;
/**
 * Worst case the hook may spend before the test body starts. The image pull runs in the
 * capability probe at module scope, before jest owns the clock, so it is not on this
 * budget.
 */
const STARTUP_TIMEOUT_MS = RUN_TIMEOUT_MS + READY_DEADLINE_MS + 30_000;

/**
 * Run one `docker` command, killing it after `timeout`. A killed call reports the
 * timeout in `stderr`, so a silent non-zero exit is never mistaken for an empty
 * docker error message.
 */
function docker(
  args: string[],
  timeout = EXEC_TIMEOUT_MS,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
  const timedOut = result.error?.message.includes('ETIMEDOUT') ?? false;
  const stderr = result.stderr ?? '';
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: timedOut ? `docker ${args[0]} timed out after ${timeout}ms ${stderr}`.trim() : stderr,
  };
}

/**
 * "Can this machine host the throwaway database": a reachable daemon and a local image,
 * not merely an installed docker CLI — which a runner has even when its shared daemon
 * never hands over a container. Returns the reason it cannot, or `null` when it can.
 */
function hostCapabilityFailure(): string | null {
  const version = docker(['version']);
  if (version.status !== 0) return `docker unavailable: ${version.stderr.trim()}`;
  const pull = docker(['pull', IMAGE], PULL_TIMEOUT_MS);
  if (pull.status !== 0) return `image ${IMAGE} unavailable: ${pull.stderr.trim()}`;
  return null;
}

// Probed at module scope because `describe.skip` is the only way jest reports a suite as
// skipped, and that choice can only be made before the run starts.
const capabilityFailure = hostCapabilityFailure();
if (capabilityFailure !== null) console.warn(`pg integration skipped: ${capabilityFailure}`);
const describeDocker = capabilityFailure === null ? describe : describe.skip;

/**
 * Poll until the postmaster accepts a TCP connection. Bounded by wall clock, not by an
 * attempt count: every probe carries its own ceiling, so the loop stops at
 * `READY_DEADLINE_MS` however slow the daemon is.
 */
async function waitForPostmaster(): Promise<void> {
  const deadline = Date.now() + READY_DEADLINE_MS;
  let lastProbe = 'not probed';
  while (Date.now() < deadline) {
    const budget = Math.min(EXEC_TIMEOUT_MS, Math.max(1_000, deadline - Date.now()));
    // The entrypoint's temporary bootstrap server answers on the unix socket
    // only, so `pg_isready` — and a socket `psql` — report ready seconds before
    // the real postmaster accepts connections. Probe TCP instead: `-h 127.0.0.1`
    // only answers once the postmaster that outlives the entrypoint is up.
    const probe = docker(
      [
        'exec',
        CONTAINER,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'feedback',
        '-c',
        'select 1',
      ],
      budget,
    );
    if (probe.status === 0) return;
    lastProbe = probe.stderr.trim() || `exit ${String(probe.status)}`;
    await new Promise((settle) => setTimeout(settle, 1_000));
  }
  throw new Error(`postgres never became ready in ${READY_DEADLINE_MS}ms: ${lastProbe}`);
}

describeDocker('pg backup/restore against a throwaway container', () => {
  let root = '';
  let runner: PgRunner;
  // The throwaway container holds the `feedback` database only, so this run dumps and
  // restores that one; the two-database path is the fake-runner suites' subject.
  const env = () => ({
    INIT_CWD: root,
    FEEDBACK_DB_URL: 'postgresql://postgres@postgres-feedback:5432/feedback',
  });

  beforeAll(async () => {
    docker(['rm', '-f', CONTAINER], RUN_TIMEOUT_MS);
    const started = docker(
      [
        'run',
        '--rm',
        '-d',
        '--name',
        CONTAINER,
        '-e',
        'POSTGRES_USER=postgres',
        '-e',
        'POSTGRES_PASSWORD=test-only',
        '-e',
        'POSTGRES_DB=feedback',
        IMAGE,
      ],
      RUN_TIMEOUT_MS,
    );
    if (started.status !== 0) throw new Error(`container start failed: ${started.stderr}`);

    await waitForPostmaster();

    runner = createDockerPgRunner(CONTAINER);
    root = mkdtempSync(join(tmpdir(), 'life-db-pg-int-'));
  }, STARTUP_TIMEOUT_MS);

  afterAll(() => {
    docker(['rm', '-f', CONTAINER], RUN_TIMEOUT_MS);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function sql(statement: string): void {
    const result = runner.exec(['psql', '-U', 'postgres', '-d', 'feedback', '-c', statement]);
    if (result.status !== 0) throw new Error(`sql failed: ${statement} — ${result.stderr.trim()}`);
  }

  function countItems(): number {
    const result = runner.exec([
      'psql',
      '-U',
      'postgres',
      '-d',
      'feedback',
      '-t',
      '-A',
      '-c',
      'SELECT COUNT(*) FROM public."items";',
    ]);
    if (result.status !== 0) throw new Error(`count failed: ${result.stderr.trim()}`);
    return Number.parseInt(result.stdout.trim(), 10);
  }

  it('restores the prior state with the manifest row counts (the undo proof)', async () => {
    sql('DROP TABLE IF EXISTS public."items";');
    sql('CREATE TABLE public."items" (id serial PRIMARY KEY, note text NOT NULL);');
    sql("INSERT INTO public.\"items\" (note) VALUES ('a'), ('b'), ('c');");

    const backup = runBackupPg({
      argv: ['--only', 'feedback'],
      env: env(),
      runner,
      now: () => new Date('2026-10-01T12:34:56.789Z'),
    });

    const manifest = JSON.parse(
      readFileSync(join(backup.destination, 'manifest.json'), 'utf8'),
    ) as PgBackupManifest;
    expect(manifest.databases[0]?.pgRestoreList).toBe('ok');
    expect(manifest.databases[0]?.tables).toEqual({ items: 3 });

    sql("INSERT INTO public.\"items\" (note) VALUES ('d'), ('e');");
    expect(countItems()).toBe(5);

    const restore = await runRestorePg({
      from: `backup/${BACKUP_STAMP}`,
      env: env(),
      runner,
      probe: () => 'down',
      now: () => new Date('2026-10-01T13:00:00.000Z'),
    });

    expect(countItems()).toBe(3);
    expect(restore.preRestoreDir).toBe(join(root, 'backup', `pre-restore-${RESTORE_STAMP}`));
    expect(existsSync(join(restore.preRestoreDir, 'feedback.dump'))).toBe(true);
    expect(existsSync(join(restore.preRestoreDir, 'PINNED'))).toBe(true);

    // The undo path really is the state we restored away from: 5 rows in the pre-restore
    // snapshot, 3 in the chosen one — restoring the pre-restore dump returns the database
    // to 5 (the SQLite "no silent data loss" guarantee, verified end to end).
    const pre = JSON.parse(
      readFileSync(join(restore.preRestoreDir, 'manifest.json'), 'utf8'),
    ) as PgBackupManifest;
    expect(pre.mode).toBe('pre-restore');
    expect(pre.pinned).toBe(true);
    expect(pre.databases[0]?.tables).toEqual({ items: 5 });

    await runRestorePg({
      from: `backup/pre-restore-${RESTORE_STAMP}`,
      env: env(),
      runner,
      probe: () => 'down',
      now: () => new Date('2026-10-01T13:30:00.000Z'),
    });
    expect(countItems()).toBe(5);
  });
});
