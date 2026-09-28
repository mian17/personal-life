import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { decryptField, encryptField, unwrapDek, wrapDek } from '@life/crypto';
import { Note } from '../src/notes/note.entity';
import { NoteTag } from '../src/notes/note-tag.entity';
import { UserKeys } from '../src/keys/user-keys.entity';
import {
  BackfillRowError,
  applyBackfill,
  formatBackfillReport,
  planBackfill,
  type FieldEncryptor,
} from '../src/keys/backfill';
import { RotationRowError, rotateMasterKeys } from '../src/keys/rotation';

/**
 * `notes-backfill` T6 — migration + rotation cores (SPEC-notes-backfill).
 *
 * Every fixture DB is a throwaway under the OS temp dir; this suite NEVER opens
 * anything under `apps/note-service/data/` (the hard line). Master keys are
 * generated in-process with `randomBytes` — never read from the developer's
 * environment.
 */

interface Harness {
  ds: DataSource;
  dbPath: string;
  dir: string;
}

interface Fixture {
  notes: Array<{ id: string; body: string; ownerSub: string | null; deletedAt?: Date | null }>;
  tags: Array<{ id: number; name: string; ownerSub: string | null }>;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'note-backfill-'));
  const dbPath = join(dir, 'life.db');
  const ds = new DataSource({
    type: 'better-sqlite3',
    database: dbPath,
    entities: [Note, NoteTag, UserKeys],
    synchronize: true,
  });
  await ds.initialize();
  // The backfill script runs against historical (pre-extraction) note DBs, whose
  // `tag` table still holds encrypted names; the current entities no longer
  // declare `Tag`, so the fixture recreates that schema directly. The pre-backfill
  // schema also still has the legacy unique index the migration drops.
  await ds.query(
    'CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "ownerSub" text)',
  );
  await ds.query('CREATE UNIQUE INDEX "UQ_tag_name_owner" ON "tag" ("name", "ownerSub")');
  return { ds, dbPath, dir };
}

async function seed(h: Harness, fixture: Fixture): Promise<void> {
  for (const n of fixture.notes) {
    await h.ds.getRepository(Note).insert({
      id: n.id,
      body: n.body,
      ownerSub: n.ownerSub,
      version: 0,
      deletedAt: n.deletedAt ?? null,
    });
  }
  for (const t of fixture.tags) {
    await h.ds.query('INSERT INTO "tag" ("id","name","ownerSub") VALUES (?,?,?)', [
      t.id,
      t.name,
      t.ownerSub,
    ]);
  }
}

