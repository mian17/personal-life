# Task Ledger: todo-completion-history (append-only completion log)

Plan (the §5 template owner — every task's full [TASK OBJECTIVE] / [SCOPE & REPOSITORY CONTEXT] /
[IMPLEMENTATION REQUIREMENTS] / [VERIFICATION & TESTING RULES] / [DEFINITION OF DONE] lives there):
`tasks/plan-todo-completion-history.md`.
Spec (owner): `docs/specs/SPEC-todo-completion-history.md`.
Specs amended (T1): `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
`docs/specs/SPEC-todo-ui.md`.
Governing intent: `docs/intent/todo-completion-history.md` (locked C1–C8).
Branch: `feat/todo-completion-history`. Module id: `todo-completion-history`.

Process: global protocol §3 (testing policy), §5 (task template), §6 (plan-validation gate),
§7 (review), §7.6 (five-lane for feature work) + repo `AGENTS.md` (Project Profile, Contracts 1/2).
Test runs stay within §3: targeted, named files only, max 2 executions; no full suite, no E2E.
The plan is not executed until a `validating-plans` subagent returns PLAN VALIDATED (§6).

**Ownership note (DRY, lesson 0016):** this ledger is a status index only. The single copy of each
task's §5 template is the plan; the ledger does not re-state it, so the two can never drift.

## Tasks

| # | Task | Phase | Depends on | Size | Status |
|---|---|---|---|---|---|
| T1 | Cross-spec amendments (`SPEC-todo-service`, `SPEC-todo-due-repeat-notify`, `SPEC-todo-ui`) | Spec | — | S | [ ] |
| T2 | `@life/shared` wire types (`TodoCompletion`, `TodoCompletionPage`; `Todo` untouched) | Shared | T1 | S | [ ] |
| T3 | `todo-completion.entity.ts` + registration (`forFeature`, `entities`) | Entity | T2 | S | [ ] |
| T4 | Completions cache shape (`TODO_COMPLETIONS`, `CachedCompletionRow`, `decodeCompletionRows`) | Cache | T3 | S | [ ] |
| T5 | Service tick/undo transaction + `findCompletions` + `GET /api/todos/completions` | Service | T3, T4 | L | [ ] |
| T6 | Backend suites (`todo-completion`, `todo-completions`, `todo-completions-cache`) + harness | Service | T5 | M | [ ] |
| T7 | App: `listTodoCompletions`, `collectTodoCompletions`, `todo-completion-list.tsx`, page branch | App | T2, T5 | M | [ ] |
| T8 | App tests (`routes-todos-completions`, `routes-todos-list` reconciliation) + mechanical checks | App | T7 | M | [ ] |
| T9 | Integration review + report | Verify | T8 | S | [ ] |
| T10 | Five-lane verification (N/N PASS) | Verify | T9 | S | [ ] |

## Checkpoints

- [ ] Spec: `grep -n "todo_completion" docs/specs/SPEC-todo-service.md` non-empty;
      `grep -n "record a completion" docs/specs/SPEC-todo-due-repeat-notify.md` non-empty;
      `grep -n "No completed todos" docs/specs/SPEC-todo-ui.md` non-empty.
- [ ] Shared: `npm run typecheck -w @life/shared` exits 0.
- [ ] Entity/Cache/Service: `npm run build -w @life/shared` then
      `npm run typecheck -w @life/todo-service` exits 0.
- [ ] Backend tests: `npm run build -w @life/shared` then
      `npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts test/todo-completions.e2e-spec.ts test/todo-completions-cache.e2e-spec.ts`
      green.
- [ ] App: `npm run build -w @life/shared` then `npm run typecheck -w @life/app` exits 0;
      `npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx test/routes-todos-list.test.tsx`
      green; Contract 1 greps clean.
- [ ] Verify: T9 report + T10 five-lane N/N PASS.

## Coordination (not a task)

This chapter changes the tick contract; `todo-custom-repeat` (spec + plan, already validated) must
be re-synced to the completion-log model after this chapter lands (lesson 0012). Out of scope here;
recorded in the plan's Coordination section.

## Gate log (global protocol §6)

| Date | Validator | Round | Verdict | Notes |
|---|---|---|---|---|
| | | 1 | | |
