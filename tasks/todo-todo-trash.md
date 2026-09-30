# Task Ledger: todo-service soft-delete / trash (+ /todos/trash UI)

Plan: `tasks/plan-todo-trash.md` · Specs (owner, amended by T1):
`docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
Reference (read-only mirror): the notes soft-delete/trash stack.
Branch: `feature/todo-ecosystem`. Module id: `todo-trash`.

Process: global protocol (§5 template, §6 plan-validation gate, §7 review, §7.6
five-lane for feature work) + repo AGENTS.md (Project Profile, Contract 1/2).
Every task below carries the full §5 template. Test runs stay within §3: targeted,
named files only, max 2 executions; no full suite, no E2E. The five-lane gate (T7)
is five parallel subagent lanes, not a shell command.

## Tasks

- [ ] T1: Spec amendments — module `todo-trash`
  - [TASK OBJECTIVE] Record the full soft-delete/trash contract in both specs before code.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `docs/specs/SPEC-todo-service.md`,
      `docs/specs/SPEC-todo-ui.md`.
    - Reference files (read-only): `docs/specs/SPEC-notes.md`,
      `docs/specs/SPEC-note-ownership.md`, `tasks/plan-todo-trash.md`.
    - Strictly prohibited files: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `deletedAt DATETIME NULL` in the `todo` SQL block;
    "No trash (decision)" replaced by the soft-delete contract (`DELETE` is soft,
    trash/restore never change `version`); the four trash routes + static-route
    ordering + hidden-from list/get/patch/tags recorded; Cache Rules gain the
    `todo:trash` shape, key `todo:<sub>:v<gen>:trash`, `deletedAt IS NULL` loader
    guard, bump-after on the four writes, and the failure mode (60s TTL backstop,
    fail-open to the direct loader, fallback never writes plaintext); trash testing
    group added; trash removed from the "Ask first" v2 list; SPEC-todo-ui `/todos`
    bullet names the soft delete + `/todos/trash`.
  - [VERIFICATION & TESTING RULES] Permitted test command: none (docs task).
    Verify: `grep -n "deletedAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "/todos/trash" docs/specs/SPEC-todo-ui.md` non-empty.
    Strict constraints: NO full suites, NO E2E, max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Both greps return non-empty.
    - [ ] No placeholder or contradicting "no trash" text remains.
    - [ ] No file outside scope modified.
  - Dependencies: none. Size: S.

