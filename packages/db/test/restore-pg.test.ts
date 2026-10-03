import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, runRestorePg } from '../src/restore-pg';
import type { PgManifestEntry } from '../src/backup-pg';
import type { PgRunner } from '../src/pg-client';

/**
 * `db:restore:pg` contract (`SPEC-feedback-infra.md` "Restore behavior", "Restore safety
 * check", "Testing Strategy"). Every fixture is a throwaway `backup/` root under the OS
 * temp dir, a **fake `PgRunner`** that records argv and returns canned stdout, and an
 * injected probe — no Docker, no real Postgres client, no real port.
 */

const STAMP = '2026-10-01T12-34-56-789Z';
const DB = 'feedback';
const SNAPSHOT_NAME = STAMP;
const at = () => new Date('2026-10-01T12:34:56.789Z');

const TABLE_NAMES = ['events', 'notes'];
const TABLE_COUNTS: Record<string, number> = { events: 3, notes: 5 };
const TABLE_LIST_STDOUT = `${TABLE_NAMES.join('\n')}\n`;

interface FakeRunner extends PgRunner {
  calls: string[][];
  copiesIn: Array<{ from: string; to: string }>;
  copiesOut: Array<{ from: string; to: string }>;
}

/**
 * Fake runner: records argv/copies. Echoes the table list for the `pg_tables` query and
 * a count for `COUNT(*)` (`counts`), answers `pg_restore --list` from `restoreListOk`,
 * the DB-native "in use" query from `otherBackends`, and lands a small archive file for
 * `copyOut`.
 */
