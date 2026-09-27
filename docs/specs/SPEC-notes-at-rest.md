# Spec: `notes-at-rest` — note-service encrypted persistence

Module id: `notes-at-rest` (see `MAP-data-privacy.md`). Depends on `crypto`.
Status: IMPLEMENTATION CONTRACT.

## Objective

`note.body` and `tag.name` — the schema's only content fields — are stored as
`@life/crypto` envelopes; everything else (ids, `ownerSub`, `version`, `deletedAt`,
timestamps) stays plaintext for ownership/filtering/ordering. The Redis cache stores
ciphertext rows only. API responses, search, and tag filtering behave **exactly** as
today. The adversary is DB-only; the service process is trusted and decrypts
transiently in the request path.

## Data Model

New table `user_keys` (the only schema addition):

```
user_keys(
  sub         TEXT PRIMARY KEY,      -- owner sub (sentinel '_legacy_' for NULL-owner rows)
  wrappedDek  TEXT NOT NULL,         -- kw.v1 envelope under the master key
  kekVersion  INTEGER NOT NULL DEFAULT 1,  -- bumped by the rotate-master-key script
  createdAt   DATETIME NOT NULL
)
```

Entity changes:

- `Tag`: `UQ_tag_name_owner` unique index is **relocated to service enforcement**
  (encrypted names are non-deterministic, so a DB unique index can no longer guard
  the invariant). The index is dropped by `notes-backfill`; the service dedupes
  tag names case-insensitively on create/link (single-user scale; documented).
- `Note`: no column changes. `id` becomes service-generated (`randomUUID()` set on
  the entity before insert) so AAD can bind it.

## Encryption Rules

- AAD shapes (uniform per field, identical at encrypt and decrypt):
  - note: `life.v1|<ownerSub>|note|body|<noteId>`
  - tag:  `life.v1|<ownerSub>|tag|name`
- Write path: always encrypt (creates and updates).
- Read path: transparent dual-read — rows with the `enc.v1.` prefix decrypt; legacy
  plaintext rows pass through unchanged (keeps rollback safe and lets the backfill
  run after boot if the deploy window demands it). After `notes-backfill`, legacy
  rows are gone.
- DEK lifecycle: lazily provisioned on first content write per owner (generate DEK →
  wrap → upsert `user_keys`). Reads of encrypted rows fail closed with `CryptoError`
  mapped to a 500 + structured log (ids only, **never** content).
- Master key: `NOTE_MASTER_KEY` env (base64, 32 B) via `loadMasterKeyFromEnv`; loaded
  once at bootstrap; never written to DB, logs, or API errors.

## Search & Tag Filtering (decrypt-then-match)

`LIKE` is retired for content. The read path becomes uniform:

1. SQL fetch of the owner's rows scoped by **metadata only** (`ownerSub`, `deletedAt`),
   ordered exactly as today's code (list: `createdAt DESC`; trash: `deletedAt DESC`;
   `id` tie-break) — no `q`/`tag` in SQL, no reordering.
2. Decrypt fields in memory.
3. Filter: `q` → case-insensitive substring over `body`; `tag` → case-insensitive
   match on tag names (same behavior as today).
4. Paginate in memory (same page shape as today's API).

Parity contract: a unit test asserts the comparator equals `LIKE '%q%'` semantics on
an ASCII corpus (SQLite `LIKE` is ASCII-case-insensitive; JS `toLowerCase()` folds
Unicode more broadly — the broader fold is the accepted, documented deviation).

## Cache Rules

- **Every cached value is ciphertext** — this covers all three cached shapes the
  service has today, not just the list:
  - `note:list:<opts>` / `note:trash:<opts>` → serialized ciphertext rows for the
    scope (scope = all | trash);
  - `note:one:<id>` → the single note's serialized ciphertext row (was: decrypted DTO);
  - `note:tags` → serialized ciphertext tag rows (was: decrypted tag names).
- Key composition follows the existing `notes-cache.ts` `key()` scheme
  (`note:<sub>:v<gen>:<rest>`); `q`/`tag` leave the key space (they no longer affect
  SQL) — one entry serves every search/filter variant. The generation-counter
  invalidation and fail-open/60s-TTL contracts are unchanged.
- Decryption and filtering happen after every cache hit. No plaintext is ever written
  to Redis (AOF persists it — that is the whole point). Tests assert every serialized
  cached value contains `enc.v1.` and no plaintext.

## Project Structure

```
apps/note-service/src/keys/        → user-keys.entity.ts, keys.service.ts (DEK provisioning/memo)
apps/note-service/src/notes/       → service/query changes; cache value shape
apps/note-service/test/            → service + parity + cache tests (temp sqlite, never data/)
```

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/note-service
Build:     npm run build -w @life/note-service
```

## Testing Strategy

1. Service-level round-trip on a temp sqlite DB: create → read → update → trash →
   restore → search → tag filter, asserting **API-visible values identical to input**
   and **DB-stored values are envelopes** (assert on the raw column).
2. LIKE-parity comparator test (ASCII corpus + documented unicode case).
3. Cache test: cached payload contains no plaintext (assert the serialized value has
   `enc.v1.` only), and a hit-path search still matches.
4. Tag dedupe: creating/linking a tag whose name matches an existing one
   (case-insensitive) reuses it; the dropped-DB-index invariant holds at service level.
5. Tamper/decrypt-failure path: corrupt body in the DB → request fails closed, log
   line contains ids only.
6. Legacy dual-read: plaintext row readable before backfill; write path always
   emits envelopes.

## Boundaries

- Always: fail closed on crypto errors; log ids/counts only (never content); keep API
  DTO shapes byte-compatible (the app must not change).
- Ask first: any API/DTO shape change, any new schema beyond `user_keys`.
- Never: plaintext in Redis/logs; `q`/`tag` back into SQL content matching; touching
  `apps/note-service/data/**` (hard line — tests use temp DBs); e2e selector changes.

## Success Criteria

- All stored content fields are envelopes; raw-column assertions prove it.
- UX parity: identical API responses for the fixture matrix (list/search/tag/trash).
- Redis payload inspection shows zero plaintext.
- `npm run typecheck` + targeted suites green.

## Open Questions

None (decisions recorded in `docs/intent/data-privacy.md`; tag-index relocation and
the tag AAD shape are documented trade-offs with upgrade paths).
