# Implementation Plan: todo-service soft-delete / trash (+ `/todos/trash` UI)

Branch: `feature/todo-ecosystem` (follow-up; `master` stays untouched).
Specs amended in the same change (owner): `docs/specs/SPEC-todo-service.md`,
`docs/specs/SPEC-todo-ui.md`. Ledger: `tasks/todo-todo-trash.md`.
Reference implementation (read-only mirror): the notes soft-delete/trash stack
(`apps/note-service`, `apps/app/lib/api.ts`, `apps/app/app/notes/trash/page.tsx`).

## Overview

Give the todo domain a real trash: a hand-managed nullable `deletedAt` on `todo`
(null = active), `DELETE /api/todos/:id` becomes a **soft** delete, and the trash
verbs (`GET /api/todos/trash`, `POST /api/todos/:id/restore`,
`DELETE /api/todos/:id/permanent`, `DELETE /api/todos/trash`) are added, cached and
invalided exactly like notes. The app gains a `/todos/trash` page reusing the notes
trash structure, a toolbar Trash entry on `/todos`, and the row's delete becomes a
silent soft delete (mirroring the notes row). This deliberately reverses the
`SPEC-todo-service` "no trash (decision)" line — the user authorised the full
soft-delete path.

## Architecture Decisions

- L1: Soft delete is a hand-managed nullable `deletedAt` datetime on `todo` (no
  `@DeleteDateColumn`, no separate table, no scheduled purge) — byte-for-byte the
  notes pattern (`SPEC-notes.md` L80-82). `Todo.deletedAt: string | null` joins the
  wire DTO in `@life/shared` (null = active).
- L2: Trash verbs never change `version` (notes contract). Delete/restore/forever
  do not touch the OCC counter; only `update` bumps it.
- L3: Trash reads go **through** the read-through cache under the reserved rest key
  `todo:trash` (new exported `TODO_TRASH = 'trash'`), one entry serving every
  page variant — consistent with Contract 2 Rule 3 (cursor/limit never in the key).
  Cached value = serialized ciphertext rows as stored; decrypt/paginate after the
  hit. `findAll`/`findOne`/`update`/`listTagUsage` exclude trashed rows.
- L4: Invalidation — `bumpGeneration(sub)` after every successful trash mutation
  (`remove` soft, `restore`, `removePermanent`, `emptyTrash`); a failed mutation
  never bumps. The `todo:all` loader gains `deletedAt IS NULL` so a bump makes the
  trashed row vanish from the list. `todo:trash` is a second entry on the same
  per-owner generation counter — no new invalidation machinery.
- L5: Route ordering — static `trash` routes are declared before `:id` routes
  (`GET`/`DELETE /api/todos/trash` before `GET /api/todos/:id`), so `/trash` is not
  parsed as an id (kernel clause, notes precedent).
- L6: The `/todos` row delete becomes a **silent soft delete** (a plain danger icon
  `Button`, no `ConfirmButton`), mirroring the notes row's silent `×`; the
  confirm moves to the trash page's permanent-delete / empty controls. This is the
  only way the trash page is meaningful, and it is the notes reuse the user asked for.
- L7: `/todos/trash` is a near-copy of `/notes/trash` (ListItem rows, `LocalTime`
  of `deletedAt`, quiet Restore, danger Delete-forever with confirm, bulk Empty
  Trash). New class hooks `trash-delete`/`trash-restore`/`trash-empty` are reused
  verbatim (they are generic legacy-class names owned by `Button`, not a notes-only
  selector). No new `@life/ui` primitive is needed and no e2e selector is edited.
- L8: `/todos` toolbar gains a Trash `IconLink` before `ThemeToggle`
  (`Notes · Manage tags · Manage lists · Trash · ThemeToggle`); the Trash entry is
  app-local chrome, the manager pages stay as they are.

## Task List

### Phase 1 — Spec (spec-first)
- [ ] T1: amend the two specs to the trash contract.

### Checkpoint: Spec
- [ ] `SPEC-todo-service.md` has the `deletedAt` column, the trash API rows, the
      `todo:trash` cache key, trash testing group, and the amended boundary line.

### Phase 2 — Data model
- [ ] T2: `Todo.deletedAt` wire field, `todo.deletedAt` column, `TODO_TRASH` const.

### Checkpoint: Data model
- [ ] shared + todo-service typecheck clean.

### Phase 3 — Service + routes
- [ ] T3: soft `remove`, `findTrash`/`restore`/`removePermanent`/`emptyTrash`,
      trashed-row guards, `CachedTodoRow.deletedAt`, controller trash routes.

