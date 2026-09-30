# Implementation Plan: todo-service soft-delete / trash (+ `/todos/trash` UI)

Branch: `feature/todo-ecosystem` (follow-up; `master` stays untouched).
Specs amended in the same change (owner): `docs/specs/SPEC-todo-service.md`,
`docs/specs/SPEC-todo-ui.md`. Ledger: `tasks/todo-todo-trash.md`.
Reference implementation (read-only mirror): the notes soft-delete/trash stack
(`apps/note-service/src/notes/notes.service.ts`,
`apps/note-service/src/notes/notes.controller.ts`,
`apps/app/lib/api.ts`, `apps/app/app/notes/trash/page.tsx`).

Process: global protocol §3 (testing), §5 (mandatory task template), §6 (plan
validation gate), §7 (review + five-lane gate). Every task below is in §5 template
form. Test runs are targeted, named files only, max 2 executions; no full suite,
no E2E. The five-lane gate (T7) is executed by five parallel subagent lanes, not a
shell command.

## Overview

Give the todo domain a real trash: a hand-managed nullable `deletedAt` on `todo`
(null = active), `DELETE /api/todos/:id` becomes a **soft** delete, and the trash
verbs (`GET /api/todos/trash`, `POST /api/todos/:id/restore`,
`DELETE /api/todos/:id/permanent`, `DELETE /api/todos/trash`) are added, cached and
invalidated exactly like notes. The app gains a `/todos/trash` page reusing the notes
trash structure, a toolbar Trash entry on `/todos`, and the row's delete becomes a
silent soft delete (mirroring the notes row). This deliberately reverses the
`SPEC-todo-service` "no trash (decision)" line — the user confirmed the full
soft-delete scope, so the new intent overrides that spec line.

## Architecture Decisions

- L1: Soft delete is a hand-managed nullable `deletedAt` datetime on `todo` (no
  `@DeleteDateColumn`, no separate table, no scheduled purge) — byte-for-byte the
  notes pattern (`docs/specs/SPEC-notes.md` Data Model). `Todo.deletedAt: string | null`
  joins the wire DTO in `@life/shared` (null = active).
- L2: Trash verbs never change `version` (notes contract). Delete/restore/forever
  do not touch the OCC counter; only `update` bumps it.
- L3: Trash reads go **through** the read-through cache under the reserved rest key
  `TODO_TRASH = 'trash'` (new exported const in
  `apps/todo-service/src/cache/todo-cache.ts`), one entry serving every page variant —
  consistent with Contract 2 Rule 3 (cursor/limit never in the key). Cached value =
  serialized ciphertext rows as stored; decrypt/paginate after the hit. The loader
  lives inside the cache's `getThrough` call (Contract 2 Rule 1). `rawRows`/`findOne`/
  `update`/`listTagUsage` exclude trashed rows.
- L4: Invalidation — `bumpGeneration(sub)` after every successful trash mutation
  (`remove` soft, `restore`, `removePermanent`, `emptyTrash`); a failed mutation
  never bumps. The `todo:all` loader gains a `deletedAt IS NULL` guard so a bump makes
  the trashed row vanish from the list. `todo:trash` is a second entry on the same
  per-owner generation counter — no new invalidation machinery.
- L5: Route ordering — static `trash` routes are declared before `:id` routes
  (`GET`/`DELETE /api/todos/trash` before `GET /api/todos/:id`), so `/trash` is not
  parsed as an id (kernel clause, notes precedent).
- L6: The `/todos` row delete becomes a **silent soft delete** (a plain danger icon
  `Button`, no `ConfirmButton`), mirroring the notes row's silent `×`; the confirm
  moves to the trash page's permanent-delete / empty controls. This is the only way
  the trash page is meaningful, and it is the notes reuse the user asked for.
- L7: `/todos/trash` is a near-copy of `/notes/trash` (ListItem rows, `LocalTime`
  of `deletedAt`, quiet Restore, danger Delete-forever with confirm, bulk Empty
  Trash). The class hooks `trash-delete`/`trash-restore`/`trash-empty` are reused
  verbatim (generic legacy-class names owned by `Button`, not a notes-only selector).
  No new `@life/ui` primitive is needed and no e2e selector is edited (the frozen
  `button.trash-delete` surface is untouched — this page reuses it).
