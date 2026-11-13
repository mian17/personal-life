import 'reflect-metadata';
import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { OriginGrant } from '@life/service-kit';
import { grantOrigin, main, resolveDbPath, type GrantRow } from '../scripts/grant-origin.js';

/**
 * `grant-origin` CLI suite (`SPEC-todo-origin` §9.12).
 *
 * Drives `main`/`grantOrigin` directly against a throwaway sqlite file under the
 * OS temp dir — this suite NEVER opens anything under `apps/todo-service/data/**`
 * (the hard line). No child process: the CLI returns an exit code instead of
 * terminating, which is exactly what makes it assertable here.
 *
 * The DDL guard is the load-bearing test: the script creates `origin_grant` by
 * hand, so the table it writes must be the one TypeORM's `synchronize` would have
 * created from the entity, or the next service boot silently mutates it.
 *
 * One case does spawn the entry (`describe('grant-origin CLI entry')` below), because
 * every other case here imports `main` in-process and so cannot see a failure in the
 * *entry* itself — which is exactly how this CLI shipped unrunnable: ts-node refused
 * the entry's module graph with a type error while the suite stayed 9/9 green.
 */

const dirs: string[] = [];

/** A temp database that already exists (the CLI refuses to create one). */
function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'grant-cli-'));
  dirs.push(dir);
  return { dir, path: join(dir, 'todo.db') };
}

/** An empty existing file: better-sqlite3 opens it and the CLI provisions the table. */
function emptyDb(): string {
  const { dir, path } = tempDb();
  new Database(path).close();
  return path;
}

function rows(dbPath: string): GrantRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        'SELECT "ownerSub", "clientId", "originService" FROM "origin_grant" ' +
          'ORDER BY "ownerSub", "clientId"',
      )
      .all() as GrantRow[];
  } finally {
    db.close();
  }
}

/** Captured stdout/stderr lines, so the printed words are asserted, not inferred. */
function capture(run: () => number): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
    out.push(String(line));
  });
  const error = jest.spyOn(console, 'error').mockImplementation((line: unknown) => {
    err.push(String(line));
  });
  try {
    return { code: run(), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('grant-origin CLI', () => {
  it('creates a grant, then updates it in place on a re-run', () => {
    const dbPath = emptyDb();
    const args = ['--owner', 'user-a', '--client', 'producer-a'];

    const created = capture(() => main([...args, '--origin', 'meal-service', '--db', dbPath]));
    const updated = capture(() => main([...args, '--origin', 'calendar-service', '--db', dbPath]));

    expect(created.code).toBe(0);
    expect(created.out).toEqual(['created user-a producer-a']);
    expect(updated.out).toEqual(['updated user-a producer-a']);
    const stored = rows(dbPath);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      ownerSub: 'user-a',
      clientId: 'producer-a',
      originService: 'calendar-service',
    });
  });

  it('lists the rows it wrote as `ownerSub clientId originService grantedAt direction`', () => {
    const dbPath = emptyDb();
    capture(() =>
      main([
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'meal-service',
        '--db',
        dbPath,
      ]),
    );

    const listed = capture(() => main(['--list', '--db', dbPath]));

    expect(listed.code).toBe(0);
    expect(listed.out).toHaveLength(1);
    // Fixed shape on every line, the direction last: a format that changed width
    // per row would be a parsing trap. `grantedAt` is one sqlite-form timestamp
    // (`YYYY-MM-DD HH:mm:ss.SSS`), so it splits across two space-separated parts.
    expect(listed.out[0]).toMatch(
      /^user-a producer-a meal-service \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} write$/,
    );
  });

  it('revokes a grant, then reports the second revoke as missing', () => {
    const dbPath = emptyDb();
    const args = ['--owner', 'user-a', '--client', 'producer-a'];
    capture(() => main([...args, '--origin', 'meal-service', '--db', dbPath]));

    const revoked = capture(() => main([...args, '--revoke', '--db', dbPath]));
    const missing = capture(() => main([...args, '--revoke', '--db', dbPath]));

    expect(revoked.out).toEqual(['revoked']);
    expect(missing.out).toEqual(['missing']);
    expect(rows(dbPath)).toEqual([]);
  });

  it('refuses a database path that does not exist, naming the path', () => {
    const { path } = tempDb();

    const result = capture(() =>
      main(['--owner', 'user-a', '--client', 'producer-a', '--db', path]),
    );

    expect(result.code).toBe(2);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain(path);
  });

  it('grants one client to two owners as two rows', () => {
    const dbPath = emptyDb();
    capture(() =>
      main([
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'meal-service',
        '--db',
        dbPath,
      ]),
    );
    capture(() =>
      main([
        '--owner',
        'user-b',
        '--client',
        'producer-a',
        '--origin',
        'calendar-service',
        '--db',
        dbPath,
      ]),
    );

    // The same client id, two owners: two rows, each with its own origin.
    const db = new Database(dbPath);
    try {
      const outcome = grantOrigin(db, {
        ownerSub: 'user-c',
        clientId: 'producer-a',
        originService: 'focus-service',
      });
      expect(outcome).toBe('created');
    } finally {
      db.close();
    }
    expect(rows(dbPath).map((row) => [row.ownerSub, row.originService])).toEqual([
      ['user-a', 'meal-service'],
      ['user-b', 'calendar-service'],
      ['user-c', 'focus-service'],
    ]);
  });

  it('prints the file and exits 0 when the database has no origin_grant table', () => {
    // An existing database that was never provisioned is not the same verdict as
    // an owner holding no grants: silence here made a wrong --db target look fine.
    const dbPath = emptyDb();

    const listed = capture(() => main(['--list', '--db', dbPath]));

    expect(listed.code).toBe(0);
    expect(listed.err).toEqual([]);
    expect(listed.out).toHaveLength(1);
    expect(listed.out[0]).toContain(dbPath);
    expect(listed.out[0]).toContain('origin_grant');
  });

  it('prints nothing when the table exists and holds no rows', () => {
    const dbPath = emptyDb();
    capture(() =>
      main([
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'meal-service',
        '--db',
        dbPath,
      ]),
    );
    capture(() =>
      main(['--owner', 'user-a', '--client', 'producer-a', '--revoke', '--db', dbPath]),
    );

    const listed = capture(() => main(['--list', '--db', dbPath]));

    expect(listed.code).toBe(0);
    expect(listed.out).toEqual([]);
  });

  it('resolves DB_PATH against the workspace cwd, not the directory npm was invoked from', () => {
    // `npm run` from the repo root sets INIT_CWD=<repo root> while the script's cwd
    // is the workspace, and DB_PATH=data/scratch.db is workspace-relative. Anchoring
    // it at INIT_CWD opened a different database at the repo root.
    const workspace = tempDb().dir;
    const invokedFrom = tempDb().dir;
    const workspaceDb = join(workspace, 'data', 'scratch.db');
    const invokedFromDb = join(invokedFrom, 'data', 'scratch.db');
    mkdirSync(join(workspace, 'data'), { recursive: true });
    mkdirSync(join(invokedFrom, 'data'), { recursive: true });
    new Database(workspaceDb).close();
    new Database(invokedFromDb).close();
    capture(() =>
      main([
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'workouts',
        '--db',
        workspaceDb,
      ]),
    );
    const env = { DB_PATH: join('data', 'scratch.db'), INIT_CWD: invokedFrom };

    const resolved = resolveDbPath([], env, workspace);
    const listed = capture(() => main(['--list'], env, workspace));

    expect(resolved).toBe(workspaceDb);
    expect(listed.out).toHaveLength(1);
    expect(listed.out[0]).toContain('user-a producer-a workouts');
  });

  it('creates a table byte-equivalent to what TypeORM generates from the entity', async () => {
    const dbPath = emptyDb();
    capture(() =>
      main([
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'meal-service',
        '--db',
        dbPath,
      ]),
    );

    const written = new Database(dbPath, { readonly: true });
    try {
      const row = written
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='origin_grant'")
        .get() as { sql: string };
      // `synchronize` on a fresh file prints the DDL TypeORM derives from the
      // entity; a mismatch means the next boot would alter the table we wrote.
      expect(row.sql).toBe(await synchronisedDdl());
    } finally {
      written.close();
    }
  });
});

