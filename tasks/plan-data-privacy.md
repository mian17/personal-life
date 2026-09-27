# Plan: data-privacy — note-content encryption at rest

Branch: `feature/data-privacy`. Specs: `docs/specs/MAP-data-privacy.md` + `SPEC-{crypto,notes-at-rest,notes-backfill}.md`.
Intent: `docs/intent/data-privacy.md`. Ledger: `tasks/todo-data-privacy.md`.

## Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Envelope formats `enc.v1.<nonce>.<ct>` / `kw.v1.<nonce>.<ct>` (base64url, ct carries the GCM tag) in the existing TEXT columns | No schema churn on content columns; legacy rows detectable by prefix; versioned for future v2 appends |
| D2 | Key hierarchy: per-user random DEK (32 B), wrapped under KEK = HKDF-SHA256(masterKey, info=`life/dek-wrap/v1`) | Envelope encryption; rotation = rewrap only; HKDF separates wrap purpose from any future master-key use |
| D3 | Master key `NOTE_MASTER_KEY` env (base64, 32 B), loaded once at bootstrap; never in DB/logs | DB-only adversary; env/secret is the custody boundary we accepted |
| D4 | AAD: notes bind `ownerSub|entity|field|noteId` (note ids become service-generated UUIDs); tags bind `ownerSub|entity|field` (auto PK assigned post-insert) | Row-swap integrity where it's free; the tag limitation is a documented trade-off under a read-only adversary with an upgrade path (service-generated tag ids) |
| D5 | Search/tag filtering = decrypt-then-match in memory; SQL touches metadata only (`ownerSub`, `deletedAt`, stable order) | `LIKE` cannot run over ciphertext; the DB never sees plaintext; parity preserved via a comparator test |
| D6 | Cache stores serialized **ciphertext rows**, keys `note:rows:<sub>:<gen>:<scope>`; `q`/`tag` leave the key space | Redis is AOF-persistent — plaintext there would defeat the chapter; one cached entry serves all filter variants |
| D7 | `UQ_tag_name_owner` relocates to service enforcement (case-insensitive dedupe); backfill drops the index, entity stops declaring it | Non-deterministic ciphertext can't satisfy a DB unique index; single-user scale makes service enforcement sufficient |
| D8 | Transparent dual-read (legacy plaintext passes through, writes always encrypt) | Safe rollback + decouples deploy boot from backfill timing |
| D9 | `@life/crypto` is a build-to-dist workspace package mirroring `@life/shared`; zero third-party deps (`node:crypto`) | Consistency with existing conventions; supply-chain hygiene for a security module |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| GCM nonce misuse | `randomBytes(12)` per encryption, per-user DEK; documented 2^32 rekey bound in SPEC-crypto |
| Master key lost / wrong in prod | Human checklist: key generation step, dry-run before apply, pre-migration DB file backup (rollback path) |
| Plaintext leak regression (cache/logs) | Tests assert cached payloads contain only `enc.v1.`; log-shape rule (ids/counts only) in spec boundaries |
| Decrypt failure bricks reads | Fail closed with typed `CryptoError` → 500 + ids-only log; dual-read keeps legacy rows readable |
| Tag duplicate race (post-index-drop) | Service-level dedupe on create/link; documented invariant move; single-user concurrency makes the window negligible |
| Migration partial state | Transactional batches, prefix-based idempotence, non-zero exit with row id on failure |
| TypeORM schema-sync interplay | Entity change (drop `@Index`) + backfill `DROP INDEX IF EXISTS` (idempotent either way) |

## Implementation order

`crypto` (T1) → `notes-at-rest` (T2–T5) → `notes-backfill` (T6) → wiring + integration (T7).
Each task: one subagent (AGENTS.md task template), TDD, tech-lead diff review + commit,
targeted tests only (≤2 runs), `npm run typecheck` per task.

## Verification checkpoints

1. Pre-IMPLEMENT: `validating-plans` fresh-context gate over spec↔plan conformance (record in ledger).
2. Per task: prescribed targeted test command green + typecheck clean (tech lead runs final verification).
3. Chapter close: five-lane gate (`tasks/five-lane-*.md`), mechanical UI checks N/A (no UI diff expected — assert zero app/UI changes in the diff), merge on the user's explicit request only.
