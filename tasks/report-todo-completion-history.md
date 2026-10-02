# Report — todo-completion-history (T9 integration review)

Module: `todo-completion-history`. Branch: `feat/todo-completion-history`.
Plan: `tasks/plan-todo-completion-history.md`. Spec: `docs/specs/SPEC-todo-completion-history.md`.
Reviewed range: `60763a7..HEAD` (the chapter's own commits; the branch is stacked on
`feat/todo-custom-repeat`).

## Commands and results

| Command | Result |
|---|---|
| `npm run build -w @life/shared` | pass |
| `npm run typecheck -w @life/todo-service` | pass (zero errors) |
| `npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts test/todo-completions.e2e-spec.ts test/todo-completions-cache.e2e-spec.ts` | pass — 3 suites, 19 tests |
| `npm run typecheck -w @life/app` | pass (zero errors) |
| `npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx test/routes-todos-list.test.tsx` | pass — 2 suites, 14 tests |
| Contract 1 grep — raw HTML in prod UI | zero hits (only `apps/app/test/todo-item.test.tsx`, a test file) |
| Contract 1 grep — `next/link` in apps | zero hits |
| Contract 1 grep — raw colors in `.css` | only `packages/ui/src/styles/tokens.css` (generated `.next/**` ignored) |
| Contract 2 grep — `getThrough` | `apps/todo-service/src/todos/todos.service.ts` present (completions read flows through the cache) |
| Sweep — `reminders/reminder.service.ts` | `done: false` only; zero `reopen` hits in `src/reminders/` |

## Blast radius

`git diff --name-only 60763a7..HEAD` returns exactly the plan's explicit-path list (20 files:
3 amended specs, 1 shared, 6 todo-service source, 4 todo-service tests, 4 app source,
2 app tests). No out-of-scope edit; working tree clean at review time.

## Success criteria (owner spec §Success Criteria)

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | Repeating tick appends one row for the pre-advance due, advances + re-arms, `done:false`, one transaction | `todos.service.ts` update() transaction; `todo-completion.e2e-spec.ts` | pass |
| 2 | One-off tick/undo; repeat-cleared history survives a later one-off tick/undo | `update()` un-complete deletes `(ownerSub, todoId, occurrence)` only; `todo-completion.e2e-spec.ts` | pass |
| 3 | Double tick no-op (`UNIQUE`); stale `expectedVersion` → 409 | guarded `writeCompletion` + `isUniqueViolation`; `todo-completion.e2e-spec.ts` | pass |
| 4 | `GET /api/todos/completions` newest-first, working limit/cursor, `title`/`listName` decrypted, no snapshot | `findCompletions` + controller literal route; `todo-completions.e2e-spec.ts` | pass |
| 5 | Permanent delete cascades; soft delete preserves (hidden from Done), restore re-reveals | `ON DELETE CASCADE`; `todo-completion.e2e-spec.ts` | pass |
| 6 | Sweep fires open rows only; no reopen path | `reminder.service.ts` `done: false`; no `reopen` in `src/reminders/` | pass |
| 7 | One `todo:<sub>:v<gen>:completions` entry; per-owner bump invalidates; filters/pagination out of key | `todo-completions-cache.e2e-spec.ts` | pass |
| 8 | `/todos?done=true` renders the log from `@life/ui`, no done-toggle; All/Open keep `todo.done` | `todo-completion-list.tsx` + page branch; `routes-todos-completions.test.tsx` | pass |
| 9 | Contract 1 greps green; Contract 2 `getThrough` shows the completions read through cache | greps above; cache suite | pass |

## Deviations from the plan (with rationale)

- **T4 placement** — `TODO_COMPLETIONS` in `todo-cache.ts`, but `CachedCompletionRow` +
  `decodeCompletionRows` + `toCachedCompletionRow` in `todos.service.ts`, mirroring the existing
  `CachedTodoRow`/`decodeCiphertextTodoRowList` precedent. The plan's T4 already recorded this
  refinement.
- **T8 touched `routes-todos-list.test.tsx`** — the `done=true` case asserted a `hideDone` prop
  the new Done branch no longer renders; reconciled to assert the body-type swap. The plan's T8
  scoped and justified this.
- **Post-T5 JSDoc correction** — the `update()` doc comment still carried the superseded
  "advances … instead of closing it" wording; corrected comment-only in the T6 commit.

## Residual gaps

- The **interactive browser path** (ticking a repeating todo in the real UI and seeing both the
  Done row and the next occurrence) is a user-run dev check, not covered by unit suites.
- The **production reminder push** path is unrelated to this chapter and remains human-verified
  (`TODO_VAPID_*` unset makes the sweep a no-op in dev/test).
- The cross-chapter **`todo-custom-repeat` re-sync** to the completion-log model is out of scope
  here and tracked in the plan's Coordination note.
