# Task Ledger: todo-custom-repeat (custom weekly recurrence)

Plan (the §5 template owner — every task's full [TASK OBJECTIVE] / [SCOPE & REPOSITORY CONTEXT] /
[IMPLEMENTATION REQUIREMENTS] / [VERIFICATION & TESTING RULES] / [DEFINITION OF DONE] lives there):
`tasks/plan-todo-custom-repeat.md`.
Spec (owner): `docs/specs/SPEC-todo-custom-repeat.md`.
Specs/maps amended (T1): `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
`docs/specs/SPEC-todo-due-repeat-notify.md`, `docs/specs/SPEC-ui-blocks.md`,
`docs/specs/MAP-ui-primitives.md`.
Amendment provenance: the `'custom'` enum delta to `SPEC-todo-due-repeat-notify.md` landed at the
base commit `860e187` (a plan-repair commit, before the chapter's own range); the T1 commit
`50cbec1` covers the other four.
Governing intent: `docs/intent/todo-custom-repeat.md` (C1–C6).
Branch: `feat/todo-custom-repeat`. Module id: `todo-custom-repeat`.

Process: global protocol §3 (testing policy), §5 (task template), §6 (plan-validation gate),
§7 (review), §7.6 (five-lane for feature work) + repo AGENTS.md (Project Profile, Contracts 1/2).
Test runs stay within §3: targeted, named files only, max 2 executions; no full suite, no E2E.
The plan is not executed until a `validating-plans` subagent returns PLAN VALIDATED (§6).

**Ownership note (DRY, lesson 0016):** this ledger is a status index only. The single copy of each
task's §5 template is the plan; the ledger does not re-state it, so the two can never drift.

## Tasks

| # | Task | Phase | Depends on | Size | Status |
|---|---|---|---|---|---|
| T1 | Spec amendments (`SPEC-todo-service`, `SPEC-todo-ui`, `SPEC-todo-due-repeat-notify`, `SPEC-ui-blocks`, `MAP-ui-primitives`; enum delta at base `860e187`, other four at `50cbec1`) | Spec | — | S | [x] |
| T2 | `@life/shared` wire types (`'custom'`, `TODO_REPEAT_DAYS`, `repeatDays`) | Shared | T1 | S | [x] |
| T3 | `@life/ui` short-weekday vocabulary (`date-parts.ts`) | UI | T1 | S | [x] |
| T4 | `@life/ui` `Dialog` block (native `<dialog>`) + tests | UI | T1 | M | [x] |
| T5 | `recurrence.ts` custom BYDAY step + CSV owners + tests | Core | T2 | M | [x] |
| T6 | Todo service + entity column + DTOs + cache row | Service | T2, T5 | M | [x] |
| T7 | Backend behavior suites + cache assertion | Service | T6 | M | [x] |
| T8 | `repeatLabel` custom + `recurrence-dialog.tsx` + editor wiring | App | T3, T4, T6 | M | [x] |
| T9 | App tests + mechanical checks | App | T8 | M | [x] |
| T10 | Integration review + report | Verify | T9 | S | [x] |
| T11 | Five-lane verification (N/N PASS) | Verify | T10 | S | [x] |

## Checkpoints

- [x] Spec: `grep -n "repeatDays" docs/specs/SPEC-todo-service.md` non-empty;
      `grep -n "Dialog" docs/specs/MAP-ui-primitives.md` non-empty.
- [x] Shared: `npm run typecheck -w @life/shared` exits 0.
- [x] UI: `npm run typecheck -w @life/ui` exits 0; `npm run test:unit -w @life/ui -- test/format-date.test.ts test/dialog.test.tsx` green.
- [x] Core: `npm run build -w @life/shared` then `npm run test:unit -w @life/todo-service -- test/recurrence.test.ts` green.
- [x] Service: `npm run typecheck -w @life/todo-service` exits 0; named backend suites green.
- [x] App: `npm run typecheck -w @life/app` exits 0; named app suites green.
- [x] Verify: T10 report + T11 five-lane N/N PASS.

## Gate log (global protocol §6)

| Date | Validator | Round | Verdict | Notes |
|---|---|---|---|---|
| | fresh-context `validating-plans` | 1 | FAIL | 2 findings fixed in `f9a2997` |
| | fresh-context `validating-plans` | 2 | FAIL | findings fixed in `2b87865` and `860e187` |
| | fresh-context `validating-plans` | 3 | PLAN VALIDATED | 3/3 consecutive passes; gate opened; execution of T1+ began |