- [ ] T2: Data model — module `todo-trash`
  - [TASK OBJECTIVE] Add the `deletedAt` wire field, the entity column, and the
    `TODO_TRASH` constant.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/shared/src/index.ts`,
      `apps/todo-service/src/todos/todo.entity.ts`,
      `apps/todo-service/src/cache/todo-cache.ts`.
    - Reference files (read-only): `apps/note-service/src/notes/note.entity.ts`,
      `packages/shared/src/index.ts` (`Note` shape),
      `apps/todo-service/src/todos/todos.service.ts`.
    - Strictly prohibited files: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `interface Todo` gains
    `deletedAt: string | null;` before `version`; entity gains
    `@Column({ type: 'datetime', nullable: true }) deletedAt: Date | null;` after
    `updatedAt` (no default; `synchronize: true` adds the column); `todo-cache.ts`
    gains `export const TODO_TRASH = 'trash';`.
  - [VERIFICATION & TESTING RULES] Permitted test command:
    `npm run typecheck -w @life/shared`; `npm run typecheck -w @life/todo-service`.
    Strict constraints: NO full suites, NO E2E, max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Field, column, constant exist as specified.
    - [ ] Both typechecks pass with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T1. Size: S.

- [ ] T3: Service + controller — module `todo-trash`
  - [TASK OBJECTIVE] Soft `remove`, trash verbs, trashed-row guards, and the
    `todo:trash` cache read with routes in the correct order.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create:
      `apps/todo-service/src/todos/todos.service.ts`,
      `apps/todo-service/src/todos/todos.controller.ts`.
    - Reference files (read-only):
      `apps/note-service/src/notes/notes.service.ts`,
      `apps/note-service/src/notes/notes.controller.ts`,
      `apps/todo-service/src/cache/todo-cache.ts`, `packages/cache/src/index.ts`,
      `apps/todo-service/src/todos/dto/list-todos.query.ts`.
    - Strictly prohibited files: every file not listed above (no entities, no
      DTOs, no tests).
  - [IMPLEMENTATION REQUIREMENTS] `CachedTodoRow.deletedAt` serialized as ISO or
    `null` and passed through by `decodeCachedTodoRow`. `remove` sets
    `deletedAt = new Date()` on an active row (404 otherwise), `save`, bump-after,
    no version change. `findTrash(sub, {limit?, cursor?}): Promise<TodoPage>` reads
    through `cache.getThrough(sub, TODO_TRASH, …)` with the loader inside the call
    (`deletedAt IS NOT NULL`, `ownerSub = :sub`, `ORDER BY deletedAt DESC, id DESC`,
    left-join `todoTags`), then decrypts, orders `deletedAt DESC, id DESC`, and
    paginates with three helpers in `todos.service.ts` —
    `encodeTrashCursor(item: { deletedAt: string; id: string }): string`
    (`base64(<deletedAt>|<id>)`),
    `decodeTrashCursor(cursor: string): { deletedAt: string; id: string }`,
    `afterTrashCursor(item: { deletedAt: string; id: string }, cursor: { deletedAt: string; id: string }): boolean`
    (strictly-after in `deletedAt DESC, id DESC`).
    `restore` clears `deletedAt` (404 when not in trash); `removePermanent`
    hard-deletes only a trashed row and 404s on a repeat; `emptyTrash` hard-deletes
    all the caller's trashed rows and returns `{count}`; all four bump after the
    mutation. `rawRows`, `findOne`, `update`, `listTagUsage` add
    `deletedAt IS NULL`; `create` sets `deletedAt: null`.
    **Cache plan (Contract 2):** shape = serialized ciphertext trash rows exactly
    as stored (each carrying `deletedAt` + `tagIds`); key
    `todo:<sub>:v<gen>:trash` (cursor/limit never enter it); invalidation =
    bump-after on the four writes on the same per-owner counter; failure mode =
    60s TTL backstop, fail-open to the direct loader, fallback never writes
    plaintext; loader lives inside `getThrough`.
    Controller: `@Get('trash')`/`@Delete('trash')` declared after `@Get('tags')`
    and before `@Get(':id')`; `@Post(':id/restore')` and `@Delete(':id/permanent')`
    before `@Delete(':id')`; reuse `ListTodosQuery`.
  - [VERIFICATION & TESTING RULES] Permitted test command:
    `npm run typecheck -w @life/todo-service`.
    Strict constraints: NO full suites, NO E2E (behavior tests are T4),
    max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Soft `remove`, `findTrash`, `restore`, `removePermanent`, `emptyTrash`
          exist with the exact signatures above.
    - [ ] The three cursor helpers match their signatures byte-for-byte.
    - [ ] Guards are in place; `create` sets `deletedAt: null`.
    - [ ] Typecheck passes with zero errors; no file outside scope modified.
  - Dependencies: T2. Size: L (one bounded concern: the trash data layer).

- [ ] T4: Service tests — module `todo-trash`
  - [TASK OBJECTIVE] Prove the trash behavior gates and the `todo:trash` cache contract.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/todo-service/test/todos.e2e-spec.ts`,
      `apps/todo-service/test/ownership.e2e-spec.ts` (new),
      `apps/todo-service/test/todo-cache.e2e-spec.ts`.
    - Reference files (read-only): `apps/note-service/test/ownership.e2e-spec.ts`,
      `apps/note-service/test/notes-cache.e2e-spec.ts`,
      `apps/todo-service/test/todo-harness.ts`,
      `apps/todo-service/test/fake-redis.ts`.
    - Strictly prohibited files: every production source file (a failing gate
      re-opens T3).
  - [IMPLEMENTATION REQUIREMENTS] `todos.e2e-spec.ts`: replace the hard-delete case —
    delete moves to trash and hides from list/get/patch; restore preserves
    `createdAt`/`tagIds`/`version`; trash/restore do not change `version`; permanent
    delete removes the row + `todo_tag` rows and 404s on a second call; empty returns
    the count. `ownership.e2e-spec.ts` (new): foreign-id restore/permanent return the
    byte-identical 404 of a missing id; `emptyTrash` empties only the caller's rows.
    `todo-cache.e2e-spec.ts`: `findTrash` twice consults the repository once under
    key `todo:<sub>:v0:trash`; the serialized `trash` value contains `enc.v1.` and no
    known plaintext; the invalidation table gains `remove`(soft)/`restore`/
    `removePermanent`/`emptyTrash` bumping `todo:gen:<sub>` after the mutation.
  - [VERIFICATION & TESTING RULES] Permitted test command:
    `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`.
    Strict constraints: NO full suites, NO E2E, only these three named files,
    max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The three suites cover every case above.
    - [ ] The prescribed test command passes.
    - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T3. Size: M.

