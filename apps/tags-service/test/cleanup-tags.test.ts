import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  applyCleanup,
  defaultCleanupPaths,
  formatCleanupReport,
  formatOrphanLine,
  planCleanup,
  resolvePaths,
  type CleanupReport,
} from '../src/tags/cleanup.js';
import { main } from '../scripts/cleanup-tags.js';

/**
 * `SPEC-tags-service` `## Maintenance scripts` → `cleanup-tags` case list.
 * Every fixture is a throwaway DB under the OS temp dir — this suite NEVER
 * opens anything under the app data directories (the hard line in the plan). The env
 * fixture deliberately omits `TAGS_MASTER_KEY`: the cleanup path must never
 * require decryption.
 */

type Db = Database.Database;

const TAGS_SCHEMA =
  'CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
  '"name" text NOT NULL, "ownerSub" text NOT NULL, "version" integer NOT NULL DEFAULT (0), ' +
  '"createdAt" datetime NOT NULL);';
const TAG_OWNER_INDEX_SCHEMA = 'CREATE INDEX "IDX_tag_owner_sub" ON "tag" ("ownerSub");';

const NOTE_SCHEMA =
  'CREATE TABLE "note" ("id" varchar PRIMARY KEY NOT NULL, "body" text NOT NULL DEFAULT \'\', ' +
  '"ownerSub" text, "version" integer NOT NULL DEFAULT (0), "deletedAt" datetime, ' +
  '"createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')), ' +
  '"updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\')));';
const NOTE_TAG_SCHEMA =
  'CREATE TABLE "note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, ' +
  'PRIMARY KEY ("noteId","tagId"));';

const TODO_SCHEMA =
  'CREATE TABLE "todo" ("id" varchar PRIMARY KEY NOT NULL, "deletedAt" datetime);';
const TODO_TAG_SCHEMA =
  'CREATE TABLE "todo_tag" ("todoId" varchar NOT NULL, "tagId" integer NOT NULL, ' +
  'PRIMARY KEY ("todoId","tagId"));';

/** Pre-migration note-DB vocabulary, dropped by the import migration (never a reference source). */
const LEGACY_TAG_SCHEMA =
  'CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
  '"name" text NOT NULL, "ownerSub" text);';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-tags-'));
  dirs.push(dir);
  return dir;
}

function open(path: string, readonly = false): Db {
  return new Database(path, readonly ? { readonly: true } : {});
}

interface TagsFixture {
  tags?: Array<{ id: number; ownerSub: string; name?: string }>;
}

function createTagsDb(path: string, fx: TagsFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    db.exec(TAGS_SCHEMA);
    db.exec(TAG_OWNER_INDEX_SCHEMA);
    for (const tag of fx.tags ?? []) {
      db.prepare(
        'INSERT INTO "tag" ("id","name","ownerSub","version","createdAt") VALUES (?,?,?,0,?)',
      ).run(tag.id, tag.name ?? 'enc.v1.test', tag.ownerSub, '2026-01-01 00:00:00');
    }
  } finally {
    db.close();
  }
}

interface NoteFixture {
  notes?: Array<{ id: string; deletedAt?: string | null }>;
  links?: Array<[string, number]>;
  /** `false` builds a `life.db` with no `note_tag` table (test 10). */
  noteTag?: boolean;
  /** Pre-migration `tag` rows left in `life.db` (test 11 — must be ignored). */
  legacyTagIds?: number[];
}

function createNoteDb(path: string, fx: NoteFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    db.exec(NOTE_SCHEMA);
    if (fx.noteTag !== false) db.exec(NOTE_TAG_SCHEMA);
    for (const note of fx.notes ?? []) {
      db.prepare('INSERT INTO "note" ("id","deletedAt") VALUES (?,?)').run(
        note.id,
        note.deletedAt ?? null,
      );
    }
    for (const [noteId, tagId] of fx.links ?? []) {
      db.prepare('INSERT INTO "note_tag" ("noteId","tagId") VALUES (?,?)').run(noteId, tagId);
    }
    if (fx.legacyTagIds !== undefined) {
      db.exec(LEGACY_TAG_SCHEMA);
      for (const id of fx.legacyTagIds) {
        db.prepare('INSERT INTO "tag" ("id","name","ownerSub") VALUES (?,?,?)').run(
          id,
          'legacy',
          'u1',
        );
      }
    }
  } finally {
    db.close();
  }
}

interface TodoFixture {
  todos?: Array<{ id: string; deletedAt?: string | null }>;
  links?: Array<[string, number]>;
  /** `false` builds a `todo.db` with no `todo_tag` table. */
  todoTag?: boolean;
}

