import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { decryptField, encryptField, unwrapDek, wrapDek } from '@life/crypto';
import {
  LEGACY_OWNER,
  ImportRowError,
  applyImport,
  bootstrapRegistrySchema,
  formatImportReport,
  importTags,
  planImport,
  type FieldEncryptor,
  type ImportReport,
} from '../src/tags/import';
import { main } from '../scripts/import-tags';

/**
 * `SPEC-tags-extraction` migration case list. Every fixture is a throwaway DB
 * under the OS temp dir — this suite NEVER opens anything under
 * `apps/*​/data/` (the hard line in the todo). Master keys are generated in-test.
 *
 * The note-DB fixture is the post-owner-backfill shape (the deploy order runs
 * `backfill-owner` first): `tag` carries `ownerSub` (nullable → `_legacy_`), and
 * `note_tag` still holds the legacy FK to `tag` that the surgery removes.
 */

type Db = Database.Database;

const NOTE_KEY = Buffer.alloc(32, 0x11);
const TAGS_KEY = Buffer.alloc(32, 0x22);
const DEK_U1 = Buffer.alloc(32, 0xa1);
const DEK_U2 = Buffer.alloc(32, 0xa2);
const DEK_TAGS_U1 = Buffer.alloc(32, 0xb1);

const aad = (owner: string): string => `life.v1|${owner}|tag|name`;

const NOTE_SCHEMA = `
CREATE TABLE "note" ("id" varchar PRIMARY KEY NOT NULL, "body" text NOT NULL, "ownerSub" text, "version" integer NOT NULL DEFAULT (0), "deletedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')));
CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text);
CREATE TABLE "note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, CONSTRAINT "FK_ddfc0b18dcc060cb8899a249910" FOREIGN KEY ("noteId") REFERENCES "note" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "FK_0d23f466571ec62e5c103785f06" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, PRIMARY KEY ("noteId", "tagId"));
CREATE INDEX "IDX_ddfc0b18dcc060cb8899a24991" ON "note_tag" ("noteId");
CREATE INDEX "IDX_0d23f466571ec62e5c103785f0" ON "note_tag" ("tagId");
CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, "wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL);
`;

/** Byte-equivalent to what the registry entities' `synchronize` generates. */
const TAGS_SCHEMA = `
CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text NOT NULL, "version" integer NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL);
CREATE INDEX "IDX_tag_owner_sub" ON "tag" ("ownerSub") ;
CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, "wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL);
`;

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'import-tags-'));
  dirs.push(dir);
  return dir;
}

function open(path: string, readonly = false): Db {
  return new Database(path, readonly ? { readonly: true } : {});
}

interface TagRow {
  id: number;
  name: string;
  ownerSub?: string | null;
  encrypt?: boolean;
}

interface NoteFixture {
  tags: TagRow[];
  notes?: string[];
  links?: Array<[string, number]>;
  deks?: Record<string, Buffer>;
}

function createNoteDb(path: string, fx: NoteFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    db.exec(NOTE_SCHEMA);
    for (const id of fx.notes ?? []) {
      db.prepare(
        'INSERT INTO "note" ("id","body","version","createdAt","updatedAt") VALUES (?,?,0,?,?)',
      ).run(id, 'body', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    }
    for (const [sub, dek] of Object.entries(fx.deks ?? {})) {
      db.prepare(
        'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,1,?)',
      ).run(sub, wrapDek(dek, NOTE_KEY), '2026-01-01 00:00:00');
    }
    for (const tag of fx.tags) {
      const owner = tag.ownerSub ?? LEGACY_OWNER;
      let name = tag.name;
      if (tag.encrypt) {
        const dek = (fx.deks ?? {})[owner];
        if (!dek) throw new Error(`fixture missing note DEK for ${owner}`);
        name = encryptField(dek, tag.name, aad(owner));
      }
      db.prepare('INSERT INTO "tag" ("id","name","ownerSub") VALUES (?,?,?)').run(
        tag.id,
        name,
        tag.ownerSub ?? null,
      );
    }
    for (const [noteId, tagId] of fx.links ?? []) {
      db.prepare('INSERT INTO "note_tag" ("noteId","tagId") VALUES (?,?)').run(noteId, tagId);
    }
  } finally {
    db.close();
  }
}

