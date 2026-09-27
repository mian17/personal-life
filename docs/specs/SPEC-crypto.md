# Spec: `crypto` — `@life/crypto` envelope-encryption package

Module id: `crypto` (see `MAP-data-privacy.md`). Status: IMPLEMENTATION CONTRACT.

## Objective

A consumer-agnostic encryption library for the workspace: given a data key (DEK) and
plaintext, produce a self-describing, versioned ciphertext envelope whose integrity
and context binding fail closed. todo-service and any future consumer use it without
knowing anything about notes.

Security contract (this is the whole point of the module):

- AES-256-GCM, 96-bit random nonce per encryption (`randomBytes`), auth tag in ct.
- Context binding via AAD (caller-supplied string) — prevents cross-row/field/user
  ciphertext transplants and version confusion.
- Strict parsing: unknown version, bad base64, wrong part count, or tag failure →
  typed `CryptoError`. **Never** return partially-decrypted or silently-empty output.
- Zero third-party dependencies — `node:crypto` only (supply-chain hygiene).
- Key material never logged, never stringified into errors, never persisted here.

## API (type contract — exact signatures)

```ts
// Formats (stable, versioned, base64url without padding):
//   field envelope : `enc.v1.<nonce>.<ct>`   (ct = ciphertext || GCM tag)
//   wrapped DEK    : `kw.v1.<nonce>.<ct>`

export const ENC_PREFIX = 'enc.v1.';
export const KW_PREFIX = 'kw.v1.';

export class CryptoError extends Error {} // tamper | parse | version | key errors

export function generateDek(): Buffer;                       // 32 random bytes
export function loadMasterKeyFromEnv(envName: string): Buffer; // base64, exactly 32 B, fail closed

/** KEK = HKDF-SHA256(masterKey, salt='', info='life/dek-wrap/v1', 32B). */
export function wrapDek(dek: Buffer, masterKey: Buffer): string;
export function unwrapDek(wrapped: string, masterKey: Buffer): Buffer;

/** Re-wrap a DEK under a new master key. Content ciphertexts are untouched. */
export function rewrapDek(wrapped: string, oldMaster: Buffer, newMaster: Buffer): string;

export function encryptField(dek: Buffer, plaintext: string, aad: string): string;
export function decryptField(dek: Buffer, envelope: string, aad: string): string;
```

AAD shapes are **owned by the caller** (notes module), but must be uniform per field
(encrypt and decrypt must reconstruct the identical string):

- note fields: `life.v1|<ownerSub>|note|<field>|<noteId>`
- tag fields:  `life.v1|<ownerSub>|tag|<field>`
  (tag PK is DB-assigned after insert, so it cannot bind; row-swap integrity for tags
  is consciously out of the read-only-adversary model — documented trade-off, upgrade
  path = service-generated tag ids if the model ever widens.)

## Project Structure

```
packages/crypto/
  package.json          → name @life/crypto, main dist/ (mirrors @life/shared)
  src/index.ts          → public exports only
  src/envelope.ts       → format parse/serialize (strict)
  src/keys.ts           → generateDek, wrap/unwrap/rewrap, HKDF, env loading
  test/*.test.ts        → jest suites (mirrors packages/ui layout)
```

## Code Style

Small pure functions, explicit buffers in/out, no classes except the error type.
Example (the module's core in one function):

```ts
export function encryptField(dek: Buffer, plaintext: string, aad: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${ENC_PREFIX}${nonce.toString('base64url')}.${ct.toString('base64url')}`;
}
```

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -- packages/crypto
Build:     npm run build -w @life/crypto
```

## Testing Strategy

Jest, suites under `packages/crypto/test/`. Required cases:

1. One published AES-256-GCM known-answer vector (pins the implementation to NIST
   parameters, not to self-consistency).
2. Round-trip (unicode, empty string, large string) — `decryptField(encryptField(x)) === x`.
3. Tamper detection: flip one bit in nonce / ct / tag → `CryptoError`, all three.
4. AAD mismatch and wrong key → `CryptoError`.
5. Format errors: unknown version, missing parts, invalid base64url, non-string input.
6. HKDF determinism (fixed master → fixed KEK; a pinned vector).
7. wrap/unwrap round-trip, wrap tamper → `CryptoError`, rewrap: unwraps under new
   master only, and the underlying DEK is identical before/after.
8. `loadMasterKeyFromEnv`: wrong length / non-base64 / missing → fail closed.

## Boundaries

- Always: fail closed; version every serialized format; run the targeted suites before commit.
- Ask first: any format change (v2 — appends, never mutates v1), any export added to `src/index.ts`.
- Never: third-party crypto deps; `Math.random`; logging or error-message-ing key
  material, plaintext, or AAD contents; reusing a nonce; returning garbage on decrypt failure.

## Success Criteria

- All required test cases green; `npm run typecheck` clean.
- No plaintext/key bytes cross the module boundary except as function arguments.
- `@life/shared`-style consumption works: `import { encryptField } from '@life/crypto'`.

## Open Questions

None (resolved in the interview; envelope/custody decisions are recorded in
`docs/intent/data-privacy.md`).