### Checkpoint: Service
- [ ] todo-service typecheck clean; `findAll`/`findOne`/`update` exclude trashed.

### Phase 4 — Service tests
- [ ] T4: extend the three todo-service suites with the trash gates + cache
      ciphertext/invalidation assertions.

### Checkpoint: Tests
- [ ] `npm run test:unit -w @life/todo-service -- <the three files>` green.

### Phase 5 — BFF
- [ ] T5: `listTodoTrash` / `restoreTodo` / `deleteTodoPermanently` /
      `emptyTodoTrash` in `apps/app/lib/todo-api.ts`.

### Phase 6 — App UI
- [ ] T6: soft-delete row, `/todos/trash` page, toolbar Trash link, server actions.

### Checkpoint: App
- [ ] `npm run test:unit -w @life/app` green; `npm run typecheck -w @life/app`
      clean; no raw HTML / `next/link` added.

### Phase 7 — Close
- [ ] T7: five-lane verification gate (§7.6) on the final state; user reviews
      `/todos` and `/todos/trash` in dev.

## Tasks in §5 template form

### T1 — Spec amendments (module `todo-trash`)
- Objective: record the trash contract in `docs/specs/SPEC-todo-service.md` and
  `docs/specs/SPEC-todo-ui.md` before any code.
- Files: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
- Requirements (SPEC-todo-service.md):
  - Data model SQL block: add `deletedAt DATETIME NULL, -- null = active` to `todo`
    after `updatedAt`; replace the "No trash (decision)" bullet with a
    "Soft delete / trash" bullet stating `deletedAt` nullable, `DELETE` is soft,
    trash/restore never change `version`.
  - Behavior/API: replace "`DELETE /api/todos/:id` (permanent)" with soft delete;
    add `GET /api/todos/trash` (cursor page, `deletedAt DESC, id DESC`),
    `POST /api/todos/:id/restore`, `DELETE /api/todos/:id/permanent`,
    `DELETE /api/todos/trash` (`{ok:true,count}`); note the static-route ordering
    clause; note trashed todos are hidden from list/get/patch and from `todo:tags`.
  - Cache Rules: add the `todo:trash` cached shape (ciphertext rows + deletedAt),
    key `todo:<sub>:v<gen>:trash`, `deletedAt IS NULL` on the `todo:all` loader,
    and bump-after on the four trash writes.
  - Testing Strategy: add a soft-delete/trash group mirroring notes.
  - Boundaries: move "trash" out of the "Ask first" v2 list (user-authorised).
- Requirements (SPEC-todo-ui.md): update the `/todos` bullet — "inline edit…
  **permanent delete**" becomes "…**soft delete to trash**; a `/todos/trash` page
  (restore / delete-forever / empty) reached from a Trash entry in the toolbar".
- Verify: `grep -n "deletedAt" docs/specs/SPEC-todo-service.md` and
  `grep -n "/todos/trash" docs/specs/SPEC-todo-ui.md` both non-empty.
- Dependencies: none. Size: S.

### T2 — Data model (module `todo-trash`)
- Objective: add the `deletedAt` field to the wire type, the entity column, and the
  cache rest constant.
- Files: `packages/shared/src/index.ts`, `apps/todo-service/src/todos/todo.entity.ts`,
  `apps/todo-service/src/cache/todo-cache.ts`.
- Requirements:
  - `@life/shared`: add `deletedAt: string | null;` to `interface Todo` (before
    `version`, matching `Note`).
  - `todo.entity.ts`: add
    `@Column({ type: 'datetime', nullable: true }) deletedAt: Date | null;`
    (after `updatedAt`; no default). `synchronize: true` adds the column.
  - `todo-cache.ts`: add `export const TODO_TRASH = 'trash';` beside `TODO_ALL`.
- Verify: `npm run typecheck -w @life/shared` && `npm run typecheck -w @life/todo-service`.
- Dependencies: T1. Size: S.

### T3 — Service + controller (module `todo-trash`)
- Objective: soft delete + trash verbs, trashed-row guards, and the cache shape.
- Files: `apps/todo-service/src/todos/todos.service.ts`,
  `apps/todo-service/src/todos/todos.controller.ts`.