interface TagsFixture {
  keys?: Record<string, Buffer>;
  tags?: TagRow[];
}

function createTagsDb(path: string, fx: TagsFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    db.exec(TAGS_SCHEMA);
    for (const [sub, dek] of Object.entries(fx.keys ?? {})) {
      db.prepare(
        'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,1,?)',
      ).run(sub, wrapDek(dek, TAGS_KEY), '2026-01-01 00:00:00');
    }
    for (const tag of fx.tags ?? []) {
      let name = tag.name;
      if (tag.encrypt) {
        const dek = (fx.keys ?? {})[tag.ownerSub ?? LEGACY_OWNER];
        if (!dek) throw new Error(`fixture missing registry DEK for ${tag.ownerSub}`);
        name = encryptField(dek, tag.name, aad(tag.ownerSub ?? LEGACY_OWNER));
      }
      db.prepare(
        'INSERT INTO "tag" ("id","name","ownerSub","version","createdAt") VALUES (?,?,?,0,?)',
      ).run(
        tag.id,
        name,
        tag.ownerSub ?? LEGACY_OWNER,
        '2026-01-01 00:00:00',
      );
    }
  } finally {
    db.close();
  }
}

function rawRegistry(path: string): Array<{ id: number; name: string; ownerSub: string }> {
  const db = open(path, true);
  try {
    return db
      .prepare('SELECT "id","name","ownerSub" FROM "tag" ORDER BY "id"')
      .all() as Array<{ id: number; name: string; ownerSub: string }>;
  } finally {
    db.close();
  }
}

function decryptRegistryName(path: string, id: number): string {
  const db = open(path, true);
  try {
    const row = db
      .prepare('SELECT "name","ownerSub" FROM "tag" WHERE "id" = ?')
      .get(id) as { name: string; ownerSub: string };
    const keyRow = db
      .prepare('SELECT "wrappedDek" FROM "user_keys" WHERE "sub" = ?')
      .get(row.ownerSub) as { wrappedDek: string };
    return decryptField(unwrapDek(keyRow.wrappedDek, TAGS_KEY), row.name, aad(row.ownerSub));
  } finally {
    db.close();
  }
}

function noteTagRows(path: string): Array<{ noteId: string; tagId: number }> {
  const db = open(path, true);
  try {
    return db
      .prepare('SELECT "noteId","tagId" FROM "note_tag" ORDER BY "noteId","tagId"')
      .all() as Array<{ noteId: string; tagId: number }>;
  } finally {
    db.close();
  }
}

function tableExists(path: string, table: string): boolean {
  const db = open(path, true);
  try {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(table) !== undefined
    );
  } finally {
    db.close();
  }
}

function tableInfo(path: string, table: string): Array<{ name: string; pk: number }> {
  const db = open(path, true);
  try {
    return db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>;
  } finally {
    db.close();
  }
}