/**
 * The entry, executed as a real process — the one thing the in-process cases cannot
 * cover.
 *
 * The CLI is a ts-node script (`scripts/grant-origin.cli.ts`), so what is asserted is
 * that Node + the loader can actually load it and run a command end to end, against a
 * real sqlite file. `NODE_OPTIONS` is dropped from the child's environment: jest sets
 * `--experimental-vm-modules` there, which belongs to the test runner, not to the CLI
 * this case is measuring.
 */
describe('grant-origin CLI entry (child process)', () => {
  it('runs `--list` as a real process and prints the stored grant with its direction', () => {
    const { path } = tempDb();
    writeFileSync(path, '');
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const cli = (...args: string[]): string =>
      execFileSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--loader',
          'ts-node/esm',
          'scripts/grant-origin.cli.ts',
          ...args,
          '--db',
          path,
        ],
        // The workspace root: the `grant-origin` script's own cwd, so ts-node resolves
        // the same tsconfig a developer's `npm run` does.
        { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', env },
      );

    expect(
      cli(
        '--owner',
        'user-a',
        '--client',
        'producer-a',
        '--origin',
        'focus-service',
        '--direction',
        'read',
        '--scope',
        'own-origin',
      ),
    ).toBe('created user-a producer-a\n');
    // The direction is the fifth token on every line, so a read grant is visible as one.
    expect(cli('--list')).toMatch(
      /^user-a producer-a focus-service \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} read\n$/,
    );
  });
});

/** The exact `origin_grant` DDL TypeORM's sqlite `synchronize` generates. */
let cachedDdl: string | undefined;

async function synchronisedDdl(): Promise<string> {
  if (cachedDdl !== undefined) return cachedDdl;
  const { dir, path } = tempDb();
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: path,
    entities: [OriginGrant],
    synchronize: true,
  });
  await dataSource.initialize();
  const db = new Database(path, { readonly: true });
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='origin_grant'")
      .get() as { sql: string };
    cachedDdl = row.sql;
  } finally {
    db.close();
    await dataSource.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
  return cachedDdl;
}