- [ ] T5: BFF — module `todo-trash`
  - [TASK OBJECTIVE] Expose the four trash verbs to the app.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/lib/todo-api.ts`.
    - Reference files (read-only): `apps/app/lib/api.ts`,
      `packages/shared/src/index.ts`, `apps/app/lib/client.ts`.
    - Strictly prohibited files: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] Add
    `listTodoTrash(): Promise<TodoPage>` (`GET /api/todos/trash`),
    `restoreTodo(id: string): Promise<Todo>` (`POST /api/todos/${id}/restore`),
    `deleteTodoPermanently(id: string): Promise<{ ok: true }>` (`DELETE /api/todos/${id}/permanent`),
    `emptyTodoTrash(): Promise<{ ok: true; count: number }>` (`DELETE /api/todos/trash`);
    reuse the existing `call<T>` helper; re-declare no type.
  - [VERIFICATION & TESTING RULES] Permitted test command:
    `npm run typecheck -w @life/app`.
    Strict constraints: NO full suites, NO E2E, max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The four functions match the exact paths/methods above.
    - [ ] Typecheck passes with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T3. Size: S.

- [ ] T6: App UI — module `todo-trash`
  - [TASK OBJECTIVE] Silent soft-delete row, toolbar Trash entry, and the
    `/todos/trash` page with its server actions.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/app/todo-actions.ts`,
      `apps/app/app/todo-item.tsx`, `apps/app/app/todos/page.tsx`,
      `apps/app/app/todos/trash/page.tsx` (new).
    - Reference files (read-only): `apps/app/app/notes/trash/page.tsx`,
      `apps/app/app/actions.ts`, `apps/app/lib/todo-api.ts`,
      `apps/app/app/notes/page.tsx`, `packages/ui/src/index.ts`.
    - Strictly prohibited files: `packages/ui` edits, every e2e file, every frozen
      surface, and every file not listed as allowed/reference.
  - **Primitive reuse plan (Contract 1):** `IconLink` (toolbar Trash), `ListItem`
    (trash rows), `Button` (quiet Restore / danger Delete-forever), `ConfirmButton`
    (permanent delete + Empty Trash), `EmptyState`,
    `PageShell`/`NavBar`/`PageTitle`/`PageActions`, `LocalTime`. No raw
    `<a>`/`<button>`/styled `<div>`, no `next/link`, `<form>` only as an unstyled
    behavior wrapper.
  - [IMPLEMENTATION REQUIREMENTS] `todo-actions.ts`: `revalidateTodos()` also
    `revalidatePath('/todos/trash')`; add `restoreTodoAction`,
    `deleteForeverTodoAction`, `emptyTodoTrashAction`. `todo-item.tsx`: replace the
    `ConfirmButton` delete with a plain form around
    `<Button type="submit" variant="danger" size="icon" aria-label={`Delete ${todo.title}`}>`
    (silent soft delete); keep the done toggle. `todos/page.tsx`: `Trash`
    `IconLink` immediately before `<ThemeToggle />` (+ `Trash2` lucide import).
    `todos/trash/page.tsx` (new): `force-dynamic`, `listTodoTrash()`,
    `EmptyState body="Trash is empty."` when empty, rows with
    `LocalTime` of `deletedAt`, quiet Restore form (`trash-restore`), danger
    `ConfirmButton` (`trash-delete`) in the delete-forever form, bulk
    `ConfirmButton size="bare" className="trash-empty"` in the empty form.
    No new primitive, no frozen selector/role/text change.
  - Known coverage gap (explicit): these files are presentational/server-action
    glue with no dedicated unit test; the `/todos` surface is guarded by
    `test/todo-groups.test.ts` plus the user's visual pass.
  - [VERIFICATION & TESTING RULES] Permitted test command:
    `npm run typecheck -w @life/app` AND
    `npm run test:unit -w @life/app -- test/todo-groups.test.ts`.
    Strict constraints: NO bare `npm run test:unit -w @life/app`, NO full suites,
    NO E2E, max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Row delete has no confirm and calls `deleteTodoAction`.
    - [ ] Toolbar Trash precedes `ThemeToggle`.
    - [ ] `/todos/trash` mirrors the notes trash page with the three class hooks.
    - [ ] The three actions revalidate both `/todos` and `/todos/trash`.
    - [ ] Both permitted commands pass with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T5. Size: M.

- [ ] T7: Five-lane verification — module `todo-trash`
  - [TASK OBJECTIVE] Run the global protocol §7.6 gate on the final integrated
    state and iterate until N/N PASS.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: none (verification only; fixes re-open their
      owning task).
    - Reference files (read-only): the working diff, `tasks/plan-todo-trash.md`,
      `tasks/todo-todo-trash.md`, `docs/specs/SPEC-todo-service.md`,
      `docs/specs/SPEC-todo-ui.md`.
    - Strictly prohibited files: everything (this task changes nothing).
  - [IMPLEMENTATION REQUIREMENTS] Suite gate first, exact commands:
    `npm run typecheck -w @life/todo-service`;
    `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`;
    `npm run typecheck -w @life/app`;
    `npm run test:unit -w @life/app -- test/todo-groups.test.ts`.
    Then five parallel lane subagents (read-only; the QA lane runs the suite-gate
    commands), each returning
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    correctness/domain, code quality, security, QA (scope = the T4 service
    e2e-specs — app UI covered by typecheck + the user's visual pass, recorded gap),
    plan conformance. Fail-closed: a crashed, missing, or empty verdict is a
    failure. Any failed lane → fix blockers → re-run ONLY the failed lanes → repeat
    until every lane returns PASS. Commit only on N/N PASS, staged by explicit
    paths (never `git add -A`).
  - [VERIFICATION & TESTING RULES] Permitted test commands: the four suite-gate
    commands above (QA lane only).
    Strict constraints: NO full suites, NO E2E, max test executions: 2 per
    suite-gate iteration. Evidence = per-round lane reports.
  - [DEFINITION OF DONE]
    - [ ] All four suite-gate commands green.
    - [ ] Five lane verdicts all PASS (N/N).
    - [ ] No partial verdict treated as done.
    - [ ] No commit outside explicit paths.
  - Dependencies: T4, T6. Size: M.
