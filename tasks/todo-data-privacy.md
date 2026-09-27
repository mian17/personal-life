# Task Ledger: data-privacy (note-content encryption at rest)

Plan: `tasks/plan-data-privacy.md` · Specs: `docs/specs/MAP-data-privacy.md` + `SPEC-*.md` · Intent: `docs/intent/data-privacy.md`

Status: **IMPLEMENTING** — pre-IMPLEMENT gate pending (validating-plans). Each task = one
subagent (mandatory AGENTS.md task template), TDD, tech-lead diff review + commit.
Test runs: targeted, sequential, ≤2 per task. Merge to `master`: user's explicit request only.

## Tasks

- [ ] T1: `@life/crypto` package (module `crypto`)
  - Files: `packages/crypto/**` (new: package.json, tsconfig, src/, test/), root
    `package.json` (add `packages/crypto` to workspaces), `package-lock.json` (via npm).
  - Acceptance: API signatures exactly per `SPEC-crypto.md`; all 8 required test cases
    (incl. one published AES-256-GCM KAT and the HKDF pin); `npm run build -w @life/crypto` works.
  - Verify: `npm run test:unit -- packages/crypto` && `npm run typecheck`.
- [ ] T2: key management in note-service (module `notes-at-rest`)
  - Files: `apps/note-service/src/keys/{user-keys.entity.ts,keys.module.ts,keys.service.ts}`
    (new), `apps/note-service/src/app.module.ts` (register), `apps/note-service/test/keys.service.test.ts` (new).
  - Acceptance: `user_keys` per spec; lazy DEK provisioning on first write; in-process
    memoized unwrap; master key loaded once via `loadMasterKeyFromEnv('NOTE_MASTER_KEY')`,
    fail closed; no key material in errors/logs.
  - Verify: `npm run test:unit -- apps/note-service/test/keys.service.test.ts` && `npm run typecheck`.
- [ ] T3: encrypted writes/reads + tag handling (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts`, `apps/note-service/src/notes/tag.entity.ts`
    (stop declaring `UQ_tag_name_owner`), `apps/note-service/test/crypto-roundtrip.test.ts` (new).
  - Acceptance: writes always emit `enc.v1` envelopes (note AAD binds service-generated
    uuid; tag AAD per spec); transparent dual-read; API DTOs byte-identical to today;
    tag names deduped case-insensitively at service level; raw-column assertions prove
    ciphertext at rest.
  - Verify: `npm run test:unit -- apps/note-service/test/crypto-roundtrip.test.ts` && `npm run typecheck`.
- [ ] T4: decrypt-then-match search + parity + pagination (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes.service.ts` (query path), `apps/note-service/src/notes/content-match.ts` (new), `apps/note-service/test/content-match.test.ts` (new).
  - Acceptance: `q`/`tag` removed from SQL content matching; metadata-only SQL +
  in-memory filter/paginate; LIKE-parity comparator test (ASCII corpus; documented
  Unicode-folding deviation); same API page shape.
  - Verify: `npm run test:unit -- apps/note-service/test/content-match.test.ts` && `npm run typecheck`.
- [ ] T5: ciphertext-only cache (module `notes-at-rest`)
  - Files: `apps/note-service/src/notes/notes-cache.ts` (value/keys shape), `apps/note-service/src/notes/notes.service.ts` (integration), `apps/note-service/test/notes-cache.test.ts` (existing → extend).
  - Acceptance: cached payloads are serialized ciphertext rows only (assert no
    plaintext in serialized value); keys `note:rows:<sub>:<gen>:<scope>`; `q`/`tag` out
    of the key space; generation-counter + fail-open + 60s TTL contracts unchanged.
  - Verify: `npm run test:unit -- apps/note-service/test/notes-cache.test.ts` && `npm run typecheck`.
- [ ] T6: backfill script (module `notes-backfill`)
  - Files: `apps/note-service/scripts/encrypt-backfill.ts` (new), `apps/note-service/src/keys/backfill.ts` (new), `apps/note-service/test/backfill.test.ts` (new).
  - Acceptance: all 6 required test cases per `SPEC-notes-backfill.md` (idempotence,
    dry-run byte-identical, round-trip decrypt incl. `_legacy_` sentinel owners,
    poisoned-row abort, index drop); deploy checklist rendered in the script header.
  - Verify: `npm run test:unit -- apps/note-service/test/backfill.test.ts` && `npm run typecheck`.
- [ ] T7: env wiring + integration pass
  - Files: `compose.yaml` (note-service `NOTE_MASTER_KEY` passthrough), `.env.development.example`
    (documented placeholder), untracked `.env.development` (dev key — never staged),
    root `package.json`/`package-lock.json` if needed.
  - Acceptance: dev stack boots with a dev key; `npm run typecheck` + `npm run build -w @life/crypto`
    + `next build` unaffected (zero app/UI diff); full targeted suites green; secrets
    nowhere in tracked files.
  - Verify: `npm run typecheck` + the three targeted suites.

## Gate log

- Pre-IMPLEMENT (validating-plans): PENDING
- Five-lane chapter gate: PENDING (tasks complete)
