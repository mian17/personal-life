# Five-lane verification — todo-custom-repeat

Module: `todo-custom-repeat`. Branch: `feat/todo-custom-repeat`.
Range reviewed: `860e187..HEAD` plus the fix-pass working tree.
Plan: `tasks/plan-todo-custom-repeat.md` (PLAN VALIDATED, §6 gate log).
Spec: `docs/specs/SPEC-todo-custom-repeat.md`. Report: `tasks/report-todo-custom-repeat.md`.

**Final verdict: N/N PASS (5/5).** No merge or chapter-close happened before this line.

## Suite gate (step 0, not a lane)

Ran before the lanes and again after each fix pass — all green, targeted named files only:

| Suite | Result |
|---|---|
| `shared -- test/index.test.ts` | 2 pass |
| `ui -- test/format-date.test.ts test/dialog.test.tsx` | 39 pass (30 + 9) |
| `todo-service -- test/recurrence.test.ts test/todos-custom-repeat.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts` | 94 pass (24 + 7 + 23 + 32 + 8) |
| `app -- test/todo-repeat-label.test.ts test/routes-todo-edit.test.tsx` | 38 pass (7 + 31) |
| typechecks `@life/shared` `@life/ui` `@life/todo-service` `@life/app` | all exit 0 |

## Lane verdicts by round

| Lane | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 1 correctness | PASS_WITH_NITS (1) | PASS (0) | — | — | — |
| 2 code-quality | PASS_WITH_NITS (2) | FAIL (1 HIGH) | PASS (0) | — | — |
| 3 security | PASS (0) | *not re-run (no blockers)* | | | |
| 4 QA | FAIL (1 HIGH) | PASS (0) | PASS (0) | — | — |
| 5 plan-conformance | PASS_WITH_NITS (2) | PASS_WITH_NITS (5) | FAIL (5) | UNVERIFIED | PASS_WITH_NITS (0) |

Round 4: lane 5 emitted `PASS_WITH_NITs` (lowercase `s`) — not a member of
`{PASS, PASS_WITH_NITS, FAIL}`. Fail-closed: counted as UNVERIFIED = failure, not a pass.
Re-run once with an explicit uppercase-schema instruction → PASS_WITH_NITS (0).

## Blockers found and closed

| Round | Lane | Blocker | Fix |
|---|---|---|---|
| 1 | 1 | `advanceToOnOrAfter` non-terminating for `custom` + empty set (`nextOccurrence` returns `local`, `while (candidate < nowLocal)` spins) — a corrupt/legacy row hangs the tick PATCH | `recurrence.ts` breaks on a no-progress step; `recurrence.test.ts` gained `terminates on an empty day set` (null + `[]`) |
| 1 | 2 | `Dialog` had no accessible name (`role=dialog` unnamed) | `useId()` + `aria-labelledby` on `<dialog>` → title `id`; test added |
| 1 | 2 | Backdrop click did not close (native `<dialog>` fires `close` only on Escape/programmatic) while Success Criterion 5 requires Escape/backdrop | explicit `onClick` with target-is-dialog + bounding-box guard; outside/inside/Escape tests added |
| 1 | 4 | Spec/plan-named **"Cancel is a no-op"** scenario absent — no test drove `onOpenChange(false)` without `onConfirm` | new case in `routes-todo-edit.test.tsx` asserting committed repeat + payload (`repeat:null`, no `repeatDays`) untouched |
| 1 | 5 | §6 gate log empty (no PLAN VALIDATED row) despite T1–T10 ticked | three rounds recorded: FAIL (`f9a2997`), FAIL (`2b87865`,`860e187`), PLAN VALIDATED 3/3 |
| 1 | 5 | Report claimed 36 files; range is 39 | corrected and verified by command |
| 2 | 2 | **HIGH** — backdrop handler closed the modal on keyboard activation of a child control (keyboard click bubbles with `clientX=0,clientY=0`, outside the centered rect) — keyboard users could not tick a weekday | `if (e.target !== el) return;` before the coordinate test; `dialog.test.tsx` gained a child-click case mocking a non-zero rect so it fails without the guard |
| 2 | 5 | Ledger listed 4 amended specs, plan mandates 5 (`SPEC-todo-due-repeat-notify` missing; its enum delta landed at base `860e187`) | ledger header + T1 row list five with provenance |
| 2 | 5 | Report's blast-radius equivalence false (owner spec not in the 39) | rewritten |
| 2 | 5 | Report attributed the 9 app-test literal migrations to T1; plan scopes them to T2 | corrected |
| 2 | 5 | Report evidence stale (93 tests / 5 dialog cases) | corrected |
| 2 | 5 | `SPEC-ui-blocks.md` + plan T4 described backdrop via `close` event | mechanism text corrected in both |
| 3 | 5 | Owner spec `SPEC-todo-custom-repeat.md` L170 / L229 still said `close` covers Escape/backdrop (HIGH) | mechanism + testing bullet corrected |
| 3 | 5 | Report said 8 dialog cases; file has 9 | corrected |
| 3 | 5 | Report said 37 app tests; actual 38 | corrected |
| 3 | 5 | Report blast radius included the owner spec (not in range) and omitted this report (in range) | rewritten with `git diff --name-status` verification |
| 3 | 5 | `SPEC-ui-blocks.md` called the dialog title a "span"; it is an `<h2>` | corrected |
| 4 | 5 | malformed enum value | fail-closed, re-run |

## Process notes

- Every fix pass was **delegated** (four bounded agents in round 1; one each in rounds 2–3), with
  an explicit allow-list, no-commit/no-push constraints, and per-workspace §3 test budgets.
- No lane was re-run without a blocker. Lane 3 (security) passed round 1 and was never re-run.
- Passing lanes were re-run only where their evidence had become stale (lane 4 after `dialog.tsx`
  changed in the round-2 fix).
- Nothing was committed, merged, or pushed during the fix→re-run loop.

## Residual nits (non-blocking, not closed by this gate)

- `dialog.tsx`'s `close`-listener comment still reads "(Escape/backdrop)"; the mechanism now has
  Escape on `close` and backdrop on `onClick`. Comment-only, no behavior impact.
- The report's "working tree clean at review time" line predates the fix pass (stated as such).
- Interactive browser verification (open the modal, tick a custom todo, see completion + next
  occurrence) remains a user-run dev check, per `report-todo-completion-history.md`.
