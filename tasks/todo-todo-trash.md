# Task Ledger: todo-service soft-delete / trash (+ /todos/trash UI)

Plan: `tasks/plan-todo-trash.md` · Specs (owner, amended here):
`docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
Reference (read-only mirror): the notes soft-delete/trash stack.
Branch: `feature/todo-ecosystem`. Module id: `todo-trash`.

Process: global protocol (§5 template, §6 plan-validation gate, §7 review, §7.6
five-lane for feature work) + repo AGENTS.md (Project Profile, Contract 1/2).
Test runs stay within §3: targeted, named files only; the full suite is the tech
lead's final integrated run, and the user's e2e pass is separate.

## Tasks

- [ ] T1: Spec amendments — module `todo-trash`
  - Description: record the trash contract in the two specs before code.
  - Files: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
  - Acceptance: SQL block carries `deletedAt DATETIME NULL`; the "no trash" line is
    replaced by the soft-delete contract; the four trash routes + `todo:trash` cache
    shape + `deletedAt IS NULL` loader guard + trash testing group are recorded; the
    "Ask first" v2 list no longer includes trash; `/todos` bullet names the soft
    delete + `/todos/trash`.
  - Verify: `grep -n "deletedAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "/todos/trash" docs/specs/SPEC-todo-ui.md` non-empty.
  - Dependencies: none. Size: S.
- [ ] T2: Data model — module `todo-trash`
  - Description: `Todo.deletedAt` wire field, `todo.deletedAt` column, `TODO_TRASH`.
  - Files: `packages/shared/src/index.ts`, `apps/todo-service/src/todos/todo.entity.ts`,
    `apps/todo-service/src/cache/todo-cache.ts`.
  - Acceptance: `interface Todo` has `deletedAt: string | null`; entity has the
    nullable datetime column (no default); `TODO_TRASH = 'trash'` exported.
  - Verify: `npm run typecheck -w @life/shared` && `npm run typecheck -w @life/todo-service`.
  - Dependencies: T1. Size: S.
- [ ] T3: Service + controller — module `todo-trash`
  - Description: soft `remove`, trash verbs, trashed-row guards, cache shape.
  - Files: `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/todos/todos.controller.ts`.
  - Acceptance: `remove` sets `deletedAt` (no version bump); `findTrash` cached under
    `todo:trash` (ciphertext rows, `deletedAt DESC, id DESC`, keyset paginate);
    `restore`/`removePermanent`/`emptyTrash` per notes contract; `rawRows`,
    `findOne`, `update`, `listTagUsage` exclude trashed; controller declares static
    `trash` routes before `:id`.
  - Verify: `npm run typecheck -w @life/todo-service`.
  - Dependencies: T2. Size: L.
- [ ] T4: Service tests — module `todo-trash`
  - Description: trash gates + cache ciphertext/invalidation assertions.
  - Files: `apps/todo-service/test/todos.e2e-spec.ts`,
    `apps/todo-service/test/ownership.e2e-spec.ts`,
    `apps/todo-service/test/todo-cache.e2e-spec.ts`.
  - Acceptance: the three suites cover trash/restore/permanent/empty, per-owner
    isolation, the `todo:<sub>:v0:trash` single-loader read, `enc.v1.`-only trash
    value, and bump-after on the four writes.
  - Verify: `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`.
  - Dependencies: T3. Size: M.
- [ ] T5: BFF — module `todo-trash`
  - Description: expose the four trash verbs in the app's todo API.
  - Files: `apps/app/lib/todo-api.ts`.
  - Acceptance: `listTodoTrash` / `restoreTodo` / `deleteTodoPermanently` /
    `emptyTodoTrash` exist with the exact paths/methods in the plan.
  - Verify: `npm run typecheck -w @life/app`.
  - Dependencies: T3. Size: S.
- [ ] T6: App UI — module `todo-trash`
  - Description: soft-delete row, toolbar Trash entry, `/todos/trash` page, actions.
  - Files: `apps/app/app/todo-actions.ts`, `apps/app/app/todo-item.tsx`,
    `apps/app/app/todos/page.tsx`, `apps/app/app/todos/trash/page.tsx` (new).
  - Primitive reuse plan: `IconLink` (toolbar Trash), `ListItem` (trash rows),
    `Button` (quiet Restore / danger Delete-forever), `ConfirmButton` (permanent +
    Empty Trash), `EmptyState`, `PageShell`/`NavBar`/`PageTitle`/`PageActions`,
    `LocalTime`; row delete is a plain danger `Button` (silent soft delete). No raw
    HTML, no `next/link`.
  - Acceptance: row delete creates no confirm and calls `deleteTodoAction`; toolbar
    has `Trash` before `ThemeToggle`; `/todos/trash` mirrors the notes trash page;
    the three actions revalidate both paths.
  - Known coverage gap (explicit): the app files are presentational/server-action
    glue with no unit test; verification is typecheck + targeted app suite + the
    user's visual pass.
  - Verify: `npm run test:unit -w @life/app` && `npm run typecheck -w @life/app`.
  - Dependencies: T5. Size: M.
- [ ] T7: Five-lane verification — module `todo-trash`
  - Description: §7.6 gate on the final state; fix blockers, re-run failed lanes
    until N/N PASS.
  - Files: none (verification; fixes re-open the owning task).
  - Acceptance: five-lane returns N/N PASS; no partial verdict.
  - Verify: the five-lane skill's lane commands.
  - Dependencies: T4, T6. Size: M.
