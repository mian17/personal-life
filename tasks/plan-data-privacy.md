# Plan: data-privacy — note-content encryption at rest

Branch: `feature/data-privacy`. Specs: `docs/specs/MAP-data-privacy.md` + `SPEC-{crypto,notes-at-rest,notes-backfill}.md`.
Intent: `docs/intent/data-privacy.md`. Ledger: `tasks/todo-data-privacy.md`.
Process: AGENTS.md §8 (autonomous after intent gate) + §6 review lifecycle per task.
The superpowers skill set (and its in-plan 10-step workflow) is explicitly **not used** (user instruction 2026-09-27).

## Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Envelope formats `enc.v1.<nonce>.<ct>` / `kw.v1.<nonce>.<ct>` (base64url, ct carries the GCM tag) in the existing TEXT columns | No schema churn on content columns; legacy rows detectable by prefix; versioned for future v2 appends |
| D2 | Key hierarchy: per-user random DEK (32 B), wrapped under KEK = HKDF-SHA256(masterKey, info=`life/dek-wrap/v1`) | Envelope encryption; rotation = rewrap only; HKDF separates wrap purpose from any future master-key use |
| D3 | Master key `NOTE_MASTER_KEY` env (base64, 32 B), loaded once at bootstrap; never in DB/logs | DB-only adversary; env/secret is the custody boundary we accepted |
| D4 | AAD (uniform per field): notes `life.v1\|<ownerSub>\|note\|body\|<noteId>` (note ids become service-generated UUIDs); tags `life.v1\|<ownerSub>\|tag\|name` (auto PK assigned post-insert) | Row-swap integrity where it's free; the tag limitation is a documented trade-off under a read-only adversary with an upgrade path (service-generated tag ids) |
| D5 | Search/tag filtering = decrypt-then-match in memory; SQL touches metadata only (`ownerSub`, `deletedAt`; list `createdAt DESC`, trash `deletedAt DESC`, `id` tie-break — order unchanged) | `LIKE` cannot run over ciphertext; the DB never sees plaintext; parity preserved via a comparator test |
| D6 | **All** cache values are serialized ciphertext rows (list/trash rows, `note:one:<id>`, `note:tags`); keys keep the existing `key()` composition `note:<sub>:v<gen>:<rest>`; `q`/`tag` leave the key space | Redis is AOF-persistent — plaintext there would defeat the chapter; one cached entry serves all filter variants |
| D7 | `UQ_tag_name_owner` relocates to service enforcement (case-insensitive dedupe); backfill drops the index, entity stops declaring it | Non-deterministic ciphertext can't satisfy a DB unique index; single-user scale makes service enforcement sufficient |
| D8 | Transparent dual-read (legacy plaintext passes through, writes always encrypt) | Safe rollback + decouples deploy boot from backfill timing |
| D9 | `@life/crypto` is a build-to-dist workspace package mirroring `@life/shared` (jest maps to `src/`); zero third-party deps (`node:crypto`) | Consistency with existing conventions; supply-chain hygiene for a security module |
| D10 | Ops scripts (`backfill-encrypt`, `rotate-master-key`) are workspace scripts via `ts-node scripts/*.ts` (the `backfill-owner` convention) | Matches the existing run convention; commands are copy-pasteable in the deploy checklist |
| D11 | Command layer: root `typecheck` fans out `npm run typecheck --workspaces --if-present`; `@life/crypto` and `@life/note-service` define `typecheck` (`tsc --noEmit`) and `test:unit` (jest); note-service `testRegex` extends to `(\.e2e-spec\|\.test)\.ts$` | The repo had no `typecheck`/`test:unit` at root (conformance finding F1/F2/F3); this makes every ledger verify command runnable without renaming existing suites |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| GCM nonce misuse | `randomBytes(12)` per encryption, per-user DEK; documented ~2^32 per-DEK rekey bound (SPEC-crypto) |
| Master key lost / wrong in prod | Human checklist: key generation step, dry-run before apply, pre-migration DB file backup (rollback path) |
| Plaintext leak regression (cache/logs) | Tests assert **every** cached shape (`list`/`trash`/`one`/`tags`) serializes `enc.v1.` only; log-shape rule (ids/counts only) in spec boundaries |
| Decrypt failure bricks reads | Fail closed with typed `CryptoError` → 500 + ids-only log; dual-read keeps legacy rows readable; tamper test owned by T3 |
| Tag duplicate race (post-index-drop) | Service-level dedupe on create/link; documented invariant move; single-user concurrency makes the window negligible |
| Migration partial state | Transactional batches, prefix-based idempotence, non-zero exit with row id on failure |
| TypeORM schema-sync interplay | Entity change (drop `@Index`) + backfill `DROP INDEX IF EXISTS` (idempotent either way) |

## Implementation order

`crypto` (T1) → `notes-at-rest` (T2–T5) → `notes-backfill` (T6) → wiring + integration (T7).
Each task: one subagent (AGENTS.md task template), TDD, tech-lead diff review + commit
(§6 lifecycle incl. the UI Contract Check — expecting zero UI diff), targeted tests only
(≤2 runs), `npm run typecheck` per task.

## Verification checkpoints

1. Pre-IMPLEMENT: tech-lead conformance pass over spec↔plan↔ledger (round-1 findings
   1–15 folded in; recorded in the ledger gate log).
2. Per task: prescribed targeted test command green + `npm run typecheck` clean
   (tech lead runs final verification and reviews the diff against the blast radius).
3. Chapter close: five-lane gate (`tasks/five-lane-data-privacy.md`), zero app/UI diff
   asserted (mechanical UI checks run anyway — expecting zero hits), merge on the
   user's explicit request only.
