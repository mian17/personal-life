import 'reflect-metadata';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Note } from '../src/notes/note.entity';
import { NoteTag } from '../src/notes/note-tag.entity';
import { KeysService, UserKeys } from '@life/service-kit';
import { NotesCache } from '../src/notes/notes-cache';
import { NotesService } from '../src/notes/notes.service';
import { applySurgery } from '../../tags-service/src/tags/import';

/**
 * `SPEC-tags-extraction` "Owned by T5" — note-service TagRef behaviors.
 *
 * note-service no longer owns tag names: writes carry `tagIds` (`TagRef`) and
 * the `note_tag` join stores exactly those ids (association-only, no registry
 * call, no prune pass). These tests run on throwaway sqlite DBs under the OS
 * temp dir — never `apps/note-service/data/**` (the hard line).
 *
 * The synchronize-stability case drives the **real** T4 schema surgery
 * (`tags-service`'s `applySurgery`, read-only import) so the fixture is exactly
 * what the human-run migration leaves behind, then boots the post-T5 app and
 * asserts `synchronize` mutated nothing (`SPEC-owner-backfill` precedent).
 */

const MASTER_KEY = Buffer.alloc(32, 0x2a);
const SUB = 'user-a';

interface Harness {
  dataSource: DataSource;
  service: NotesService;
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'note-tagrefs-'));
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: join(dir, 'notes.db'),
    entities: [Note, NoteTag, UserKeys],
    synchronize: true,
  });
  await dataSource.initialize();
  const keys = new KeysService(dataSource.getRepository(UserKeys), MASTER_KEY);
  const service = new NotesService(
    dataSource.getRepository(Note),
    dataSource.getRepository(NoteTag),
    new NotesCache(null),
    keys,
  );
  return { dataSource, service, dir };
}

/** The raw `note_tag` rows for a note, ascending by id (bypasses hydration). */
async function rawTagIds(dataSource: DataSource, noteId: string): Promise<number[]> {
  const rows = (await dataSource.query(
    'SELECT tagId FROM note_tag WHERE noteId = ? ORDER BY tagId',
    [noteId],
  )) as Array<{ tagId: number }>;
  return rows.map((r) => Number(r.tagId));
}

describe('tags-extraction T5: note-service TagRef behaviors', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('round-trips tagIds on create/get/list and stores them association-only', async () => {
    const created = await h.service.create(SUB, 'tagged body', [2, 7]);

    expect(created.tagIds).toEqual([2, 7]);
    expect(await rawTagIds(h.dataSource, created.id)).toEqual([2, 7]);

    const fetched = await h.service.findOne(SUB, created.id);
    expect(fetched.tagIds).toEqual([2, 7]);

    const listed = await h.service.findAll(SUB, {});
    expect(listed.notes.find((n) => n.id === created.id)?.tagIds).toEqual([2, 7]);
  });

  it('attaches and detaches by id: a write replaces the set, dangling ids fall away with no registry call', async () => {
    // A registry id that does not exist anywhere is stored verbatim — note-service
    // never validates against (or calls) the registry (kernel detach semantics).
    const created = await h.service.create(SUB, 'dangling', [999_999]);
    expect(created.tagIds).toEqual([999_999]);

    // A subsequent write replaces the set: the dangling id is gone, replaced by
    // whatever ids this write carries.
    const replaced = await h.service.update(SUB, created.id, undefined, [1, 2]);
    expect(replaced.tagIds).toEqual([1, 2]);
    expect(await rawTagIds(h.dataSource, created.id)).toEqual([1, 2]);

    // An empty array is a full detach (never an "unchanged" signal).
    const cleared = await h.service.update(SUB, created.id, undefined, []);
    expect(cleared.tagIds).toEqual([]);
    expect(await rawTagIds(h.dataSource, created.id)).toEqual([]);

    // Omitting tagIds leaves the associations untouched.
    await h.service.update(SUB, created.id, undefined, [4]);
    const bodyOnly = await h.service.update(SUB, created.id, 'body only');
    expect(bodyOnly.tagIds).toEqual([4]);
  });

  it('dedupes repeated ids within one write', async () => {
    const created = await h.service.create(SUB, 'dup', [3, 3, 1, 1, 2]);
    expect(created.tagIds).toEqual([1, 2, 3]);
    expect(await rawTagIds(h.dataSource, created.id)).toEqual([1, 2, 3]);
  });

  it('filters listings by tagId (metadata-only; the same cached row set serves every variant)', async () => {
    const work = await h.service.create(SUB, 'work note', [1]);
    const idea = await h.service.create(SUB, 'idea note', [2]);
    await h.service.create(SUB, 'untagged note', []);

    const byTag = await h.service.findAll(SUB, { tagId: 1 });
    expect(byTag.notes.map((n) => n.id)).toEqual([work.id]);
    expect(byTag.notes.map((n) => n.id)).not.toContain(idea.id);

    const combined = await h.service.findAll(SUB, { tagId: 1, q: 'work' });
    expect(combined.notes.map((n) => n.id)).toEqual([work.id]);

    const none = await h.service.findAll(SUB, { tagId: 42 });
    expect(none.notes).toHaveLength(0);
  });

  it('returns [{tagId, count}] usage over non-trashed notes (trashed-only tags hidden)', async () => {
    const a = await h.service.create(SUB, 'a', [1, 2]);
    await h.service.create(SUB, 'b', [1]);
    const trashed = await h.service.create(SUB, 'c', [9]);
    await h.service.remove(SUB, trashed.id);

    const usage = await h.service.listTagUsage(SUB);
    expect(usage).toEqual([
      { tagId: 1, count: 2 },
      { tagId: 2, count: 1 },
    ]);
    // No name field ever appears; the surface is ids + counts only.
    expect(Object.keys(usage[0]).sort()).toEqual(['count', 'tagId']);

    // A tag carried only by a trashed note is hidden; restoring it re-counts.
    expect(usage.map((u) => u.tagId)).not.toContain(9);
    await h.service.restore(SUB, trashed.id);
    expect(await h.service.listTagUsage(SUB)).toContainEqual({ tagId: 9, count: 1 });

    // Per-owner scoping: another subject's associations never leak in.
    expect(await h.service.listTagUsage('user-b')).toEqual([]);
    // The first note's own associations are unchanged by any of the above.
    expect(await rawTagIds(h.dataSource, a.id)).toEqual([1, 2]);
  });
});

