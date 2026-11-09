import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { CryptoError, ENC_PREFIX, wrapDek } from '@life/crypto';
import { createMasterKey, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../src/service-config.js';
import { Todo } from '../src/todos/todo.entity.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';

/**
 * `SPEC-todo-service` Testing Strategy #1 + #2 (encryption half): envelope
 * round-trip (unicode, empty note, large note), raw columns start `enc.v1.`,
 * list names too, AAD binding (swapping two todos' title ciphertexts fails
 * closed for both), key custody (lazy provision, memoized unwrap, fail-closed
 * read) and the no-dual-read rule (M5 — the store starts encrypted).
 *
 * Every fixture DB is a throwaway under the OS temp dir; this suite NEVER opens
 * anything under `apps/todo-service/data/` (the hard line).
 *
 * `unwrapDek` is wrapped in a `jest.fn` so the memoization contract ("unwrap
 * each sub's DEK at most once per process") is asserted on the real call count.
 */
jest.mock('@life/crypto', () => {
  const actual = jest.requireActual('@life/crypto');
  return { ...actual, unwrapDek: jest.fn(actual.unwrapDek) };
});

import * as cryptoModule from '@life/crypto';

const unwrapSpy = cryptoModule.unwrapDek as unknown as jest.Mock;

/** Flip one ciphertext byte while keeping the envelope base64url-canonical. */
function flipCiphertextByte(envelope: string): string {
  const [nonce, ct] = envelope.slice(ENC_PREFIX.length).split('.');
  const raw = Buffer.from(ct, 'base64url');
  raw[0] = raw[0] ^ 0xff;
  return `${ENC_PREFIX}${nonce}.${raw.toString('base64url')}`;
}

describe('todo-service encryption + key custody', () => {
  let h: UnitHarness;

  beforeEach(async () => {
    h = await makeUnitHarness();
    unwrapSpy.mockClear();
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  const rawTodo = async (id: string): Promise<{ title: string; note: string | null }> => {
    const rows = await h.dataSource.query('SELECT title, note FROM todo WHERE id = ?', [id]);
    return rows[0];
  };

  it('round-trips unicode title + note and stores them as enc.v1. envelopes', async () => {
    const title = 'Giặt đồ 🧺 — café Ünïcode';
    const note = 'ghi chú: 日本語 テキスト with emoji 🎯 and accents éàü';
    const dto = await h.todos.create(SUB, { title, note });

    expect(dto.title).toBe(title);
    expect(dto.note).toBe(note);
    expect(dto.done).toBe(false);
    expect(dto.dueDate).toBeNull();
    expect(dto.listId).toBeNull();
    expect(dto.tagIds).toEqual([]);
    expect(dto.version).toBe(0);

    const stored = await rawTodo(dto.id);
    expect(stored.title.startsWith(ENC_PREFIX)).toBe(true);
    expect(stored.note!.startsWith(ENC_PREFIX)).toBe(true);
    expect(stored.title).not.toContain(title);
    expect(stored.note).not.toContain('日本語');
  });

  it('round-trips an empty note as an envelope (not null) and a large note', async () => {
    const empty = await h.todos.create(SUB, { title: 'empty-note', note: '' });
    expect(empty.note).toBe('');
    expect((await rawTodo(empty.id)).note!.startsWith(ENC_PREFIX)).toBe(true);

    const large = 'x'.repeat(15000) + '|tail';
    const big = await h.todos.create(SUB, { title: 'large-note', note: large });
    expect(big.note).toBe(large);
    // The stored value is an envelope (base64 grows it); it must not be the
    // plaintext, and it must round-trip.
    const storedLarge = (await rawTodo(big.id)).note!;
    expect(storedLarge.startsWith(ENC_PREFIX)).toBe(true);
    expect(storedLarge).not.toContain('|tail');
    expect((await h.todos.findOne(SUB, big.id)).note).toBe(large);
  });

  it('stores list names as enc.v1. envelopes and returns plaintext on read', async () => {
    const created = await h.lists.create(SUB, 'TOPSECRET-LIST-NAME');
    expect(created.name).toBe('TOPSECRET-LIST-NAME');

    const rows = await h.dataSource.query('SELECT name FROM list WHERE id = ?', [created.id]);
    expect((rows[0].name as string).startsWith(ENC_PREFIX)).toBe(true);
    expect(rows[0].name).not.toContain('TOPSECRET-LIST-NAME');

    const listed = await h.lists.list(SUB);
    expect(listed.find((l) => l.id === created.id)!.name).toBe('TOPSECRET-LIST-NAME');
  });

  it('fails closed when a raw DB title is not an enc.v1 envelope (no dual-read, M5)', async () => {
    const id = randomUUID();
    await h.dataSource.getRepository(Todo).insert({
      id,
      title: 'legacy plaintext title',
      note: null,
      done: false,
      dueDate: null,
      listId: null,
      origin: null,
      ownerSub: SUB,
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(h.todos.findOne(SUB, id)).rejects.toBeInstanceOf(CryptoError);
  });

  it('tamper: a flipped title byte fails closed and logs the id but never the content', async () => {
    const secret = 'TOP-SECRET-TODO-TITLE';
    const created = await h.todos.create(SUB, { title: secret, note: 'plain note' });
    const stored = (await rawTodo(created.id)).title;

    await h.dataSource.query('UPDATE todo SET title = ? WHERE id = ?', [
      flipCiphertextByte(stored),
      created.id,
    ]);

    const chunks: string[] = [];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      await expect(h.todos.findOne(SUB, created.id)).rejects.toBeInstanceOf(CryptoError);
    } finally {
      stderr.mockRestore();
    }

    const output = chunks.join('');
    expect(output).toContain('decrypt failed for todo');
    expect(output).toContain(created.id);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(ENC_PREFIX);
  });

  it("AAD binding: swapping two todos' title ciphertexts fails closed for both", async () => {
    const a = await h.todos.create(SUB, { title: 'Owner-a-title' });
    const b = await h.todos.create(SUB, { title: 'Owner-b-title' });

    const aStored = (await rawTodo(a.id)).title;
    const bStored = (await rawTodo(b.id)).title;
    await h.dataSource.query('UPDATE todo SET title = ? WHERE id = ?', [bStored, a.id]);
    await h.dataSource.query('UPDATE todo SET title = ? WHERE id = ?', [aStored, b.id]);

    // Each envelope is bound to its todo id (in the AAD), so neither transplant
    // opens, even though both share the owner sub.
    await expect(h.todos.findOne(SUB, a.id)).rejects.toBeInstanceOf(CryptoError);
    await expect(h.todos.findOne(SUB, b.id)).rejects.toBeInstanceOf(CryptoError);
  });

  it('lazily provisions one user_keys row and memoizes the unwrap', async () => {
    const dek = randomBytes(32);
    await h.dataSource.getRepository(UserKeys).insert({
      sub: SUB,
      wrappedDek: wrapDek(dek, Buffer.alloc(32, 0x2c)),
      kekVersion: 1,
      createdAt: new Date(),
    });
    unwrapSpy.mockClear();

    // Three reads/writes: exactly one unwrap of this sub's DEK.
    await h.todos.create(SUB, { title: 'one' });
    await h.todos.create(SUB, { title: 'two' });
    await h.todos.findAll(SUB, {});

    expect(unwrapSpy).toHaveBeenCalledTimes(1);
    const rows = await h.dataSource.query('SELECT COUNT(*) AS c FROM user_keys');
    expect(Number(rows[0].c)).toBe(1);
  });
});

describe('master-key bootstrap', () => {
  const saved = process.env[MASTER_KEY_ENV];

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[MASTER_KEY_ENV];
    } else {
      process.env[MASTER_KEY_ENV] = saved;
    }
  });

  it('fails closed when the master key env var is missing', () => {
    delete process.env[MASTER_KEY_ENV];

    expect(() => createMasterKey(MASTER_KEY_ENV)).toThrow(CryptoError);
    expect(() => createMasterKey(MASTER_KEY_ENV)).toThrow(new RegExp(MASTER_KEY_ENV));
  });

  it('fails closed on a wrong-length key without leaking key material', () => {
    const short = randomBytes(16).toString('base64');
    process.env[MASTER_KEY_ENV] = short;

    let message = '';
    try {
      createMasterKey(MASTER_KEY_ENV);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(new RegExp(`${MASTER_KEY_ENV}|32 bytes`));
    expect(message).not.toContain(short);
    expect(message).not.toContain(short.slice(0, 8));
  });
});

describe('jest suite collection', () => {
  it('collects the unit + e2e suites under the pinned testRegex', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    const re = new RegExp(pkg.jest.testRegex);

    expect(re.test('todos.e2e-spec.ts')).toBe(true);
    expect(re.test('todo-cache.e2e-spec.ts')).toBe(true);
    expect(re.test('health.e2e-spec.ts')).toBe(true);
    expect(re.test('todo-encryption.test.ts')).toBe(true);
    expect(re.test('content-match.test.ts')).toBe(true);
    // Support files must not be collected as suites.
    expect(re.test('jwt-harness.ts')).toBe(false);
    expect(re.test('fake-redis.ts')).toBe(false);
    expect(re.test('todo-harness.ts')).toBe(false);
    expect(re.test('setup-env.ts')).toBe(false);
  });
});