function makeRunner(
  options: { restoreListOk?: boolean; otherBackends?: number; counts?: Record<string, number> } = {},
): FakeRunner {
  const restoreListOk = options.restoreListOk ?? true;
  const otherBackends = options.otherBackends ?? 0;
  const counts = options.counts ?? TABLE_COUNTS;
  const runner: FakeRunner = {
    calls: [],
    copiesIn: [],
    copiesOut: [],
    exec(argv: string[]): { status: number; stdout: string; stderr: string } {
      runner.calls.push(argv);
      const sql = argv[argv.length - 1] ?? '';
      if (argv[0] === 'pg_restore' && argv[1] === '--list') {
        return { status: restoreListOk ? 0 : 1, stdout: '', stderr: 'bad dump' };
      }
      if (sql.includes('pg_stat_activity')) {
        return { status: 0, stdout: `${otherBackends}\n`, stderr: '' };
      }
      if (sql.includes('pg_tables')) return { status: 0, stdout: TABLE_LIST_STDOUT, stderr: '' };
      if (sql.includes('COUNT(*)')) {
        const table = TABLE_NAMES.find((name) => sql.includes(`public."${name}"`)) ?? '';
        return { status: 0, stdout: `${counts[table] ?? 0}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    copyIn(from: string, to: string): void {
      runner.copiesIn.push({ from, to });
    },
    copyOut(from: string, to: string): void {
      runner.copiesOut.push({ from, to });
      mkdirSync(join(to, '..'), { recursive: true });
      writeFileSync(to, 'FAKE-PG-DUMP');
    },
  };
  return runner;
}

function makeFixture(): { root: string; backupRoot: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), 'life-db-restore-pg-'));
  return { root, backupRoot: join(root, 'backup'), env: { INIT_CWD: root } };
}

function makeSnapshotManifest(tables: Record<string, number>): object {
  return {
    mode: 'routine',
    createdAt: '2026-10-01T00:00:00.000Z',
    pinned: false,
    databases: [
      { name: DB, file: `${DB}.dump`, source: DB, bytes: 14, pgRestoreList: 'ok', tables },
    ],
  };
}

/**
 * Seed a snapshot directory under `backup/` with a `feedback.dump` and (unless
 * `manifest: false`) a backup-shape `manifest.json`.
 */
function seedSnapshot(
  backupRoot: string,
  name: string,
  options: { tables?: Record<string, number>; manifest?: boolean } = {},
): string {
  const dir = join(backupRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${DB}.dump`), 'FAKE-SNAPSHOT-DUMP');
  if (options.manifest !== false) {
    writeFileSync(
      join(dir, 'manifest.json'),
      `${JSON.stringify(makeSnapshotManifest(options.tables ?? TABLE_COUNTS), null, 2)}\n`,
    );
  }
  return dir;
}

/** Run a CLI call capturing stdout/stderr; returns `{ code, out, err }`. */
async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  runner: PgRunner,
  probe: () => 'up' | 'down' | 'unknown',
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = ((line: string) => out.push(line)) as typeof console.log;
  console.error = ((line: string) => err.push(line)) as typeof console.error;
  try {
    return { code: await main(argv, env, runner, probe, at), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

/** Index of the first recorded `psql -c` statement containing `needle`. */
function sqlIndex(runner: FakeRunner, needle: string): number {
  return runner.calls.findIndex((argv) => argv.includes('-c') && (argv[argv.length - 1] ?? '').includes(needle));
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('runRestorePg happy path', () => {
  it('takes a verified pinned pre-restore snapshot, replaces, and verifies counts', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);
    const runner = makeRunner();

    const result = await runRestorePg({
      from: `backup/${SNAPSHOT_NAME}`,
      env: fx.env,
      runner,
      probe: () => 'down',
      now: at,
    });

    // The snapshot crossed into the container and passed pg_restore --list.
    expect(runner.copiesIn).toEqual([
      {
        from: join(fx.root, 'backup', SNAPSHOT_NAME, `${DB}.dump`),
        to: `/tmp/db-restore-${STAMP}/${DB}.dump`,
      },
    ]);
    expect(runner.calls.some((argv) => argv[0] === 'pg_restore' && argv[1] === '--list')).toBe(true);

    // The pre-restore snapshot is pinned and manifest-tagged as pre-restore.
    expect(result.preRestoreDir).toBe(join(fx.backupRoot, `pre-restore-${STAMP}`));
    expect(existsSync(join(result.preRestoreDir, `${DB}.dump`))).toBe(true);
    expect(existsSync(join(result.preRestoreDir, 'PINNED'))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(result.preRestoreDir, 'manifest.json'), 'utf8'),
    ) as { mode: string; pinned: boolean; databases: PgManifestEntry[] };
    expect(manifest.mode).toBe('pre-restore');
    expect(manifest.pinned).toBe(true);
    expect(manifest.databases[0]?.pgRestoreList).toBe('ok');
    expect(manifest.databases[0]?.tables).toEqual(TABLE_COUNTS);

    // Replacement ran after the snapshot: DROP/CREATE + pg_restore with --no-owner.
    expect(sqlIndex(runner, 'DROP DATABASE')).toBeGreaterThan(-1);
    expect(sqlIndex(runner, 'CREATE DATABASE')).toBeGreaterThan(-1);
    const restore = runner.calls.find(
      (argv) => argv[0] === 'pg_restore' && !argv.includes('--list'),
    );
    expect(restore).toContain('--no-owner');
    expect(restore).toContain(`/tmp/db-restore-${STAMP}/${DB}.dump`);
  });

  it('prints one line per restored database and returns 0', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);

    const { code, out } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      makeRunner(),
      () => 'down',
    );

    expect(code).toBe(0);
    expect(out).toContain(`db:restore:pg ${DB} <- `);
    expect(out).toContain('pg_restore_list=ok');
    expect(out).toContain(`pre_restore=${join(fx.backupRoot, `pre-restore-${STAMP}`, `${DB}.dump`)}`);
  });

  it('--only feedback restores the database; an unknown name exits 1 before any write', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);

    const ok = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`, '--only', DB],
      fx.env,
      makeRunner(),
      () => 'down',
    );
    expect(ok.code).toBe(0);

    const runner = makeRunner();
    const bad = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`, '--only', 'nope'],
      fx.env,
      runner,
      () => 'down',
    );
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown database name: nope');
    expect(runner.calls).toEqual([]);
  });
});

