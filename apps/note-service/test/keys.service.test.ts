import { jest } from '@jest/globals';
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';

/**
 * `notes-at-rest` T2 — DEK provisioning/memo (`SPEC-notes-at-rest` Data Model +
 * Encryption Rules). Every fixture DB is a throwaway under the OS temp dir; this
 * suite NEVER opens anything under `apps/note-service/data/` (the hard line).
 *
 * `unwrapDek` is wrapped in a `jest.fn` so the memoization contract ("unwrap each
 * sub's DEK at most once per process lifetime") is asserted on the real call count,
 * not on a re-implementation.
 *
 * ESM has no hoisted `jest.mock`: the real module is imported first, the spy is
 * built from the real `unwrapDek`, and only then is the module registry mocked.
 * Modules that reach `@life/crypto` (`KeysService` in service-kit included) load
 * with `await import` AFTER that, so they bind the spy, not the original.
 */
const realCrypto = await import('@life/crypto');
const { CryptoError, wrapDek } = realCrypto;
const unwrapSpy = jest.fn(realCrypto.unwrapDek);
jest.unstable_mockModule('@life/crypto', () => ({ ...realCrypto, unwrapDek: unwrapSpy }));

const { KeysService, UserKeys, createMasterKey } = await import('@life/service-kit');
const { MASTER_KEY_ENV } = await import('../src/service-config.js');

const MASTER_KEY = Buffer.alloc(32, 0x2a);

interface Harness {
  dataSource: DataSource;
  repo: Repository<UserKeys>;
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'note-keys-'));
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: join(dir, 'keys.db'),
    entities: [UserKeys],
    synchronize: true,
  });
  await dataSource.initialize();
  return { dataSource, repo: dataSource.getRepository(UserKeys), dir };
}

describe('KeysService', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
    unwrapSpy.mockClear();
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('lazily provisions exactly one user_keys row on first content write', async () => {
    const svc = new KeysService(h.repo, MASTER_KEY);

    const dek = await svc.getOrCreateDek('user-a');

    const rows = await h.repo.find();
    expect(rows).toHaveLength(1);
    expect(rows[0].sub).toBe('user-a');
    expect(rows[0].wrappedDek.startsWith('kw.v1.')).toBe(true);
    // The stored envelope must never carry the raw DEK in any common encoding.
    expect(rows[0].wrappedDek).not.toContain(dek.toString('base64url'));
    expect(rows[0].wrappedDek).not.toContain(dek.toString('hex'));
    expect(rows[0].kekVersion).toBe(1);
    // Provisioning generates a fresh key; it does not need to unwrap anything.
    expect(unwrapSpy).not.toHaveBeenCalled();
  });

  it('returns a stable DEK per sub and distinct DEKs across subs', async () => {
    const svc = new KeysService(h.repo, MASTER_KEY);

    const a1 = await svc.getOrCreateDek('user-a');
    const a2 = await svc.getOrCreateDek('user-a');
    const b = await svc.getOrCreateDek('user-b');

    expect(a2.equals(a1)).toBe(true);
    expect(b.equals(a1)).toBe(false);
    expect(await h.repo.count()).toBe(2);
    // The second call for user-a is a memo hit, not a second insert.
    expect(await h.repo.find({ where: { sub: 'user-a' } })).toHaveLength(1);
  });

  it('unwraps a sub DEK at most once (process-local memo)', async () => {
    const dek = randomBytes(32);
    await h.repo.insert({
      sub: 'user-a',
      wrappedDek: wrapDek(dek, MASTER_KEY),
      kekVersion: 1,
      createdAt: new Date(),
    });
    unwrapSpy.mockClear();
    const svc = new KeysService(h.repo, MASTER_KEY);

    const first = await svc.getDekForRead('user-a');
    const second = await svc.getDekForRead('user-a');
    const third = await svc.getOrCreateDek('user-a');

    expect(first.equals(dek)).toBe(true);
    expect(second.equals(dek)).toBe(true);
    expect(third.equals(dek)).toBe(true);
    expect(unwrapSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed on read of a sub with no provisioned key and creates no row', async () => {
    const svc = new KeysService(h.repo, MASTER_KEY);

    await expect(svc.getDekForRead('ghost')).rejects.toBeInstanceOf(CryptoError);
    expect(await h.repo.count()).toBe(0);
    expect(unwrapSpy).not.toHaveBeenCalled();
  });

  it('survives a restart: a fresh instance unwraps the same DEK from the stored row', async () => {
    const svc1 = new KeysService(h.repo, MASTER_KEY);
    const dek1 = await svc1.getOrCreateDek('user-a');

    // Fresh service = fresh memo; only the persisted row can reproduce the DEK.
    unwrapSpy.mockClear();
    const svc2 = new KeysService(h.repo, MASTER_KEY);
    const dek2 = await svc2.getDekForRead('user-a');

    expect(dek2.equals(dek1)).toBe(true);
    expect(unwrapSpy).toHaveBeenCalledTimes(1);
  });

  it('collects both unit and existing e2e suites under the extended testRegex', () => {
    // `jest --listTests` is the authoritative check; this asserts the same regex
    // contract in-suite so it cannot silently regress, without running other suites.
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    const re = new RegExp(pkg.jest.testRegex);

    expect(re.test('keys.service.test.ts')).toBe(true);
    expect(re.test('notes.e2e-spec.ts')).toBe(true);
    expect(re.test('ownership.e2e-spec.ts')).toBe(true);
    expect(re.test('owner-backfill.e2e-spec.ts')).toBe(true);
    expect(re.test('notes-cache.e2e-spec.ts')).toBe(true);
    expect(re.test('auth.e2e-spec.ts')).toBe(true);
    // Support files must not be collected as suites.
    expect(re.test('jwt-harness.ts')).toBe(false);
    expect(re.test('fake-redis.ts')).toBe(false);
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
