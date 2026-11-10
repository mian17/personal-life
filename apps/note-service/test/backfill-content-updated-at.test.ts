import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import {
  applySchema,
  backfillContentUpdatedAt,
  runBackfill,
} from '../scripts/backfill-content-updated-at.js';

/**
 * `contentUpdatedAt` backfill script — step semantics on a throwaway legacy DB.
 * This suite NEVER opens anything under `apps/note-service/data/` (the hard line).
 *
 * The fixture is the pre-deploy schema: `note` without `contentUpdatedAt`, rows
 * whose `createdAt` and `updatedAt` differ (retag/trash/restore bump `updatedAt`),
 * so "copies createdAt, never updatedAt" is assertable, not just documented.
 */

describe('backfill-content-updated-at', () => {
  let dir: string;
  let dbPath: string;

  const LEGACY_DDL =
    'CREATE TABLE "note" ("id" varchar PRIMARY KEY NOT NULL, "body" text NOT NULL, ' +
    '"createdAt" datetime NOT NULL, "updatedAt" datetime NOT NULL)';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'note-content-order-'));
    dbPath = join(dir, 'life.db');
    const db = new Database(dbPath);
    db.exec(LEGACY_DDL);
    const insert = db.prepare(
      'INSERT INTO "note" ("id","body","createdAt","updatedAt") VALUES (?,?,?,?)',
    );
    // createdAt deliberately != updatedAt on every row.
    insert.run('n1', 'one', '2026-01-01 00:00:00', '2026-02-01 00:00:00');
    insert.run('n2', 'two', '2026-01-02 00:00:00', '2026-02-02 00:00:00');
    insert.run('n3', 'three', '2026-01-03 00:00:00', '2026-02-03 00:00:00');
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const stampedValues = (): Array<{ id: string; contentUpdatedAt: string }> => {
    const db = new Database(dbPath);
    try {
      return db.prepare('SELECT "id","contentUpdatedAt" FROM "note" ORDER BY "id"').all() as Array<{
        id: string;
        contentUpdatedAt: string;
      }>;
    } finally {
      db.close();
    }
  };

  it('applySchema adds the column once and is a no-op afterwards', () => {
    expect(applySchema(dbPath)).toEqual({
      mutated: true,
      actions: ['added note.contentUpdatedAt'],
    });
    expect(applySchema(dbPath)).toEqual({ mutated: false, actions: [] });
  });

  it('backfills createdAt onto legacy rows and never updatedAt', () => {
    applySchema(dbPath);
    expect(backfillContentUpdatedAt(dbPath)).toEqual({ stamped: 3, alreadySet: 0 });
    const rows = stampedValues();
    // n1..n3 keep their distinct createdAts; every updatedAt here is later
    // (2026-02-*), so a single leaked updatedAt would show.
    expect(rows.map((r) => r.contentUpdatedAt)).toEqual([
      '2026-01-01 00:00:00',
      '2026-01-02 00:00:00',
      '2026-01-03 00:00:00',
    ]);
  });

  it('never re-stamps a row that already carries a timestamp', () => {
    applySchema(dbPath);
    backfillContentUpdatedAt(dbPath);
    const db = new Database(dbPath);
    db.prepare('UPDATE "note" SET "contentUpdatedAt" = ? WHERE "id" = ?').run(
      '2026-03-01 00:00:00',
      'n2',
    );
    db.close();
    // A re-run stamps zero; the body-edit-time on n2 survives.
    expect(backfillContentUpdatedAt(dbPath)).toEqual({ stamped: 0, alreadySet: 3 });
    expect(stampedValues().find((r) => r.id === 'n2')?.contentUpdatedAt).toBe(
      '2026-03-01 00:00:00',
    );
  });

  it('runBackfill backs up first, then migrates, and is idempotent', () => {
    const first = runBackfill({ NOTE_DB_PATH: dbPath });
    expect(first.backup.verified).toBe(true);
    expect(first.backup.quickCheck).toBe('ok');
    expect(first.backup.noteCount).toBe(3);
    expect(existsSync(first.backup.backupPath)).toBe(true);
    expect(first.schema.actions).toEqual(['added note.contentUpdatedAt']);
    expect(first.stamped).toEqual({ stamped: 3, alreadySet: 0 });

    const second = runBackfill({ NOTE_DB_PATH: dbPath });
    expect(second.schema.actions).toEqual([]);
    expect(second.stamped).toEqual({ stamped: 0, alreadySet: 3 });
  });
});
