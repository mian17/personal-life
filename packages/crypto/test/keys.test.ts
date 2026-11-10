import {
  CryptoError,
  KW_PREFIX,
  generateDek,
  loadMasterKeyFromEnv,
  rewrapDek,
  unwrapDek,
  wrapDek,
} from '../src/index.js';
import { deriveKek } from '../src/keys.js';

const ENV_NAME = 'LIFE_TEST_MASTER_KEY';

const KEY_A = Buffer.alloc(32, 0x11);
const KEY_B = Buffer.alloc(32, 0x22);

describe('constants', () => {
  it('exposes the versioned wrapped-DEK prefix', () => {
    expect(KW_PREFIX).toBe('kw.v1.');
  });
});

describe('generateDek', () => {
  it('returns 32 random bytes that differ between calls', () => {
    const a = generateDek();
    const b = generateDek();
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
  });
});

describe('HKDF-SHA256 KEK derivation', () => {
  it('derives the pinned KEK for a fixed master key', () => {
    // master = bytes 0x00..0x1f; salt = ''; info = 'life/dek-wrap/v1'; 32 bytes.
    // Pin generated once with node:crypto hkdfSync('sha256', master, Buffer.alloc(0),
    // 'life/dek-wrap/v1', 32) and recorded here as a regression vector.
    const master = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    expect(deriveKek(master).toString('hex')).toBe(
      '1c8ea2edc9f85beb4708cc6610033f0a20c23c0cf8204d3d14a26341c5f3f797',
    );
  });

  it('rejects a master key that is not exactly 32 bytes', () => {
    expect(() => deriveKek(Buffer.alloc(16))).toThrow(CryptoError);
    expect(() => deriveKek(Buffer.alloc(64))).toThrow(CryptoError);
  });
});

describe('wrapDek / unwrapDek', () => {
  it('round-trips a DEK', () => {
    const dek = generateDek();
    const wrapped = wrapDek(dek, KEY_A);
    expect(wrapped.startsWith(KW_PREFIX)).toBe(true);
    expect(unwrapDek(wrapped, KEY_A).equals(dek)).toBe(true);
  });

  it('uses a fresh nonce on every wrap', () => {
    const dek = generateDek();
    expect(wrapDek(dek, KEY_A)).not.toBe(wrapDek(dek, KEY_A));
  });

  it('rejects a tampered nonce', () => {
    const wrapped = wrapDek(generateDek(), KEY_A);
    const parts = wrapped.split('.');
    const nonce = Buffer.from(parts[2], 'base64url');
    nonce[0] ^= 0x01;
    parts[2] = nonce.toString('base64url');
    expect(() => unwrapDek(parts.join('.'), KEY_A)).toThrow(CryptoError);
  });

  it('rejects a tampered wrapped key', () => {
    const wrapped = wrapDek(generateDek(), KEY_A);
    const parts = wrapped.split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[ct.length - 1] ^= 0x01;
    parts[3] = ct.toString('base64url');
    expect(() => unwrapDek(parts.join('.'), KEY_A)).toThrow(CryptoError);
  });

  it('rejects the wrong master key', () => {
    const wrapped = wrapDek(generateDek(), KEY_A);
    expect(() => unwrapDek(wrapped, KEY_B)).toThrow(CryptoError);
  });

  it('rejects malformed wrapped keys', () => {
    expect(() => unwrapDek('kw.v2.AAAA.AAAA', KEY_A)).toThrow(CryptoError);
    expect(() => unwrapDek('kw.v1.AAAA', KEY_A)).toThrow(CryptoError);
    expect(() => unwrapDek(`${KW_PREFIX}not*base64url!!.AAAA`, KEY_A)).toThrow(CryptoError);
    expect(() => unwrapDek(null as unknown as string, KEY_A)).toThrow(CryptoError);
  });

  it('rejects non-32-byte DEKs and master keys', () => {
    expect(() => wrapDek(Buffer.alloc(16), KEY_A)).toThrow(CryptoError);
    expect(() => wrapDek(generateDek(), Buffer.alloc(16))).toThrow(CryptoError);
    expect(() => unwrapDek(wrapDek(generateDek(), KEY_A), Buffer.alloc(17))).toThrow(CryptoError);
  });
});

describe('rewrapDek', () => {
  it('rewraps under the new master only, preserving the DEK bytes', () => {
    const dek = generateDek();
    const original = wrapDek(dek, KEY_A);

    const rewrapped = rewrapDek(original, KEY_A, KEY_B);

    // unwraps under the new master to the identical DEK
    expect(unwrapDek(rewrapped, KEY_B).equals(dek)).toBe(true);
    // no longer unwraps under the old master
    expect(() => unwrapDek(rewrapped, KEY_A)).toThrow(CryptoError);
    // the original envelope is untouched and still valid under the old master
    expect(unwrapDek(original, KEY_A).equals(dek)).toBe(true);
  });

  it('fails closed when the source envelope cannot be unwrapped', () => {
    const original = wrapDek(generateDek(), KEY_A);
    expect(() => rewrapDek(original, KEY_B, KEY_B)).toThrow(CryptoError);
  });
});

describe('loadMasterKeyFromEnv', () => {
  const original = process.env[ENV_NAME];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_NAME];
    } else {
      process.env[ENV_NAME] = original;
    }
  });

  it('decodes a base64 32-byte key', () => {
    process.env[ENV_NAME] = KEY_A.toString('base64');
    const loaded = loadMasterKeyFromEnv(ENV_NAME);
    expect(Buffer.isBuffer(loaded)).toBe(true);
    expect(loaded.equals(KEY_A)).toBe(true);
  });

  it('fails closed when the variable is missing', () => {
    delete process.env[ENV_NAME];
    expect(() => loadMasterKeyFromEnv(ENV_NAME)).toThrow(CryptoError);
  });

  it('fails closed on the wrong decoded length', () => {
    process.env[ENV_NAME] = Buffer.alloc(16, 0x33).toString('base64');
    expect(() => loadMasterKeyFromEnv(ENV_NAME)).toThrow(CryptoError);
  });

  it('fails closed on non-base64 input', () => {
    process.env[ENV_NAME] = 'not*base64*!!!';
    expect(() => loadMasterKeyFromEnv(ENV_NAME)).toThrow(CryptoError);
  });

  it('never echoes key material in the error message', () => {
    const material = Buffer.alloc(16, 0x33).toString('base64');
    process.env[ENV_NAME] = material;
    try {
      loadMasterKeyFromEnv(ENV_NAME);
      throw new Error('expected CryptoError');
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as Error).message).not.toContain(material);
    }
  });
});
