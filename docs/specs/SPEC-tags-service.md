# Spec: tags-service (ecosystem tag registry)

Module id: `tags-service` (see `MAP-todo-ecosystem.md`). New workspace app
`apps/tags-service`, mirroring note-service's stack and patterns (NestJS + TypeORM
better-sqlite3 + `@life/cache` + `@life/crypto` + IdP JWKS auth).

## Objective

The single source of truth for tag names across the whole ecosystem: any entity in
any service can be tagged (MAP M1 — vocabulary centralized, associations local).
"Tags could mean anything associated with it across the whole ecosystem" — so this
service owns vocabulary only, never associations.

## Data model

```
tag(
  id        INTEGER PRIMARY KEY AUTOINCREMENT,  -- preserved ids, sole writer (M2)
  name      TEXT NOT NULL,                      -- enc.v1 envelope
  ownerSub  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 0,         -- kernel concurrency contract
  createdAt DATETIME NOT NULL
)
user_keys(sub, wrappedDek, kekVersion, createdAt)   -- own key custody (M3)
```

- DB wiring: `DB_PATH` env (default `apps/tags-service/data/tags.db` via
  `src/keys/db.ts`, mirroring note-service's resolver); compose bind-mounts
  `./apps/tags-service/data:/data` with `DB_PATH=/data/tags.db`.

- Name encryption: `@life/crypto` envelope with AAD `life.v1|<sub>|tag|name` — the
  byte-identical shape note-service used, so migration re-encrypts cleanly.
- No association tables. Uniqueness is case-insensitive per owner, enforced at
  service level (ciphertext cannot satisfy a DB unique index — SPEC-notes-at-rest
  precedent).

## Behavior / API (kernel contracts apply)

- `GET /api/tags` → `[{id, name, createdAt}]`, decrypted, name-sorted
  (case-insensitive). Names exist only here.
- `POST /api/tags {name}` → create-or-get case-insensitively (201 created / 200
  existing). This is the only way tags come into existence.
- `PATCH /api/tags/:id {name, expectedVersion?}` → rename. Ecosystem-wide by
  construction (single name source). Rejects a case-insensitive collision with a
  *different* tag of the same owner (409) and a stale `expectedVersion` (409;
  omit = last-write-wins — kernel concurrency contract).
- `DELETE /api/tags/:id` → delete the vocabulary row. Consumers detach (kernel
  `TagRef` semantics). Never touches domain content.
- `POST /api/tags/resolve {ids}` → `[{id, name}]` for the caller's own tags;
  unknown/foreign ids are omitted (consumers treat omitted ids as detached).
- All writes bump the owner's cache generation counter.

## Encryption (per SPEC-notes-at-rest discipline)

- Writes always emit envelopes; reads decrypt after cache hits; tamper fails closed
  (typed `CryptoError` → 500, ids-only log line).
- No dual-read (M5) — the store starts encrypted. Master key `TAGS_MASTER_KEY`
  (32-byte base64), fail-closed bootstrap.

## Cache Rules (AGENTS.md Contract 2)

- Cached shape: the owner's serialized **ciphertext** tag rows — one entry serves
  both the list and `resolve` (slice by id in memory after the hit).
- Key: `tags:<sub>:v<gen>:all`. No request parameters in the key.
- Invalidation: per-owner generation counter bumped on create/rename/delete; 60s
  TTL backstop; fail-open on any cache error (direct loader).
- Decrypt and sort after every hit. No plaintext ever reaches Redis.

## Health

Per `SPEC-service-kernel`: `/health/live` (no dependency checks), `/health/ready`
(DB + key custody only).

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/tags-service
Build:     npm run build -w @life/tags-service
```

## Testing Strategy

1. create-or-get case-insensitivity (`Work`/`work`/`WORK` → one row).
2. Rename reaches every consumer path (single source: resolve returns the new name
   on the next call).
3. Delete-detach: after delete, `resolve` omits the id; a consumer's association
   rows are untouched by this service.
4. `resolve` is owner-scoped (foreign ids omitted).
5. Raw column assertions: `name` starts `enc.v1.`; no known plaintext serialized in
   cached values.
6. Tamper → fail closed, ids-only log.
7. Health routes (live/ready semantics).

## Boundaries

- Always: kernel contracts as written; cache values ciphertext-only.
- Ask first: adding association storage here (that would flip MAP M1).
- Never: store tag names in other services; run migration code at boot; touch
  `apps/*/data/**` in code or tests (temp DBs only).

## Success Criteria

1. `apps/tags-service` boots with `TAGS_MASTER_KEY`, serves the five endpoints with
   tests green.
2. Renaming a tag changes what every future consumer sees; deleting detaches, never
   destroys content.
3. `SPEC-tags-extraction` can migrate real rows into this schema unchanged.