- L8: `/todos` toolbar gains a Trash `IconLink` before `ThemeToggle`
  (`Notes · Manage tags · Manage lists · Trash · ThemeToggle`); the Trash entry is
  app-local chrome, the manager pages stay as they are.

## Task List

### Phase 1 — Spec (spec-first)
- [ ] T1: amend the two specs to the trash contract (module `todo-trash`).

### Checkpoint: Spec
- [ ] `grep -n "deletedAt" docs/specs/SPEC-todo-service.md` is non-empty.
- [ ] `grep -n "/todos/trash" docs/specs/SPEC-todo-ui.md` is non-empty.

### Phase 2 — Data model
- [ ] T2: `Todo.deletedAt` wire field, `todo.deletedAt` column, `TODO_TRASH` const.

### Checkpoint: Data model
- [ ] `npm run typecheck -w @life/shared` exits 0.
- [ ] `npm run typecheck -w @life/todo-service` exits 0.

### Phase 3 — Service + routes
- [ ] T3: soft `remove`, `findTrash`/`restore`/`removePermanent`/`emptyTrash`,
      trashed-row guards, `CachedTodoRow.deletedAt`, controller trash routes.

### Checkpoint: Service
- [ ] `npm run typecheck -w @life/todo-service` exits 0.

### Phase 4 — Service tests
- [ ] T4: extend the todo-service suites with the trash gates + cache
      ciphertext/invalidation assertions.

### Checkpoint: Tests
- [ ] `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts` green.

### Phase 5 — BFF
- [ ] T5: `listTodoTrash` / `restoreTodo` / `deleteTodoPermanently` /
      `emptyTodoTrash` in `apps/app/lib/todo-api.ts`.

### Checkpoint: BFF
- [ ] `npm run typecheck -w @life/app` exits 0.

### Phase 6 — App UI
- [ ] T6: soft-delete row, `/todos/trash` page, toolbar Trash link, server actions.

### Checkpoint: App
- [ ] `npm run typecheck -w @life/app` exits 0.
- [ ] `npm run test:unit -w @life/app -- test/todo-groups.test.ts` green.
- [ ] Contract 1 mechanical greps clean (no raw HTML, no `next/link`).

### Phase 7 — Close
- [ ] T7: five-lane verification gate (global protocol §7.6) on the final state; user
      reviews `/todos` and `/todos/trash` in dev.

## Tasks in §5 template form

### T1 — Spec amendments (module `todo-trash`)

[TASK OBJECTIVE]
  Record the full soft-delete/trash contract in `docs/specs/SPEC-todo-service.md`
  and `docs/specs/SPEC-todo-ui.md` before any code changes.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `docs/specs/SPEC-todo-service.md`,
    `docs/specs/SPEC-todo-ui.md`.
  - Reference files (read-only): `docs/specs/SPEC-notes.md` (soft-delete contract
    reference), `docs/specs/SPEC-note-ownership.md`,
    `tasks/plan-todo-trash.md`.
  - Strictly prohibited files: every file not listed above (no code, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - SPEC-todo-service.md data model: add `deletedAt DATETIME NULL, -- null = active`
    to the `todo(...)` SQL block after `updatedAt`; replace the
    "No trash (decision)" bullet with a "Soft delete / trash" bullet stating
    `deletedAt` is nullable, `DELETE` is soft, and trash/restore never change
    `version`.
  - SPEC-todo-service.md behavior/API: replace "`DELETE /api/todos/:id`
    (permanent)" with a soft delete; add `GET /api/todos/trash` (cursor page,
    ordered `deletedAt DESC, id DESC`), `POST /api/todos/:id/restore`,
    `DELETE /api/todos/:id/permanent`, `DELETE /api/todos/trash`
    (`{ok: true, count}`); state the static-route ordering clause; state trashed
    todos are hidden from list/get/patch and from `GET /api/todos/tags`.
  - SPEC-todo-service.md Cache Rules (Contract 2 Rule 4): add the `todo:trash`
    cached shape (serialized ciphertext rows as stored, each carrying `deletedAt`),
    key `todo:<sub>:v<gen>:trash`, the `deletedAt IS NULL` guard on the `todo:all`
    loader, bump-after on the four trash writes, and the shared failure mode
    (60s TTL backstop, fail-open to the direct loader, fallback never writes
    plaintext).
  - SPEC-todo-service.md testing strategy: add a soft-delete/trash group mirroring
    the notes trash coverage (absent from list/`GET :id`/tag filters, present in
    trash, restore preserves `createdAt`/tags/`version`, permanent delete, empty).
  - SPEC-todo-service.md boundaries: move "trash" out of the "Ask first" v2 list
    (user-authorised full soft-delete scope).
  - SPEC-todo-ui.md `/todos` bullet: "inline edit… **permanent delete**" becomes
    "…**soft delete to trash**; a `/todos/trash` page (restore / delete-forever /
    empty) reached from a Trash entry in the toolbar".
  - No spec text may claim a trash table, a scheduled purge, or a version bump on
    trash verbs.

