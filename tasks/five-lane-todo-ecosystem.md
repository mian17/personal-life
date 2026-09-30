# Five-Lane Gate: todo-ecosystem (shared tag registry + todo service + ecosystem contracts)

Branch: `feature/todo-ecosystem` · Range: `master..HEAD` (ba47237..9cbf391)
Plan: `tasks/plan-todo-ecosystem.md` · Ledger: `tasks/todo-todo-ecosystem.md`

## Final verdict: **N/N — MERGEABLE** (merge parked: user's explicit request only)

Trail: 11-round conformance gate green → T1–T9 implemented (subagent-per-task,
tech-lead review + checkpoints) → suite gate green (765 tests) → lanes 1–5 fired in
parallel → lanes 1/2/5 FAIL (2 shared blockers + 2 MEDIUMs) → exactly one fix pass
(`3d6f9f7`, tests_pass=true) → failed lanes re-run → **5/5 PASS**.

| Lane | Round 1 | After fix pass |
|---|---|---|
| 1 correctness / domain | **FAIL** (1 CRITICAL, 1 HIGH) | PASS_WITH_NITS |
| 2 code quality | **FAIL** (2 HIGH) | PASS_WITH_NITS |
| 3 security | PASS_WITH_NITS | (stands) |
| 4 QA / coverage | PASS (765/765 reproduced) | (stands) |
| 5 plan conformance | **FAIL** (1 HIGH, 2 MEDIUM) | PASS_WITH_NITS |

## The blockers the gate caught

1. **CRITICAL — migration path defaults one `..` short.** `import.ts`'s defaults
   resolved to `<repo>/apps/apps/...` (the module sits at `src/tags|dist/tags`).
   With `NOTE_DB_PATH` set and `TAGS_DB_PATH` unset, the runbook would have written
   a phantom registry **and then dropped the real `tag` table** — silent loss of the
   entire tag vocabulary. Fixed to repo-root anchoring + a regression test pinning
   both defaults. The migration's own 17 cases never caught it because they always
   passed explicit paths.
2. **HIGH — production app had no ecosystem URLs.** compose injected only
   `API_URL`; the BFF's `TAGS_API_URL`/`TODO_API_URL` fell back to container-local
   loopback, so every note write (which resolves tags first and fails closed) and
   all of `/todos` would have been dead in production — green in dev, harness, and
   every test. Fixed + `depends_on` healthy.
3. **MEDIUM ×2 — audience-model drift:** `.env.development.example` still pinned
   per-service audiences; note-service's verifier default lagged the kernel's
   shared `life-api`. Both aligned (tests pin their own audience via the harness).

## Security posture (lane 3, zero C/H/M)

Fresh nonce per encryption, AAD-bound fields with cross-row transplant tests,
fail-closed key custody with leak-free errors, `@Public()` health only (bodies
`{status}`), byte-identical 404s, parameterized SQL, human-gated migration with
verified backups and honest reports, no new third-party deps, no key material in
tracked files.

## Follow-ups (nits, recorded not blocking)

- IdP's *code default* audience map still falls back to `note-service`
  (`access-token.policy.ts`) — all shipped configs override it; align in a
  follow-up to kill the latent 401 foot-gun.
- `SPEC-note-service-rs.md`'s audience paragraph is stale under the shared model
  (add a supersession note, SPEC-notes-at-rest precedent).
- README's audience sentence is redundantly parenthetical; `.env.development.example`
  comment line predates the `life-api` map.
- `POST /api/tags/resolve` returns 201 for a pure read (spec doesn't pin it).
- Kernel duplication across the two new services (auth/health/keys) is real debt —
  a future `@life/service-kernel` extraction is the senior move when a third
  consumer appears (rule of three, like `resolveDbPath`).
- idp's spawn-based JWKS test is load-sensitive under eight-suite contention
  (pre-existing, passes in isolation).

## Machine record

```json
{"gate":"MERGEABLE","score":"5/5","merge_condition":"N/N","merge_status":"PARKED_AWAITING_USER_EXPLICIT_REQUEST","suite":"8 workspaces, 765 tests, typecheck clean","fix_pass":"3d6f9f7 (tests_pass=true)","human_run_required":"production import-tags migration + deploy + Playwright e2e (frozen surface) — see SPEC-tags-extraction.md checklist"}
```

## Post-gate deltas re-gated (2026-09-30)

After this gate, two user-requested changes landed and were re-gated across the final
state (§7.6: fix blockers, re-run lanes until N/N):
1. `/trash` → `/notes/trash` (route move; URL-only frozen-surface change, user-approved).
2. The **ui-blocks revision** — `Stack`/`Section` primitives + `/todos` consumption
   (its own §6 validation gate: 3 rounds) **plus a late `Row` primitive and a `Card`
   padding fix** from the user's visual pass (the composer date row had split across
   two rows; both manager panels sat flush because `Card` had no padding).

Final five-lane verdict on the re-gated state: **5/5** — lane 1 PASS, lane 3 PASS,
lanes 2/4/5 PASS_WITH_NITS, zero blockers. Suite gate: 789 tests across 8 workspaces
(ui 231, app 173, tags 63, todo 71, note 128, idp 103, cache 15, shared 9) + typecheck
clean. Outstanding human step: the visual pass on `/todos` in `npm run dev` (the
original defect) and the frozen Playwright run.

## Next

Merge to `master` on the user's explicit request only. Deployment is human-run:
generate `TAGS_MASTER_KEY`/`TODO_MASTER_KEY`, run `import-tags --dry-run` → apply
(checklist verbatim in `apps/tags-service/scripts/import-tags.ts` header), boot,
then the human's Playwright pass over the frozen suite (expected: green with the
I5 URL updates; the TagPicker chip deviation T8-2 is the one to eyeball).
