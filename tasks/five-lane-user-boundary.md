# Five-Lane Verification: note-service per-user boundary

Branch: `feature/user-boundary`. Diff under review: `git diff master...HEAD` (chapter,
17 commits at final run). Run date: 2026-09-26.

## Final verdict: **N/N — MERGEABLE** (merge blocked by the user's explicit-request rule)

Trail: suite gate green → lanes 1–5 fired in parallel → lane 1's session was cancelled
mid-run (UNVERIFIED → fail-closed) → user authorized a lane-1 re-run → **5/5 PASS**.

Standing rule from the user (2026-09-26): **no merge without the user's explicit
request**, regardless of gate outcome. The branch is merge-ready and unmerged.

## Suite gate (step 0) — GREEN

app unit ✓ · idp **98/98** (`--runInBand`) · note-service **74/74** (5 suites) ·
lint clean (4 workspaces). Contention adjudication: the parallel idp run reded only on
untouched specs (`oidc-config` better-sqlite3 driver-load race; `keys-jwks` 5s
child-process timeout — both characterized in `tasks/five-lane-redis.md`); zero idp
files in this diff; the documented `--runInBand` mitigation produced 98/98.

## Lane verdicts

| # | Lane | Verdict | Blockers | Notes |
|---|------|---------|----------|-------|
| 1 | correctness-domain | **PASS_WITH_NITS** (re-run) | 0 | adversarial read of the migration (backup-first, no row/id/FK loss, crash windows converge, re-stamp impossible); all 15 repository call sites scoped; legacy NULL rows unreachable; cache isolation sound |
| 2 | code-quality | PASS_WITH_NITS | 1 MEDIUM (stale `SPEC-note-cache.md` Code Style block) — **resolved post-verdict**, docs-only (`e089aa4`) |
| 3 | security | PASS_WITH_NITS | 0 | auth seam, authorization, script injection/traversal, leaks, DTO freeze all verified clean |
| 4 | qa-e2e | PASS_WITH_NITS | 0 | every acceptance behavior mapped to a named passing test; human-owned e2e suite confirmed untouched |
| 5 | plan-conformance | PASS_WITH_NITS | 0 | all REQUIRED items evidenced; all FORBIDDEN items absent; blast radii match the diff |

## Post-verdict corrections (docs-only, committed after the lane verdicts; code untouched)

- `docs/specs/SPEC-note-cache.md` — Code Style block updated to the sub-aware API
  (lane 2's MEDIUM blocker; the Contract section above it was already correct).
- `docs/specs/SPEC-notes.md` — Tech Stack `API_TOKEN` line marked superseded (lane 5 nit 3).
- `tasks/todo-notes-user-boundary.md` — Task 5 blast-radius text corrected: `ts-node`
  was already a note-service devDependency; no dependency/lockfile change was ever made
  (lane 5 nit 1; an earlier commit message claimed this correction but carried the wrong content).

## Recorded nits (non-blocking)

- A zero-user abort happens *after* Step 2 schema surgery (spec-accepted: "zero
  backfill writes"; the backup is the rollback) but the abort message does not point
  the operator at the backup; likewise `main()` prints the backup path only on success.
- `snapshotAndVerify` verifies the `note` count only (not `tag`/`note_tag`);
  `PRAGMA quick_check` covers integrity.
- `applySchema` re-inlines the tag DDL literal instead of reusing `TAG_TABLE_DDL`;
  `foreign_key_check` runs after `COMMIT` (backup is the rollback).
- `@Principal()` trusts the global guard without a runtime assertion.
- `resolveTags` check-then-insert can 500 one request on a concurrent same-name race
  (pre-existing pattern).
- `auth.guard.ts` comment "Dev skips the token check for localhost" predates this
  chapter (the bypass keys on `NODE_ENV`).
- Dead `table === 'note' ? 'id' : 'id'` ternary in `owner-backfill.e2e-spec.ts`;
  `countWhereNull` called twice per table.
- Backup file has umask permissions (same exposure as `life.db`); `main()` prints the
  owner sub to the operator console only.
- `docs/intent/redis-shared-state.md` received a one-line carve-out cross-reference in
  the intent commit — chapter-level bookkeeping outside any task's blast radius.

## Machine-readable verdicts

```json
{"suite_gate":"GREEN","app":"pass","idp":"98/98(runInBand)","note":"74/74","lint":"clean","contention":"adjudicated"}
{"round":1,"lanes":{"correctness-domain":"UNVERIFIED","code-quality":"PASS_WITH_NITS","security":"PASS_WITH_NITS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"PASS_WITH_NITS"},"note":"lane 1 session cancelled; fail-closed = failure"}
{"round":2,"re_run":["correctness-domain"],"lanes":{"correctness-domain":"PASS_WITH_NITS","code-quality":"PASS_WITH_NITS","security":"PASS_WITH_NITS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"PASS_WITH_NITS"}}
{"gate":"MERGEABLE","score":"5/5","merge_condition":"N/N","merge_status":"BLOCKED_BY_USER_EXPLICIT_REQUEST"}
```

## Next

The gate is complete and the chapter is merge-ready. Per the user's standing
instruction, the merge to `master` happens only on their explicit request. The human
deploy checklist (backfill script **before** booting the new code) is in
`tasks/todo-notes-user-boundary.md`.
