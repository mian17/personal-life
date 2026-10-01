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

- DB wiring: `DB_PATH` env (default `apps/tags-service/data/tags.db` via `@life/shared`'s `resolveDbPath`
  (note-service's split: the service reads `DB_PATH` inline, scripts resolve their
  own vars); compose bind-mounts
  `./apps/tags-service/data:/data` with `DB_PATH=/data/tags.db`.

- Name encryption: `@life/crypto` envelope with AAD `life.v1|<sub>|tag|name` — the
  byte-identical shape note-service used, so migration re-encrypts cleanly.
- No association tables. Uniqueness is case-insensitive per owner, enforced at
  service level (ciphertext cannot satisfy a DB unique index — SPEC-notes-at-rest
  precedent).

## Behavior / API (kernel contracts apply)

- `GET /api/tags` → `[{id, name, version, createdAt}]`, decrypted, name-sorted
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

## Maintenance scripts

Operator-run scripts that write the `tag` table directly, outside the request
path and only with the stack stopped (never while the service is serving).

### cleanup-tags — orphan registry cleanup

Operator-run remediation for orphaned registry rows — tags left behind with no
remaining association. It cleans up rows that a detach path (for example the
notes autosave partial-token bug) has already produced; it is a remediation
tool, not a fix for the producing bug.

- **Orphan definition (exact).** With
  `referenced = { tag.id : tag.id ∈ DISTINCT(note_tag.tagId) ∪
  DISTINCT(todo_tag.tagId) }` over `note_tag` in the note DB and `todo_tag` in
  the todo DB, `orphans = { tag.id : tag.id ∉ referenced }`. The set difference
  is over plaintext integer ids only — no decryption. `scanned` is the `tag` row
  count, `referenced` the scanned rows that are referenced, and
  `orphans = scanned − referenced`. The legacy `tag` table in the note DB
  (dropped by the import migration) is never read.
- **Trashed rows count as references.** The script never filters on
  `note.deletedAt` / `todo.deletedAt`: soft-deleted notes and todos keep their
  join rows, so a tag held only by a trashed row is **not** orphaned and is
  kept, because restore must keep working. The script's SQL must not mention
  `deletedAt`.
- **Ids-only logging / no decryption.** The report prints `id` + `ownerSub`,
  never `name` (which is `enc.v1.` ciphertext). `TAGS_MASTER_KEY` is not
  required, and the script never decrypts.
- **Fail-closed inputs.** If any of `tags.db`, `life.db`, `todo.db` does not
  exist as a file, the script errors and deletes nothing — orphanhood cannot be
  proven with an input missing. An existing DB whose join table genuinely does
  not exist contributes the empty set (`tableExists` guard per DB); a `tags.db`
  with no `tag` table scans zero rows and deletes nothing.
- **Backup-before-write.** Apply is the default; `--dry-run` is read-only and
  byte-pure (no snapshot, no write). Apply takes a self-verified `VACUUM INTO`
  snapshot (`PRAGMA quick_check` = `ok`, via the shared `snapshotAndVerify`
  helper reused from `import-tags`) **before** the delete transaction, so the
  snapshot captures the pre-delete registry state. Deletes are per-owner-scoped
  hard deletes (`DELETE FROM "tag" WHERE "ownerSub" = ? AND "id" = ?`) inside
  one transaction; a failed delete rolls the whole transaction back.
- **Cache staleness / stack-stopped rule.** Raw SQL bypasses the per-owner
  generation bump the request path performs, so `tags:<sub>:v<gen>:all` can
  serve a deleted tag up to the next invalidation. The mitigation is to run with
  the stack stopped (the `import-tags` precedent); the 60 s TTL backstop
  documented in `## Cache Rules` bounds any residual staleness after a restart.
  The script never reads through, writes to, or connects to Redis/`@life/cache`,
  and the service's failure mode is unchanged (fail-open to the direct loader).
- **Sole-writer deviation (M2).** The data model declares the service sole
  writer of `tag`; this operator-run script is the one sanctioned second writer,
  exactly like `import-tags`. It only hard-deletes orphan rows — never inserts,
  never renames — and the request path remains the sole writer.
- **Command + env overrides.** `npm run cleanup-tags -w @life/tags-service --
  [--dry-run]`, with `TAGS_DB_PATH` / `NOTE_DB_PATH` / `TODO_DB_PATH` overrides
  resolved via `@life/shared`'s `resolveDbPath` (defaults anchored at the repo
  root: `apps/tags-service/data/tags.db`, `apps/note-service/data/life.db`,
  `apps/todo-service/data/todo.db`). Agents never point it at real DBs — the
  human runs it (hard line, `apps/*/data/**`).
- **Report.** One summary line
  `cleanup-tags [plan|apply]: scanned=N referenced=R orphans=M deleted=D errors=0`
  (`deleted` is `0` in plan mode; `errors` is always `0` on a returned report,
  and any failure prints `cleanup-tags failed: <message>` and exits non-zero),
  then one detail line per orphan in ascending `id` order,
  `orphan id=<id> owner=<ownerSub>`. `orphans` equals the number of detail
  lines; zero orphans prints the summary line only.

## Health

Per `SPEC-service-kernel`: `/health/live` (no dependency checks), `/health/ready`
(DB + key custody only), and the `/health` deprecated alias (readiness semantics).

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
