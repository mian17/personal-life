# Five-Lane Verification: note-service per-user boundary

Branch: `feature/user-boundary`. Diff under review: `git diff master...HEAD` (chapter,
15 commits at run time). Run date: 2026-09-26.

## Final verdict: **INCONCLUSIVE — 4/5 lanes returned, lane 1 UNVERIFIED (session cancelled)**

Fail-closed scoring: a missing verdict is a failure, never a pass — so this run does
**not** reach N/N. Independent standing rule from the user (2026-09-26): **no merge
without the user's explicit request**, regardless of gate outcome.

## Suite gate (step 0) — GREEN

app unit ✓ · idp **98/98** (`--runInBand`) · note-service **74/74** (5 suites) ·
lint clean (4 workspaces). Contention adjudication: the parallel idp run reded only on
untouched specs (`oidc-config` better-sqlite3 driver-load race; `keys-jwks` 5s
child-process timeout — both characterized in `tasks/five-lane-redis.md`); zero idp
files in this diff; the documented `--runInBand` mitigation produced 98/98.

## Lane verdicts (round 1)

| # | Lane | Verdict | Blockers | Notes |
|---|------|---------|----------|-------|
| 1 | correctness-domain | **UNVERIFIED** | — | session cancelled before returning a verdict; not re-run without user authorization |
| 2 | code-quality | PASS_WITH_NITS | 1 MEDIUM (stale `SPEC-note-cache.md` Code Style block) — **resolved post-verdict**, docs-only |
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

- `auth.guard.ts` comment "Dev skips the token check for localhost" predates this
  chapter (the bypass keys on `NODE_ENV`, not localhost).
- `SPEC-owner-backfill.md` says "zero writes" on zero-users abort where the suite
  asserts "zero backfill writes" (Step 2 DDL legitimately precedes Step 3).
- `backfill-owner.ts` re-inlines the tag DDL string instead of reusing `TAG_TABLE_DDL`
  (drift risk between the two literals).
- Dead `table === 'note' ? 'id' : 'id'` ternary in `owner-backfill.e2e-spec.ts`;
  `countWhereNull` called twice per table.
- `foreign_key_check` runs after `COMMIT` in the tag rebuild (practically unreachable;
  the Step 1 backup is the documented rollback).
- `@Principal()` trusts the global guard without a runtime assertion.
- `docs/intent/redis-shared-state.md` received a one-line carve-out cross-reference in
  the intent commit — chapter-level bookkeeping outside any task's blast radius.
- Lane 2 nits: `resolveTags` check-then-insert race (pre-existing pattern); backup file
  has umask permissions (same exposure as `life.db`); `main()` prints the owner sub to
  the operator console only.

## Machine-readable verdicts

```json
{"suite_gate":"GREEN","app":"pass","idp":"98/98(runInBand)","note":"74/74","lint":"clean","contention":"adjudicated"}
{"round":1,"lanes":{"correctness-domain":"UNVERIFIED","code-quality":"PASS_WITH_NITS","security":"PASS_WITH_NITS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"PASS_WITH_NITS"},"blockers_open":0}
{"gate":"INCONCLUSIVE","score":"4/5","merge_condition":"N/N","merge_blocked_by":"user explicit-request rule","next":"re-run lane 1 on user authorization"}
```

## Next

Lane 1 (correctness/domain) must run for the gate to reach N/N. Per the user's
standing instruction the merge is blocked until they explicitly request it; lane 1's
re-run is likewise awaiting their word.
