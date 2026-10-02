# Task Ledger: todo-custom-repeat (custom weekly recurrence)

Plan (the §5 template owner — every task's full [TASK OBJECTIVE] / [SCOPE & REPOSITORY CONTEXT] /
[IMPLEMENTATION REQUIREMENTS] / [VERIFICATION & TESTING RULES] / [DEFINITION OF DONE] lives there):
`tasks/plan-todo-custom-repeat.md`.
Spec (owner): `docs/specs/SPEC-todo-custom-repeat.md`.
Specs/maps amended (T1): `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
`docs/specs/SPEC-ui-blocks.md`, `docs/specs/MAP-ui-primitives.md`.
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
| T1 | Spec amendments (`SPEC-todo-service`, `SPEC-todo-ui`, `SPEC-ui-blocks`, `MAP-ui-primitives`) | Spec | — | S | [ ] |
| T2 | `@life/shared` wire types (`'custom'`, `TODO_REPEAT_DAYS`, `repeatDays`) | Shared | T1 | S | [ ] |
| T3 | `@life/ui` short-weekday vocabulary (`date-parts.ts`) | UI | T1 | S | [ ] |
| T4 | `@life/ui` `Dialog` block (native `<dialog>`) + tests | UI | T1 | M | [ ] |
| T5 | `recurrence.ts` custom BYDAY step + CSV owners + tests | Core | T2 | M | [ ] |
| T6 | Todo service + entity column + DTOs + cache row | Service | T2, T5 | M | [ ] |
| T7 | Backend behavior suites + cache assertion | Service | T6 | M | [ ] |
| T8 | `repeatLabel` custom + `recurrence-dialog.tsx` + editor wiring | App | T3, T4, T6 | M | [ ] |
| T9 | App tests + mechanical checks | App | T8 | M | [ ] |
| T10 | Integration review + report | Verify | T9 | S | [ ] |
| T11 | Five-lane verification (N/N PASS) | Verify | T10 | S | [ ] |

## Checkpoints

- [ ] Spec: `grep -n "repeatDays" docs/specs/SPEC-todo-service.md` non-empty;
      `grep -n "Dialog" docs/specs/MAP-ui-primitives.md` non-empty.
- [ ] Shared: `npm run typecheck -w @life/shared` exits 0.
- [ ] UI: `npm run typecheck -w @life/ui` exits 0; `npm run test:unit -w @life/ui -- test/format-date.test.ts test/dialog.test.tsx` green.
- [ ] Core: `npm run build -w @life/shared` then `npm run test:unit -w @life/todo-service -- test/recurrence.test.ts` green.
- [ ] Service: `npm run typecheck -w @life/todo-service` exits 0; named backend suites green.
- [ ] App: `npm run typecheck -w @life/app` exits 0; named app suites green.
- [ ] Verify: T10 report + T11 five-lane N/N PASS.

## Gate log (global protocol §6)

| Date | Validator | Round | Verdict | Notes |
|---|---|---|---|---|
| | | 1 | | |
