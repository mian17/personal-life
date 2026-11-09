import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, wrapDek } from '@life/crypto';
import { KeysService, UserKeys, createMasterKey } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../src/service-config.js';
import { Tag } from '../src/tags/tag.entity.js';
import { TagsCache } from '../src/tags/tags-cache.js';
import { TagsService } from '../src/tags/tags.service.js';

/**
 * `SPEC-tags-service` Encryption + Testing Strategy cases: key custody
 * (lazy provision, memoized unwrap, fail-closed read), tamper → fail closed with
 * an ids-only log line, and AAD binding. Every fixture DB is a throwaway under
 * the OS temp dir; this suite NEVER opens anything under
 * `apps/tags-service/data/` (the hard line).
 *
 * `unwrapDek` is wrapped in a `jest.fn` so the memoization contract ("unwrap
 * each sub's DEK at most once per process lifetime") is asserted on the real
 * call count, not a re-implementation.
 */
jest.mock('@life/crypto', () => {
  const actual = jest.requireActual('@life/crypto');
  return { ...actual, unwrapDek: jest.fn(actual.unwrapDek) };
});

import * as cryptoModule from '@life/crypto';

const unwrapSpy = cryptoModule.unwrapDek as unknown as jest.Mock;

const MASTER_KEY = Buffer.alloc(32, 0x2b);
const SUB = 'user-a';

interface Harness {
  dataSource: DataSource;
  repo: Repository<UserKeys>;
  service: TagsService;
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'tags-keys-'));
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: join(dir, 'tags.db'),
    entities: [Tag, UserKeys],
    synchronize: true,
  });
  await dataSource.initialize();
  const repo = dataSource.getRepository(UserKeys);
  const keys = new KeysService(repo, MASTER_KEY);
  const service = new TagsService(dataSource.getRepository(Tag), new TagsCache(null), keys);
  return { dataSource, repo, service, dir };
}

/** Flip one ciphertext byte while keeping the envelope base64url-canonical. */
function flipCiphertextByte(envelope: string): string {
  const [nonce, ct] = envelope.slice(ENC_PREFIX.length).split('.');
  const raw = Buffer.from(ct, 'base64url');
  raw[0] = raw[0] ^ 0xff;
  return `${ENC_PREFIX}${nonce}.${raw.toString('base64url')}`;
}

async function rawName(dataSource: DataSource, id: number): Promise<string> {
  const rows = await dataSource.query('SELECT name FROM tag WHERE id = ?', [id]);
  return rows[0].name as string;
}

describe('TagsService encryption + key custody', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
    unwrapSpy.mockClear();
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('lazily provisions one user_keys row and stores names as enc.v1 envelopes', async () => {
    const created = (await h.service.create(SUB, 'Work')).tag;

    expect(created.name).toBe('Work');
    const rows = await h.repo.find();
    expect(rows).toHaveLength(1);
    expect(rows[0].sub).toBe(SUB);
    expect(rows[0].wrappedDek.startsWith('kw.v1.')).toBe(true);
    // Provisioning generates a fresh key; it does not need to unwrap anything.
    expect(unwrapSpy).not.toHaveBeenCalled();

    const stored = await rawName(h.dataSource, created.id);
    expect(stored.startsWith(ENC_PREFIX)).toBe(true);
    expect(stored).not.toContain('Work');
  });

  it('unwraps a sub DEK at most once (process-local memo)', async () => {
    const dek = randomBytes(32);
    await h.repo.insert({
      sub: SUB,
      wrappedDek: wrapDek(dek, MASTER_KEY),
      kekVersion: 1,
      createdAt: new Date(),
    });
    unwrapSpy.mockClear();

    const first = await h.service.list(SUB);
    const second = await h.service.list(SUB);
    const third = await h.service.create(SUB, 'Another');

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(third).toBeDefined();
    expect(unwrapSpy).toHaveBeenCalledTimes(1);
  });

  it('tamper: a flipped name byte fails closed and logs the id but never the content', async () => {
    const secret = 'TOP-SECRET-TAG-NAME';
    const created = (await h.service.create(SUB, secret)).tag;
    const stored = await rawName(h.dataSource, created.id);
    await h.dataSource.query('UPDATE tag SET name = ? WHERE id = ?', [
      flipCiphertextByte(stored),
      created.id,
    ]);

    const chunks: string[] = [];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      await expect(h.service.list(SUB)).rejects.toBeInstanceOf(CryptoError);
    } finally {
      stderr.mockRestore();
    }

    const output = chunks.join('');
    expect(output).toContain('decrypt failed for tag');
    expect(output).toContain(String(created.id));
    expect(output).not.toContain(secret);
    expect(output).not.toContain(ENC_PREFIX);
  });

  it("AAD binding: swapping two tags' name ciphertexts fails closed for both", async () => {
    // Same owner ⇒ same AAD, so this case proves per-row integrity from the tag
    // id in the log rather than AAD separation. A cross-owner transplant (a
    // different AAD) is the separation proof:
    const a = (await h.service.create(SUB, 'Owner-a-name')).tag;
    const other = 'user-b';
    const b = (await h.service.create(other, 'Owner-b-name')).tag;

    const aStored = await rawName(h.dataSource, a.id);
    const bStored = await rawName(h.dataSource, b.id);
    await h.dataSource.query('UPDATE tag SET name = ? WHERE id = ?', [bStored, a.id]);
    await h.dataSource.query('UPDATE tag SET name = ? WHERE id = ?', [aStored, b.id]);

    // Each ciphertext was bound to its owner sub, so neither transplant opens.
    await expect(h.service.list(SUB)).rejects.toBeInstanceOf(CryptoError);
    await expect(h.service.list(other)).rejects.toBeInstanceOf(CryptoError);
  });

  it('delete-detach: deleting a vocabulary row leaves no plaintext and other rows intact', async () => {
    const keep = (await h.service.create(SUB, 'Keep')).tag;
    const drop = (await h.service.create(SUB, 'Drop')).tag;

    await h.service.remove(SUB, drop.id);

    expect((await h.service.list(SUB)).map((t) => t.id)).toEqual([keep.id]);
    const remaining = await h.dataSource.query('SELECT id FROM tag');
    expect(remaining.map((r: { id: number }) => r.id)).toEqual([keep.id]);
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

    expect(re.test('tags.e2e-spec.ts')).toBe(true);
    expect(re.test('tags-cache.e2e-spec.ts')).toBe(true);
    expect(re.test('health.e2e-spec.ts')).toBe(true);
    expect(re.test('tags-encryption.test.ts')).toBe(true);
    // Support files must not be collected as suites.
    expect(re.test('jwt-harness.ts')).toBe(false);
    expect(re.test('fake-redis.ts')).toBe(false);
    expect(re.test('setup-env.ts')).toBe(false);
  });
});
