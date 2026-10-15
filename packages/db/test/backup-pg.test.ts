import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { main, runBackupPg } from '../src/backup-pg';
import type { PgBackupManifest, PgManifestEntry } from '../src/backup-pg';
import type { PgRunner } from '../src/pg-client';

/**
 * `db:backup:pg` contract (`SPEC-feedback-infra.md` "Backup behavior", "Naming,
 * manifest, retention", "Exit codes"). Every fixture is a throwaway `backup/`
 * root under the OS temp dir and a **fake `PgRunner`** that records argv and
 * returns canned stdout — no Docker, no real Postgres client.
 */

const STAMP = '2026-10-01T12-34-56-789Z';
const DB = 'feedback';

/** Canned stdout that satisfies `tableCounts`' table list + per-table COUNT(*). */
const TABLE_NAMES = ['events', 'notes'];
const TABLE_COUNTS: Record<string, number> = { events: 3, notes: 5 };
const TABLE_LIST_STDOUT = `${TABLE_NAMES.join('\n')}\n`;

interface FakeRunner extends PgRunner {
  calls: string[][];
  copies: Array<{ from: string; to: string }>;
}

/**
 * Fake runner: records every `exec` argv, echoes the table list for the
 * `pg_tables` query and a count for `COUNT(*)`, answers `pg_restore --list`
 * from `restoreListOk`, and makes `copyOut` land a small archive file.
 */
