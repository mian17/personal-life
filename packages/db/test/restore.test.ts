import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DatabaseName } from '../src/index';
import { runRestore } from '../src/index';
import * as snapshot from '../src/snapshot';
import { main } from '../scripts/restore';

/**
 * `db:restore` contract (`SPEC-db-backup-restore` `## Restore behavior`, `## Restore
 * safety check`, `## No silent data loss`). Every fixture is a throwaway DB under the
 * OS temp dir; the stack probe is always injected, so no test opens a real port and
 * no `apps/*\/data/**` path is ever touched.
 */

const STAMP = '2026-10-01T12-34-56-789Z';
const STAMP2 = '2026-10-02T00-00-00-000Z';
const SNAPSHOT_DIR = 'backup/2026-10-01T12-34-56-789Z';

interface RestoreFixture {
  root: string;
  backupRoot: string;
  targets: Record<DatabaseName, string>;
}

const dirs: string[] = [];

function seed(path: string, rows: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE t (x INTEGER)');
    const insert = db.prepare('INSERT INTO t (x) VALUES (?)');
    for (let i = 0; i < rows; i += 1) insert.run(i);
  } finally {
    db.close();
  }
}

function countOf(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c;
  } finally {
    db.close();
  }
}

/** A repo-root stand-in: temp live targets plus a `backup/<stamp>/` snapshot dir. */
function makeRestoreFixture(): RestoreFixture {
  const root = mkdtempSync(join(tmpdir(), 'life-db-restore-'));
  dirs.push(root);
  const targets: Record<DatabaseName, string> = {
    life: join(root, 'apps', 'note-service', 'data', 'life.db'),
    tags: join(root, 'apps', 'tags-service', 'data', 'tags.db'),
    todo: join(root, 'apps', 'todo-service', 'data', 'todo.db'),
    idp: join(root, 'apps', 'idp', 'data', 'idp.db'),
    meal: join(root, 'apps', 'meal-service', 'data', 'meal.db'),
  };
  return { root, backupRoot: join(root, 'backup'), targets };
}

/** Seed one snapshot file (a valid SQLite DB) into `backup/<stamp>/<name>`. */
function snapshotPath(fx: RestoreFixture, name: DatabaseName, stamp = STAMP): string {
  return join(fx.backupRoot, stamp, `${name}.db`);
}

function envFor(fx: RestoreFixture, names: DatabaseName[] = ['life', 'tags', 'todo', 'idp', 'meal']) {
  const env: NodeJS.ProcessEnv = { INIT_CWD: fx.root };
  const vars: Record<DatabaseName, string> = {
    life: 'NOTE_DB_PATH',
    tags: 'TAGS_DB_PATH',
    todo: 'TODO_DB_PATH',
    idp: 'IDP_DB_PATH',
    meal: 'MEAL_DB_PATH',
  };
  for (const name of names) env[vars[name]] = fx.targets[name];
  return env;
}