[VERIFICATION & TESTING RULES]
  - Permitted test command: none. This is a docs task; no test execution.
  - Verification: `grep -n "deletedAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "/todos/trash" docs/specs/SPEC-todo-ui.md` are both non-empty.
  - Strict constraints: NO full suites, NO E2E; typecheck not required (docs only);
    max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Code meets all implementation requirements.
  - [ ] No files outside the allowed scope were modified.
  - [ ] The two grep verifications return non-empty.
  - [ ] No leftover placeholder or contradictory "no trash" text remains.

### T2 — Data model (module `todo-trash`)

[TASK OBJECTIVE]
  Add the `deletedAt` field to the `Todo` wire type and the `todo` entity, and the
  `TODO_TRASH` cache rest constant.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/shared/src/index.ts`,
    `apps/todo-service/src/todos/todo.entity.ts`,
    `apps/todo-service/src/cache/todo-cache.ts`, plus the two app test fixtures
    `apps/app/test/todo-groups.test.ts` and `apps/app/test/todo-query.test.ts` —
    each needs a one-line `deletedAt: null` added to its `Todo` literal once the
    wire type gains the required field (documented scope amendment; without it the
    app typecheck fails on fixtures that predate the field).
  - Reference files (read-only): `apps/note-service/src/notes/note.entity.ts`
    (`deletedAt` column precedent), `packages/shared/src/index.ts` (`Note` shape),
    `apps/todo-service/src/todos/todos.service.ts`.
  - Strictly prohibited files: every file not listed above (no service logic, no
    controller, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - `@life/shared`: add `deletedAt: string | null;` to `interface Todo`, before
    `version` (matching `interface Note`), so the DTO carries null = active.
  - `todo.entity.ts`: add
    `@Column({ type: 'datetime', nullable: true }) deletedAt: Date | null;`
    after `updatedAt`, with no default; `synchronize: true` adds the column.
  - `todo-cache.ts`: add `export const TODO_TRASH = 'trash';` beside `TODO_ALL`;
    the namespace prefix stays `todo`.
  - No other signature changes.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/shared` then
    `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] `interface Todo` has `deletedAt: string | null`.
  - [ ] The entity has the nullable datetime column with no default.
  - [ ] `TODO_TRASH = 'trash'` is exported.
  - [ ] No files outside the allowed scope were modified.
  - [ ] Both typechecks pass with zero errors.

### T3 — Service + controller (module `todo-trash`)

[TASK OBJECTIVE]
  Turn `DELETE /api/todos/:id` into a soft delete, add the trash verbs and the
  `todo:trash` cache read, and guard every active-row read against trashed rows.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create:
    `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/todos/todos.controller.ts`.
  - Reference files (read-only):
    `apps/note-service/src/notes/notes.service.ts`,
    `apps/note-service/src/notes/notes.controller.ts`,
    `apps/todo-service/src/cache/todo-cache.ts`, `packages/cache/src/index.ts`,
    `apps/todo-service/src/todos/dto/list-todos.query.ts`.
  - Strictly prohibited files: every file not listed above (no entities, no DTOs,
    no tests in this task).

[IMPLEMENTATION REQUIREMENTS]
  - `CachedTodoRow` gains `deletedAt: string | null`; `toCachedTodoRow` serializes
    `todo.deletedAt ? todo.deletedAt.toISOString() : null`;
    `decodeCachedTodoRow` passes `deletedAt: row.deletedAt` through to the DTO.
  - `remove(sub, id)`: find `{id, ownerSub: sub, deletedAt: IsNull()}` → 404 if
    absent; set `deletedAt = new Date()`; `save`; `bumpGeneration` after. No
    version change. (Replaces the current hard `delete`.)
  - `findTrash(sub, {limit?, cursor?}): Promise<TodoPage>` — cached via
    `cache.getThrough(sub, TODO_TRASH, loader, {decode: decodeCiphertextTodoRowList, cacheable: isCiphertextTodoRowList})`;
    the loader (inside `getThrough`, per Contract 2 Rule 1) =
    `createQueryBuilder('todo').leftJoinAndSelect('todo.todoTags','todoTag').where('todo.deletedAt IS NOT NULL').andWhere('todo.ownerSub = :sub').orderBy('todo.deletedAt','DESC').addOrderBy('todo.id','DESC').getMany()`
    → `toCachedTodoRow`. Decode all rows, order by `deletedAt DESC, id DESC`, and
    keyset-paginate in memory. Define three helpers in `todos.service.ts` beside
    `decodeCursor`, with these exact signatures:
    `encodeTrashCursor(item: { deletedAt: string; id: string }): string` returning
    `base64(<deletedAt>|<id>)`;
    `decodeTrashCursor(cursor: string): { deletedAt: string; id: string }`;
    `afterTrashCursor(item: { deletedAt: string; id: string }, cursor: { deletedAt: string; id: string }): boolean`
    returning true when the item falls strictly after the cursor in
    `deletedAt DESC, id DESC` order (i.e.
    `item.deletedAt < cursor.deletedAt || (item.deletedAt === cursor.deletedAt && item.id < cursor.id)`).
    Return `{todos, nextCursor}`.
  - Cache plan (Contract 2 delegation field) for `todo:trash`: shape = the owner's
    serialized **ciphertext** trash rows exactly as stored (title/note `enc.v1.`
    envelopes, each row carrying `deletedAt` + `tagIds`); key =
    `todo:<sub>:v<gen>:trash` (one entry serves every cursor/limit variant);
    invalidation = bump-after on the four writes (`remove` soft, `restore`,
    `removePermanent`, `emptyTrash`) on the same per-owner counter as `todo:all`;
    failure mode = 60s TTL backstop, fail-open on any cache error to the direct
    loader, and the fallback path never writes plaintext (Redis is AOF-persistent);
    the loader lives inside the cache's `getThrough` call.
  - `restore(sub, id): Promise<TodoDto>` — find
    `{id, ownerSub: sub, deletedAt: Not(IsNull())}` → 404; `deletedAt = null`;
    `save`; `bumpGeneration`; return the decoded `TodoDto`.
  - `removePermanent(sub, id): Promise<void>` —
    `todos.delete({id, ownerSub: sub, deletedAt: Not(IsNull())})`;
    `if (!result.affected) throw new NotFoundException('Todo not found')`;
    `bumpGeneration`.
  - `emptyTrash(sub): Promise<{count:number}>` —
    `todos.delete({ownerSub: sub, deletedAt: Not(IsNull())})`; `bumpGeneration`;
    return `{count: result.affected ?? 0}`.
  - Guards: the `rawRows` loader adds `.andWhere('todo.deletedAt IS NULL')`;
    `findOne` and `update` add `deletedAt: IsNull()` to their `where`;
    `listTagUsage`'s loader adds `.andWhere('todo.deletedAt IS NULL')`; `create`
    sets `deletedAt: null`. `findAll` needs no change beyond `rawRows` (it slices
    the same row set).
  - Controller (`@Controller('api/todos')`), exact declaration order:
    after the existing `@Get('tags')` and before `@Get(':id')`, declare
    `@Get('trash') findTrash(@Principal() p, @Query() query: ListTodosQuery)` →
    `this.todos.findTrash(p.sub, {limit: query.limit, cursor: query.cursor})` and
    `@Delete('trash') emptyTrash(...)` → `{ ok: true, ...await this.todos.emptyTrash(p.sub) }`;
    after `@Patch(':id')`, declare `@Post(':id/restore')` →
    `this.todos.restore(...)` and `@Delete(':id/permanent')` →
    `await this.todos.removePermanent(...); return { ok: true }`; keep
    `@Delete(':id')` last. Reuse `ListTodosQuery` (only `limit`/`cursor` read); no
    new DTO.
  - Error states: missing/foreign ids are a byte-identical 404 on every trash verb;
    a failed mutation never bumps the generation.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck only in this task (the
    behavior tests are T4); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Soft `remove`, `findTrash`, `restore`, `removePermanent`, `emptyTrash`
        exist with the exact signatures above.
  - [ ] The three cursor helpers exist with the exact signatures above.
  - [ ] `todo:trash` reads through the cache's `getThrough` under key
        `todo:<sub>:v<gen>:trash`; the four writes bump after.
  - [ ] Trashed rows are excluded from `rawRows`, `findOne`, `update`,
        `listTagUsage`; `create` sets `deletedAt: null`.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors.

### T4 — Service tests (module `todo-trash`)

[TASK OBJECTIVE]
  Prove the trash behavior gates and the `todo:trash` cache contract in the
  todo-service suites.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/test/todos.e2e-spec.ts`,
    `apps/todo-service/test/ownership.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-cache.e2e-spec.ts`.
  - Reference files (read-only): `apps/note-service/test/ownership.e2e-spec.ts`
    (two-subject mirror), `apps/note-service/test/notes-cache.e2e-spec.ts`,
    `apps/todo-service/test/todo-harness.ts`,
    `apps/todo-service/test/fake-redis.ts`.
  - Strictly prohibited files: every file not listed above (no source changes; a
    failing gate re-opens T3 as a separate task).