function makeRunner(options: { restoreListOk?: boolean } = {}): FakeRunner {
  const restoreListOk = options.restoreListOk ?? true;
  const runner: FakeRunner = {
    calls: [],
    copies: [],
    exec(argv: string[]): { status: number; stdout: string; stderr: string } {
      runner.calls.push(argv);
      const sql = argv[argv.length - 1] ?? '';
      if (argv[0] === 'pg_restore' && argv[1] === '--list') {
        return { status: restoreListOk ? 0 : 1, stdout: '', stderr: 'bad dump' };
      }
      if (sql.includes('pg_tables')) return { status: 0, stdout: TABLE_LIST_STDOUT, stderr: '' };
      if (sql.includes('COUNT(*)')) {
        const table = TABLE_NAMES.find((name) => sql.includes(`public."${name}"`)) ?? '';
        return { status: 0, stdout: `${TABLE_COUNTS[table] ?? 0}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    copyIn(): void {
      throw new Error('backup must never copy in');
    },
    copyOut(containerPath: string, hostPath: string): void {
      runner.copies.push({ from: containerPath, to: hostPath });
      mkdirSync(join(hostPath, '..'), { recursive: true });
      writeFileSync(hostPath, 'FAKE-PG-DUMP');
    },
  };
  return runner;
}

const at = () => new Date('2026-10-01T12:34:56.789Z');

function makeFixture(): { root: string; backupRoot: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), 'life-db-backup-pg-'));
  return { root, backupRoot: join(root, 'backup'), env: { INIT_CWD: root } };
}

function readManifestOf(dir: string): PgBackupManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PgBackupManifest;
}

function seedDir(
  backupRoot: string,
  name: string,
  options: { mode?: string; pinned?: boolean; marker?: boolean; manifest?: boolean } = {},
): string {
  const dir = join(backupRoot, name);
  mkdirSync(dir, { recursive: true });
  if (options.manifest !== false) {
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ mode: options.mode ?? 'routine', pinned: options.pinned ?? false }),
    );
  }
  if (options.marker) writeFileSync(join(dir, 'PINNED'), '');
  return dir;
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('runBackupPg naming + manifest', () => {
  it('writes the UTC stamp directory and <database>.dump via the container temp path', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const runner = makeRunner();

    const result = runBackupPg({ argv: [], env: fx.env, runner, now: at });

    expect(result.destination).toBe(join(fx.backupRoot, STAMP));
    expect(result.mode).toBe('routine');
    expect(existsSync(join(fx.backupRoot, STAMP, `${DB}.dump`))).toBe(true);

    expect(runner.copies).toEqual([
      { from: `/tmp/db-backup-${STAMP}/${DB}.dump`, to: join(fx.backupRoot, STAMP, `${DB}.dump`) },
    ]);
    const dump = runner.calls.find((argv) => argv[0] === 'pg_dump');
    expect(dump).toEqual([
      'pg_dump',
      '-Fc',
      '--no-owner',
      '-U',
      DB,
      '-d',
      DB,
      '-f',
      `/tmp/db-backup-${STAMP}/${DB}.dump`,
    ]);
  });

  it('records the SQLite-parity manifest shape with pgRestoreList + tables', () => {
    const fx = makeFixture();
    dirs.push(fx.root);

    const result = runBackupPg({ argv: [], env: fx.env, runner: makeRunner(), now: at });
    const manifest = readManifestOf(result.destination);

    expect(manifest.mode).toBe('routine');
    expect(manifest.createdAt).toBe('2026-10-01T12:34:56.789Z');
    expect(manifest.pinned).toBe(false);
    expect(manifest.databases).toHaveLength(1);

    const entry = manifest.databases[0] as PgManifestEntry;
    expect(entry.name).toBe(DB);
    expect(entry.file).toBe(`${DB}.dump`);
    expect(entry.source).toBe(DB);
    expect(entry.pgRestoreList).toBe('ok');
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.tables).toEqual(TABLE_COUNTS);
    expect(result.snapshots[0]).toEqual(entry);
  });

  it('--only feedback is accepted and the archived file is feedback.dump', () => {
    const fx = makeFixture();
    dirs.push(fx.root);

    const result = runBackupPg({
      argv: ['--only', 'feedback'],
      env: fx.env,
      runner: makeRunner(),
      now: at,
    });

    expect(result.snapshots.map((s) => s.file)).toEqual(['feedback.dump']);
    expect(existsSync(join(result.destination, 'feedback.dump'))).toBe(true);
  });

  it('exits 1 on an unknown --only name before any write', () => {
    const fx = makeFixture();
    dirs.push(fx.root);

    expect(() =>
      runBackupPg({ argv: ['--only', 'nope'], env: fx.env, runner: makeRunner(), now: at }),
    ).toThrow(/unknown database name: nope/);
    expect(existsSync(fx.backupRoot)).toBe(false);
  });

  it('refuses an existing destination', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    mkdirSync(join(fx.backupRoot, STAMP), { recursive: true });

    expect(() => runBackupPg({ argv: [], env: fx.env, runner: makeRunner(), now: at })).toThrow(
      /destination already exists/,
    );
  });
});

describe('--pin', () => {
  it('is deliberate, `-pinned` by name, and writes a PINNED marker', () => {
    const fx = makeFixture();
    dirs.push(fx.root);

    const result = runBackupPg({ argv: ['--pin'], env: fx.env, runner: makeRunner(), now: at });

    expect(result.destination).toBe(join(fx.backupRoot, `${STAMP}-pinned`));
    expect(basename(result.destination)).toContain('-pinned');
    expect(existsSync(join(result.destination, 'PINNED'))).toBe(true);

    const manifest = readManifestOf(result.destination);
    expect(manifest.mode).toBe('deliberate');
    expect(manifest.pinned).toBe(true);
  });
});

describe('retention (reused pruneRoutineSnapshots)', () => {
  it('prunes routine snapshots to the newest 10 and never touches pinned/deliberate/pre-restore/manifest-less', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const names = Array.from({ length: 10 }, (_, i) => `2026-10-01T00-00-00-00${i}Z`);
    for (const name of names) seedDir(fx.backupRoot, name);
    const pinned = seedDir(fx.backupRoot, '2026-09-30T00-00-00-000Z-pinned', {
      mode: 'deliberate',
      pinned: true,
      marker: true,
    });
    const manifestless = seedDir(fx.backupRoot, '2026-09-30T00-00-00-001Z', { manifest: false });
    const preRestore = seedDir(fx.backupRoot, 'pre-restore-2026-09-30T00-00-00-002Z', {
      mode: 'pre-restore',
      pinned: true,
      marker: true,
    });

    runBackupPg({ argv: [], env: fx.env, runner: makeRunner(), now: at });

    const kept = readdirSync(fx.backupRoot).filter((n) => names.includes(n));
    expect(kept).toEqual(names.slice(1));
    expect(existsSync(join(fx.backupRoot, names[0]))).toBe(false);
    expect(existsSync(pinned)).toBe(true);
    expect(existsSync(manifestless)).toBe(true);
    expect(existsSync(preRestore)).toBe(true);
    expect(existsSync(join(fx.backupRoot, STAMP))).toBe(true);
  });

  it('a --pin run never prunes', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const names = Array.from({ length: 10 }, (_, i) => `2026-10-01T00-00-00-00${i}Z`);
    for (const name of names) seedDir(fx.backupRoot, name);

    runBackupPg({ argv: ['--pin'], env: fx.env, runner: makeRunner(), now: at });

    expect(readdirSync(fx.backupRoot).filter((n) => names.includes(n))).toEqual(names);
  });
});

describe('CLI exit codes', () => {
  it('returns 1 with nothing written for an unknown --only name', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const errors: string[] = [];
    const original = console.error;
    console.error = ((line: string) => errors.push(line)) as typeof console.error;
    let code: number;
    try {
      code = main(['--only', 'nope'], fx.env, makeRunner());
    } finally {
      console.error = original;
    }
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('unknown database name: nope');
    expect(existsSync(fx.backupRoot)).toBe(false);
  });

  it('is deterministic across repeated identical runs (same argv+now → same exit code and line)', () => {
    const fx1 = makeFixture();
    const fx2 = makeFixture();
    dirs.push(fx1.root, fx2.root);
    const lines: string[] = [];
    const original = console.log;
    console.log = ((line: string) => lines.push(line)) as typeof console.log;
    const codes: number[] = [];
    try {
      codes.push(main([], fx1.env, makeRunner(), at));
      codes.push(main([], fx2.env, makeRunner(), at));
    } finally {
      console.log = original;
    }
    expect(codes).toEqual([0, 0]);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain('db:backup:pg [routine] feedback.dump -> ');
      expect(line).toContain('pg_restore_list=ok');
    }
  });

  it('exits 1 when pg_restore --list fails, without a success line', () => {
    const fx = makeFixture();
    dirs.push(fx.root);
    const errors: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = ((line: string) => errors.push(line)) as typeof console.error;
    console.log = (() => undefined) as typeof console.log;
    let code: number;
    try {
      code = main([], fx.env, makeRunner({ restoreListOk: false }));
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('pg_restore --list failed');
    expect(existsSync(join(fx.backupRoot, STAMP, 'manifest.json'))).toBe(false);
  });
});
