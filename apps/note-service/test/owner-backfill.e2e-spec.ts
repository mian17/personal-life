import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  main,
  resolvePaths,
  runBackfill,
  type RunResult,
} from '../scripts/backfill-owner';

/**
 * `owner-backfill` script suite (Task 5, SPEC-owner-backfill). Every fixture is a
 * throwaway DB under the OS temp dir — this suite NEVER opens anything under
 * `apps/*​/data/` (the hard line in the todo).
 *
 * The legacy fixture DDL is byte-for-byte what the pre-boundary TypeORM entities
 * generated (verified against a live boot): `note` without `ownerSub`, `tag` with
 * an inline single-column `UNIQUE(name)`, and `note_tag` with real FK rows. That
 * is the shape the script must convert — and the shape `synchronize` provably
 * cannot.
 */

const LEGACY_LIFE_SCHEMA = `
CREATE TABLE "note" ("id" varchar PRIMARY KEY NOT NULL, "body" text NOT NULL, "version" integer NOT NULL DEFAULT (0), "deletedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')));
CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_6a9775008add570dc3e5a0bab7b" UNIQUE ("name"));
CREATE TABLE "note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, CONSTRAINT "FK_ddfc0b18dcc060cb8899a249910" FOREIGN KEY ("noteId") REFERENCES "note" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "FK_0d23f466571ec62e5c103785f06" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, PRIMARY KEY ("noteId", "tagId"));
CREATE INDEX "IDX_ddfc0b18dcc060cb8899a24991" ON "note_tag" ("noteId") ;
CREATE INDEX "IDX_0d23f466571ec62e5c103785f0" ON "note_tag" ("tagId") ;
`;

const IDP_SCHEMA = `
CREATE TABLE "user" ("id" varchar PRIMARY KEY NOT NULL, "username" text NOT NULL, "passwordHash" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_user_username" UNIQUE ("username"));
`;

type Db = Database.Database;

interface LegacyLife {
  notes: Array<{ id: string; body: string; createdAt?: string }>;
  tags: string[];
  links?: Array<[string, number]>;
}

interface IdpUser {
  id: string;
  createdAt: string;
  username?: string;
}

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'owner-backfill-'));
  dirs.push(dir);
  return dir;
}

function open(path: string, readonly = false): Db {
  return new Database(path, readonly ? { readonly: true } : {});
}

function exec(db: Db, sql: string): void {
  db.exec(sql);
}

function createLegacyLifeDb(path: string, life: LegacyLife): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    exec(db, LEGACY_LIFE_SCHEMA);
    for (const note of life.notes) {
      db.prepare(
        'INSERT INTO "note" ("id","body","version","createdAt","updatedAt") VALUES (?,?,0,?,?)',
      ).run(note.id, note.body, note.createdAt ?? '2026-01-01 00:00:00', note.createdAt ?? '2026-01-01 00:00:00');
    }
    life.tags.forEach((name, i) => {
      db.prepare('INSERT INTO "tag" ("id","name") VALUES (?,?)').run(i + 1, name);
    });
    for (const [noteId, tagId] of life.links ?? []) {
      db.prepare('INSERT INTO "note_tag" ("noteId","tagId") VALUES (?,?)').run(noteId, tagId);
    }
  } finally {
    db.close();
  }
}

function createIdpDb(path: string, users: IdpUser[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    exec(db, IDP_SCHEMA);
    for (const user of users) {
      db.prepare(
        'INSERT INTO "user" ("id","username","passwordHash","createdAt") VALUES (?,?,?,?)',
      ).run(user.id, user.username ?? user.id, 'hash', user.createdAt);
    }
  } finally {
    db.close();
  }
}

const envFor = (dir: string, life: string, idp: string): NodeJS.ProcessEnv => ({
  INIT_CWD: dir,
  NOTE_DB_PATH: life,
  IDP_DB_PATH: idp,
});

function tableInfo(db: Db, table: string): Array<{ name: string; type: string }> {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
}

