# Task Ledger: data-privacy (note-content encryption at rest)

Plan: `tasks/plan-data-privacy.md` · Specs: `docs/specs/MAP-data-privacy.md` + `SPEC-*.md` · Intent: `docs/intent/data-privacy.md`

Status: **GATE COMPLETE — 5/5 N/N, MERGEABLE** (merge parked: user's explicit request only). Process: AGENTS.md §8 (autonomous after the intent gate) + §6
review lifecycle per task. Superpowers skills explicitly not used (user instruction
2026-09-27). Each task = one subagent (mandatory AGENTS.md task template), TDD,
tech-lead diff review + commit. Test runs: targeted, sequential, ≤2 per task.
Merge to `master`: user's explicit request only.

## Tasks

- [x] T1: `@life/crypto` package (module `crypto`)
  - Files: `packages/crypto/**` (new: package.json with `typecheck`/`test:unit`/`build`
    scripts, tsconfig, src/, test/), root `package.json` (add `packages/crypto` to
    workspaces + add `"typecheck": "npm run typecheck --workspaces --if-present"`),
    `package-lock.json` (via npm).
  - Acceptance: API signatures exactly per `SPEC-crypto.md` (incl. `CryptoError`,
    `ENC_PREFIX`/`KW_PREFIX`, `rewrapDek`, `loadMasterKeyFromEnv`); all 8 required test
    cases (one published AES-256-GCM KAT, HKDF pin, tamper/format/rotation cases);
    `npm run build -w @life/crypto` produces `dist/`.
  - Verify: `npm run test:unit -w @life/crypto` && `npm run typecheck`.
- [x] T2: key management in note-service (module `notes-at-rest`)
  - Files: `apps/note-service/src/keys/{user-keys.entity.ts,keys.module.ts,keys.service.ts}`
    (new), `apps/note-service/src/app.module.ts` (register), `apps/note-service/package.json`
    (add `@life/crypto` dep + jest `moduleNameMapper` entry mirroring `@life/shared`,
    extend `testRegex` to `(\.e2e-spec|\.test)\.ts$`, add `typecheck`/`test:unit` scripts),
    `apps/note-service/test/keys.service.test.ts` (new).
  - Acceptance: `user_keys` per spec; lazy DEK provisioning on first write; in-process
    memoized unwrap; master key loaded once via `loadMasterKeyFromEnv('NOTE_MASTER_KEY')`,
    fail closed; no key material in errors/logs.
  - Verify: `npm run test:unit -w @life/note-service -- test/keys.service.test.ts` && `npm run typecheck`.
- [x] T3: encrypted writes/reads + tag handling (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts`, `apps/note-service/src/notes/tag.entity.ts`
    (stop declaring `UQ_tag_name_owner`), `apps/note-service/test/crypto-roundtrip.test.ts` (new).
  - Acceptance: writes always emit `enc.v1` envelopes (note AAD binds service-generated
    uuid; tag AAD per spec); transparent dual-read; API DTOs byte-identical to today;
    `listTags` returns decrypted names; tag names deduped case-insensitively at service
    level; raw-column assertions prove ciphertext at rest; **tamper/fail-closed path**:
    corrupt body in the DB → request fails closed (typed `CryptoError` → 500) with an
    ids-only log line.
  - Verify: `npm run test:unit -w @life/note-service -- test/crypto-roundtrip.test.ts` && `npm run typecheck`.
- [x] T4: decrypt-then-match search + parity + pagination (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts` (query path),
    `apps/note-service/src/notes/content-match.ts` (new), `apps/note-service/test/content-match.test.ts` (new).
  - Acceptance: `q`/`tag` removed from SQL content matching; metadata-only SQL with
    today's ordering preserved (list `createdAt DESC`, trash `deletedAt DESC`, `id`
    tie-break); in-memory filter/paginate; same API page shape; LIKE-parity comparator
    test (ASCII corpus; documented Unicode-folding deviation).
  - Verify: `npm run test:unit -w @life/note-service -- test/content-match.test.ts` && `npm run typecheck`.
- [x] T5: ciphertext-only cache (module `notes-at-rest`)
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
- [x] T6: ops scripts — backfill + rotation (module `notes-backfill`)
  - Files: `apps/note-service/scripts/encrypt-backfill.ts`, `apps/note-service/scripts/rotate-master-key.ts`
    (new), `apps/note-service/src/keys/backfill.ts`, `apps/note-service/src/keys/rotation.ts` (new),
    `apps/note-service/src/keys/db.ts` (new — shared cwd-independent DB-path helper,
    added by the five-lane fix pass), `apps/note-service/test/backfill.test.ts` (new),
    `apps/note-service/test/backfill-db-path.test.ts` (new — path-resolution regression
    suite, fix pass), `apps/note-service/package.json`
    (add `backfill-encrypt`, `rotate-master-key` scripts — `ts-node scripts/*.ts` convention).
  - Acceptance: all 7 required cases per `SPEC-notes-backfill.md` (idempotence,
    dry-run byte-identical, round-trip decrypt incl. `_legacy_` sentinel owners,
    poisoned-row abort, index drop, rotation rewrap-all touching zero content rows +
    already-rotated rows reported skipped); deploy checklist commands run verbatim
    (`npm run backfill-encrypt -w @life/note-service -- --dry-run` etc.); checklist
    rendered in the script header.
  - Verify: `npm run test:unit -w @life/note-service -- test/backfill.test.ts` && `npm run typecheck`.
- [x] T7: env wiring + integration pass
  - Files: `compose.yaml` (note-service `NOTE_MASTER_KEY` passthrough),
    `.env.development.example` (documented placeholder, no value), untracked
    `.env.development` (dev key — never staged).
  - Integration repairs (tech lead) — ownership: the seven files below were
    edited during the integration pass (I1–I3 + deploy wiring) and are owned
    here; no other task's Files list covers them.
    - `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`
      — deploy wiring: `COPY packages/crypto/package.json` (note-service also
      copies `packages/crypto` and builds `@life/crypto`) so `npm ci` and the
      image build resolve the new workspace package.
    - `apps/note-service/test/setup-env.ts` — jest `setupFiles` supplying the
      obviously-fake test master key so e2e suites that boot `AppModule` start
      (I2).
    - `apps/note-service/src/notes/notes.module.ts` — import `KeysModule` so
      `NotesService` can resolve `KeysService` (I1 dependency wiring).
    - `apps/note-service/scripts/backfill-owner.ts`,
      `apps/note-service/test/owner-backfill.e2e-spec.ts` — I3: propagate the D7
      schema truth (drop `UQ_tag_name_owner`, create `user_keys`) to the legacy
      owner-backfill DDL and its suite, keeping the boot-mutates-nothing
      contract.
  - Acceptance: dev stack boots with a dev key; `npm run typecheck` + `npm run build -w @life/crypto`
    + `npm run build -w @life/note-service` green; zero UI diff — the `apps/app`
    diff is limited to the Dockerfile workspace-manifest line (build plumbing);
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
- Integration boundary run (T7): 9/9 suites, 110/110 tests, typecheck + builds clean,
  zero UI diff (the `apps/app` diff is limited to the Dockerfile workspace-manifest
  line — build plumbing, no UI change), no secrets in tracked files. Found and fixed
  3 real defects:
  I1 (T5 regression) unbound `this.openField` decrypt callback masked `CryptoError`
  with `TypeError` on tamper paths → bound (`openFieldCb`); I2 e2e suites booting
  `AppModule` need the master key → jest `setupFiles` test key (public by design);
  I3 D7 schema truth propagated to the old `backfill-owner` DDL (no `UQ_tag_name_owner`,
  creates `user_keys`) keeping the boot-mutates-nothing contract. Also measured: one
  earlier full-run flake (37 failures) traced to stale state from a boot-crashed run;
  3 consecutive full runs since are 100% stable.
- Dev boot with the real dev key (bounded, port 3101): `Nest application successfully
  started`, HTTP 200 on `/api/tags` — keys + notes modules initialized.
- Five-lane chapter gate, round 1 (5 parallel lanes over master..HEAD): lanes 1
  (correctness) PASS_WITH_NITS, 3 (security) PASS, 4 (qa) PASS_WITH_NITS, 2
  (code-quality) FAIL + 5 (plan-conformance) FAIL — one shared HIGH defect: the ops
  scripts' DB-path default resolved against INIT_CWD, so the documented repo-root
  deploy command targeted <repo>/data/life.db instead of apps/note-service/data/life.db
  (a migration that would never touch the production data), plus ledger-ownership
  accuracy items. One fix pass (tests_pass=true): shared `src/keys/db.ts` helper with a
  package-anchored default + `test/backfill-db-path.test.ts` (3 cases), truthful script
  comments, ledger ownership for the seven integration-repair files, corrected
  zero-UI-diff wording. Re-run: lane 2 PASS_WITH_NITS (blocker verified fixed).
- Five-lane re-run after fix pass `f3dc4aa`: lane 2 PASS_WITH_NITS (blocker verified
  fixed at HEAD), lane 5 PASS_WITH_NITS (all 4 blockers verified closed; full
  conformance walk clean — 46 diff files all owned, D1–D11 traceable). Final:
  **5/5 N/N — MERGEABLE** (`tasks/five-lane-data-privacy.md`). Merge + production
  migration remain human-gated (explicit request / human-run per AGENTS.md §8).
