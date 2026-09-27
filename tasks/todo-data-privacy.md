# Task Ledger: data-privacy (note-content encryption at rest)

Plan: `tasks/plan-data-privacy.md` · Specs: `docs/specs/MAP-data-privacy.md` + `SPEC-*.md` · Intent: `docs/intent/data-privacy.md`

Status: **IMPLEMENTING**. Process: AGENTS.md §8 (autonomous after the intent gate) + §6
review lifecycle per task. Superpowers skills explicitly not used (user instruction
2026-09-27). Each task = one subagent (mandatory AGENTS.md task template), TDD,
tech-lead diff review + commit. Test runs: targeted, sequential, ≤2 per task.
Merge to `master`: user's explicit request only.

## Tasks

- [ ] T1: `@life/crypto` package (module `crypto`)
  - Files: `packages/crypto/**` (new: package.json with `typecheck`/`test:unit`/`build`
    scripts, tsconfig, src/, test/), root `package.json` (add `packages/crypto` to
    workspaces + add `"typecheck": "npm run typecheck --workspaces --if-present"`),
    `package-lock.json` (via npm).
  - Acceptance: API signatures exactly per `SPEC-crypto.md` (incl. `CryptoError`,
    `ENC_PREFIX`/`KW_PREFIX`, `rewrapDek`, `loadMasterKeyFromEnv`); all 8 required test
    cases (one published AES-256-GCM KAT, HKDF pin, tamper/format/rotation cases);
    `npm run build -w @life/crypto` produces `dist/`.
  - Verify: `npm run test:unit -w @life/crypto` && `npm run typecheck`.
- [ ] T2: key management in note-service (module `notes-at-rest`)
  - Files: `apps/note-service/src/keys/{user-keys.entity.ts,keys.module.ts,keys.service.ts}`
    (new), `apps/note-service/src/app.module.ts` (register), `apps/note-service/package.json`
    (add `@life/crypto` dep + jest `moduleNameMapper` entry mirroring `@life/shared`,
    extend `testRegex` to `(\.e2e-spec|\.test)\.ts$`, add `typecheck`/`test:unit` scripts),
    `apps/note-service/test/keys.service.test.ts` (new).
  - Acceptance: `user_keys` per spec; lazy DEK provisioning on first write; in-process
    memoized unwrap; master key loaded once via `loadMasterKeyFromEnv('NOTE_MASTER_KEY')`,
    fail closed; no key material in errors/logs.
  - Verify: `npm run test:unit -w @life/note-service -- test/keys.service.test.ts` && `npm run typecheck`.
- [ ] T3: encrypted writes/reads + tag handling (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts`, `apps/note-service/src/notes/tag.entity.ts`
    (stop declaring `UQ_tag_name_owner`), `apps/note-service/test/crypto-roundtrip.test.ts` (new).
  - Acceptance: writes always emit `enc.v1` envelopes (note AAD binds service-generated
    uuid; tag AAD per spec); transparent dual-read; API DTOs byte-identical to today;
    `listTags` returns decrypted names; tag names deduped case-insensitively at service
    level; raw-column assertions prove ciphertext at rest; **tamper/fail-closed path**:
    corrupt body in the DB → request fails closed (typed `CryptoError` → 500) with an
    ids-only log line.
  - Verify: `npm run test:unit -w @life/note-service -- test/crypto-roundtrip.test.ts` && `npm run typecheck`.
- [ ] T4: decrypt-then-match search + parity + pagination (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts` (query path),
    `apps/note-service/src/notes/content-match.ts` (new), `apps/note-service/test/content-match.test.ts` (new).
  - Acceptance: `q`/`tag` removed from SQL content matching; metadata-only SQL with
    today's ordering preserved (list `createdAt DESC`, trash `deletedAt DESC`, `id`
    tie-break); in-memory filter/paginate; same API page shape; LIKE-parity comparator
    test (ASCII corpus; documented Unicode-folding deviation).
  - Verify: `npm run test:unit -w @life/note-service -- test/content-match.test.ts` && `npm run typecheck`.
- [ ] T5: ciphertext-only cache (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes-cache.ts` (value shape where needed),
    `apps/note-service/src/notes/notes.service.ts` (integration), `apps/note-service/test/notes-cache.e2e-spec.ts`
    (existing suite → extend).
  - Acceptance: **all three cached shapes** store ciphertext only — `note:list:*` /
    `note:trash:*` (rows), `note:one:<id>` (single row; was decrypted DTO), `note:tags`
    (tag rows; was decrypted names) — each asserted `enc.v1.`-only in serialized form;
    keys keep the existing `key()` composition with `q`/`tag` out of the key space;
    generation-counter + fail-open + 60s TTL contracts unchanged; decrypt happens on
    every hit path (incl. `findOne` and `listTags`).
  - Verify: `npm run test:unit -w @life/note-service -- test/notes-cache.e2e-spec.ts` && `npm run typecheck`.
- [ ] T6: ops scripts — backfill + rotation (module `notes-backfill`)
  - Files: `apps/note-service/scripts/encrypt-backfill.ts`, `apps/note-service/scripts/rotate-master-key.ts`
    (new), `apps/note-service/src/keys/backfill.ts`, `apps/note-service/src/keys/rotation.ts` (new),
    `apps/note-service/test/backfill.test.ts` (new), `apps/note-service/package.json`
    (add `backfill-encrypt`, `rotate-master-key` scripts — `ts-node scripts/*.ts` convention).
  - Acceptance: all 7 required cases per `SPEC-notes-backfill.md` (idempotence,
    dry-run byte-identical, round-trip decrypt incl. `_legacy_` sentinel owners,
    poisoned-row abort, index drop, rotation rewrap-all touching zero content rows +
    already-rotated rows reported skipped); deploy checklist commands run verbatim
    (`npm run backfill-encrypt -w @life/note-service -- --dry-run` etc.); checklist
    rendered in the script header.
  - Verify: `npm run test:unit -w @life/note-service -- test/backfill.test.ts` && `npm run typecheck`.
- [ ] T7: env wiring + integration pass
  - Files: `compose.yaml` (note-service `NOTE_MASTER_KEY` passthrough),
    `.env.development.example` (documented placeholder, no value), untracked
    `.env.development` (dev key — never staged).
  - Acceptance: dev stack boots with a dev key; `npm run typecheck` + `npm run build -w @life/crypto`
    + `npm run build -w @life/note-service` green; zero app/UI diff (`git diff master...HEAD -- apps/app` empty);
    all three targeted suites green in one pass; no secrets in tracked files.
  - Verify: `npm run typecheck` + `npm run test:unit -w @life/crypto` + `npm run test:unit -w @life/note-service`.

## Gate log

- Pre-IMPLEMENT conformance round 1 (fresh-context validator): **FAIL, 15 findings**
  (F1–F15) — all folded into specs/plan/ledger 2026-09-27 (command layer F1/F2/F15 +
  D11, jest testRegex F3, cache-scope gap F5 `note:one`/`note:tags`, key-shape F6,
  ordering parity F7, tamper-test ownership F8, run-convention F9 + D10, dep/mapper
  ownership F10, nonce bound F11, AAD prefix F12, rotation ownership F13 + D10,
  `listTags` naming F14, T5 file name F4).
- `validating-plans`/superpowers process: **dropped per user instruction** (its
  10-step in-plan workflow and successor chain). The gate log above stands as the
  tech-lead conformance record (§6); per-task review + five-lane gate at close remain.
- Five-lane chapter gate: PENDING (tasks complete).