[IMPLEMENTATION REQUIREMENTS]
  - `todos.e2e-spec.ts`: replace the hard-delete test with — delete moves to trash
    and hides the todo from list/get/patch; restore preserves
    `createdAt`/`tagIds`/`version`; trash/restore do not change `version`; permanent
    delete removes the row and its `todo_tag` rows and 404s on a second call;
    `DELETE /api/todos/trash` returns the count and empties the caller's trash.
  - `ownership.e2e-spec.ts` (new; mirror the note-service two-subject suite):
    foreign-id restore/permanent return the byte-identical 404 a missing id gets;
    `emptyTrash` empties only the caller's rows (B's trash is untouched).
  - `todo-cache.e2e-spec.ts`: `findTrash` twice consults the repository once under
    key `todo:<sub>:v0:trash`; the trash serialized value contains `enc.v1.` and no
    known plaintext; the invalidation table gains `remove` (soft)/`restore`/
    `removePermanent`/`emptyTrash` bumping `todo:gen:<sub>` after the mutation.
  - No production file may be edited to make a test pass.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`.
  - Strict constraints: NO full suites, NO E2E; only these three named files; max
    test executions: 2.

[DEFINITION OF DONE]
  - [ ] The three suites cover every behavior listed above.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors.
  - [ ] The prescribed three-file test command passes.

### T5 — BFF (module `todo-trash`)

[TASK OBJECTIVE]
  Expose the four trash verbs to the app through `apps/app/lib/todo-api.ts`.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/todo-api.ts`.
  - Reference files (read-only): `apps/app/lib/api.ts` (notes trash BFF),
    `packages/shared/src/index.ts`, `apps/app/lib/client.ts`.
  - Strictly prohibited files: every file not listed above (no server actions, no
    pages in this task).