function hasIndex(db: Db, table: string, name: string): boolean {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>;
  return list.some((i) => i.name === name);
}

function indexColumns(db: Db, index: string): string[] {
  return (db.prepare(`PRAGMA index_info("${index}")`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** True when `table` still carries the un-droppable legacy inline `UNIQUE(name)`. */
function hasSingleColumnUniqueOnName(db: Db, table: string): boolean {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string; unique: number }>;
  return list.some((idx) => {
    if (!idx.unique) return false;
    const cols = indexColumns(db, idx.name);
    return cols.length === 1 && cols[0] === 'name';
  });
}

function tableSql(db: Db, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as
    | { sql: string }
    | undefined;
  return row?.sql ?? '';
}

/** Canonical, comparable view of the schema (the convergence oracle). */
function schemaSnapshot(path: string): string[] {
  const db = open(path, true);
  try {
    const rows = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all() as Array<{ type: string; name: string; sql: string | null }>;
    return rows.map((r) => `${r.type}|${r.name}|${r.sql ?? ''}`);
  } finally {
    db.close();
  }
}

function noteBodies(path: string): string[] {
  const db = open(path, true);
  try {
    return (db.prepare('SELECT body FROM "note" ORDER BY id').all() as Array<{ body: string }>).map(
      (r) => r.body,
    );
  } finally {
    db.close();
  }
}

function tagNames(path: string): string[] {
  const db = open(path, true);
  try {
    return (db.prepare('SELECT name FROM "tag" ORDER BY id').all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  } finally {
    db.close();
  }
}

function ownerOf(path: string, table: 'note' | 'tag', id: string | number): string | null {
  const db = open(path, true);
  try {
    const row = db.prepare(`SELECT ownerSub FROM "${table}" WHERE "id" = ?`).get(id) as
      | { ownerSub: string | null }
      | undefined;
    return row?.ownerSub ?? null;
  } finally {
    db.close();
  }
}

describe('owner-backfill (e2e)', () => {
  const originalEnv = { ...process.env };

  // This suite boots the real Nest app (TypeORM connect + schema sync) on top of
  // a migrated DB. Jest's 5s default is not enough for that under parallel
  // workers, and a timeout there reads as a schema mismatch when it is not one.
  jest.setTimeout(30_000);

  afterAll(() => {
    process.env = originalEnv;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('backup is verified before any write and restores the pre-run state', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, {
      notes: [
        { id: 'n1', body: 'first' },
        { id: 'n2', body: 'second' },
      ],
      tags: ['work', 'home'],
      links: [
        ['n1', 1],
        ['n2', 2],
      ],
    });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01 00:00:00' }]);

    const result = runBackfill(envFor(dir, life, idp));

    // Step 1: the backup exists and passed its checks.
    expect(existsSync(result.backup.backupPath)).toBe(true);
    expect(result.backup.backupPath).toContain(`${life}.bak-`);
    expect(result.backup.noteCount).toBe(2);

    // Ordering proof: the copy captures the PRE-migration schema — Step 2's DDL
    // had not run when the snapshot was taken.
    const backupDb = open(result.backup.backupPath, true);
    try {
      expect(tableInfo(backupDb, 'note').map((c) => c.name)).not.toContain('ownerSub');
      expect(hasSingleColumnUniqueOnName(backupDb, 'tag')).toBe(true);
      expect(backupDb.prepare('PRAGMA quick_check').all()).toEqual([{ quick_check: 'ok' }]);
    } finally {
      backupDb.close();
    }

    // Rollback proof: restoring the backup yields the exact pre-run state.
    const restored = join(dir, 'restored.db');
    copyFileSync(result.backup.backupPath, restored);
    expect(tableInfo(open(restored, true), 'note').map((c) => c.name)).not.toContain('ownerSub');
    expect(noteBodies(restored)).toEqual(['first', 'second']);
    expect(tagNames(restored)).toEqual(['work', 'home']);

    // ...while the migrated DB now carries the boundary column, stamped.
    expect(ownerOf(life, 'note', 'n1')).toBe('u-old');
    expect(ownerOf(life, 'tag', 1)).toBe('u-old');
  });

  it('creates a distinct backup per run and never overwrites an existing one', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, {
      notes: [{ id: 'n1', body: 'only' }],
      tags: ['work'],
      links: [['n1', 1]],
    });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    const first = runBackfill(envFor(dir, life, idp));
    const second = runBackfill(envFor(dir, life, idp));

    expect(first.backup.backupPath).not.toBe(second.backup.backupPath);
    expect(existsSync(first.backup.backupPath)).toBe(true);
    expect(existsSync(second.backup.backupPath)).toBe(true);

    // The re-run converged: nothing to stamp, no schema write.
    expect(second.stamped.noteStamped).toBe(0);
    expect(second.stamped.tagStamped).toBe(0);
    expect(second.schema.mutated).toBe(false);
  });

  it('converts a legacy tag table: rows/ids survive, FK clean, global unique gone, indexes present', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, {
      notes: [
        { id: 'n1', body: 'a' },
        { id: 'n2', body: 'b' },
      ],
      tags: ['work', 'home'],
      links: [
        ['n1', 1],
        ['n1', 2],
        ['n2', 2],
      ],
    });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    const result = runBackfill(envFor(dir, life, idp));
    expect(result.schema.actions.join(' ')).toContain('rebuilt tag');

    const db = open(life);
    try {
      // Rows survive the rebuild with ids preserved; join rows intact.
      expect(db.prepare('SELECT id, name FROM "tag" ORDER BY id').all()).toEqual([
        { id: 1, name: 'work' },
        { id: 2, name: 'home' },
      ]);
      expect(db.prepare('SELECT noteId, tagId FROM "note_tag" ORDER BY noteId, tagId').all()).toEqual([
        { noteId: 'n1', tagId: 1 },
        { noteId: 'n1', tagId: 2 },
        { noteId: 'n2', tagId: 2 },
      ]);

      // The FK-off rebuild left zero violations.
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      // AUTOINCREMENT-equivalent DDL TypeORM expects survives.
      expect(tableSql(db, 'tag')).toContain('AUTOINCREMENT');
      expect(tableInfo(db, 'tag').map((c) => c.name)).toEqual(['id', 'name', 'ownerSub']);

      // The legacy global unique is gone...
      expect(hasSingleColumnUniqueOnName(db, 'tag')).toBe(false);
      // ...and so is the composite unique: `UQ_tag_name_owner` moved to
      // service-level enforcement (plan D7 — ciphertext names cannot satisfy a
      // DB unique index). The note index is exactly what the entity declares.
      expect(hasIndex(db, 'tag', 'UQ_tag_name_owner')).toBe(false);
      expect(hasIndex(db, 'note', 'IDX_note_owner_sub')).toBe(true);
      expect(indexColumns(db, 'IDX_note_owner_sub')).toEqual(['ownerSub']);

      // Same name is now insertable for two different owners...
      db.prepare('INSERT INTO "tag" ("name","ownerSub") VALUES (?,?)').run('work', 'owner-a');
      db.prepare('INSERT INTO "tag" ("name","ownerSub") VALUES (?,?)').run('work', 'owner-b');
      // ...and the DB no longer guards per-owner uniqueness at all: the service
      // dedupes case-insensitively on create/link (plan D7; covered by the
      // crypto-roundtrip suite's tag-dedupe case).
      expect(() =>
        db.prepare('INSERT INTO "tag" ("name","ownerSub") VALUES (?,?)').run('work', 'owner-a'),
      ).not.toThrow();

      // Every legacy row was stamped to the oldest user.
      expect(
        (db.prepare('SELECT COUNT(*) AS c FROM "tag" WHERE ownerSub IS NULL').get() as { c: number }).c,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("boots the app after migration with zero schema-mutating statements", async () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, {
      notes: [{ id: 'n1', body: 'converge' }],
      tags: ['work'],
      links: [['n1', 1]],
    });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    runBackfill(envFor(dir, life, idp));
    const before = schemaSnapshot(life);

    const savedDb = process.env.DB_PATH;
    const savedRedis = process.env.REDIS_URL;
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.DB_PATH = life;
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'test';
    try {
      const { createApp } = await import('../src/app.factory');
      const app = await createApp();
      await app.init();
      await app.close();
    } finally {
      if (savedDb === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = savedDb;
      if (savedRedis === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = savedRedis;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }

    // `synchronize` had nothing left to do — the script's DDL is byte-equivalent.
    expect(schemaSnapshot(life)).toEqual(before);
  });

  it('aborts with zero backfill writes when the identity DB has no users', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'keep' }], tags: ['work'], links: [] });
    createIdpDb(idp, []);

    expect(() => runBackfill(envFor(dir, life, idp))).toThrow(/seed the user first/);
    // No row was assigned an owner.
    expect(ownerOf(life, 'note', 'n1')).toBeNull();
    expect(ownerOf(life, 'tag', 1)).toBeNull();
    expect(noteBodies(life)).toEqual(['keep']);
  });

  it('aborts before any write when IDP_DB_PATH is missing from the environment', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'keep' }], tags: ['work'], links: [] });

    expect(() => runBackfill({ INIT_CWD: dir, NOTE_DB_PATH: life })).toThrow(/IDP_DB_PATH is required/);
    // Resolution fails first: not even a backup file exists, let alone schema.
    const db = open(life, true);
    try {
      expect(tableInfo(db, 'note').map((c) => c.name)).not.toContain('ownerSub');
    } finally {
      db.close();
    }
  });

  it('aborts when IDP_DB_PATH points at a missing or unreadable file', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'keep' }], tags: ['work'], links: [] });

    expect(() => runBackfill(envFor(dir, life, join(dir, 'nope.db')))).toThrow(/seed the user first/);
    // An unreadable target (a directory) aborts too.
    expect(() => runBackfill(envFor(dir, life, dir))).toThrow(/unreadable/);
    // The row data is untouched by either abort.
    expect(ownerOf(life, 'note', 'n1')).toBeNull();
  });

  it('selects the oldest user by createdAt', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'x' }], tags: ['t'], links: [] });
    createIdpDb(idp, [
      { id: 'u-young', createdAt: '2025-06-01 00:00:00' },
      { id: 'u-oldest', createdAt: '2020-01-01 00:00:00' },
      { id: 'u-mid', createdAt: '2023-01-01 00:00:00' },
    ]);

    const result = runBackfill(envFor(dir, life, idp));
    expect(result.sub).toBe('u-oldest');
    expect(ownerOf(life, 'note', 'n1')).toBe('u-oldest');
    expect(ownerOf(life, 'tag', 1)).toBe('u-oldest');
  });

  it('breaks a createdAt tie by id ascending', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'x' }], tags: ['t'], links: [] });
    createIdpDb(idp, [
      { id: 'b-second', createdAt: '2024-01-01 00:00:00' },
      { id: 'a-first', createdAt: '2024-01-01 00:00:00' },
    ]);

    expect(runBackfill(envFor(dir, life, idp)).sub).toBe('a-first');
  });

  it('is idempotent: a re-run stamps nothing and skips the schema guard', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'x' }], tags: ['t'], links: [] });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    const first = runBackfill(envFor(dir, life, idp));
    expect(first.schema.mutated).toBe(true);
    expect(first.stamped.noteStamped).toBe(1);
    expect(first.stamped.tagStamped).toBe(1);

    const schemaBefore = schemaSnapshot(life);
    const rowsBefore = noteBodies(life);

    const second = runBackfill(envFor(dir, life, idp));
    expect(second.schema.mutated).toBe(false);
    expect(second.schema.actions.join(' ')).toContain('skipped');
    expect(second.stamped.noteStamped).toBe(0);
    expect(second.stamped.tagStamped).toBe(0);
    expect(second.stamped.noteAlreadyOwned).toBe(1);
    expect(second.stamped.tagAlreadyOwned).toBe(1);
    expect(schemaSnapshot(life)).toEqual(schemaBefore);
    expect(noteBodies(life)).toEqual(rowsBefore);
  });

  it('stamps only NULL owners and never re-stamps owned rows', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, {
      notes: [
        { id: 'n1', body: 'legacy' },
        { id: 'n2', body: 'owned' },
      ],
      tags: ['legacy-tag', 'owned-tag'],
      links: [],
    });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    // First pass migrates the schema and stamps everyone, then we deliberately
    // carve out one owned row and one NULL row to re-run against.
    runBackfill(envFor(dir, life, idp));
    const db = open(life);
    try {
      db.prepare('UPDATE "note" SET ownerSub = ? WHERE id = ?').run('existing', 'n2');
      db.prepare('UPDATE "note" SET ownerSub = NULL WHERE id = ?').run('n1');
      db.prepare('UPDATE "tag" SET ownerSub = ? WHERE name = ?').run('existing', 'owned-tag');
      db.prepare('UPDATE "tag" SET ownerSub = NULL WHERE name = ?').run('legacy-tag');
    } finally {
      db.close();
    }

    const result = runBackfill(envFor(dir, life, idp));
    expect(result.stamped.noteStamped).toBe(1);
    expect(result.stamped.tagStamped).toBe(1);
    expect(result.stamped.noteAlreadyOwned).toBe(1);
    expect(result.stamped.tagAlreadyOwned).toBe(1);
    expect(ownerOf(life, 'note', 'n1')).toBe('u-old');
    expect(ownerOf(life, 'note', 'n2')).toBe('existing');
    expect(ownerOf(life, 'tag', 1)).toBe('u-old');
    expect(ownerOf(life, 'tag', 2)).toBe('existing');
  });

  it('resolves relative env values against INIT_CWD', () => {
    const dir = tmpDir();
    // Both relative values point into the same `rel/` subtree under INIT_CWD.
    const life = join(dir, 'rel', 'life.db');
    const idp = join(dir, 'rel', 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'rel' }], tags: ['t'], links: [] });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    const resolved = resolvePaths({
      INIT_CWD: dir,
      NOTE_DB_PATH: 'rel/life.db',
      IDP_DB_PATH: 'rel/idp.db',
    });
    expect(resolved.noteDbPath).toBe(life);
    expect(resolved.idpDbPath).toBe(idp);

    // The whole run honours the same resolution: the backup lands beside life.db.
    const result: RunResult = runBackfill({
      INIT_CWD: dir,
      NOTE_DB_PATH: 'rel/life.db',
      IDP_DB_PATH: 'rel/idp.db',
    });
    expect(result.noteDbPath).toBe(life);
    expect(existsSync(result.backup.backupPath)).toBe(true);
    expect(result.backup.backupPath.startsWith(life)).toBe(true);
    expect(ownerOf(life, 'note', 'n1')).toBe('u-old');
  });

  it('main() reports success (exit 0) and failure (non-zero)', () => {
    const dir = tmpDir();
    const life = join(dir, 'life.db');
    const idp = join(dir, 'idp.db');
    createLegacyLifeDb(life, { notes: [{ id: 'n1', body: 'cli' }], tags: ['t'], links: [] });
    createIdpDb(idp, [{ id: 'u-old', createdAt: '2024-01-01' }]);

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(main(envFor(dir, life, idp))).toBe(0);
      expect(log.mock.calls.join(' ')).toContain('.bak-');

      const emptyIdp = join(dir, 'empty-idp.db');
      createIdpDb(emptyIdp, []);
      const other = join(dir, 'other.db');
      createLegacyLifeDb(other, { notes: [{ id: 'n9', body: 'cli2' }], tags: ['t2'], links: [] });
      expect(main(envFor(dir, other, emptyIdp))).toBe(1);
      expect(error.mock.calls.join(' ')).toContain('seed the user first');
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