const down = () => 'down' as const;
const up = () => 'up' as const;
const unknown = () => 'unknown' as const;
const at = () => new Date('2026-10-01T12:34:56.789Z');
const at2 = () => new Date('2026-10-02T00:00:00.000Z');

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('db:restore run', () => {
  it('replaces the live file with the verified snapshot and passes quick_check', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    const result = await runRestore({
      from: SNAPSHOT_DIR,
      env: envFor(fx),
      probe: down,
      now: at,
    });

    expect(result.replaced.map((r) => r.name)).toEqual(['life']);
    expect(countOf(fx.targets.life)).toBe(5);
    expect(result.replaced[0].snapshot).toBe(snapshotPath(fx, 'life'));

    const expectedPre = join(fx.backupRoot, `pre-restore-${STAMP}`, 'life.db');
    expect(result.replaced[0].preRestore).toBe(expectedPre);
    expect(result.preRestoreDir).toBe(join(fx.backupRoot, `pre-restore-${STAMP}`));
    expect(countOf(expectedPre)).toBe(1);
    const manifest = JSON.parse(readFileSync(join(result.preRestoreDir as string, 'manifest.json'), 'utf8'));
    expect(manifest.mode).toBe('pre-restore');
    expect(manifest.pinned).toBe(true);
    expect(manifest.databases.map((d: { name: string }) => d.name)).toEqual(['life']);
    expect(existsSync(join(result.preRestoreDir as string, 'PINNED'))).toBe(true);
  });

  it('undo proof: restoring the pre-restore snapshot returns the prior state', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    await runRestore({ from: SNAPSHOT_DIR, env: envFor(fx), probe: down, now: at });
    expect(countOf(fx.targets.life)).toBe(5);

    const undoDir = join(fx.backupRoot, `pre-restore-${STAMP}`);
    const undo = await runRestore({
      from: undoDir,
      only: ['life'],
      env: envFor(fx),
      probe: down,
      now: at2,
    });

    expect(countOf(fx.targets.life)).toBe(1);
    expect(undo.replaced[0].preRestore).toBe(
      join(fx.backupRoot, `pre-restore-${STAMP2}`, 'life.db'),
    );
  });

  it('records preRestore: null when the live target does not exist', async () => {
    const fx = makeRestoreFixture();
    seed(snapshotPath(fx, 'life'), 5);

    const result = await runRestore({ from: SNAPSHOT_DIR, env: envFor(fx), probe: down, now: at });

    expect(result.replaced[0].preRestore).toBeNull();
    expect(result.preRestoreDir).toBeNull();
    expect(countOf(fx.targets.life)).toBe(5);
  });

  it('--only restores the subset', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(fx.targets.idp, 1);
    seed(snapshotPath(fx, 'life'), 6);
    seed(snapshotPath(fx, 'idp'), 7);

    const result = await runRestore({
      from: SNAPSHOT_DIR,
      only: ['idp'],
      env: envFor(fx),
      probe: down,
      now: at,
    });

    expect(result.replaced.map((r) => r.name)).toEqual(['idp']);
    expect(countOf(fx.targets.idp)).toBe(7);
    expect(countOf(fx.targets.life)).toBe(1);
  });

  it('--only meal replaces the live meal.db from the snapshot and passes quick_check', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.meal, 1);
    seed(snapshotPath(fx, 'meal'), 9);

    const result = await runRestore({
      from: SNAPSHOT_DIR,
      only: ['meal'],
      env: envFor(fx, ['meal']),
      probe: down,
      now: at,
    });

    expect(result.replaced.map((r) => r.name)).toEqual(['meal']);
    expect(countOf(fx.targets.meal)).toBe(9);
    expect(result.replaced[0].preRestore).toBe(
      join(fx.backupRoot, `pre-restore-${STAMP}`, 'meal.db'),
    );
    expect(countOf(join(fx.backupRoot, `pre-restore-${STAMP}`, 'meal.db'))).toBe(1);
  });

  it('removes stale -wal/-shm siblings of the target', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);
    writeFileSync(`${fx.targets.life}-wal`, 'stale');
    writeFileSync(`${fx.targets.life}-shm`, 'stale');

    await runRestore({ from: SNAPSHOT_DIR, env: envFor(fx), probe: down, now: at });

    expect(existsSync(`${fx.targets.life}-wal`)).toBe(false);
    expect(existsSync(`${fx.targets.life}-shm`)).toBe(false);
  });
});

describe('db:restore safety', () => {
  it('refuses and replaces nothing when the probe reports up (exit 2)', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], envFor(fx), up)).toBe(2);
    } finally {
      err.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });

  it('refuses and replaces nothing when the probe reports unknown (exit 2)', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], envFor(fx), unknown)).toBe(2);
    } finally {
      err.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(1);
  });

  it('verifies the chosen snapshot before use (exit 1, target untouched)', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    mkdirSync(join(fx.backupRoot, STAMP), { recursive: true });
    writeFileSync(snapshotPath(fx, 'life'), 'not a database at all');

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], envFor(fx), down)).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(1);
  });

  it('aborts before touching the target when the pre-snapshot fails', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    jest.spyOn(snapshot, 'snapshotAndVerify').mockImplementation(() => {
      throw new Error('pre-snapshot failed');
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], envFor(fx), down)).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });

  it('exits 1 for a missing --from flag and for a non-existent --from directory', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main([], envFor(fx), down)).toBe(1);
      expect(await main(['--from', 'backup/nope'], envFor(fx), down)).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(fx.backupRoot)).toBe(false);
  });

  it('restores without prompting or hanging (stdin is never read)', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], envFor(fx), down)).toBe(0);
    } finally {
      log.mockRestore();
    }

    expect(countOf(fx.targets.life)).toBe(5);
  });
});

describe('db:restore --from containment', () => {
  it('refuses an absolute --from outside backup/ and writes nothing', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    const before = readFileSync(fx.targets.life);

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', join(fx.root, 'apps', 'note-service', 'data')], envFor(fx), down)).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(readFileSync(fx.targets.life)).toEqual(before);
    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });

  it('refuses a .. traversal --from that escapes backup/ and writes nothing', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    const before = readFileSync(fx.targets.life);

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(
        await main(['--from', 'backup/../apps/note-service/data'], envFor(fx), down),
      ).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(readFileSync(fx.targets.life)).toEqual(before);
    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });

  it('refuses a snapshot that resolves to the live target and writes nothing', async () => {
    const fx = makeRestoreFixture();
    seed(fx.targets.life, 1);
    seed(snapshotPath(fx, 'life'), 5);
    const before = readFileSync(fx.targets.life);
    // The live target points inside backup/, so the chosen snapshot is the live file itself.
    const env: NodeJS.ProcessEnv = { INIT_CWD: fx.root, NOTE_DB_PATH: snapshotPath(fx, 'life') };

    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--from', SNAPSHOT_DIR], env, down)).toBe(1);
    } finally {
      err.mockRestore();
    }

    expect(readFileSync(fx.targets.life)).toEqual(before);
    expect(countOf(fx.targets.life)).toBe(1);
    expect(existsSync(join(fx.backupRoot, `pre-restore-${STAMP}`))).toBe(false);
  });
});
