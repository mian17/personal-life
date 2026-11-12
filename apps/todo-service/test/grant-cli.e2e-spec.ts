import 'reflect-metadata';
import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { OriginGrant } from '@life/service-kit';
import { grantOrigin, main, type GrantRow } from '../scripts/grant-origin.js';

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

  it('lists the rows it wrote as `ownerSub clientId originService grantedAt`', () => {
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
    const [ownerSub, clientId, originService, ...rest] = listed.out[0].split(' ');
    expect([ownerSub, clientId, originService]).toEqual(['user-a', 'producer-a', 'meal-service']);
    // `grantedAt` is stored in TypeORM's sqlite form: `YYYY-MM-DD HH:mm:ss.SSS`.
    expect(rest.join(' ')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
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
