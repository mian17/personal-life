import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackupPg } from '../src/backup-pg';
import type { PgBackupManifest } from '../src/backup-pg';
import { createDockerPgRunner } from '../src/pg-client';
import type { PgRunner } from '../src/pg-client';
import { runRestorePg } from '../src/restore-pg';

/**
 * `db:restore:pg` integration (`SPEC-feedback-infra.md` "Testing Strategy"): a throwaway
 * `postgres:17-alpine` container, a real `pg_dump`/`pg_restore`, the undo proof — seed,
 * back up, mutate, restore, and the prior state returns with the manifest's row counts.
 *
 * Skipped (never failed) when Docker is unavailable. Never touches an application data
 * directory or the production compose services: the container name is fixed and
 * force-removed on both sides of the run.
 */

jest.setTimeout(300_000);

const CONTAINER = 'feedback-pg-test';
const IMAGE = 'postgres:17-alpine';
const BACKUP_STAMP = '2026-10-01T12-34-56-789Z';
const RESTORE_STAMP = '2026-10-01T13-00-00-000Z';

const dockerAvailable = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
const describeDocker = dockerAvailable ? describe : describe.skip;

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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
    docker(['rm', '-f', CONTAINER]);
    const started = docker([
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
    ]);
    if (started.status !== 0) throw new Error(`container start failed: ${started.stderr}`);

    // The entrypoint's temporary bootstrap server answers on the unix socket
    // only, so `pg_isready` — and a socket `psql` — report ready seconds before
    // the real postmaster accepts connections. Probe TCP instead: `-h 127.0.0.1`
    // only answers once the postmaster that outlives the entrypoint is up.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = docker(['exec', CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'feedback', '-c', 'select 1']);
      if (probe.status === 0) break;
      await new Promise((settle) => setTimeout(settle, 1000));
      if (attempt === 59) throw new Error(`postgres never became ready: ${probe.stderr.trim()}`);
    }

    runner = createDockerPgRunner(CONTAINER);
    root = mkdtempSync(join(tmpdir(), 'life-db-pg-int-'));
  });

  afterAll(() => {
    docker(['rm', '-f', CONTAINER]);
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