[IMPLEMENTATION REQUIREMENTS]
  - Add: `listTodoTrash(): Promise<TodoPage>` (`GET /api/todos/trash`);
    `restoreTodo(id: string): Promise<Todo>` (`POST /api/todos/${id}/restore`);
    `deleteTodoPermanently(id: string): Promise<{ ok: true }>`
    (`DELETE /api/todos/${id}/permanent`);
    `emptyTodoTrash(): Promise<{ ok: true; count: number }>`
    (`DELETE /api/todos/trash`).
  - Reuse the module's existing `call<T>(path, init)` helper and the `@life/shared`
    types; re-declare nothing.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] The four functions exist with the exact paths/methods above.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.

### T6 — App UI (module `todo-trash`)

[TASK OBJECTIVE]
  Make the `/todos` row delete a silent soft delete, add the toolbar Trash entry,
  and add the `/todos/trash` page with restore / delete-forever / empty.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/todo-actions.ts`,
    `apps/app/app/todo-item.tsx`, `apps/app/app/todos/page.tsx`,
    `apps/app/app/todos/trash/page.tsx` (new).
  - Reference files (read-only): `apps/app/app/notes/trash/page.tsx`,
    `apps/app/app/actions.ts`, `apps/app/lib/todo-api.ts`,
    `apps/app/app/notes/page.tsx`, `packages/ui/src/index.ts`.
  - Strictly prohibited files: every file not listed above (no `packages/ui` edit,
    no e2e spec, no frozen surface change).

[IMPLEMENTATION REQUIREMENTS]
  - Primitive reuse plan (Contract 1 delegation field): every visual comes from
    `@life/ui` — `IconLink` (toolbar Trash), `ListItem` (trash rows), `Button`
    (quiet Restore; danger Delete-forever), `ConfirmButton` (permanent delete +
    Empty Trash), `EmptyState`, `PageShell`/`NavBar`/`PageTitle`/`PageActions`,
    `LocalTime`. No raw `<a>`/`<button>`/styled `<div>`; no `next/link`; `<form>`
    only as an unstyled behavior wrapper (Contract 1 Rule 1 exemption).
  - `todo-actions.ts`: `revalidateTodos()` also `revalidatePath('/todos/trash')`;
    add `restoreTodoAction(id)`, `deleteForeverTodoAction(id)`,
    `emptyTodoTrashAction()` (each calls its T5 BFF function then
    `revalidateTodos()`).
  - `todo-item.tsx`: replace the `deleteAction` `ConfirmButton` form with a plain
    `<form action={deleteTodoAction.bind(null, todo.id)}>` wrapping
    `<Button type="submit" variant="danger" size="icon" aria-label={`Delete ${todo.title}`}><Trash2 size={18} aria-hidden /></Button>`
    (silent soft delete — L6). Keep the done-toggle `trailing` unchanged.
  - `todos/page.tsx`: add
    `<IconLink href="/todos/trash" label="Trash"><Trash2 size={20} aria-hidden /></IconLink>`
    immediately before `<ThemeToggle />`; add `Trash2` to the lucide import.
  - `todos/trash/page.tsx` (new): mirror `apps/app/app/notes/trash/page.tsx` —
    `export const dynamic = 'force-dynamic'`; `listTodoTrash()`; empty →
    `<EmptyState body="Trash is empty." />`; rows `ListItem` title=`todo.title`,
    meta=`todo.deletedAt ? <LocalTime dateTime={todo.deletedAt} /> : undefined`,
    snippet=`todo.note ?? undefined`, trailing = quiet Restore form
    (`aria-label={`Restore ${todo.title}`}`, className `trash-restore`),
    deleteAction = `ConfirmButton variant="danger" className="trash-delete"`
    inside the `deleteForeverTodoAction` form; `PageActions` bulk
    `ConfirmButton variant="danger" size="bare" className="trash-empty"` inside the
    `emptyTodoTrashAction` form.
  - No new `@life/ui` primitive and no change to any frozen selector/role/text.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/app` AND the scoped
    non-regression guard
    `npm run test:unit -w @life/app -- test/todo-groups.test.ts`.
  - Note: the T6 files are presentational/server-action glue with no dedicated unit
    test; the `/todos` surface is guarded by `test/todo-groups.test.ts` and the
    user's visual pass (recorded gap in the ledger). Do NOT run a bare
    `npm run test:unit -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Row delete creates no confirm and calls `deleteTodoAction` (soft delete).
  - [ ] The toolbar has a `Trash` `IconLink` before `ThemeToggle`.
  - [ ] `/todos/trash` mirrors the notes trash page (restore / delete-forever /
        empty) with the exact class hooks `trash-restore`/`trash-delete`/
        `trash-empty`.
  - [ ] The three actions revalidate both `/todos` and `/todos/trash`.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` and the `test/todo-groups.test.ts` guard
        pass with zero errors.

