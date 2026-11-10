import { jest } from '@jest/globals';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { CryptoError } from '@life/crypto';
import { KeysService, UserKeys } from '@life/service-kit';
import { Note } from '../src/notes/note.entity.js';
import { NoteTag } from '../src/notes/note-tag.entity.js';
import { NotesCache } from '../src/notes/notes-cache.js';
import { NotesService } from '../src/notes/notes.service.js';

/**
 * `notes-at-rest` T3 — encrypted writes/reads + tag handling
 * (`SPEC-notes-at-rest` Encryption Rules / Data Model).
 *
 * Every fixture DB is a throwaway under the OS temp dir; this suite NEVER opens
 * anything under `apps/note-service/data/` (the hard line). The service runs on a
 * real sqlite database so the raw columns can be inspected directly, and the
 * cache is a no-client `NotesCache` (loader passthrough) so the suite exercises
 * the DB + crypto path without a live Redis.
 */

const MASTER_KEY = Buffer.alloc(32, 0x2a);
const SUB = 'user-a';
const ENC_PREFIX = 'enc.v1.';

interface Harness {
  dataSource: DataSource;
  service: NotesService;
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'note-crypto-'));
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

/** The raw stored body for a note (never through a repository hydration). */
async function rawBody(dataSource: DataSource, id: string): Promise<string> {
  const rows = await dataSource.query('SELECT body FROM note WHERE id = ?', [id]);
  return rows[0].body as string;
}

async function rawTagIds(dataSource: DataSource, noteId: string): Promise<number[]> {
  const rows = (await dataSource.query(
    'SELECT tagId FROM note_tag WHERE noteId = ? ORDER BY tagId',
    [noteId],
  )) as Array<{ tagId: number }>;
  return rows.map((r) => Number(r.tagId));
}

/** Flip one ciphertext byte while keeping the envelope base64url-canonical. */
function flipCiphertextByte(envelope: string): string {
  const [nonce, ct] = envelope.slice(ENC_PREFIX.length).split('.');
  const raw = Buffer.from(ct, 'base64url');
  raw[0] = raw[0] ^ 0xff;
  return `${ENC_PREFIX}${nonce}.${raw.toString('base64url')}`;
}

describe('notes-at-rest T3: encrypted fields + transparent dual-read', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('create: raw body column is an enc.v1 envelope while the API returns the input', async () => {
    const dto = await h.service.create(SUB, 'hello world', []);

    expect(dto.body).toBe('hello world');
    const stored = await rawBody(h.dataSource, dto.id);
    expect(stored.startsWith(ENC_PREFIX)).toBe(true);
    expect(stored).not.toContain('hello world');
  });

  it('update: writes a fresh envelope (new nonce) and reads back the new plaintext', async () => {
    const created = await h.service.create(SUB, 'first version', []);
    const before = await rawBody(h.dataSource, created.id);

    const updated = await h.service.update(SUB, created.id, 'second version');
    const after = await rawBody(h.dataSource, created.id);

    expect(updated.body).toBe('second version');
    expect(after.startsWith(ENC_PREFIX)).toBe(true);
    // A new random nonce per encryption means the envelope changes even for
    // different plaintext, and the stored value is not a byte-copy of the old.
    expect(after).not.toBe(before);
    expect(after.split('.')[2]).not.toBe(before.split('.')[2]);

    const readBack = await h.service.findOne(SUB, created.id);
    expect(readBack.body).toBe('second version');
  });

  it('tags: tagIds round-trip through the association table; no tag names are stored here', async () => {
    const dto = await h.service.create(SUB, 'tagged', [7, 3]);

    // The wire DTO carries the registry ids (order-normalized).
    expect(dto.tagIds).toEqual([3, 7]);
    // Only association rows exist; note-service owns no tag vocabulary.
    expect(await rawTagIds(h.dataSource, dto.id)).toEqual([3, 7]);
    const tagTables = (await h.dataSource.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tag'",
    )) as unknown[];
    expect(tagTables).toHaveLength(0);

    const reread = await h.service.findOne(SUB, dto.id);
    expect(reread.tagIds).toEqual([3, 7]);
  });

  it('tag dedupe: repeated ids in one write collapse into a single association each', async () => {
    const a = await h.service.create(SUB, 'a', [5, 5, 5]);
    const b = await h.service.create(SUB, 'b', [5, 6]);

    // Exactly one row per distinct id, per note.
    expect(await rawTagIds(h.dataSource, a.id)).toEqual([5]);
    expect(await rawTagIds(h.dataSource, b.id)).toEqual([5, 6]);
  });

  it('dual-read: a legacy plaintext row is readable unchanged, then a write converts it', async () => {
    const id = randomUUID();
    await h.dataSource.getRepository(Note).insert({
      id,
      body: 'legacy plaintext body',
      ownerSub: SUB,
      version: 0,
      deletedAt: null,
    });
    expect((await rawBody(h.dataSource, id)).startsWith(ENC_PREFIX)).toBe(false);

    const legacyRead = await h.service.findOne(SUB, id);
    expect(legacyRead.body).toBe('legacy plaintext body');

    await h.service.update(SUB, id, 'converted body');
    const converted = await rawBody(h.dataSource, id);
    expect(converted.startsWith(ENC_PREFIX)).toBe(true);
    expect((await h.service.findOne(SUB, id)).body).toBe('converted body');
  });

  it("AAD binding: swapping two notes' body ciphertexts fails closed for both", async () => {
    const a = await h.service.create(SUB, 'note a body', []);
    const b = await h.service.create(SUB, 'note b body', []);
    const aBody = await rawBody(h.dataSource, a.id);
    const bBody = await rawBody(h.dataSource, b.id);

    await h.dataSource.query('UPDATE note SET body = ? WHERE id = ?', [bBody, a.id]);
    await h.dataSource.query('UPDATE note SET body = ? WHERE id = ?', [aBody, b.id]);

    // Each ciphertext was bound to its own noteId, so neither transplant opens.
    await expect(h.service.findOne(SUB, a.id)).rejects.toBeInstanceOf(CryptoError);
    await expect(h.service.findOne(SUB, b.id)).rejects.toBeInstanceOf(CryptoError);
  });

  it('tamper: a flipped body byte fails closed and logs the id but never the content', async () => {
    const secret = 'TOP-SECRET-BODY-CONTENT';
    const created = await h.service.create(SUB, secret, []);
    const stored = await rawBody(h.dataSource, created.id);
    await h.dataSource.query('UPDATE note SET body = ? WHERE id = ?', [
      flipCiphertextByte(stored),
      created.id,
    ]);

    const chunks: string[] = [];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      await expect(h.service.findOne(SUB, created.id)).rejects.toBeInstanceOf(CryptoError);
    } finally {
      stderr.mockRestore();
    }

    const output = chunks.join('');
    expect(output).toContain('decrypt failed for note');
    expect(output).toContain(created.id);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(ENC_PREFIX);
  });

  it('generates note ids as v4 UUIDs at the service layer', async () => {
    const created = await h.service.create(SUB, 'uuid please', []);
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
