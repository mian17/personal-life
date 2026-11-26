---
type: 'Reference'
title: 'Crypto at rest'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-aaa203a9bf25ac19f43fe44b
    resource: repo://packages/cache/src/index.ts
  - id: openwiki-source-d7616c767a5f46d71760689e
    resource: repo://packages/crypto/src/envelope.ts
  - id: openwiki-source-1d2f30650faf07c7055b3ce7
    resource: repo://packages/crypto/src/errors.ts
  - id: openwiki-source-e4ba516cdc3ab2f9593b841f
    resource: repo://packages/crypto/src/keys.ts
  - id: openwiki-source-21b8fe1ab13551b617967c22
    resource: repo://packages/crypto/test/envelope.test.ts
  - id: openwiki-source-d4a495f0b256f2c9e14b50a6
    resource: repo://packages/service-kit/src/keys/keys.service.ts
  - id: openwiki-source-7ba63ed7bd06d75dcb3dd5c5
    resource: repo://packages/service-kit/src/keys/user-keys.entity.ts
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Crypto at rest

Every service that stores content encrypts it before it touches disk or Redis.
The implementation is `@life/crypto` (`packages/crypto`): two envelope formats,
one key hierarchy, and a hard rule about where plaintext may exist. The cache is
inside this boundary, not outside it.

## The two envelope formats

**Content — `enc.v1.<nonce-b64url>.<ct-b64url>`.** A field is sealed with
AES-256-GCM under a data-encryption key (DEK). The nonce is 96 random bits drawn
fresh for every encryption (NIST SP 800-38D random-nonce mode); `ct` is
`ciphertext || tag` with the standard 16-byte GCM tag. The envelope is
self-describing and bound to its context by AAD, so an envelope moved to a
different field, row or owner fails to open rather than decrypting to the wrong
plaintext.

**Wrapped keys — `kw.v1.<nonce-b64url>.<ct-b64url>`.** Same cipher, different
job: wrapping a DEK under a key-encryption key (KEK). The two prefixes are
distinct so a wrapped key can never be mistaken for content or vice versa, and
`splitSealed` enforces the shape strictly — unknown version, wrong part count,
bad base64url, wrong nonce length, or a body shorter than the auth tag all throw
`CryptoError`.

## Key hierarchy

```
<Service>_MASTER_KEY (32B, base64, per service, from env)
        │  HKDF-SHA256(salt = '', info = 'life/dek-wrap/v1')
        ▼
       KEK  ── wrap/unwrap only ──▶  kw.v1 envelope of a per-owner DEK
                                       │
                              AES-256-GCM (enc.v1)
                                       ▼
                               content ciphertext
```

- One **DEK per owner** (`sub`), 256-bit, generated on first content write and
  stored only as a `kw.v1.` envelope in the `user_keys` table.
- The KEK is derived with a fixed HKDF domain separator
  (`life/dek-wrap/v1`) and is used for nothing but DEK wrapping — content keys
  never touch it.
- **Key rotation rewraps, it does not re-encrypt.** `rewrapDek` unwraps the DEK
  under the old master key and wraps the same DEK bytes under the new one, so
  every content ciphertext stays valid and no bulk re-encryption is needed.
- **Per-service custody.** Each service loads its own `<SERVICE>_MASTER_KEY`
  (`NOTE_MASTER_KEY`, `MEAL_MASTER_KEY`, …), so two services never share a KEK
  even though they share the `user_keys` table shape. A stolen master key for
  one service cannot open another store.

## Where plaintext is allowed to exist

Exactly two places, both transient:

1. **The request path.** Decrypt, assemble DTOs, filter and paginate happen after
   every cache hit and before the response. Content filters (`content-match.ts`
   style) run in memory, post-decrypt — never as SQL over encrypted columns.
2. **A process-local DEK memo.** `KeysService` unwraps an owner's DEK at most
   once per process and keeps it in a `Map` that is never serialized and never
   logged.

Everywhere else — SQLite rows, Postgres rows, Redis values — the bytes are
ciphertext. The read-through cache stores serialized rows **as persisted**, and
`packages/cache` refuses to accept a value without an `enc.v1.` envelope on
write-back, so a plaintext row can never land in Redis (it is AOF-persistent, so
a decrypted DTO there would be a data-privacy breach, not a cache warm-up).

## Failure posture: loud and closed

There is no fallback plaintext anywhere in the design, and every failure mode
refuses rather than degrades:

- `loadMasterKeyFromEnv` throws when the variable is missing, non-base64, or
  does not decode to 32 bytes — at boot, with a message that names the variable
  and never contains key material.
- Reads never provision a DEK: a missing `user_keys` row fails closed with
  `CryptoError`. Only writes provision, lazily, per owner.
- Any authentication failure — tamper, wrong key, AAD mismatch — surfaces as
  `CryptoError` ("authentication or context mismatch"); the open path never
  returns partial plaintext.
- `CryptoError` messages describe _what_ failed and never include keys,
  plaintext, or AAD contents.

## Proof

`packages/crypto/test/envelope.test.ts` seals NIST CAVP AES-GCM known-answer
vectors (from `gcmEncryptExtIV256.rsp`, mirrored via pyca/cryptography) and
compares byte-for-byte against the published ciphertext, so the primitives are
pinned to the standard's test vectors rather than to their own round-trip. That
vector file is the one allowlisted path in `.gitleaks.toml` — a published test
key, not a credential.

## See also

- [Data layer: BE → cache → DB](../architecture/data-layer.md) — how ciphertext
  flows through the cache and where decryption happens.
- [Deployment and operations](../operations/deployment.md) — master keys as
  compose environment, and backup ordering for encrypted stores.