### T7 — Five-lane verification (module `todo-trash`)

[TASK OBJECTIVE]
  Run the global protocol §7.6 five-lane gate on the final integrated state and
  iterate until it returns N/N PASS.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: none (verification only; any fix re-opens
    T3/T4/T5/T6 as its owning task).
  - Reference files (read-only): the working diff,
    `tasks/plan-todo-trash.md`, `tasks/todo-todo-trash.md`,
    `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
  - Strictly prohibited files: everything (this task changes nothing).

[IMPLEMENTATION REQUIREMENTS]
  - Step 1 — suite gate first (red never reaches the lanes), with these exact
    commands:
    `npm run typecheck -w @life/todo-service`,
    `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`,
    `npm run typecheck -w @life/app`,
    `npm run test:unit -w @life/app -- test/todo-groups.test.ts`.
    Iterate fix → re-run until all four are green.
  - Step 2 — fire five parallel lane subagents (read-only; the QA lane runs the
    suite-gate commands), each returning exactly
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    1. Correctness/domain (the trash contract holds: no data loss, no silent
       failure);
    2. Code quality (five axes);
    3. Security (zero CRITICAL/HIGH/MEDIUM on the changed files);
    4. QA (executes the Step 1 suite-gate commands; its scope is the T4 service
       e2e-specs — the app UI is presentational glue covered by typecheck + the
       user's visual pass, recorded as a gap in the ledger);
    5. Plan conformance (the working diff vs `tasks/plan-todo-trash.md` and the two
       specs).
  - Step 3 — fail-closed: a crashed, missing, or empty lane verdict is a failure.
    Any failed lane → fix its blockers → re-run ONLY the failed lanes → repeat until
    every lane returns PASS. Never mark done, commit, or merge on a partial verdict
    (the skill's one-fix-pass budget is overridden by the global protocol: iterate
    until N/N).
  - Step 4 — commit only on N/N PASS, staged by explicit paths (never
    `git add -A`).

[VERIFICATION & TESTING RULES]
  - Permitted test commands: the four suite-gate commands in Step 1 (run by the QA
    lane), within the repo profile.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2 per
    suite-gate iteration.
  - The gate's evidence is the per-round lane reports (verdicts + blockers).

[DEFINITION OF DONE]
  - [ ] All four suite-gate commands pass.
  - [ ] Five lanes each return a verdict; every lane is PASS (N/N).
  - [ ] No partial verdict was treated as done; no commit outside explicit paths.
  - [ ] Any blocker was fixed and only the failed lanes were re-run.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `todo:all` loader without a `deletedAt IS NULL` guard leaks trashed rows | High | T3 adds the guard; T4 asserts list/get/patch exclude trashed |
| Cache stores a decrypted DTO for trash | High | `todo:trash` uses the same `isCiphertextTodoRowList`/decode pair; T4 asserts `enc.v1.`-only |
| Static `trash` route parsed as `:id` | Med | L5 ordering; T4 hits `/api/todos/trash` |
| Restoring changes `version` or drops tags | Med | L2; T4 asserts `createdAt`/`tagIds`/`version` preserved |
| Row delete UX change surprises the user | Low | L6 documented; user reviews in dev; confirm retained on trash controls |
| Frozen e2e surface touched | High | No e2e spec edit; `trash-delete`/`trash-restore`/`trash-empty` reused verbatim; the user runs e2e |

## Open Questions

None. The user confirmed the full soft-delete scope; open items (route, toolbar
link, manager placement) are settled by the existing todos/notes conventions.