function createTodoDb(path: string, fx: TodoFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = open(path);
  try {
    db.exec(TODO_SCHEMA);
    if (fx.todoTag !== false) db.exec(TODO_TAG_SCHEMA);
    for (const todo of fx.todos ?? []) {
      db.prepare('INSERT INTO "todo" ("id","deletedAt") VALUES (?,?)').run(
        todo.id,
        todo.deletedAt ?? null,
      );
    }
    for (const [todoId, tagId] of fx.links ?? []) {
      db.prepare('INSERT INTO "todo_tag" ("todoId","tagId") VALUES (?,?)').run(todoId, tagId);
    }
  } finally {
    db.close();
  }
}

function envFor(dir: string, note: string, todo: string, tags: string): NodeJS.ProcessEnv {
  // Deliberately no `TAGS_MASTER_KEY`: the cleanup path must never need it.
  return { INIT_CWD: dir, NOTE_DB_PATH: note, TODO_DB_PATH: todo, TAGS_DB_PATH: tags };
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function registryRows(path: string): Array<{ id: number; ownerSub: string }> {
  const db = open(path, true);
  try {
    return db.prepare('SELECT "id","ownerSub" FROM "tag" ORDER BY "id"').all() as Array<{
      id: number;
      ownerSub: string;
    }>;
  } finally {
    db.close();
  }
}

function backupFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes('.pre-cleanup-'));
}

interface Fixture {
  dir: string;
  note: string;
  todo: string;
  tags: string;
  paths: { noteDbPath: string; todoDbPath: string; tagsDbPath: string };
}

function makeFixture(): { dir: string; note: string; todo: string; tags: string } {
  const dir = tmpDir();
  return {
    dir,
    note: join(dir, 'life.db'),
    todo: join(dir, 'todo.db'),
    tags: join(dir, 'tags.db'),
  };
}

function pathsFor(fx: { note: string; todo: string; tags: string }): Fixture['paths'] {
  return { noteDbPath: fx.note, todoDbPath: fx.todo, tagsDbPath: fx.tags };
}

