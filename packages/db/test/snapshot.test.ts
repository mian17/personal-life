import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { snapshotAndVerify, uniqueSnapshotPath, verifyDatabase } from '../src/index';

/**
 * `@life/db` snapshot primitive (plan T3): the shared `VACUUM INTO` + `quick_check`
 * proof. Every fixture lives in a fresh `mkdtempSync(tmpdir())` directory — no
 * `apps/*\/data/**` path is ever opened.
 */

const ISO = '2026-10-01T12:34:56.789Z';
let dir: string;

function seed(path: string, rows: number): void {
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
    return (db.prepare('SELECT COUNT(*) AS c FROM "t"').get() as { c: number }).c;
  } finally {
    db.close();
  }
}

type Prepare = (this: Database.Database, sql: string) => Database.Statement;

/** Intercept `Database#prepare` for connections the predicate selects; `fake` supplies the statement. */
function mockPrepare(
  match: (db: Database.Database, sql: string) => boolean,
  fake: () => unknown,
): void {
  const original = Database.prototype.prepare as unknown as Prepare;
  jest.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string,
  ) {
    if (match(this, sql)) return fake() as Database.Statement;
    return original.call(this, sql);
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-db-snapshot-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('uniqueSnapshotPath', () => {
  it('is UTC, millisecond, filename-safe, and composes <source>.<suffix>-<stamp>', () => {
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(ISO);
    expect(uniqueSnapshotPath('life.db', 'app')).toBe('life.db.app-2026-10-01T12-34-56-789Z');
  });

  it('falls back to a numeric suffix rather than returning an existing path', () => {
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(ISO);
    const source = join(dir, 'life.db');
    seed(source, 1);
    const first = `${source}.bak-2026-10-01T12-34-56-789Z`;

    const a = uniqueSnapshotPath(source, 'bak');
    expect(a).toBe(first);
    expect(existsSync(a)).toBe(false);

    writeFileSync(a, 'occupied');
    const b = uniqueSnapshotPath(source, 'bak');
    expect(b).toBe(`${first}-1`);
    expect(existsSync(b)).toBe(false);

    writeFileSync(b, 'occupied');
    const c = uniqueSnapshotPath(source, 'bak');
    expect(c).toBe(`${first}-2`);
    expect(existsSync(c)).toBe(false);
  });
});

describe('snapshotAndVerify', () => {
  it('copies, both source and copy pass quick_check, and the source bytes + mtime are unchanged', () => {
    const source = join(dir, 'life.db');
    seed(source, 3);
    const before = readFileSync(source);
    const beforeMtime = statSync(source).mtimeMs;

    const result = snapshotAndVerify(source, join(dir, 'nested', 'copy.db'));

    expect(result.backupPath).toBe(join(dir, 'nested', 'copy.db'));
    expect(result.quickCheck).toBe('ok');
    expect(result.rowCounts).toEqual({});
    expect(existsSync(result.backupPath)).toBe(true);
    expect(verifyDatabase(source)).toBe('ok');
    expect(verifyDatabase(result.backupPath)).toBe('ok');
    expect(countOf(result.backupPath)).toBe(3);
    expect(readFileSync(source).equals(before)).toBe(true);
    expect(statSync(source).mtimeMs).toBe(beforeMtime);
  });

  it('reports the requested rowCountTables', () => {
    const source = join(dir, 'life.db');
    seed(source, 2);

    const result = snapshotAndVerify(source, join(dir, 'copy.db'), { rowCountTables: ['t'] });
    expect(result.rowCounts).toEqual({ t: 2 });
    expect(countOf(result.backupPath)).toBe(2);
  });

  it('throws when a rowCountTables count differs between source and copy', () => {
    const source = join(dir, 'life.db');
    seed(source, 2);

    mockPrepare(
      (db, sql) => db.name !== source && /COUNT\(\*\)/.test(sql),
      () => ({ get: () => ({ c: 999 }) }),
    );

    expect(() =>
      snapshotAndVerify(source, join(dir, 'copy.db'), { rowCountTables: ['t'] }),
    ).toThrow(/count mismatch/);
  });

  it('throws when the target already exists (VACUUM INTO refuses it)', () => {
    const source = join(dir, 'life.db');
    seed(source, 1);
    const target = join(dir, 'copy.db');
    seed(target, 0);

    expect(() => snapshotAndVerify(source, target)).toThrow(/output file already exists/);
  });

  it('throws when the source does not exist', () => {
    expect(() => snapshotAndVerify(join(dir, 'missing.db'), join(dir, 'copy.db'))).toThrow(
      /does not exist/,
    );
    expect(existsSync(join(dir, 'copy.db'))).toBe(false);
  });

  it('throws when the source fails quick_check', () => {
    const source = join(dir, 'junk.db');
    writeFileSync(source, 'not a database at all');

    mockPrepare(
      (db, sql) => db.name === source && /PRAGMA quick_check/.test(sql),
      () => ({ get: () => ({ quick_check: 'not ok' }) }),
    );

    expect(() => snapshotAndVerify(source, join(dir, 'copy.db'))).toThrow(
      /source failed PRAGMA quick_check/,
    );
  });

  it('throws when the copy fails quick_check', () => {
    const source = join(dir, 'life.db');
    seed(source, 1);
    const target = join(dir, 'copy.db');

    mockPrepare(
      (db, sql) => db.name === target && /PRAGMA quick_check/.test(sql),
      () => ({ get: () => ({ quick_check: 'not ok' }) }),
    );

    expect(() => snapshotAndVerify(source, target)).toThrow(/snapshot failed PRAGMA quick_check/);
  });

  it('throws when the copy was not created', () => {
    const source = join(dir, 'life.db');
    seed(source, 1);
    const target = join(dir, 'copy.db');

    // VACUUM INTO claims success but never writes the file.
    mockPrepare(
      (db, sql) => db.name === source && /VACUUM INTO/.test(sql),
      () => ({ run: () => undefined }),
    );

    expect(() => snapshotAndVerify(source, target)).toThrow(/snapshot was not created/);
    expect(existsSync(target)).toBe(false);
  });
});

describe('verifyDatabase', () => {
  it('returns ok for a healthy database and throws for a broken or missing one', () => {
    const good = join(dir, 'good.db');
    seed(good, 1);
    expect(verifyDatabase(good)).toBe('ok');

    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'not a database at all');
    expect(() => verifyDatabase(bad)).toThrow();

    expect(() => verifyDatabase(join(dir, 'missing.db'))).toThrow(/does not exist/);
  });
});