- Requirements (service):
  - `CachedTodoRow` gains `deletedAt: string | null`; `toCachedTodoRow` serializes
    `todo.deletedAt ? todo.deletedAt.toISOString() : null`; `decodeCachedTodoRow`
    passes it through to the DTO.
  - `remove(sub, id)`: find `{id, ownerSub: sub, deletedAt: IsNull()}` → 404 if
    absent; set `deletedAt = new Date()`; `save`; `bumpGeneration` after. No version
    change. (Replaces the current hard `delete`.)
  - `findTrash(sub, {limit?, cursor?}): Promise<TodoPage>` — cached via
    `cache.getThrough(sub, TODO_TRASH, loader, {decode: decodeCiphertextTodoRowList, cacheable: isCiphertextTodoRowList})`;
    loader = `createQueryBuilder('todo').leftJoinAndSelect('todo.todoTags','todoTag').where('todo.deletedAt IS NOT NULL').andWhere('todo.ownerSub = :sub').orderBy('todo.deletedAt','DESC').addOrderBy('todo.id','DESC').getMany()` → `toCachedTodoRow`.
    Then decode all rows, order by `deletedAt DESC, id DESC`, keyset-paginate with a
    `base64(<deletedAt>|<id>)` cursor (new `encodeTrashCursor`/`decodeTrashCursor`/
    `afterTrashCursor` helpers, or a `paginate` equivalent), return `{todos, nextCursor}`.
  - `restore(sub, id): Promise<TodoDto>` — find `{id, ownerSub: sub, deletedAt: Not(IsNull())}`
    → 404; `deletedAt = null`; `save`; `bumpGeneration`; return `decodeCachedTodoRow`.
  - `removePermanent(sub, id): Promise<void>` — `todos.delete({id, ownerSub: sub, deletedAt: Not(IsNull())})`;
    `if (!result.affected) throw new NotFoundException('Todo not found')`; `bumpGeneration`.
  - `emptyTrash(sub): Promise<{count:number}>` — `todos.delete({ownerSub: sub, deletedAt: Not(IsNull())})`;
    `bumpGeneration`; return `{count: result.affected ?? 0}`.
  - Guards: `rawRows` loader adds `.andWhere('todo.deletedAt IS NULL')`; `findOne`
    and `update` add `deletedAt: IsNull()` to their `where`; `listTagUsage` loader
    adds `.andWhere('todo.deletedAt IS NULL')`. `create` sets `deletedAt: null`.
  - `findAll` needs no extra change beyond `rawRows` (it slices the same row set).
- Requirements (controller — `@Controller('api/todos')`, routes in this order):
  - After the existing `@Get('tags')`, before `@Get(':id')`:
    `@Get('trash') findTrash(@Principal() p, @Query() query: ListTodosQuery)` →
    `this.todos.findTrash(p.sub, {limit: query.limit, cursor: query.cursor})`;
    `@Delete('trash') emptyTrash(...)` → `{ ok: true, ...await this.todos.emptyTrash(p.sub) }`.
  - After `@Delete(':id')`: `@Post(':id/restore')` → `this.todos.restore(...)`;
    `@Delete(':id/permanent')` → `await this.todos.removePermanent(...); return { ok: true }`.
  - Reuse `ListTodosQuery` (only `limit`/`cursor` read); no new DTO.
- Verify: `npm run typecheck -w @life/todo-service`.
- Dependencies: T2. Size: L (one bounded concern: the trash data layer).

### T4 — Service tests (module `todo-trash`)
- Objective: prove the trash gates and the cache contract.
- Files: `apps/todo-service/test/todos.e2e-spec.ts`,
  `apps/todo-service/test/ownership.e2e-spec.ts`,
  `apps/todo-service/test/todo-cache.e2e-spec.ts`.
- Requirements:
  - `todos.e2e-spec.ts`: replace the hard-delete test with — delete moves to trash
    and hides from list/get/patch; restore preserves `createdAt`/`tagIds`/`version`;
    trash/restore do not change `version`; permanent delete removes the row + its
    `todo_tag` rows and 404s on a second call; empty trash returns the count.
  - `ownership.e2e-spec.ts`: foreign-id restore/permanent return the same 404 as a
    missing id; `emptyTrash` empties only the caller's rows.
  - `todo-cache.e2e-spec.ts`: `findTrash` twice consults the repository once under
    key `todo:<sub>:v0:trash`; the `trash` serialized value contains `enc.v1.` and
    no known plaintext; the invalidation table gains `remove` (soft)/`restore`/
    `removePermanent`/`emptyTrash` bumping `todo:gen:<sub>` after the mutation.
- Verify: `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts test/todo-cache.e2e-spec.ts`.
- Dependencies: T3. Size: M.