function fkList(
  path: string,
  table: string,
): Array<{ table: string; from: string; to: string; on_delete: string }> {
  const db = open(path, true);
  try {
    return db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;
  } finally {
    db.close();
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function envFor(dir: string, note: string, tags: string): NodeJS.ProcessEnv {
  return { INIT_CWD: dir, NOTE_DB_PATH: note, TAGS_DB_PATH: tags };
}

describe('import-tags migration (SPEC-tags-extraction)', () => {
  const savedNote = process.env.NOTE_MASTER_KEY;
  const savedTags = process.env.TAGS_MASTER_KEY;

  beforeAll(() => {
    process.env.NOTE_MASTER_KEY = NOTE_KEY.toString('base64');
    process.env.TAGS_MASTER_KEY = TAGS_KEY.toString('base64');
  });

  afterAll(() => {
    if (savedNote === undefined) delete process.env.NOTE_MASTER_KEY;
    else process.env.NOTE_MASTER_KEY = savedNote;
    if (savedTags === undefined) delete process.env.TAGS_MASTER_KEY;
    else process.env.TAGS_MASTER_KEY = savedTags;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('imports id-preservingly and leaves note_tag values untouched', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [
        { id: 1, name: 'Work', ownerSub: 'u1', encrypt: true },
        { id: 2, name: 'home', ownerSub: 'u2' }, // legacy plaintext
      ],
      deks: { u1: DEK_U1 },
      links: [
        ['n1', 1],
        ['n1', 2],
      ],
    });

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.imported).toBe(2);
    expect(report.skipped).toBe(0);
    expect(report.merges).toBe(0);
    expect(report.keysCreated).toBe(2);

    expect(rawRegistry(tags).map((r) => r.id)).toEqual([1, 2]);
    expect(rawRegistry(tags).map((r) => r.ownerSub)).toEqual(['u1', 'u2']);
    expect(decryptRegistryName(tags, 1)).toBe('Work');
    expect(decryptRegistryName(tags, 2)).toBe('home');

    // Association values are untouched by the import (surgery only changes DDL).
    expect(noteTagRows(note)).toEqual([
      { noteId: 'n1', tagId: 1 },
      { noteId: 'n1', tagId: 2 },
    ]);
    expect(tableExists(note, 'tag')).toBe(false);
  });

  it('is idempotent: a second apply changes nothing and reuses byte-identical ciphertext', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Work', ownerSub: 'u1', encrypt: true }],
      deks: { u1: DEK_U1 },
      links: [['n1', 1]],
    });

    applyImport(note, tags, NOTE_KEY, TAGS_KEY);
    const registryBefore = rawRegistry(tags);
    const noteHash = sha256(note);
    const tagsHash = sha256(tags);

    const second = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.merges).toBe(0);
    expect(second.keysCreated).toBe(0);
    expect(rawRegistry(tags)).toEqual(registryBefore);
    expect(sha256(note)).toBe(noteHash);
    expect(sha256(tags)).toBe(tagsHash);
  });

  it('skips ids already present without re-encrypting them (import-layer idempotence)', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [
        { id: 1, name: 'Work', ownerSub: 'u1', encrypt: true },
        { id: 2, name: 'Home', ownerSub: 'u1', encrypt: true },
      ],
      deks: { u1: DEK_U1 },
      links: [
        ['n1', 1],
        ['n1', 2],
      ],
    });

    bootstrapRegistrySchema(tags);
    importTags(note, tags, NOTE_KEY, TAGS_KEY);
    const registryBefore = rawRegistry(tags);

    const second = importTags(note, tags, NOTE_KEY, TAGS_KEY);

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.merges).toBe(0);
    expect(rawRegistry(tags)).toEqual(registryBefore);
  });

  it('dry-run writes nothing and its counts match apply', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [
        { id: 1, name: 'Work', ownerSub: 'u1', encrypt: true },
        { id: 2, name: 'work', ownerSub: 'u1', encrypt: true }, // case variant
      ],
      deks: { u1: DEK_U1 },
      links: [
        ['n1', 1],
        ['n1', 2],
      ],
    });

    const noteHash = sha256(note);
    const plan = planImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(existsSync(tags)).toBe(false); // dry-run never creates the registry
    expect(sha256(note)).toBe(noteHash); // dry-run never writes the note DB
    expect(plan.mode).toBe('plan');

    const apply = applyImport(note, tags, NOTE_KEY, TAGS_KEY);
    expect(plan.imported).toBe(apply.imported);
    expect(plan.skipped).toBe(apply.skipped);
    expect(plan.merges).toBe(apply.merges);
    expect(plan.keysCreated).toBe(apply.keysCreated);
  });

  it('files NULL-owner rows under the _legacy_ sentinel and round-trips them', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Legacy', ownerSub: null }],
      links: [['n1', 1]],
    });

    applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    const [row] = rawRegistry(tags);
    expect(row.ownerSub).toBe(LEGACY_OWNER);
    expect(row.name.startsWith('enc.v1.')).toBe(true);
    expect(decryptRegistryName(tags, 1)).toBe('Legacy');
  });

  it('stores legacy plaintext input as registry envelopes', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'PlainName', ownerSub: 'u1' }],
      links: [['n1', 1]],
    });

    applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    const [row] = rawRegistry(tags);
    expect(row.name.startsWith('enc.v1.')).toBe(true);
    expect(row.name).not.toContain('PlainName');
    expect(decryptRegistryName(tags, 1)).toBe('PlainName');
  });

  it('aborts a poisoned batch, surfaces the row id, and exits non-zero', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [
        { id: 1, name: 'One', ownerSub: 'u1' },
        { id: 2, name: 'Two', ownerSub: 'u1' },
        { id: 3, name: 'Three', ownerSub: 'u1' },
      ],
      links: [['n1', 1]],
    });

    const poison: FieldEncryptor = (dek, plaintext, aadStr, ctx) => {
      if (ctx.id === 2) throw new Error('poisoned row');
      return encryptField(dek, plaintext, aadStr);
    };

    let thrown: unknown;
    try {
      applyImport(note, tags, NOTE_KEY, TAGS_KEY, { batchSize: 2, encryptField: poison });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ImportRowError);
    expect((thrown as ImportRowError).rowId).toBe(2);
    expect((thrown as Error).message).toContain('2');

    // The whole batch [1, 2] rolled back: no row was written.
    expect(rawRegistry(tags)).toEqual([]);

    const print = jest.fn();
    const printError = jest.fn();
    const code = main([], {
      env: envFor(dir, note, tags),
      print,
      printError,
      options: { batchSize: 2, encryptField: poison },
    });
    expect(code).toBe(1);
    expect(printError.mock.calls.join(' ')).toContain('2');
  });

  it('performs schema surgery: no tag table, note_tag rebuilt without the tag FK', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Work', ownerSub: 'u1' }],
      links: [['n1', 1]],
    });

    applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(tableExists(note, 'tag')).toBe(false);
    const columns = tableInfo(note, 'note_tag');
    expect(columns.map((c) => c.name)).toEqual(['noteId', 'tagId']);
    expect(columns.map((c) => c.pk)).toEqual([1, 2]);

    const fks = fkList(note, 'note_tag');
    expect(fks.some((f) => f.table === 'tag')).toBe(false);
    const noteFk = fks.find((f) => f.table === 'note');
    expect(noteFk?.from).toBe('noteId');
    expect(noteFk?.to).toBe('id');
    expect(noteFk?.on_delete).toBe('CASCADE');

    const db = open(note);
    try {
      // No FK to an external vocabulary: an arbitrary registry id is insertable.
      db.prepare('INSERT INTO "note_tag" ("noteId","tagId") VALUES (?,?)').run('n1', 999);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('backs up every existing DB before any write; an absent tags.db is skipped, not an error', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Work', ownerSub: 'u1' }],
      links: [['n1', 1]],
    });
    expect(existsSync(tags)).toBe(false);

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.noteBackupPath).toContain('.pre-import-');
    expect(existsSync(report.noteBackupPath as string)).toBe(true);
    expect(report.tagsBackupPath).toBeNull();
    // The snapshot captured the pre-migration state (tag table still present).
    expect(tableExists(report.noteBackupPath as string, 'tag')).toBe(true);
  });

  it('aborts before any write when a backup fails its check', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Work', ownerSub: 'u1' }],
      links: [['n1', 1]],
    });
    writeFileSync(note, 'this is not a sqlite database');

    expect(() => applyImport(note, tags, NOTE_KEY, TAGS_KEY)).toThrow();
    expect(existsSync(tags)).toBe(false); // aborted before the bootstrap write
  });

  it('merges case-variant duplicates onto the lowest id, dedupes, and repoints note_tag', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1', 'n2'],
      tags: [
        { id: 1, name: 'Work', ownerSub: 'u1', encrypt: true },
        { id: 2, name: 'work', ownerSub: 'u1', encrypt: true },
      ],
      deks: { u1: DEK_U1 },
      links: [
        ['n1', 1],
        ['n1', 2],
        ['n2', 2],
      ],
    });

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.imported).toBe(1);
    expect(report.merges).toBe(1);
    expect(rawRegistry(tags).map((r) => r.id)).toEqual([1]);
    expect(decryptRegistryName(tags, 1)).toBe('Work');
    // The note linked to BOTH variants keeps exactly one association (dedupe),
    // and the note linked only to the variant is repointed.
    expect(noteTagRows(note)).toEqual([
      { noteId: 'n1', tagId: 1 },
      { noteId: 'n2', tagId: 1 },
    ]);
  });

  it('merges case-variants within the _legacy_ sentinel owner', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [
        { id: 1, name: 'Work', ownerSub: null },
        { id: 2, name: 'work', ownerSub: null },
      ],
      links: [
        ['n1', 1],
        ['n1', 2],
      ],
    });

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.merges).toBe(1);
    expect(rawRegistry(tags).map((r) => r.id)).toEqual([1]);
    expect(rawRegistry(tags)[0].ownerSub).toBe(LEGACY_OWNER);
    expect(noteTagRows(note)).toEqual([{ noteId: 'n1', tagId: 1 }]);
  });

  it('merges a source row that collides with an existing registry id', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createTagsDb(tags, {
      keys: { u1: DEK_TAGS_U1 },
      tags: [{ id: 5, name: 'Work', ownerSub: 'u1', encrypt: true }],
    });
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 9, name: 'work', ownerSub: 'u1' }],
      links: [['n1', 9]],
    });

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.imported).toBe(0);
    expect(report.merges).toBe(1);
    expect(rawRegistry(tags).map((r) => r.id)).toEqual([5]);
    expect(noteTagRows(note)).toEqual([{ noteId: 'n1', tagId: 5 }]);
  });

  it('handles an empty source DB idempotently', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, { notes: ['n1'], tags: [], links: [] });

    const report = applyImport(note, tags, NOTE_KEY, TAGS_KEY);

    expect(report.imported).toBe(0);
    expect(report.merges).toBe(0);
    expect(tableExists(tags, 'tag')).toBe(true);
    expect(tableExists(note, 'tag')).toBe(false);
  });

  it('main prints the exact report line and honours --dry-run', () => {
    const dir = tmpDir();
    const note = join(dir, 'life.db');
    const tags = join(dir, 'tags.db');
    createNoteDb(note, {
      notes: ['n1'],
      tags: [{ id: 1, name: 'Work', ownerSub: 'u1' }],
      links: [['n1', 1]],
    });

    const planPrint = jest.fn();
    expect(main(['--dry-run'], { env: envFor(dir, note, tags), print: planPrint })).toBe(0);
    expect(planPrint.mock.calls.join(' ')).toContain('import-tags [plan]:');
    expect(existsSync(tags)).toBe(false);

    const applyPrint = jest.fn();
    expect(main([], { env: envFor(dir, note, tags), print: applyPrint })).toBe(0);
    expect(applyPrint.mock.calls.join(' ')).toContain(
      'import-tags [apply]: imported=1 skipped=0 merges=0 keysCreated=1 errors=0',
    );
  });

  it('formats the report line exactly', () => {
    const report: ImportReport = {
      mode: 'apply',
      imported: 3,
      skipped: 1,
      merges: 2,
      keysCreated: 4,
      errors: 0,
      noteBackupPath: null,
      tagsBackupPath: null,
      surgeryActions: [],
    };
    expect(formatImportReport(report)).toBe(
      'import-tags [apply]: imported=3 skipped=1 merges=2 keysCreated=4 errors=0',
    );
  });
});
