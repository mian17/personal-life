import { JsonWebKey, createHash, createPrivateKey, generateKeyPairSync, sign } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

/** One persisted OKP/Ed25519 key pair in JWK form (private, never leaves `data/`). */
export interface SigningKeyJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d: string;
  kid: string;
  alg: 'EdDSA';
  use: 'sig';
}

export interface JsonWebKeySet {
  keys: SigningKeyJwk[];
}

/**
 * RFC 7638 thumbprint of the public members, matching oidc-provider's own kid
 * derivation (sha256 of the canonical public JWK, base64url) so a stable kid
 * survives restarts and matches what the provider serves from the JWKS.
 */
function deriveKid(x: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x }))
    .digest('base64url');
}

function generateSigningKey(): SigningKeyJwk {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string };
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    d: jwk.d,
    kid: deriveKid(jwk.x),
    alg: 'EdDSA',
    use: 'sig',
  };
}

/**
 * Loads the persisted JWK Set, generating and writing it (mode 0600) when absent.
 * An existing file is always reused — the kid is stable across restarts and keys
 * are never regenerated or overwritten.
 */
export function loadOrCreateKeySet(path: string): JsonWebKeySet {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const created: JsonWebKeySet = { keys: [generateSigningKey()] };
    writeFileSync(path, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 });
    return created;
  }
  return JSON.parse(raw) as JsonWebKeySet;
}

/**
 * Adds a freshly generated signing key at the front (the new signing key) while
 * keeping older keys for verification — the minimal rotation helper Task 9
 * builds on. Full rotation tolerance is Task 9's job.
 */
export function rotateKeySet(set: JsonWebKeySet): JsonWebKeySet {
  return { keys: [generateSigningKey(), ...set.keys] };
}

/** Signs a compact JWS with the first (active) key of the set; `typ` is `at+jwt`. */
export function signJwt(payload: Record<string, unknown>, set: JsonWebKeySet): string {
  const key = set.keys[0];
  if (!key) throw new Error('no signing key available');
  const header = { alg: 'EdDSA', kid: key.kid, typ: 'at+jwt' };
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const keyObject = createPrivateKey({ key: { ...key } as JsonWebKey, format: 'jwk' });
  const signature = sign(null, Buffer.from(signingInput), keyObject);
  return `${signingInput}.${signature.toString('base64url')}`;
}