### T5 — BFF (module `todo-trash`)
- Objective: expose the trash verbs to the app.
- Files: `apps/app/lib/todo-api.ts`.
- Requirements: add
  `listTodoTrash(): Promise<TodoPage>` (`GET /api/todos/trash`),
  `restoreTodo(id): Promise<Todo>` (`POST /api/todos/${id}/restore`),
  `deleteTodoPermanently(id): Promise<{ ok: true }>` (`DELETE /api/todos/${id}/permanent`),
  `emptyTodoTrash(): Promise<{ ok: true; count: number }>` (`DELETE /api/todos/trash`).
- Verify: `npm run typecheck -w @life/app`.
- Dependencies: T3. Size: S.

### T6 — App UI (module `todo-trash`)
- Objective: soft-delete the row, add the toolbar Trash entry, and the trash page.
- Files: `apps/app/app/todo-actions.ts`, `apps/app/app/todo-item.tsx`,
  `apps/app/app/todos/page.tsx`, `apps/app/app/todos/trash/page.tsx` (new).
- Primitive reuse plan (Contract 1 delegation field): all visuals from `@life/ui` —
  `IconLink` (toolbar Trash), `ListItem` (trash rows), `Button` (quiet Restore,
  danger Delete-forever), `ConfirmButton` (permanent delete + Empty Trash),
  `EmptyState`, `PageShell`/`NavBar`/`PageTitle`/`PageActions`, `LocalTime`. No raw
  `<a>`/`<button>`/styled `<div>`; no `next/link`.
- Requirements:
  - `todo-actions.ts`: `revalidateTodos()` also `revalidatePath('/todos/trash')`;
    add `restoreTodoAction(id)`, `deleteForeverTodoAction(id)`,
    `emptyTodoTrashAction()` (each calls its BFF fn then `revalidateTodos()`).
  - `todo-item.tsx`: replace the `deleteAction` `ConfirmButton` form with a plain
    `<form action={deleteTodoAction.bind(null, todo.id)}>` wrapping
    `<Button type="submit" variant="danger" size="icon" aria-label={`Delete ${todo.title}`}><Trash2 .../></Button>`
    (silent soft delete — L6). Keep the done-toggle `trailing` unchanged.
  - `todos/page.tsx`: add
    `<IconLink href="/todos/trash" label="Trash"><Trash2 size={20} aria-hidden /></IconLink>`
    immediately before `<ThemeToggle />`; add `Trash2` to the lucide import.
  - `todos/trash/page.tsx` (new): mirror `apps/app/app/notes/trash/page.tsx` —
    `force-dynamic`; `listTodoTrash()`; empty → `<EmptyState body="Trash is empty." />`;
    rows `ListItem` title=`todo.title`, meta=`todo.deletedAt ? <LocalTime dateTime={todo.deletedAt} /> : undefined`,
    snippet=`todo.note ?? undefined`, trailing=quiet Restore form
    (`aria-label={`Restore ${todo.title}`}`, class `trash-restore`), deleteAction=
    `ConfirmButton variant="danger" className="trash-delete"` inside
    `deleteForeverTodoAction` form; `PageActions` bulk `ConfirmButton variant="danger" size="bare" className="trash-empty"`
    inside `emptyTodoTrashAction` form.
- Verify: `npm run test:unit -w @life/app` && `npm run typecheck -w @life/app`.
- Dependencies: T5. Size: M.

### T7 — Five-lane verification (module `todo-trash`)
- Objective: run the §7.6 gate on the final integrated state (suite gate inside §3
  limits, then the five lanes in parallel, fail-closed) and fix until N/N PASS.
- Files: none (verification; fixes re-open the owning task).
- Verify: the five-lane skill's lane commands; targeted suites per the repo profile.
- Dependencies: T4, T6. Size: M.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `todo:all` loader without `deletedAt IS NULL` leaks trashed rows | High | T3 adds the guard; T4 asserts list/get/patch exclude trashed |
| Cache stores a decrypted DTO for trash | High | `todo:trash` uses the same `isCiphertextTodoRowList`/decode pair; T4 asserts `enc.v1.`-only |
| Static `trash` route parsed as `:id` | Med | L5 ordering; T4 hits `/api/todos/trash` |
| Restoring changes `version` or drops tags | Med | L2; T4 asserts createdAt/tagIds/version preserved |
| Row delete UX change surprises the user | Low | L6 documented; user reviews in dev; confirm retained on trash controls |
| Frozen e2e surface touched | High | No `apps/app/test/e2e` edit; new labels/classes are additive; user runs e2e |

## Open Questions

None. The user confirmed the full soft-delete scope; open items (route, toolbar
link, manager placement) are settled by the existing todos/notes conventions.
