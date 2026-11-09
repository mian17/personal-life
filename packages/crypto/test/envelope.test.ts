import { CryptoError, ENC_PREFIX, decryptField, encryptField, generateDek } from '../src/index.js';
import { open, seal } from '../src/envelope.js';

/**
 * Published known-answer vector.
 *
 * Source: NIST CAVP, AES-GCM, file `gcmEncryptExtIV256.rsp`
 * (CAVS 14.0, "GCM Encrypt with keysize 256 test information"), section
 * [Keylen = 256][IVlen = 96][PTlen = 128][AADlen = 128][Taglen = 128], Count = 0.
 * Mirrored at
 * https://github.com/pyca/cryptography/blob/main/vectors/cryptography_vectors/ciphers/AES/GCM/gcmEncryptExtIV256.rsp
 *
 * Values are hex. `ct` is the published ciphertext; the envelope's `ct` part is
 * `ciphertext || tag`, so the expected sealed bytes are `ct || tag`.
 */
const KAT = {
  key: '92e11dcdaa866f5ce790fd24501f92509aacf4cb8b1339d50c9c1240935dd08b',
  iv: 'ac93a1a6145299bde902f21a',
  pt: '2d71bcfa914e4ac045b2aa60955fad24',
  aad: '1e0889016f67601c8ebea4943bc23ad6',
  ct: '8995ae2e6df3dbf96fac7b7137bae67f',
  tag: 'eca5aa77d51d4a0a14d9c51e1da474ab',
};

function flipBitInBase64UrlPart(envelope: string, partIndex: number): string {
  const parts = envelope.split('.');
  const raw = Buffer.from(parts[partIndex], 'base64url');
  raw[0] ^= 0x01;
  parts[partIndex] = raw.toString('base64url');
  return parts.join('.');
}

describe('constants', () => {
  it('exposes the versioned field-envelope prefix', () => {
    expect(ENC_PREFIX).toBe('enc.v1.');
  });
});

describe('known-answer vector', () => {
  it('seals a NIST CAVP AES-256-GCM vector to the published ct||tag', () => {
    const sealed = seal(
      Buffer.from(KAT.key, 'hex'),
      Buffer.from(KAT.iv, 'hex'),
      Buffer.from(KAT.pt, 'hex'),
      Buffer.from(KAT.aad, 'hex'),
    );
    expect(sealed.toString('hex')).toBe(KAT.ct + KAT.tag);
  });

  it('opens a NIST CAVP vector envelope built from the published ct||tag', () => {
    const envelope = `${ENC_PREFIX}${Buffer.from(KAT.iv, 'hex').toString('base64url')}.${Buffer.from(
      KAT.ct + KAT.tag,
      'hex',
    ).toString('base64url')}`;
    const plaintext = open(Buffer.from(KAT.key, 'hex'), envelope, Buffer.from(KAT.aad, 'hex'));
    expect(plaintext.compare(Buffer.from(KAT.pt, 'hex'))).toBe(0);
  });
});

describe('encryptField / decryptField round-trip', () => {
  it('round-trips unicode, empty string and a 100KB payload', () => {
    const dek = generateDek();
    const aad = 'life.v1|user|note|body|00000000-0000-0000-0000-000000000001';
    const cases = [
      '',
      'hello world',
      'héllo — 世界 🌍 Ω≈ç√∫˜µ≤≥÷ こんにちは',
      'a'.repeat(100 * 1024),
    ];

    for (const plaintext of cases) {
      const envelope = encryptField(dek, plaintext, aad);
      expect(envelope.startsWith(ENC_PREFIX)).toBe(true);
      expect(decryptField(dek, envelope, aad)).toBe(plaintext);
    }
  });

  it('uses a fresh nonce (and ciphertext) on every call', () => {
    const dek = generateDek();
    const aad = 'aad';
    const first = encryptField(dek, 'same', aad);
    const second = encryptField(dek, 'same', aad);
    expect(first).not.toBe(second);
    expect(decryptField(dek, first, aad)).toBe('same');
    expect(decryptField(dek, second, aad)).toBe('same');
  });
});

describe('tamper detection', () => {
  const aad = 'life.v1|owner|note|body|id';

  it('rejects a flipped nonce bit', () => {
    const dek = generateDek();
    const tampered = flipBitInBase64UrlPart(encryptField(dek, 'secret', aad), 2);
    expect(() => decryptField(dek, tampered, aad)).toThrow(CryptoError);
  });

  it('rejects a flipped ciphertext bit', () => {
    const dek = generateDek();
    const parts = encryptField(dek, 'secret', aad).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0x01;
    parts[3] = ct.toString('base64url');
    expect(() => decryptField(dek, parts.join('.'), aad)).toThrow(CryptoError);
  });

  it('rejects a flipped auth-tag bit (last byte of ct)', () => {
    const dek = generateDek();
    const parts = encryptField(dek, 'secret', aad).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[ct.length - 1] ^= 0x01;
    parts[3] = ct.toString('base64url');
    expect(() => decryptField(dek, parts.join('.'), aad)).toThrow(CryptoError);
  });
});

describe('context binding', () => {
  it('rejects an AAD mismatch', () => {
    const dek = generateDek();
    const envelope = encryptField(dek, 'secret', 'life.v1|alice|note|body|id');
    expect(() => decryptField(dek, envelope, 'life.v1|bob|note|body|id')).toThrow(CryptoError);
  });

  it('rejects the wrong key', () => {
    const envelope = encryptField(generateDek(), 'secret', 'aad');
    expect(() => decryptField(generateDek(), envelope, 'aad')).toThrow(CryptoError);
  });
});

describe('strict format errors', () => {
  const freshEnvelope = () => encryptField(generateDek(), 'secret', 'aad');

  it('rejects an unknown version prefix', () => {
    const envelope = freshEnvelope().replace('enc.v1.', 'enc.v2.');
    expect(() => decryptField(generateDek(), envelope, 'aad')).toThrow(CryptoError);
  });

  it('rejects a missing part', () => {
    const truncated = freshEnvelope().split('.').slice(0, 3).join('.');
    expect(() => decryptField(generateDek(), truncated, 'aad')).toThrow(CryptoError);
  });

  it('rejects an empty trailing part', () => {
    expect(() => decryptField(generateDek(), `${ENC_PREFIX}AAAA.`, 'aad')).toThrow(CryptoError);
  });

  it('rejects invalid base64url', () => {
    const parts = freshEnvelope().split('.');
    parts[3] = 'not*valid*base64url!!';
    expect(() => decryptField(generateDek(), parts.join('.'), 'aad')).toThrow(CryptoError);
  });

  it('rejects a non-string envelope', () => {
    const dek = generateDek();
    expect(() => decryptField(dek, null as unknown as string, 'aad')).toThrow(CryptoError);
    expect(() => decryptField(dek, 42 as unknown as string, 'aad')).toThrow(CryptoError);
    expect(() => decryptField(dek, undefined as unknown as string, 'aad')).toThrow(CryptoError);
  });

  it('rejects a non-string plaintext or non-string aad on encrypt', () => {
    const dek = generateDek();
    expect(() => encryptField(dek, null as unknown as string, 'aad')).toThrow(CryptoError);
    expect(() => encryptField(dek, 'secret', null as unknown as string)).toThrow(CryptoError);
  });

  it('rejects a wrong-length key on encrypt', () => {
    expect(() => encryptField(Buffer.alloc(16), 'secret', 'aad')).toThrow(CryptoError);
  });
});
