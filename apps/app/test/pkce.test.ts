import { codeChallengeS256, createCodeVerifier, createNonce, createState, safeEqual } from '@/lib/auth/pkce';

describe('PKCE (S256)', () => {
  it('generates a verifier of valid shape and length', () => {
    const verifier = createCodeVerifier();
    // RFC 7636 §4.1: 43–128 characters from the unreserved set.
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('derives the S256 challenge deterministically as base64url(SHA-256(verifier))', async () => {
    const { createHash } = await import('crypto');
    const verifier = createCodeVerifier();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(codeChallengeS256(verifier)).toBe(expected);
    // base64url alphabet only, no padding.
    expect(codeChallengeS256(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallengeS256(verifier)).not.toContain('=');
  });

  it('generates a fresh verifier every time', () => {
    const set = new Set(Array.from({ length: 20 }, () => createCodeVerifier()));
    expect(set.size).toBe(20);
  });
});

describe('state and nonce', () => {
  it('generates unpredictable values', () => {
    const states = new Set(Array.from({ length: 20 }, () => createState()));
    const nonces = new Set(Array.from({ length: 20 }, () => createNonce()));
    expect(states.size).toBe(20);
    expect(nonces.size).toBe(20);
    expect(createState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('safeEqual (state validation)', () => {
  it('accepts identical values and rejects mismatches', () => {
    const value = createState();
    expect(safeEqual(value, value)).toBe(true);
    expect(safeEqual(value, createState())).toBe(false);
    expect(safeEqual(value, value + 'x')).toBe(false);
  });

  it('fails closed on missing values', () => {
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual('x', undefined)).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual('', '')).toBe(true); // equal empty strings still compare equal
  });
});