describe('cleanup-tags orphan registry cleanup (SPEC-tags-service)', () => {
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('1. deletes nothing when every registry row is referenced', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, {
      notes: [{ id: 'n1' }],
      links: [
        ['n1', 1],
        ['n1', 2],
      ],
    });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.mode).toBe('apply');
    expect(report.scanned).toBe(2);
    expect(report.referenced).toBe(2);
    expect(report.orphans).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.errors).toBe(0);
    expect(formatCleanupReport(report)).toBe(
      'cleanup-tags [apply]: scanned=2 referenced=2 orphans=0 deleted=0 errors=0',
    );
    expect(registryRows(fx.tags)).toEqual([
      { id: 1, ownerSub: 'u1' },
      { id: 2, ownerSub: 'u1' },
    ]);
  });

  it('2. deletes an unreferenced row on apply', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.mode).toBe('apply');
    expect(report.scanned).toBe(2);
    expect(report.referenced).toBe(1);
    expect(report.orphans).toBe(1);
    expect(report.deleted).toBe(1);
    expect(report.errors).toBe(0);
    expect(formatCleanupReport(report)).toBe(
      'cleanup-tags [apply]: scanned=2 referenced=1 orphans=1 deleted=1 errors=0',
    );
    expect(registryRows(fx.tags)).toEqual([{ id: 1, ownerSub: 'u1' }]);
  });

  it('3. KEPT: only a TRASHED note holds the tag (deletedAt never filters)', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, { tags: [{ id: 1, ownerSub: 'u1' }] });
    createNoteDb(fx.note, {
      notes: [{ id: 'n1', deletedAt: '2026-01-01 00:00:00' }],
      links: [['n1', 1]],
    });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.orphans).toBe(0);
    expect(report.deleted).toBe(0);
    expect(registryRows(fx.tags)).toEqual([{ id: 1, ownerSub: 'u1' }]);
  });

  it('4. KEPT: only a TRASHED todo holds the tag', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, { tags: [{ id: 1, ownerSub: 'u1' }] });
    createNoteDb(fx.note, { notes: [], links: [] });
    createTodoDb(fx.todo, {
      todos: [{ id: 't1', deletedAt: '2026-01-01 00:00:00' }],
      links: [['t1', 1]],
    });

    const report = applyCleanup(pathsFor(fx));

    expect(report.orphans).toBe(0);
    expect(report.deleted).toBe(0);
    expect(registryRows(fx.tags)).toEqual([{ id: 1, ownerSub: 'u1' }]);
  });

  it('5. KEPT: a live note holds the tag', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, { tags: [{ id: 1, ownerSub: 'u1' }] });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.orphans).toBe(0);
    expect(registryRows(fx.tags)).toEqual([{ id: 1, ownerSub: 'u1' }]);
  });

  it('6. cross-owner isolation: deletes both orphans, keeps both referenced rows', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
        { id: 3, ownerSub: 'u2' },
        { id: 4, ownerSub: 'u2' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [{ id: 't1' }], links: [['t1', 4]] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.orphans).toBe(2);
    expect(report.orphanRows).toEqual([
      { id: 2, ownerSub: 'u1' },
      { id: 3, ownerSub: 'u2' },
    ]);
    expect(registryRows(fx.tags)).toEqual([
      { id: 1, ownerSub: 'u1' },
      { id: 4, ownerSub: 'u2' },
    ]);
  });

  it('7. dry-run leaves all three DBs byte-identical and writes no backup', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const before = { tags: sha256(fx.tags), note: sha256(fx.note), todo: sha256(fx.todo) };
    const paths = pathsFor(fx);

    const plan = planCleanup(paths);
    expect(plan.mode).toBe('plan');
    expect(plan.deleted).toBe(0);
    expect(plan.backupPath).toBeNull();

    const print = jest.fn();
    expect(main(['--dry-run'], { env: envFor(fx.dir, fx.note, fx.todo, fx.tags), print })).toBe(0);
    const lines = print.mock.calls.map((c: string[]) => c[0] as string);
    expect(lines[0]).toContain('cleanup-tags [plan]:');
    expect(lines[0]).toContain('deleted=0');

    expect(sha256(fx.tags)).toBe(before.tags);
    expect(sha256(fx.note)).toBe(before.note);
    expect(sha256(fx.todo)).toBe(before.todo);
    expect(backupFiles(fx.dir)).toEqual([]);
  });

  it('8. apply writes a verified backup that still holds the pre-delete state', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.backupPath).not.toBeNull();
    expect(report.backupPath).toContain('.pre-cleanup-');
    const backupPath = report.backupPath as string;
    expect(existsSync(backupPath)).toBe(true);
    const copy = open(backupPath, true);
    try {
      const check = copy.prepare('PRAGMA quick_check').get() as { quick_check: string };
      expect(check.quick_check).toBe('ok');
      const rows = copy.prepare('SELECT "id" FROM "tag" ORDER BY "id"').all() as Array<{
        id: number;
      }>;
      expect(rows.map((r) => r.id)).toEqual([1, 2]);
    } finally {
      copy.close();
    }
  });

  it('9. missing todo.db → exit 1, no deletion, no backup', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    // `todo.db` intentionally never created.

    const before = sha256(fx.tags);
    const print = jest.fn();
    const printError = jest.fn();
    const code = main([], { env: envFor(fx.dir, fx.note, fx.todo, fx.tags), print, printError });

    expect(code).toBe(1);
    expect(print.mock.calls).toHaveLength(0);
    expect(printError.mock.calls.join(' ')).toContain('todo.db');
    expect(sha256(fx.tags)).toBe(before);
    expect(backupFiles(fx.dir)).toEqual([]);
  });

  it('10. an existing DB with no note_tag table contributes the empty set', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [], links: [], noteTag: false });
    createTodoDb(fx.todo, { todos: [{ id: 't1' }], links: [['t1', 1]] });

    const print = jest.fn();
    const code = main([], { env: envFor(fx.dir, fx.note, fx.todo, fx.tags), print });

    expect(code).toBe(0);
    expect(print.mock.calls[0][0]).toBe(
      'cleanup-tags [apply]: scanned=2 referenced=1 orphans=1 deleted=1 errors=0',
    );
    expect(registryRows(fx.tags)).toEqual([{ id: 1, ownerSub: 'u1' }]);
  });

  it('11. never reads the legacy `tag` table in the note DB', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, { tags: [{ id: 1, ownerSub: 'u1' }] });
    createNoteDb(fx.note, { notes: [], links: [], legacyTagIds: [1] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const report = applyCleanup(pathsFor(fx));

    expect(report.scanned).toBe(1);
    expect(report.referenced).toBe(0);
    expect(report.orphans).toBe(1);
    expect(report.deleted).toBe(1);
    expect(registryRows(fx.tags)).toEqual([]);
  });

  it('12. needs no TAGS_MASTER_KEY and never logs the fixture name', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, { tags: [{ id: 5, ownerSub: 'sub-a', name: 'enc.v1.test' }] });
    createNoteDb(fx.note, { notes: [], links: [] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const env = envFor(fx.dir, fx.note, fx.todo, fx.tags);
    expect(env.TAGS_MASTER_KEY).toBeUndefined();

    const print = jest.fn();
    const code = main([], { env, print });

    expect(code).toBe(0);
    const lines = print.mock.calls.map((c: string[]) => c[0] as string);
    expect(lines).toContain('orphan id=5 owner=sub-a');
    expect(lines.join('\n')).not.toContain('enc.v1.test');
  });

  it('13. formats the summary and detail lines exactly', () => {
    const plan: CleanupReport = {
      mode: 'plan',
      scanned: 3,
      referenced: 2,
      orphans: 1,
      deleted: 0,
      errors: 0,
      backupPath: null,
      orphanRows: [],
    };
    expect(formatCleanupReport(plan)).toBe(
      'cleanup-tags [plan]: scanned=3 referenced=2 orphans=1 deleted=0 errors=0',
    );

    const apply: CleanupReport = {
      mode: 'apply',
      scanned: 1,
      referenced: 0,
      orphans: 1,
      deleted: 1,
      errors: 0,
      backupPath: '/tmp/tags.db.pre-import-2026',
      orphanRows: [],
    };
    expect(formatCleanupReport(apply)).toBe(
      'cleanup-tags [apply]: scanned=1 referenced=0 orphans=1 deleted=1 errors=0',
    );

    expect(formatOrphanLine({ id: 7, ownerSub: 'sub-a' })).toBe('orphan id=7 owner=sub-a');
  });

  it('14. plan and apply agree on the same fixture', () => {
    const fx = makeFixture();
    createTagsDb(fx.tags, {
      tags: [
        { id: 1, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
        { id: 3, ownerSub: 'u2' },
      ],
    });
    createNoteDb(fx.note, { notes: [{ id: 'n1' }], links: [['n1', 1]] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const paths = pathsFor(fx);
    const plan = planCleanup(paths);
    const apply = applyCleanup(paths);

    expect(plan.scanned).toBe(apply.scanned);
    expect(plan.referenced).toBe(apply.referenced);
    expect(plan.orphans).toBe(apply.orphans);
    expect(plan.scanned).toBe(3);
    expect(plan.referenced).toBe(1);
    expect(plan.orphans).toBe(2);
  });

  it('15. anchors the default paths at the repo root and honours env overrides', () => {
    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    // `defaultCleanupPaths` is what `src/tags/paths.ts` calls at CLI startup,
    // with `import.meta.dirname` in place of this literal.
    const defaults = defaultCleanupPaths(join(import.meta.dirname, '..', 'src', 'tags'));
    expect(defaults.noteDbPath).toBe(join(repoRoot, 'apps', 'note-service', 'data', 'life.db'));
    expect(defaults.todoDbPath).toBe(join(repoRoot, 'apps', 'todo-service', 'data', 'todo.db'));
    expect(defaults.tagsDbPath).toBe(join(repoRoot, 'apps', 'tags-service', 'data', 'tags.db'));
    expect(defaults.noteDbPath).not.toContain(join('apps', 'apps'));

    const fx = makeFixture();
    const env = envFor(fx.dir, fx.note, fx.todo, fx.tags);
    expect(resolvePaths(env, defaults)).toEqual({
      noteDbPath: fx.note,
      todoDbPath: fx.todo,
      tagsDbPath: fx.tags,
    });
    // String assertions only: nothing under apps/*/data/** is ever opened here.
  });

  it('16. prints the summary first, then orphan lines in ascending id order', () => {
    const fx = makeFixture();
    // Inserted out of order (9 before 2) so ORDER BY id is observable.
    createTagsDb(fx.tags, {
      tags: [
        { id: 9, ownerSub: 'u1' },
        { id: 2, ownerSub: 'u1' },
      ],
    });
    createNoteDb(fx.note, { notes: [], links: [] });
    createTodoDb(fx.todo, { todos: [], links: [] });

    const paths = pathsFor(fx);
    const plan = planCleanup(paths);
    expect(plan.orphans).toBe(plan.orphanRows.length);
    expect(plan.orphans).toBe(2);

    const print = jest.fn();
    const code = main(['--dry-run'], {
      env: envFor(fx.dir, fx.note, fx.todo, fx.tags),
      print,
    });
    expect(code).toBe(0);

    const lines = print.mock.calls.map((c: string[]) => c[0] as string);
    expect(lines[0]).toBe(
      'cleanup-tags [plan]: scanned=2 referenced=0 orphans=2 deleted=0 errors=0',
    );
    expect(lines.slice(1)).toEqual(['orphan id=2 owner=u1', 'orphan id=9 owner=u1']);

    const details = lines.filter((l: string) => l.startsWith('orphan id='));
    expect(details).toHaveLength(plan.orphans);
  });
});