describe('tags-extraction T5: NoteTag entity + synchronize stability', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'note-tagrefs-sync-'));
    dirs.push(dir);
    return dir;
  }

  /** The post-`owner-backfill`, pre-surgery note DB shape (the migration's input). */
  const PRE_MIGRATION_SCHEMA = `
CREATE TABLE "note" ("id" varchar PRIMARY KEY NOT NULL, "body" text NOT NULL, "ownerSub" text, "version" integer NOT NULL DEFAULT (0), "deletedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "contentUpdatedAt" datetime);
CREATE INDEX "IDX_note_owner_sub" ON "note" ("ownerSub");
CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text);
CREATE TABLE "note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, CONSTRAINT "FK_ddfc0b18dcc060cb8899a249910" FOREIGN KEY ("noteId") REFERENCES "note" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "FK_0d23f466571ec62e5c103785f06" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, PRIMARY KEY ("noteId", "tagId"));
CREATE INDEX "IDX_ddfc0b18dcc060cb8899a24991" ON "note_tag" ("noteId") ;
CREATE INDEX "IDX_0d23f466571ec62e5c103785f0" ON "note_tag" ("tagId") ;
CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, "wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL);
`;

  function snapshot(path: string): string[] {
    const db = new Database(path, { readonly: true });
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

  function noteTagDdl(path: string): string {
    const db = new Database(path, { readonly: true });
    try {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'note_tag'")
        .get() as { sql: string } | undefined;
      return row?.sql ?? '';
    } finally {
      db.close();
    }
  }

  it("matches the migration's rebuilt note_tag DDL byte-for-byte (idempotent boot, zero mutations)", async () => {
    const dbPath = join(tmpDir(), 'life.db');

    // Build the pre-migration shape, then run the REAL T4 schema surgery.
    const db = new Database(dbPath);
    try {
      db.exec(PRE_MIGRATION_SCHEMA);
      db.prepare(
        'INSERT INTO "note" ("id","body","version","createdAt","updatedAt") VALUES (?,?,0,?,?)',
      ).run('n1', 'body', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
      db.prepare('INSERT INTO "tag" ("id","name","ownerSub") VALUES (?,?,?)').run(1, 'Work', 'u1');
      db.prepare('INSERT INTO "note_tag" ("noteId","tagId") VALUES (?,?)').run('n1', 1);
    } finally {
      db.close();
    }
    const actions = applySurgery(dbPath);
    expect(actions.join(' ')).toContain('rebuilt note_tag');
    expect(actions.join(' ')).toContain('dropped tag');

    // The migration output is exactly what the NoteTag entity generates.
    const migratedDdl = noteTagDdl(dbPath);
    const freshDir = tmpDir();
    const freshPath = join(freshDir, 'fresh.db');
    const fresh = new DataSource({
      type: 'better-sqlite3',
      database: freshPath,
      entities: [Note, NoteTag, UserKeys],
      synchronize: true,
    });
    await fresh.initialize();
    await fresh.destroy();
    expect(migratedDdl).toBe(noteTagDdl(freshPath));
    // `noteId` FK → note with ON DELETE CASCADE, ON UPDATE NO ACTION; tagId has no FK.
    expect(migratedDdl).toContain('ON DELETE CASCADE ON UPDATE NO ACTION');
    const fkTables = (() => {
      const d = new Database(dbPath, { readonly: true });
      try {
        return (
          d.prepare('PRAGMA foreign_key_list("note_tag")').all() as Array<{ table: string }>
        ).map((f) => f.table);
      } finally {
        d.close();
      }
    })();
    expect(fkTables).toEqual(['note']);

    // Boot the post-T5 app against the migrated DB: zero schema-mutating statements.
    const before = snapshot(dbPath);
    const savedDb = process.env.DB_PATH;
    const savedRedis = process.env.REDIS_URL;
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.DB_PATH = dbPath;
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
    expect(snapshot(dbPath)).toEqual(before);
  });

  it('cascades association rows when a note is permanently deleted', async () => {
    const dir = tmpDir();
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(dir, 'cascade.db'),
      entities: [Note, NoteTag, UserKeys],
      synchronize: true,
    });
    await dataSource.initialize();
    try {
      const keys = new KeysService(dataSource.getRepository(UserKeys), MASTER_KEY);
      const service = new NotesService(
        dataSource.getRepository(Note),
        dataSource.getRepository(NoteTag),
        new NotesCache(null),
        keys,
      );
      const created = await service.create(SUB, 'cascade me', [1, 2]);
      expect(await rawTagIds(dataSource, created.id)).toEqual([1, 2]);

      await service.remove(SUB, created.id);
      await service.removePermanent(SUB, created.id);
      expect(await rawTagIds(dataSource, created.id)).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });
});