describe('runRestorePg fail-closed preconditions (touching nothing)', () => {
  it.each(['up', 'unknown'] as const)('probe %s exits 2 and replaces nothing', async (state) => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);
    const runner = makeRunner();

    const { code, err } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      runner,
      () => state,
    );

    expect(code).toBe(2);
    expect(err).toContain('127.0.0.1:3002');
    expect(runner.calls.some((argv) => argv[0] === 'pg_dump')).toBe(false);
    expect(sqlIndex(runner, 'DROP DATABASE')).toBe(-1);
    expect(runner.copiesOut).toEqual([]);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });

  it('a non-zero DB-native client count exits 2 and replaces nothing', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);
    const runner = makeRunner({ otherBackends: 1 });

    const { code, err } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      runner,
      () => 'down',
    );

    expect(code).toBe(2);
    expect(err).toContain(`database ${DB} has other clients`);
    expect(runner.calls.some((argv) => argv[0] === 'pg_dump')).toBe(false);
    expect(sqlIndex(runner, 'DROP DATABASE')).toBe(-1);
  });

  it('a failing pg_restore --list exits 1 and replaces nothing', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);
    const runner = makeRunner({ restoreListOk: false });

    const { code, err } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      runner,
      () => 'down',
    );

    expect(code).toBe(1);
    expect(err).toContain('pg_restore --list failed');
    expect(runner.calls.some((argv) => argv[0] === 'pg_dump')).toBe(false);
    expect(sqlIndex(runner, 'DROP DATABASE')).toBe(-1);
    expect(runner.copiesOut).toEqual([]);
  });

  it('--from outside backup/ exits 1', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const outside = mkdtempSync(join(tmpdir(), 'life-db-restore-pg-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, `${DB}.dump`), 'FAKE');
    const runner = makeRunner();

    const { code, err } = await runCli(
      ['--from', outside],
      fx.env,
      runner,
      () => 'down',
    );

    expect(code).toBe(1);
    expect(err).toContain(`must be under ${join(fx.root, 'backup')}`);
    expect(runner.calls).toEqual([]);
  });

  it('a missing --from exits 1 without a runner call', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const runner = makeRunner();

    const { code, err } = await runCli([], fx.env, runner, () => 'down');

    expect(code).toBe(1);
    expect(err).toContain('--from requires a snapshot directory');
    expect(runner.calls).toEqual([]);
  });

  it('a snapshot directory without the dump exits 1', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME, { manifest: true });
    rmSync(join(fx.backupRoot, SNAPSHOT_NAME, `${DB}.dump`));
    const runner = makeRunner();

    const { code, err } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      runner,
      () => 'down',
    );

    expect(code).toBe(1);
    expect(err).toContain('snapshot file does not exist');
    expect(runner.calls).toEqual([]);
  });
});

describe('runRestorePg ordering and post-write verification', () => {
  it('takes the pre-restore snapshot before the target is dropped', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME);
    const runner = makeRunner();

    await runRestorePg({
      from: `backup/${SNAPSHOT_NAME}`,
      env: fx.env,
      runner,
      probe: () => 'down',
      now: at,
    });

    const dumpIndex = runner.calls.findIndex((argv) => argv[0] === 'pg_dump');
    const preListIndex = runner.calls.findIndex(
      (argv) => argv[0] === 'pg_restore' && argv[1] === '--list' && argv[2]?.includes('db-pre-restore'),
    );
    const dropIndex = sqlIndex(runner, 'DROP DATABASE');
    expect(dumpIndex).toBeGreaterThan(-1);
    expect(preListIndex).toBeGreaterThan(-1);
    expect(runner.copiesOut[0]?.to).toBe(join(fx.backupRoot, `pre-restore-${STAMP}`, `${DB}.dump`));
    expect(dumpIndex).toBeLessThan(dropIndex);
    expect(preListIndex).toBeLessThan(dropIndex);
  });

  it('a row-count mismatch exits 1 and names the pre-restore recovery path', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME, { tables: { notes: 5 } });
    const runner = makeRunner({ counts: { events: 3, notes: 4 } });

    const { code, err } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      runner,
      () => 'down',
    );

    expect(code).toBe(1);
    expect(err).toContain('row count mismatch on notes: expected 5, got 4');
    expect(err).toContain(`recover from ${join(fx.backupRoot, `pre-restore-${STAMP}`, `${DB}.dump`)}`);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`, 'PINNED'))).toBe(true);
    expect(sqlIndex(runner, 'DROP DATABASE')).toBeGreaterThan(-1);
  });

  it('an unreadable/missing snapshot manifest skips the comparison and still succeeds', async () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    seedSnapshot(fx.backupRoot, SNAPSHOT_NAME, { manifest: false });

    const { code } = await runCli(
      ['--from', `backup/${SNAPSHOT_NAME}`],
      fx.env,
      makeRunner({ counts: { events: 0, notes: 0 } }),
      () => 'down',
    );

    expect(code).toBe(0);
  });
});