/** 2 owners + NULL owner + a trash row + case-variant tag names. */
function standardFixture(): { ids: Record<string, string>; fixture: Fixture } {
  const ids = {
    a: randomUUID(),
    b: randomUUID(),
    legacy: randomUUID(),
    trash: randomUUID(),
  };
  return {
    ids,
    fixture: {
      notes: [
        { id: ids.a, body: 'alpha secret', ownerSub: 'user-a' },
        { id: ids.b, body: 'beta note', ownerSub: 'user-b' },
        { id: ids.legacy, body: 'legacy body', ownerSub: null },
        {
          id: ids.trash,
          body: 'trashed body',
          ownerSub: 'user-a',
          deletedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ],
      tags: [
        { id: 1, name: 'Work', ownerSub: 'user-a' },
        { id: 2, name: 'work', ownerSub: 'user-a' },
        { id: 3, name: 'Legacy', ownerSub: null },
      ],
    },
  };
}

async function rawBody(ds: DataSource, id: string): Promise<string> {
  const rows = (await ds.query('SELECT body FROM "note" WHERE id = ?', [id])) as Array<{
    body: string;
  }>;
  return rows[0].body;
}

async function allNotes(ds: DataSource): Promise<Array<{ id: string; body: string }>> {
  return (await ds.query('SELECT id, body FROM "note" ORDER BY id')) as Array<{
    id: string;
    body: string;
  }>;
}

async function allTags(ds: DataSource): Promise<Array<{ id: number; name: string }>> {
  return (await ds.query('SELECT id, name FROM "tag" ORDER BY id')) as Array<{
    id: number;
    name: string;
  }>;
}

async function keyRows(
  ds: DataSource,
): Promise<Array<{ sub: string; wrappedDek: string; kekVersion: number }>> {
  return (await ds.query(
    'SELECT "sub", "wrappedDek", "kekVersion" FROM "user_keys" ORDER BY "sub"',
  )) as Array<{ sub: string; wrappedDek: string; kekVersion: number }>;
}

async function deksBySub(ds: DataSource, masterKey: Buffer): Promise<Map<string, Buffer>> {
  const rows = await keyRows(ds);
  return new Map(rows.map((r) => [r.sub, unwrapDek(r.wrappedDek, masterKey)]));
}

/** Flip one ciphertext byte of a `kw.v1` envelope, preserving base64url canonicity. */
function flipWrappedByte(wrapped: string): string {
  const [nonce, ct] = wrapped.slice('kw.v1.'.length).split('.');
  const raw = Buffer.from(ct, 'base64url');
  raw[0] = raw[0] ^ 0xff;
  return `kw.v1.${nonce}.${raw.toString('base64url')}`;
}

describe('notes-backfill T6: idempotent plaintext → envelope migration', () => {
  let h: Harness;
  const MASTER_KEY = randomBytes(32);

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.ds.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('apply encrypts every content row, provisions keys incl. _legacy_, and drops the unique index', async () => {
    const { fixture } = standardFixture();
    await seed(h, fixture);

    const report = await applyBackfill(h.ds, MASTER_KEY);

    expect(report.mode).toBe('apply');
    expect(report.encrypted).toBe(7);
    expect(report.skipped).toBe(0);
    expect(report.keysCreated).toBe(3);
    expect(report.errors).toBe(0);
    expect(report.indexDropped).toBe(true);

    for (const n of fixture.notes) {
      expect(await rawBody(h.ds, n.id)).toMatch(/^enc\.v1\./);
    }
    for (const t of await allTags(h.ds)) {
      expect(t.name).toMatch(/^enc\.v1\./);
    }

    const subs = (await keyRows(h.ds)).map((r) => r.sub);
    expect(subs).toEqual(['_legacy_', 'user-a', 'user-b']);

    const index = (await h.ds.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='UQ_tag_name_owner'",
    )) as unknown[];
    expect(index).toHaveLength(0);

    const formatted = formatBackfillReport(report);
    expect(formatted).toContain('encrypted=7');
    expect(formatted).toContain('keysCreated=3');
    expect(formatted).toContain('errors=0');
  });

  it('tolerates an absent `tag` table (post-`tags-extraction` note DB): notes only, no error', async () => {
    const { fixture } = standardFixture();
    await seed(h, fixture);
    // The migration drops the note DB's `tag` table; tag names now live in
    // `tags-service`. The historical backfill must still run without error.
    await h.ds.query('DROP TABLE "tag"');

    const report = await applyBackfill(h.ds, MASTER_KEY);

    // 4 note rows (the 3 tag rows are gone); owners user-a, user-b, _legacy_.
    expect(report.encrypted).toBe(4);
    expect(report.skipped).toBe(0);
    expect(report.keysCreated).toBe(3);
    expect(report.errors).toBe(0);
    for (const n of fixture.notes) {
      expect(await rawBody(h.ds, n.id)).toMatch(/^enc\.v1\./);
    }
  });

  it('is idempotent: a second apply skips everything and leaves ciphertext byte-identical', async () => {
    const { fixture } = standardFixture();
    await seed(h, fixture);
    await applyBackfill(h.ds, MASTER_KEY);

    const beforeNotes = new Map((await allNotes(h.ds)).map((n) => [n.id, n.body]));
    const beforeTags = (await allTags(h.ds)).map((t) => t.name);

    const second = await applyBackfill(h.ds, MASTER_KEY);

    expect(second.encrypted).toBe(0);
    expect(second.skipped).toBe(7);
    expect(second.keysCreated).toBe(0);
    expect(second.errors).toBe(0);

    for (const n of await allNotes(h.ds)) {
      expect(n.body).toBe(beforeNotes.get(n.id));
    }
    expect((await allTags(h.ds)).map((t) => t.name)).toEqual(beforeTags);
  });

  it('round-trips the plaintext through the provisioned DEK with the byte-exact AAD shapes', async () => {
    const { ids, fixture } = standardFixture();
    await seed(h, fixture);
    await applyBackfill(h.ds, MASTER_KEY);

    const deks = await deksBySub(h.ds, MASTER_KEY);

    // Note AAD binds the row uuid; normal owners use their real sub...
    expect(
      decryptField(
        deks.get('user-a')!,
        await rawBody(h.ds, ids.a),
        `life.v1|user-a|note|body|${ids.a}`,
      ),
    ).toBe('alpha secret');
    expect(
      decryptField(
        deks.get('user-b')!,
        await rawBody(h.ds, ids.b),
        `life.v1|user-b|note|body|${ids.b}`,
      ),
    ).toBe('beta note');
    // ...and a NULL-owner row uses the `_legacy_` sentinel that also files its key.
    expect(
      decryptField(
        deks.get('_legacy_')!,
        await rawBody(h.ds, ids.legacy),
        `life.v1|_legacy_|note|body|${ids.legacy}`,
      ),
    ).toBe('legacy body');

    // Tag AAD binds owner+field only (tag ids are DB-assigned post-insert).
    const tags = await allTags(h.ds);
    expect(decryptField(deks.get('user-a')!, tags[0].name, 'life.v1|user-a|tag|name')).toBe('Work');
    expect(decryptField(deks.get('user-a')!, tags[1].name, 'life.v1|user-a|tag|name')).toBe('work');
    expect(
      decryptField(deks.get('_legacy_')!, tags[2].name, 'life.v1|_legacy_|tag|name'),
    ).toBe('Legacy');
  });

  it('dry-run changes nothing on disk and predicts the counts apply would perform', async () => {
    const { fixture } = standardFixture();
    await seed(h, fixture);

    const before = readFileSync(h.dbPath);
    const plan = await planBackfill(h.ds);
    const after = readFileSync(h.dbPath);

    expect(plan.mode).toBe('plan');
    expect(plan.encrypted).toBe(7);
    expect(plan.skipped).toBe(0);
    expect(plan.keysCreated).toBe(3);
    expect(plan.errors).toBe(0);
    expect(plan.indexDropped).toBe(true);

    // The DB file is byte-identical: plan touched nothing.
    expect(after.equals(before)).toBe(true);
    expect((await rawBody(h.ds, fixture.notes[0].id)).startsWith('enc.v1.')).toBe(false);

    const applied = await applyBackfill(h.ds, MASTER_KEY);
    expect(applied.encrypted).toBe(plan.encrypted);
    expect(applied.skipped).toBe(plan.skipped);
    expect(applied.keysCreated).toBe(plan.keysCreated);
  });

  it('aborts a poisoned batch transaction, surfaces the row id, and writes nothing from that batch', async () => {
    // Fixed ids so the `id ASC` batch order (and therefore batch membership) is
    // deterministic: batch 1 = [..01, ..02(poison)], batch 2 = [..03, ..04].
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ];
    await seed(h, {
      notes: ids.map((id, i) => ({ id, body: `body-${i}`, ownerSub: 'user-a' })),
      tags: [],
    });

    const poison = ids[1];
    const failing: FieldEncryptor = (dek, plaintext, aad, ctx) => {
      if (ctx.id === poison) throw new Error('forced encryption failure');
      return encryptField(dek, plaintext, aad);
    };

    let caught: unknown;
    try {
      await applyBackfill(h.ds, MASTER_KEY, { batchSize: 2, encryptField: failing });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BackfillRowError);
    expect((caught as Error).message).toContain(poison);

    // Batch 1 rolled back in full (its healthy sibling ..01 stays plaintext) and
    // batch 2 never ran: no partial writes anywhere, and no report is produced.
    for (let i = 0; i < ids.length; i += 1) {
      expect(await rawBody(h.ds, ids[i])).toBe(`body-${i}`);
    }
  });

  it('rotates every DEK under the new master without touching any content row, and re-runs are safe', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const { fixture } = standardFixture();
    await seed(h, fixture);
    await applyBackfill(h.ds, oldKey);

    const beforeDeks = await deksBySub(h.ds, oldKey);
    const beforeNotes = new Map((await allNotes(h.ds)).map((n) => [n.id, n.body]));
    const beforeTags = (await allTags(h.ds)).map((t) => t.name);

    const report = await rotateMasterKeys(h.ds, oldKey, newKey);

    expect(report.rotated).toBe(3);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);

    for (const row of await keyRows(h.ds)) {
      expect(unwrapDek(row.wrappedDek, newKey).equals(beforeDeks.get(row.sub)!)).toBe(true);
      expect(row.kekVersion).toBe(2);
    }

    // Zero content rows were read or written: byte-identical columns.
    for (const n of await allNotes(h.ds)) {
      expect(n.body).toBe(beforeNotes.get(n.id));
    }
    expect((await allTags(h.ds)).map((t) => t.name)).toEqual(beforeTags);

    // Re-run: already-rotated rows are reported skipped and never corrupted.
    const rerun = await rotateMasterKeys(h.ds, oldKey, newKey);
    expect(rerun.rotated).toBe(0);
    expect(rerun.skipped).toBe(3);
    expect(rerun.errors).toBe(0);
    for (const row of await keyRows(h.ds)) {
      expect(unwrapDek(row.wrappedDek, newKey).equals(beforeDeks.get(row.sub)!)).toBe(true);
      expect(row.kekVersion).toBe(2);
    }
  });

  it('throws on a row that fails the old-key unwrap for a non-already-rotated reason', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const createdAt = new Date().toISOString();

    await h.ds.query(
      'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,?,?)',
      ['user-a', wrapDek(randomBytes(32), oldKey), 1, createdAt],
    );
    const tampered = flipWrappedByte(wrapDek(randomBytes(32), oldKey));
    await h.ds.query(
      'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,?,?)',
      ['user-b', tampered, 1, createdAt],
    );

    let caught: unknown;
    try {
      await rotateMasterKeys(h.ds, oldKey, newKey);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RotationRowError);
    expect((caught as Error).message).toContain('user-b');

    // Atomic: the healthy row was not written and the bad row was left untouched.
    const rows = await keyRows(h.ds);
    expect(rows.find((r) => r.sub === 'user-a')!.kekVersion).toBe(1);
    expect(rows.find((r) => r.sub === 'user-b')!.wrappedDek).toBe(tampered);
  });
});
