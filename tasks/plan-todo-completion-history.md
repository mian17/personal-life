# Implementation Plan: todo-completion-history (append-only completion log)

Branch: `feat/todo-completion-history` (stacked on `feat/todo-custom-repeat`; it changes the
tick/completion contract that chapter builds on, so it lands **first**; `master` stays untouched
and is never merged without the user's explicit request). Module id: `todo-completion-history`
(see `MAP-todo-ecosystem.md`). Spec (owner, referenced by every task):
`docs/specs/SPEC-todo-completion-history.md`.
Specs amended in this chapter (T1): `docs/specs/SPEC-todo-service.md`,
`docs/specs/SPEC-todo-due-repeat-notify.md`, `docs/specs/SPEC-todo-ui.md`.
Ledger: `tasks/todo-todo-completion-history.md`.
Governing intent: `docs/intent/todo-completion-history.md` (locked **C1–C8**).
Prior decisions read before planning (lesson 0012): the intent's C1–C8, lesson 0017 (Apple
Reminders is the reference — completing a repeating reminder records the occurrence **and**
reveals the next, never advance-only), lesson 0003 (frontend dates), lesson 0011 (per-service
Redis), lesson 0016 (one owner per rule), and the current `SPEC-todo-service.md` /
`SPEC-todo-due-repeat-notify.md` tick-contract wording this chapter supersedes.

Process: global protocol §3 (testing policy), §5 (mandatory task template), §6 (plan-validation
gate), §7 (review), §7.6 (five-lane for feature work) + repo `AGENTS.md` (Project Profile,
Contracts 1/2). Every task is in §5 template form. Test runs are targeted, named files only,
max 2 executions; no full suite, no E2E. The plan is **not** executed until a `validating-plans`
subagent returns PLAN VALIDATED (§6). The five-lane gate (T10) is five parallel subagent lanes,
not a shell command.

## Overview

The todo row is split into a **definition** (title, note, list, due, repeat rule, current
next-due) and an **append-only occurrence log** (`todo_completion`), one row per completion.
Completing a todo appends one occurrence row for the due that was satisfied; the definition row
is unchanged except for its flag/advance. The **Done** view reads the log, not `todo.done`.

A repeating todo due Mon Oct 5 ticked on Mon Oct 5 appends one row (`occurrence = 2026-10-05`),
advances to Mon Oct 12 and stays **open** (`done: false`); `/todos?done=true` lists the Oct 5
occurrence with its real completion date while `/todos` (Open) still shows the Oct 12 instance.
A one-off tick appends one row and closes the todo; Undo deletes that row and reopens it. A
double tick can never double-record (`UNIQUE (todoId, occurrence)`). The sweep-reopen hack is
deleted — the sweep WHERE stays open rows only, and no reopen path exists.

## Architecture Decisions

- **D1 — Definition vs. occurrence split (C1).** The recurrence *rule* stays on `todo`;
  occurrences are not materialized ahead of time. History lives only in the log; future
  occurrences stay computed. No change to the `todo` row's rule columns.
- **D2 — Append-only log entity (C2/C3/C7).** New `todo_completion` table: `id` uuid PK,
  `ownerSub` text, `todoId` text (FK → `todo.id` `ON DELETE CASCADE`, `ON UPDATE NO ACTION`),
  `occurrence` text (the satisfied due in `dueDate`'s dual shape, or the `'~'` undated sentinel),
  `completedAt` text (canonical UTC instant). `UNIQUE (todoId, occurrence)`;
  `IDX_todo_completion_owner_completed (ownerSub, completedAt)`;
  `IDX_todo_completion_todo (todoId, completedAt)`. Rows are inserted or deleted, never updated;
  no `version`, no OCC. Created additively by `synchronize: true`; no migration framework.
- **D3 — Idempotency is a guarded insert, not an upsert (C3).** `writeCompletion` returns early
  when `(todoId, occurrence)` already exists, and swallows only a unique-constraint error
  (`isUniqueViolation`). A repeated tick is a no-op insert; a stale `expectedVersion` retry is
  still independently rejected as `409` by the existing OCC check.
- **D4 — Repeating tick records **and** advances; stays open (C4, lesson 0017).** For
  `done:true, repeat !== null, D !== null`: `occurrence = D` (the pre-advance due);
  `next = advanceToOnOrAfter(dueSortKey(D, tz), repeat, nowLocal())` (unchanged engine); guarded
  insert; set `dueDate` to `next` (timed re-localized), recompute `reminderScheduledAt`, keep
  `done = false`, bump `version` once. **No reopen path**: `ReminderService.sweep()` keeps
  `done: false` in its `where`; nothing writes `done = true` on a repeating tick.
- **D5 — One-off tick / Undo (C5).** For `repeat === null`, `done:true` inserts
  `occurrence = D ?? '~'` and sets `done = true`; `done:false` deletes **only** that occurrence's
  row (`delete({ ownerSub, todoId, occurrence: D ?? '~' })`) and sets `done = false`. Rows for
  other occurrences (e.g. repeating history recorded before the repeat was cleared) are
  preserved. Un-completing a repeating todo (`repeat !== null, done:false`) leaves the log
  untouched (append-only; out of scope).
- **D6 — One `DataSource` transaction per done branch (D9).** The log write and the definition
  write commit together. `TodosService` gains `@InjectDataSource() private readonly dataSource`
  (the `HealthService` precedent); the done branch runs `await
  this.dataSource.transaction(async (manager) => { <rule> })`, where `<rule>` is whichever of the
  four tick/undo rules below applies, and saves the todo via `manager.save(todo)`. The generation
  bump runs **once after commit**. A thrown transaction never bumps.
- **D7 — Done view reads the log; `todo.done` is only the Open flag (C6).** `todo.done` no longer
  drives history or the Done filter source.
- **D8 — Cache: the fourth shape (C8, Contract 2).** `TODO_COMPLETIONS = 'completions'` rest key;
  key `todo:<sub>:v<gen>:completions`; cached value `CachedCompletionRow { id, todoId, occurrence,
  completedAt }` (rows as persisted — **no** content column, so no `enc.v1.` assertion; unlike
  the todo-row guard). Loader inside `getThrough`; `decodeCompletionRows` rejects a malformed hit
  and fails open. `limit`/`cursor` never enter the key. Invalidation rides the **same**
  `todo:gen:<sub>` counter; permanent delete / empty-trash bump it (FK cascade removes rows).
- **D9 — No snapshot; cascade lifecycle (C7).** The log stores no title/list copy. `title` and
  `listName` are **decrypted in the request path** from the existing cached row-sets
  (`todo:all` for `title`, `todo:lists`/`ListsService.list` for `listName`). Permanent delete
  hard-deletes the todo and the FK cascades the log; soft delete/trash leaves the log intact and
  the Done view joins only active todos, so a trashed todo's occurrences hide until restore.
- **D10 — Wire contract lives in `@life/shared`; the `Todo` DTO is untouched.** Add
  `TodoCompletion`/`TodoCompletionPage`; the tick response stays the unchanged 15-key `Todo` DTO
  (so `todos.e2e-spec.ts`/`ownership.e2e-spec.ts` key sets are not migrated).
- **D11 — UI reuses existing primitives (Contract 1).** `/todos?done=true` renders `List` +
  `ListItem` rows (`href`/`title`/`meta`, no `leading`/`deleteAction`/`variant`), a `span` meta row
  (`dueDateLabel(completedAt, today)` + optional list name), and `EmptyState`. No new atom/block,
  no raw HTML, no new token, no app CSS. The log is read-only (no done-toggle, no per-row delete).

## Task List

### Phase 1 — Spec (spec-first, docs only)
- [ ] T1: cross-spec amendments — restate the tick contract in `SPEC-todo-service.md` +
      `SPEC-todo-due-repeat-notify.md`; add the completions cache shape to `SPEC-todo-service.md`;
      record the Done-view surface additions in `SPEC-todo-ui.md`.

### Checkpoint: Spec
- [ ] `grep -n "todo_completion" docs/specs/SPEC-todo-service.md` non-empty.
- [ ] `grep -n "record a completion" docs/specs/SPEC-todo-due-repeat-notify.md` non-empty.
- [ ] `grep -n "No completed todos" docs/specs/SPEC-todo-ui.md` non-empty.

### Phase 2 — Shared
- [ ] T2: `@life/shared` — `TodoCompletion` + `TodoCompletionPage`; verify the `Todo` DTO is
      untouched (15 keys) and scope no app test-literal migration.

### Checkpoint: Shared
- [ ] `npm run typecheck -w @life/shared` exits 0.

### Phase 3 — Entity + registration
- [ ] T3: `todo-completion.entity.ts` (exact columns/indexes/unique/FK); register in
      `todos.module.ts` `forFeature` and `app.module.ts` `entities`.

### Checkpoint: Entity
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/todo-service` exits 0.

### Phase 4 — Cache shape
- [ ] T4: `TODO_COMPLETIONS` rest key + module comment (three → four); `CachedCompletionRow` +
      `decodeCompletionRows` in `todos.service.ts` (the `CachedTodoRow` precedent), no content
      assertion.

### Checkpoint: Cache shape
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/todo-service` exits 0.

### Phase 5 — Service + controller
- [ ] T5: the three tick/undo rules in `TodosService.update` inside one `DataSource` transaction
      with the guarded `writeCompletion` + `isUniqueViolation`; `findCompletions`; completion
      cursor helpers; `GET /api/todos/completions` declared before `:id`; `DataSource` injected.

### Checkpoint: Service
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/todo-service` exits 0.

### Phase 6 — Backend tests
- [ ] T6: the three named suites + `todo-harness.ts` entity registration.

### Checkpoint: Backend tests
- [ ] `npm run build -w @life/shared` then
      `npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts test/todo-completions.e2e-spec.ts test/todo-completions-cache.e2e-spec.ts`
      green.

### Phase 7 — App
- [ ] T7: `listTodoCompletions()` + `collectTodoCompletions()` + `todo-completion-list.tsx` +
      the `doneFilter === true` branch in `todos/page.tsx`.

### Checkpoint: App
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/app` exits 0.

### Phase 8 — App tests + mechanical checks
- [ ] T8: `routes-todos-completions.test.tsx` + the `routes-todos-list.test.tsx` done=true
      reconciliation + Contract 1 greps.

### Checkpoint: App tests
- [ ] `npm run build -w @life/shared` then
      `npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx test/routes-todos-list.test.tsx`
      green.
- [ ] Contract 1 mechanical greps clean.

### Phase 9 — Verify
- [ ] T9: Tech Lead integration review + `tasks/report-todo-completion-history.md`.
- [ ] T10: five-lane verification (five parallel lanes; N/N PASS required) →
      `tasks/five-lane-todo-completion-history.md`.

## Coordination (not a task; out of scope here)

This chapter **changes the tick contract**. `todo-custom-repeat` (spec + plan, already validated)
builds its advance-on-tick on the superseded "advance, not a completion" wording; after this
chapter lands, that chapter's spec and plan must be re-synced to the completion-log model
(lesson 0012 — locked decisions are cross-chapter). This re-sync is **not** part of this chapter;
it is recorded here so it is not lost.

## Tasks in §5 template form

### T1 — Cross-spec amendments (module `todo-completion-history`)

[TASK OBJECTIVE]
  Restate the tick/completion contract in the two consuming specs and record the Done-view
  surface additions, before any code changes.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `docs/specs/SPEC-todo-service.md`,
    `docs/specs/SPEC-todo-due-repeat-notify.md`, `docs/specs/SPEC-todo-ui.md`.
  - Reference files (read-only): `docs/specs/SPEC-todo-completion-history.md` (the owner spec),
    `docs/intent/todo-completion-history.md` (C1–C8), `docs/specs/MAP-todo-ecosystem.md`.
  - Strictly prohibited files: every other file (no code, no tests, no map edit — the
    `todo-completion-history` module row already exists in `MAP-todo-ecosystem.md`).

[IMPLEMENTATION REQUIREMENTS]
  - `SPEC-todo-service.md` — **tick contract.** In the current advance-on-tick clause
    (~lines 141–148) replace "does **not** mark it done — it advances to the next occurrence
    on/after 'now'" with the completion-log wording: a repeating tick **records a completion
    and** advances; `done` stays `false`; the sweep is unchanged (open rows only) and **no
    reopen path exists**. State `occurrence = D` (the pre-advance due) and the
    `UNIQUE (todoId, occurrence)` idempotency key. A non-recurring `done:true` still marks done
    and (new) records `occurrence = D ?? '~'`; `done:false` on a one-off deletes that occurrence's
    row.
  - `SPEC-todo-service.md` — **API.** Add
    `GET /api/todos/completions?{limit, cursor}` → `TodoCompletionPage` (newest first,
    `completedAt DESC, id DESC`, default `limit 50` / cap 200), declared as a literal route
    **before** `@Get(':id')` and reusing `ListTodosQuery` (only `limit`/`cursor` read). Cursor
    `base64(<completedAt>|<id>)`. `title`/`listName` are decrypted in the request path; no
    snapshot column.
  - `SPEC-todo-service.md` — **Cache Rules (Contract 2 Rule 4).** Add the fourth shape
    `todo:<sub>:v<gen>:completions` with cached value
    `CachedCompletionRow { id, todoId, occurrence, completedAt }` (rows as persisted; **no**
    content column and therefore **no** `enc.v1.` assertion); loader is the
    `todo_completion WHERE ownerSub = :sub ORDER BY completedAt DESC, id DESC` query inside
    `getThrough`; `limit`/`cursor` never enter the key; invalidation rides the same
    `todo:gen:<sub>` counter on tick/un-complete/permanent-delete/empty-trash; 60s TTL,
    fail-open. Note soft delete/restore bump the counter so the active-todo join stays consistent.
  - `SPEC-todo-service.md` — **Data model.** Add the `todo_completion` table + its columns,
    `UNIQUE`, and two indexes (mirroring the owner spec's entity block); state it is plaintext
    (no content column, no envelope) and that permanent delete cascades while soft delete
    preserves.
  - `SPEC-todo-due-repeat-notify.md` — in the **Recurrence advance** section (~lines 160–184)
    restate step 5 and the two bullets: a repeating tick records a completion **and** advances,
    `done` stays `false`, and delete the "Ticking a recurring todo is an advance, not a completion"
    sentence (lesson 0017). The sweep subsection keeps `done = 0` and gains a one-line note that
    no reopen path exists.
  - `SPEC-todo-ui.md` — record the Done-view surface **additions** only: `/todos?done=true`
    renders the completion log; rows are `ListItem` links whose accessible name is the todo
    **title** (`/todos/<todoId>/edit`); the empty state is `EmptyState` heading
    `No completed todos`; no done-toggle is rendered. No existing name/role/aria-label changes
    (`Done`/`All`/`Open`/`Status`/row `href`s all stay).
  - No spec text may claim a materialized future occurrence, a title/list snapshot, or a reopen
    path.

[VERIFICATION & TESTING RULES]
  - Permitted test command: none. Docs only; no test execution.
  - Verification: `grep -n "todo_completion" docs/specs/SPEC-todo-service.md`,
    `grep -n "record a completion" docs/specs/SPEC-todo-due-repeat-notify.md`, and
    `grep -n "No completed todos" docs/specs/SPEC-todo-ui.md` are each non-empty.
  - Strict constraints: NO full suites, NO E2E; typecheck not required (docs only); max test
    executions: 0.

[DEFINITION OF DONE]
  - [ ] The three named spec files carry the deltas above; the superseded "advance, not a
        completion" wording is gone from `SPEC-todo-due-repeat-notify.md`.
  - [ ] `SPEC-todo-service.md`'s Cache Rules document the fourth shape, its key, invalidation,
        and failure mode.
  - [ ] The three grep verifications return non-empty; no file outside scope modified.

### T2 — Shared wire types (module `todo-completion-history`)

[TASK OBJECTIVE]
  Add the `TodoCompletion` and `TodoCompletionPage` wire interfaces to `@life/shared` exactly as
  the owner spec defines, without touching the `Todo` DTO.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `packages/shared/src/index.ts`.
  - Reference files (read-only): `docs/specs/SPEC-todo-completion-history.md` (the interface
    block), `packages/shared/src/index.ts` (`Todo`/`TodoPage` precedent),
    `apps/app/test/routes-todos-list.test.tsx` (the 15-key `Todo` literal, read-only proof).
  - Strictly prohibited files: every other file (no service, no entity, no UI, no test).

[IMPLEMENTATION REQUIREMENTS]
  - Add, beside `TodoPage`:
    ```ts
    /** One appended completion occurrence (`SPEC-todo-completion-history`, C2/C6/C7). */
    export interface TodoCompletion {
      id: string;
      todoId: string;                       // link to the live definition (edit screen)
      occurrence: string;                   // the satisfied due, or '~' (undated one-off)
      completedAt: string;                  // canonical UTC instant of the tick
      title: string;                        // DECRYPTED, joined at read time (C7 — never a snapshot)
      listId: string | null;                // the todo's list at read time
      listName: string | null;              // DECRYPTED list name; null when unlisted
    }

    export interface TodoCompletionPage {
      completions: TodoCompletion[];
      nextCursor: string | null;
    }
    ```
  - Do **not** touch `Todo`, `CreateTodoInput`, `UpdateTodoInput`, `TodoPage`, or any constant.
    **Verified against the tree:** the current `Todo` DTO has exactly 15 keys
    (`id,title,note,done,important,effectiveImportant,dueDate,repeat,reminderScheduledAt,
    listId,tagIds,createdAt,updatedAt,deletedAt,version`) and every app test `todo(...)` literal
    already carries all 15. The `Todo` key set does **not** change, so this task scopes **no**
    app test-literal migration (contrast `todo-due-repeat-notify` T2 / `todo-custom-repeat` T2,
    which added required fields).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/shared`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `TodoCompletion` and `TodoCompletionPage` exist exactly as specified.
  - [ ] `Todo` and both input types are byte-unchanged (no new required key); no app test file
        was edited.
  - [ ] `npm run typecheck -w @life/shared` passes with zero errors; no file outside scope.

### T3 — Entity + registration (module `todo-completion-history`)

[TASK OBJECTIVE]
  Add the `TodoCompletion` entity with the exact columns/indexes/uniqueness/FK, and register it in
  the todo module's `forFeature` and the app's `entities`.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/src/todos/todo-completion.entity.ts` (new),
    `apps/todo-service/src/todos/todos.module.ts`, `apps/todo-service/src/app.module.ts`.
  - Reference files (read-only): `apps/todo-service/src/todos/todo.entity.ts` (column style),
    `apps/todo-service/src/todos/todo-tag.entity.ts` (FK/JoinColumn style),
    `apps/todo-service/src/lists/list.entity.ts`, `docs/specs/SPEC-todo-completion-history.md`.
  - Strictly prohibited files: every other file (no service wiring, no cache, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - `todo-completion.entity.ts`, byte-mirroring the owner spec's entity block:
    ```ts
    import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
    import { Todo } from './todo.entity';

    @Entity('todo_completion')
    @Unique('UQ_todo_completion_todo_occurrence', ['todoId', 'occurrence'])
    @Index('IDX_todo_completion_owner_completed', ['ownerSub', 'completedAt'])
    @Index('IDX_todo_completion_todo', ['todoId', 'completedAt'])
    export class TodoCompletion {
      @PrimaryGeneratedColumn('uuid') id: string;
      @Column({ type: 'text' }) ownerSub: string;
      @Column({ type: 'text' }) todoId: string;
      @Column({ type: 'text' }) occurrence: string;
      @Column({ type: 'text' }) completedAt: string;
      @ManyToOne(() => Todo, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
      @JoinColumn({ name: 'todoId' })
      todo: Todo;
    }
    ```
    Plaintext, non-content (no `enc.v1.` column); `occurrence` is NOT NULL in every case (the
    dual due shape or `'~'`).
  - `todos.module.ts`: `TypeOrmModule.forFeature([Todo, TodoTag, TodoCompletion])` and import
    `TodoCompletion`.
  - `app.module.ts`: add `TodoCompletion` to the `entities: [Todo, TodoTag, List, UserKeys,
    PushSubscription]` array and import it.
  - `synchronize: true` creates the table additively; no migration file, no existing row rewrite.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` (shared-build precondition; every
    consumer resolves `@life/shared` via `dist/index.d.ts`) then
    `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The entity carries the exact table name, `UNIQUE (todoId, occurrence)`, both indexes, the
        `CASCADE` FK, and the four text/uuid columns.
  - [ ] `TodoCompletion` is registered in both `forFeature` and `entities`.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors; no file outside scope.

### T4 — Completions cache shape (module `todo-completion-history`)

[TASK OBJECTIVE]
  Pin the fourth cache rest key and the completion-row decode guard, so the log read goes through
  the read-through cache with a malformed-hit fail-open guard that has no content assertion.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `apps/todo-service/src/cache/todo-cache.ts`,
    `apps/todo-service/src/todos/todos.service.ts` (the `CachedCompletionRow` type + guard only;
    the read/`findCompletions` wiring is T5).
  - Reference files (read-only): `apps/todo-service/src/todos/todos.service.ts`
    (`CachedTodoRow`/`isCiphertextTodoRow`/`decodeCiphertextTodoRowList` precedent),
    `apps/todo-service/src/todos/todo-completion.entity.ts` (T3),
    `docs/specs/SPEC-todo-completion-history.md` Cache Rules.
  - Strictly prohibited files: every other file (no controller, no app).

[IMPLEMENTATION REQUIREMENTS]
  - **Location note (justified refinement of the task wording):** `todo-cache.ts` owns the rest
    key; the row type and guard live in `todos.service.ts`, byte-mirroring the existing
    `CachedTodoRow` + `decodeCiphertextTodoRowList` precedent (`lists.service.ts` holds its own
    cached row type too). They are **not** added to `todo-cache.ts`.
  - `todo-cache.ts`: add `export const TODO_COMPLETIONS = 'completions';` and update the module
    comment from "the three `<rest>` values" to four, naming
    `todo:<sub>:v<gen>:completions`.
  - `todos.service.ts`, beside `CachedTodoRow`:
    ```ts
    /** The completion log's cached row shape — rows as persisted, no content column. */
    interface CachedCompletionRow {
      id: string;
      todoId: string;
      occurrence: string;
      completedAt: string;
    }

    function isCompletionRow(row: CachedCompletionRow): boolean {
      return (
        typeof row?.id === 'string' &&
        typeof row?.todoId === 'string' &&
        typeof row?.occurrence === 'string' &&
        typeof row?.completedAt === 'string'
      );
    }

    function decodeCompletionRows(raw: unknown): CachedCompletionRow[] {
      if (!Array.isArray(raw) || !raw.every(isCompletionRow)) {
        throw new Error('cache entry is not completion rows');
      }
      return raw;
    }
    ```
    **No** `enc.v1.` assertion: the log has no content column (`SPEC-todo-completion-history`
    Cache Rules). `toCachedCompletionRow(entity)` maps `id/todoId/occurrence/completedAt`
    verbatim (needed by T5).
  - Do not change any existing guard, the `todo:all`/`todo:trash` paths, or the ciphertext
    assertions.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `TODO_COMPLETIONS === 'completions'` and the module comment says four rest values.
  - [ ] `CachedCompletionRow` + `isCompletionRow` + `decodeCompletionRows` +
        `toCachedCompletionRow` exist exactly as specified; no `enc.v1.` assertion is added.
  - [ ] Existing guards and paths are untouched; `npm run typecheck -w @life/todo-service` passes;
        no file outside scope.

### T5 — Service + controller (module `todo-completion-history`)

[TASK OBJECTIVE]
  Implement the three tick/undo rules and the `findCompletions` read, and expose
  `GET /api/todos/completions` before the `:id` route.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/todos/todos.controller.ts`.
  - Reference files (read-only): `apps/todo-service/src/todos/todo-completion.entity.ts` (T3),
    `apps/todo-service/src/cache/todo-cache.ts` (`TODO_COMPLETIONS`, T4),
    `apps/todo-service/src/health/health.service.ts` (`@InjectDataSource` precedent),
    `apps/todo-service/src/lists/lists.service.ts` (`list()` for `listName`),
    `apps/todo-service/src/reminders/reminder.service.ts` (sweep stays `done: false`),
    `packages/shared/src/index.ts` (`TodoCompletion`/`TodoCompletionPage`, T2),
    `apps/todo-service/src/todos/dto/list-todos.query.ts`.
  - Strictly prohibited files: every other file (no entity/cache edit beyond T3/T4, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - **Imports/injection:** add `InjectDataSource` / `DataSource`, `QueryFailedError` (from
    `typeorm`), `TodoCompletion`, `decodeCompletionRows`, `TODO_COMPLETIONS`, and the shared type
    `TodoCompletionPage`. Add `@InjectDataSource() private readonly dataSource: DataSource` as
    the **last constructor parameter** (after `private readonly lists: ListsService`), so the
    harness call in T6 appends it last; all existing parameters keep their order.
  - **Cursor helpers** (module-level, mirroring `encodeTrashCursor`/`decodeTrashCursor`/
    `afterTrashCursor`):
    `encodeCompletionCursor(item: {completedAt: string; id: string})` →
    `base64(<completedAt>|<id>)`; `decodeCompletionCursor(cursor)` → `{completedAt, id}`;
    `afterCompletionCursor(item, cursor)` → `item.completedAt < cursor.completedAt ||
    (item.completedAt === cursor.completedAt && item.id < cursor.id)` (strictly-after in
    `completedAt DESC, id DESC`).
  - **`isUniqueViolation(err)`** (module-level): `err instanceof QueryFailedError` and
    `(err.driverError as { code?: string } | undefined)?.code === 'SQLITE_CONSTRAINT_UNIQUE'`,
    falling back to `err.message.includes('UNIQUE constraint failed')`.
  - **`writeCompletion(manager, sub, todoId, occurrence, completedAt)`** (private): mirror the
    owner spec's guarded insert — `manager.getRepository(TodoCompletion).findOne({ where: {
    todoId, occurrence } })` → early return; else `insert({ id: randomUUID(), ownerSub: sub,
    todoId, occurrence, completedAt })` inside `try/catch`, swallowing only
    `isUniqueViolation(err)`.
  - **`update()` done branch, one transaction.** Keep every existing non-`done` mutation
    (title/note encryption, `important`/`listId` resolution, due/repeat resolution, the
    repeat-requires-due 400, tag-association handling) unchanged. Change the `done` handling so,
    when `patch.done !== undefined`, the flag/log/advance writes run in
    `this.dataSource.transaction(async (manager) => { … manager.save(todo) })`:
    1. Repeating tick — `patch.done === true && todo.repeat !== null && todo.dueDate !== null`:
       `const occurrence = todo.dueDate` (pre-advance); `const local =
       dueSortKey(todo.dueDate, this.tz)`; `const next = advanceToOnOrAfter(local, todo.repeat,
       this.nowLocal())`; `await this.writeCompletion(manager, sub, id, occurrence, new
       Date().toISOString())`; `todo.dueDate = next.includes('T') ?
       localToUtc(next, this.tz).toISOString() : next`; `todo.reminderScheduledAt =
       this.reminderAt(todo.dueDate, this.tz)`; `todo.done = false`.
    2. One-off tick — `patch.done === true && todo.repeat === null`:
       `const occurrence = todo.dueDate ?? '~'`; `await this.writeCompletion(..., occurrence,
       new Date().toISOString())`; `todo.done = true`.
    3. Un-complete one-off — `patch.done === false && todo.repeat === null`:
       `await manager.getRepository(TodoCompletion).delete({ ownerSub: sub, todoId: id,
       occurrence: todo.dueDate ?? '~' })`; `todo.done = false`.
    4. Un-complete repeating — `patch.done === false && todo.repeat !== null`: log untouched;
       `todo.done` is already `false`.
    Inside the transaction, after the branch, set `todo.version += 1; todo.updatedAt = new
    Date();` and `await manager.save(todo)`. When `patch.done === undefined`, keep the existing
    linear path: the same `version`/`updatedAt` bump and the existing `this.todos.save(todo)`
    (no transaction). For a done patch the **outer** `this.todos.save(todo)` is replaced by the
    transaction's `manager.save(todo)` (the row is saved exactly once either way).
    `await this.cache.bumpGeneration(sub)` runs **once, after** the save/commit, for both paths
    (as today); a thrown transaction never bumps. The final `decodeCachedTodoRow` return is
    unchanged; **the `Todo` DTO key set is unchanged (15 keys)**.
  - **`findCompletions(sub, opts: { limit?: number; cursor?: string }): Promise<TodoCompletionPage>`:**
    1. `const limit = opts.limit ?? 50;`
    2. Read the log through the cache:
       `const rows = await this.cache.getThrough(sub, TODO_COMPLETIONS, async () => { const found
       = await this.dataSource.getRepository(TodoCompletion).createQueryBuilder('c')
       .where('c.ownerSub = :sub', { sub }).orderBy('c.completedAt', 'DESC')
       .addOrderBy('c.id', 'DESC').getMany(); return found.map(toCachedCompletionRow); }`,
       passing `{ decode: decodeCompletionRows }`.
    3. Join active todos from the same cached `todo:all` row-set: `const todoRows = await
       this.rawRows(sub)`, `const dek = await this.readDek(sub, todoRows)`, build a
       `Map<id, CachedTodoRow>`; **omit** any completion whose `todoId` is not in the map
       (soft-deleted → Trash; permanently deleted → already cascaded).
    4. Order `completedAt DESC, id DESC` in memory (the loader already orders; keep the in-memory
       sort for the joined list), apply `afterCompletionCursor` when `opts.cursor` is set,
       compute `hasMore`/`page`/`nextCursor` exactly like `findTrash`.
    5. For the page only: decrypt each referenced todo's `title` with `todoTitleAad(sub, id)`
       (`this.openField(...)`), read its `listId`, and resolve `listName` from
       `ListsService.list(sub)` **only when at least one page row has a non-null `listId`**
       (build a `Map<listId, name>`); otherwise skip the call. Assemble
       `TodoCompletion[]` as `{ id, todoId, occurrence, completedAt, title, listId, listName }`.
       Return `{ completions: page, nextCursor }`.
  - **Controller** (`todos.controller.ts`): add, immediately after the literal `tags`/`trash`
    routes and **before** `@Get(':id')`:
    ```ts
    // Literal route declared before the `:id` route; only limit/cursor are read.
    @Get('completions')
    findCompletions(@Principal() principal: Principal, @Query() query: ListTodosQuery) {
      return this.todos.findCompletions(principal.sub, { limit: query.limit, cursor: query.cursor });
    }
    ```
    No new DTO (reuse `ListTodosQuery`). No other route/behaviour change.
  - **Sweep unchanged:** `ReminderService.sweep()` keeps `done: false`; this task adds no reopen
    write anywhere and deletes none of the existing sweep logic (it never existed in `main`).
  - **No change to `Todo` DTO key set**, so no test-literal or key-set migration is scoped here.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E (behavior tests are T6); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] A repeating tick appends exactly one row for the pre-advance due, advances the due,
        re-arms the reminder, and keeps `done: false` — in one transaction.
  - [ ] A one-off tick appends `occurrence = D ?? '~'` and sets `done: true`; a one-off Undo
        deletes only that occurrence's row and sets `done: false`; a repeating Undo leaves the log
        untouched.
  - [ ] A double tick is a no-op insert; `isUniqueViolation` swallows only the UNIQUE error.
  - [ ] `findCompletions` reads through `TODO_COMPLETIONS`, omits non-active todos, and returns
        `TodoCompletionPage` newest-first with a working cursor.
  - [ ] `GET /api/todos/completions` is declared before `@Get(':id')` and reuses `ListTodosQuery`.
  - [ ] `bumpGeneration(sub)` runs exactly once after a successful done branch; the `Todo` DTO
        15-key set is unchanged; `npm run typecheck -w @life/todo-service` passes; no file
        outside scope.

### T6 — Backend tests (module `todo-completion-history`)

[TASK OBJECTIVE]
  Prove the three tick/undo rules, the endpoint, and the cache shape in the three named
  todo-service suites, registering the new entity in the unit harness.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/test/todo-completion.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-completions.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-completions-cache.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-harness.ts` (add `TodoCompletion` to the `entities` array so the
    throwaway sqlite schema carries `todo_completion`; no other harness change).
  - Reference files (read-only): `apps/todo-service/test/todo-harness.ts` (the
    `makeUnitHarness` shape), `apps/todo-service/test/todo-cache.e2e-spec.ts` (cache assertion
    pattern), `apps/todo-service/test/reminders.e2e-spec.ts` (Nest `TestingModule` + fake-cache
    pattern), `apps/todo-service/test/setup-env.ts`, `apps/todo-service/test/fake-redis.ts`,
    `apps/todo-service/src/todos/todos.service.ts`.
  - Strictly prohibited files: every production source file (a failing gate re-opens T5, or
    T3/T4).

[IMPLEMENTATION REQUIREMENTS]
  - `todo-harness.ts`: `entities: [Todo, TodoTag, List, UserKeys, TodoCompletion]` + import.
    `makeUnitHarness` also constructs `TodosService`, so append the `DataSource` as the **last**
    constructor argument in the same edit — `new TodosService(dataSource.getRepository(Todo),
    dataSource.getRepository(TodoTag), cache, keys, lists, dataSource)` (T5 pins it last). Keep the
    throwaway temp-dir DB rule (never `apps/todo-service/data/**`).
  - **`todo-completion.e2e-spec.ts`** (service-level, via `makeUnitHarness`) — exact cases:
    - repeating tick appends exactly one row with `occurrence` = the **pre-advance** due in its
      dual shape, advances the due to the next occurrence, re-arms `reminderScheduledAt`, and
      leaves `done: false`;
    - one-off tick appends one row (`occurrence = dueDate`) and sets `done: true`;
    - due-less one-off records `occurrence = '~'` and its Undo deletes the `'~'` row;
    - a todo carrying several completion rows whose repeat was cleared, ticked as a one-off then
      un-ticked, retains its earlier rows;
    - a double tick is a no-op insert (one row; the `UNIQUE` guard);
    - a stale `expectedVersion` retry is `409`;
    - `removePermanent` and `emptyTrash` cascade-delete the rows (query `todo_completion`
      directly through the harness `dataSource`);
    - soft delete leaves the rows; restore makes them visible again.
  - **`todo-completions.e2e-spec.ts`** (service-level, via `makeUnitHarness`) — exact cases:
    - `findCompletions` returns rows `completedAt DESC, id DESC`;
    - cursor continuity: paging through with the returned `nextCursor` yields no duplicate and no
      skipped row;
    - `limit` default (50) and cap (200) are applied;
    - owner scoping: a foreign `sub` never sees another owner's rows;
    - a trashed todo's completions are omitted from the page;
    - `title` is the decrypted title, `listId` is present, and `listName` resolves for a listed
      todo (and is `null` for an unlisted one).
  - **`todo-completions-cache.e2e-spec.ts`** (recording fake cache + fake-redis) — exact cases:
    - the log is cached under `todo:<sub>:v<gen>:completions` (assert the rest key via a recording
      `TodosCache` override, mirroring the `reminders.e2e-spec.ts` `SpyingTodosCache`);
    - one entry serves every page variant (`limit`/`cursor` never enter the key);
    - a tick / one-off Undo / permanent delete bumps the generation, so the next read is refetched
      (loader called again);
    - every read flows through `getThrough` (no direct DB read in the read path);
    - a corrupt hit (a non-array, or a row with a non-string field) fails open to the loader.
  - No production file may be edited to make a test pass. Existing suites
    (`todos.e2e-spec.ts`/`ownership.e2e-spec.ts`/`todo-cache.e2e-spec.ts`) are untouched: the
    `Todo` DTO key set is unchanged and the fourth const does not enter their arrays.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts test/todo-completions.e2e-spec.ts test/todo-completions-cache.e2e-spec.ts`
    and `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; only these three named files; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] The three new suites cover every listed case and pass.
  - [ ] `todo-harness.ts` registers `TodoCompletion` and passes the `DataSource` to
        `TodosService`.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors; no production file
        and no file outside scope modified.

### T7 — App: BFF, Done view, page branch (module `todo-completion-history`)

[TASK OBJECTIVE]
  Add the completions BFF call and cursor walk, the read-only Done-view log, and the
  `doneFilter === true` branch on `/todos`.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/todo-api.ts`, `apps/app/lib/todo-query.ts`,
    `apps/app/app/todo-completion-list.tsx` (new), `apps/app/app/todos/page.tsx`.
  - Reference files (read-only): `packages/shared/src/index.ts`
    (`TodoCompletion`/`TodoCompletionPage`, T2), `packages/ui/src/index.ts`
    (`List`/`ListItem`/`EmptyState`, `dueDateLabel`), `apps/app/app/todo-list.tsx` +
    `apps/app/app/todo-item.tsx` (meta-row pattern), `apps/app/lib/client.ts` (`callService`),
    `apps/app/app/todo-actions.ts` (`revalidateTodos` already revalidates `/todos`).
  - Strictly prohibited files: every other file (no `packages/ui` edit, no service, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - **Primitive reuse plan (Contract 1, element by element):**
    - Done-view body root → `List` (no new visual language).
    - completion row → `ListItem` with `href`, `title`, `meta`; **no** `leading`, **no**
      `deleteAction`, **no** `variant`, no `done`/`collapsing`.
    - completed-date meta → a plain `span` (structural glue, no `className`) rendering
      `dueDateLabel(c.completedAt, today)` (the single `@life/ui` date owner; dd/mm/yyyy,
      `Today`/`Tomorrow` + local `HH:mm`).
    - list-name meta → a plain `span` (same meta row as `todo-item.tsx`), rendered only when
      `c.listName` is non-null.
    - empty state → `EmptyState` (`heading="No completed todos"`,
      `body="Completed tasks appear here."`).
    - page chrome → the existing `ListShell` (title `Todos`, `TodosNav`, tabs,
      `PreservingSearchBox`, status/tag/list filters, FAB), **unchanged**.
    No new atom/block is required (Contract 1 Rule 3 holds); no raw `<a>`/`<button>`; no app CSS;
    no new token; no `next/link` import in the app.
  - `apps/app/lib/todo-api.ts`: add
    ```ts
    /** `GET /api/todos/completions` — cursor page of the owner's completion log. */
    export function listTodoCompletions(
      opts: { limit?: number; cursor?: string } = {},
    ): Promise<TodoCompletionPage> {
      const params = new URLSearchParams();
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
      const qs = params.toString();
      return call<TodoCompletionPage>(`/api/todos/completions${qs ? `?${qs}` : ''}`);
    }
    ```
    Import `TodoCompletionPage` from `@life/shared`; re-declare no type.
  - `apps/app/lib/todo-query.ts`:
    ```ts
    export type CompletionPageFetcher = (
      cursor?: string,
    ) => Promise<{ completions: TodoCompletion[]; nextCursor: string | null }>;

    export async function collectTodoCompletions(
      fetchPage: CompletionPageFetcher,
      maxItems = 1000,
    ): Promise<TodoCompletion[]> { /* mirror collectTodos with page.completions */ }
    ```
    Import `TodoCompletion` from `@life/shared`.
  - `apps/app/app/todo-completion-list.tsx` (new, server component):
    ```tsx
    export function TodoCompletionList({ completions, today }: {
      completions: TodoCompletion[]; today: string;
    }) {
      if (completions.length === 0) {
        return <EmptyState heading="No completed todos" body="Completed tasks appear here." />;
      }
      return (
        <List>
          {completions.map((c) => (
            <ListItem
              key={c.id}
              href={`/todos/${c.todoId}/edit`}
              title={c.title}
              meta={
                <>
                  <span>{dueDateLabel(c.completedAt, today)}</span>
                  {c.listName && <span>{c.listName}</span>}
                </>
              }
            />
          ))}
        </List>
      );
    }
    ```
    Read-only: no done-toggle, no delete action.
  - `apps/app/app/todos/page.tsx`: when `doneFilter === true`, load
    `collectTodoCompletions((cursor) => listTodoCompletions({ cursor }))` **instead of** collecting
    todos, and pass `body={<TodoCompletionList completions={completions} today={today} />}`;
    otherwise keep the existing `collectTodos` + `TodoList` body (including the `groupTodos` call,
    which is only needed on the non-Done branches). `filters`/`search`/`nav`/FAB and the Done pill
    active state are unchanged. The Done branch renders no `hideDone` prop (there is no toggle).
    Reuse `today` (`todayIso()`); no new data fetch.
  - **Revalidation:** unchanged — `todo-actions.ts`'s `revalidateTodos()` already revalidates
    `/todos`, and the generation bump invalidates the `completions` cache entry.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` (shared-build precondition) then
    `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E (app tests are T8); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `listTodoCompletions` and `collectTodoCompletions` exist with the exact signatures.
  - [ ] `TodoCompletionList` composes only `List`/`ListItem`/`EmptyState` + `dueDateLabel`
        spans; no raw HTML, no `next/link`, no app CSS, no new token.
  - [ ] `/todos?done=true` renders the completion log; `All`/`Open` still render the todo list
        from `todo.done`; the empty log renders `EmptyState` heading `No completed todos`.
  - [ ] `npm run typecheck -w @life/app` passes; no file outside scope.

### T8 — App tests + mechanical checks (module `todo-completion-history`)

[TASK OBJECTIVE]
  Add the Done-view regression suite and reconcile the existing `/todos` list-wiring assertion
  that the new Done branch changes, then run the Contract 1 mechanical checks.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/test/routes-todos-completions.test.tsx` (new),
    `apps/app/test/routes-todos-list.test.tsx` (the single `done=true` assertion at ~lines
    197–207 is reconciled — see the justification below).
  - Reference files (read-only): `apps/app/test/routes-todos-list.test.tsx` (the mock/harness
    pattern), `apps/app/app/todos/page.tsx`, `apps/app/app/todo-completion-list.tsx`,
    `apps/app/lib/todo-query.ts`, `packages/ui/src/index.ts`, `AGENTS.md` (Contract 1 checks).
  - Strictly prohibited files: every production source file (a failing test re-opens T7).

[IMPLEMENTATION REQUIREMENTS]
  - **Justification for touching `routes-todos-list.test.tsx` (deviation from the literal task
    list):** T7 replaces the `doneFilter === true` body from `TodoList` (which received
    `hideDone={false}`) with `TodoCompletionList`. The existing test
    `'passes hideDone=true unless the Done filter is active'` asserts
    `done.props.body.props.hideDone === false`; after T7 that prop no longer exists, so the suite
    would be red. Leaving it would violate `npm run typecheck`/test-green. The spec's Testing #4
    ("`All`/`Open` still render the todo list from `todo.done`") is exactly this reconciliation.
  - `routes-todos-completions.test.tsx` (new): mock the same modules
    `routes-todos-list.test.tsx` mocks (`@/lib/todo-api`, `@/lib/tags-api`, `@/lib/preferences`),
    adding `listTodoCompletions` to the `@/lib/todo-api` mock factory (the new
    `TodoCompletionList` imports no server actions of its own). Cases:
    - `/todos?done=true` renders `TodoCompletionList` (not `TodoList`) with one row per
      occurrence, newest first;
    - **no** done-toggle is rendered (no `hideDone`, no `leading` checkbox in the row);
    - a row links to `/todos/<todoId>/edit`, shows the decrypted `title`, the
      `dueDateLabel(completedAt, today)` completed date, and the list name;
    - an empty log renders `EmptyState` with heading `No completed todos`;
    - `All`/`Open` still render `TodoList` from `todo.done` (assert
      `all.props.body.type === TodoList` and `open.props.body.type === TodoList`).
  - `routes-todos-list.test.tsx`: update the final `done=true` case so it asserts the Done branch
    swaps the body to `TodoCompletionList` (and `TodoList` for `All`/`Open`), preserving the
    `All`/`Open` `hideDone: true` assertions. Keep the other cases untouched.
  - Mechanical checks (Contract 1, run in this task's verification and reported):
    - `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
      → zero hits in production UI code (test files may contain raw elements; the new
      `todo-completion-list.tsx` must not);
    - `grep -rn "next/link" apps --include='*.tsx'` → zero hits;
    - `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → hits only
      inside `packages/ui/src/styles/tokens.css`.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` (shared-build precondition) then
    `npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx test/routes-todos-list.test.tsx`
    and `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; only these two named files; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] Both suites pass; the new suite covers every case above.
  - [ ] `routes-todos-list.test.tsx` is green with the reconciled Done-branch assertion.
  - [ ] The three mechanical greps return only the allowed hits.
  - [ ] `npm run typecheck -w @life/app` passes; no file outside scope modified.

### T9 — Integration review + report (module `todo-completion-history`)

[TASK OBJECTIVE]
  Tech Lead verification across the integrated boundary and a written report.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `tasks/report-todo-completion-history.md` (new).
  - Reference files (read-only): every changed file; `tasks/plan-todo-completion-history.md`;
    `docs/specs/SPEC-todo-completion-history.md`; `docs/intent/todo-completion-history.md`;
    `AGENTS.md`.
  - Strictly prohibited files: every other file.

[IMPLEMENTATION REQUIREMENTS]
  - Inspect the diff for out-of-scope edits (blast-radius check) and revert any.
  - Run, within §3 limits, the chapter's targeted checks: `npm run build -w @life/shared`;
    `npm run typecheck -w @life/todo-service`; the three backend suites; `npm run typecheck -w
    @life/app`; the two app suites; and the three Contract 1 greps + the Contract 2
    `grep -rln "getThrough" apps/*/src` check naming `todos.service.ts`.
  - Confirm each of the owner spec's **Success Criteria 1–9** is met and record the command +
    result (`pass`/`fail`) per item. Record residual gaps (e.g. the interactive push path is a
    user-run dev check) explicitly.

[VERIFICATION & TESTING RULES]
  - Permitted commands: the typechecks, the named suites, and the mechanical greps (each ≤ 2
    runs).
  - Strict constraints: NO full suites, NO E2E.

[DEFINITION OF DONE]
  - [ ] The report lists each command + result and each success criterion + evidence.
  - [ ] Any deviation from `tasks/plan-todo-completion-history.md` is named with its rationale.
  - [ ] No file outside scope modified.

### T10 — Five-lane verification (module `todo-completion-history`)

[TASK OBJECTIVE]
  Run the global protocol §7.6 five-lane gate on the final integrated state and iterate until it
  returns N/N PASS.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `tasks/five-lane-todo-completion-history.md` (new; the lane
    report).
  - Reference files (read-only): the working diff, `tasks/plan-todo-completion-history.md`,
    `tasks/todo-todo-completion-history.md`, `docs/specs/SPEC-todo-completion-history.md`,
    `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
    `docs/specs/SPEC-todo-ui.md`.
  - Strictly prohibited files: every other file (lanes are read-only reviewers; any fix re-opens
    its owning task).

[IMPLEMENTATION REQUIREMENTS]
  - **Step 1 — suite gate first**, exact commands:
    `npm run build -w @life/shared`;
    `npm run typecheck -w @life/todo-service`;
    `npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts test/todo-completions.e2e-spec.ts test/todo-completions-cache.e2e-spec.ts`;
    `npm run typecheck -w @life/app`;
    `npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx test/routes-todos-list.test.tsx`.
    Iterate fix → re-run until all are green (within §3: max 2 runs per suite-gate iteration).
  - **Step 2 — five parallel fresh-context lane subagents** (read-only; the QA lane runs Step 1),
    each returning exactly
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    1. Correctness/domain — the three tick/undo rules, `done` semantics, transaction integrity,
       `UNIQUE` idempotency, the Done-view join, no data loss on permanent delete/restore.
    2. Code quality — the five axes (reads, dead code, over-engineering, consistency, tests).
    3. Security — zero CRITICAL/HIGH/MEDIUM on changed files (owner scoping of the log and the
       completions endpoint; no content plaintext in Redis or the log; no raw HTML injection).
    4. QA — executes Step 1; scope = the five named suites; the interactive browser path is a
       user-run dev check, recorded as a gap.
    5. Plan conformance — the diff vs this plan and the three amended specs (tick contract,
       cache shape, Done-view surfaces).
  - **Step 3 — fail-closed:** a crashed, missing, or empty lane verdict is a failure. Any failed
    lane → fix blockers → re-run **only** the failed lanes → repeat until every lane returns PASS.
  - **Step 4 — commit only on N/N PASS**, staged by explicit paths (never `git add -A`). The
    chapter's explicit paths:
    - spec: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
      `docs/specs/SPEC-todo-ui.md`.
    - shared: `packages/shared/src/index.ts`.
    - todo-service source: `apps/todo-service/src/todos/todo-completion.entity.ts`,
      `todos.service.ts`, `todos.controller.ts`, `todos.module.ts`,
      `apps/todo-service/src/cache/todo-cache.ts`, `apps/todo-service/src/app.module.ts`.
    - todo-service tests: `apps/todo-service/test/todo-completion.e2e-spec.ts`,
      `todo-completions.e2e-spec.ts`, `todo-completions-cache.e2e-spec.ts`, `todo-harness.ts`.
    - app source: `apps/app/lib/todo-api.ts`, `apps/app/lib/todo-query.ts`,
      `apps/app/app/todo-completion-list.tsx`, `apps/app/app/todos/page.tsx`.
    - app tests: `apps/app/test/routes-todos-completions.test.tsx`,
      `apps/app/test/routes-todos-list.test.tsx`.
    - plan/ledger/report: `tasks/plan-todo-completion-history.md`,
      `tasks/todo-todo-completion-history.md`, `tasks/report-todo-completion-history.md`,
      `tasks/five-lane-todo-completion-history.md`.
    Commit message convention (matches the repo log, Conventional Commits):
    `<type>(<scope>): <subject>` — use `feat(todos): append-only completion history` for the
    implementation commit and `docs:` for the plan/spec repairs; never stage with a glob.

[VERIFICATION & TESTING RULES]
  - Permitted test commands: the Step 1 commands (QA lane), within the repo profile.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2 per suite-gate iteration.
  - The gate's evidence is the per-round lane reports (verdicts + blockers).

[DEFINITION OF DONE]
  - [ ] All Step 1 commands pass.
  - [ ] Five lanes each return a verdict; every lane is PASS (N/N).
  - [ ] No partial verdict was treated as done; no commit outside explicit paths.
  - [ ] Any blocker was fixed and only the failed lanes were re-run.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A repeating tick sets `done: true` or reopens | High | D4; T5 keeps `done: false`, T6 asserts it; sweep keeps `done = 0` |
| Double tick double-records history | High | D3 `UNIQUE (todoId, occurrence)` + guarded insert; T6 asserts one row |
| Undo deletes more than the one occurrence | High | D5 deletes by `(ownerSub, todoId, occurrence)`; T6 asserts earlier rows survive |
| Content (`title`/`listName`) lands in Redis or the log | High | D8/D9; T4 has no content column; T6 cache suite asserts the shape; title/list decrypted in-request |
| Permanent delete leaves orphan log rows | High | D2 `ON DELETE CASCADE`; T6 asserts cascade on `removePermanent`/`emptyTrash` |
| Soft-deleted todo's history shows in Done before restore | Med | `findCompletions` joins active `todo:all` only; T6 asserts omission, restore makes visible |
| Cursor dup/skip at a page boundary | Med | D8 `completedAt DESC, id DESC` keyset; T6 asserts continuity |
| `GET /api/todos/completions` parsed as `:id` | High | T5 declares the literal route before `@Get(':id')`; T6 endpoint case |
| `Todo` DTO key set accidentally changes | High | D10/T2 verified 15 keys; T5 returns the unchanged DTO; no key-set migration scoped |
| Existing `/todos` list suite goes red on the Done branch | Med | T8 reconciles the single `done=true` assertion and asserts the body-type swap |
| Reopen-hack language survives in the specs | Med | T1 restates both specs; the validator checks it |
| New app code uses raw HTML / app CSS | High | Contract 1 primitive reuse plan (D11/T7); T8 greps |

## Open Questions

None blocking. Deferred follow-ons are recorded in `docs/intent/todo-completion-history.md`
"Out of scope" (materialized occurrences; `RECURRENCE-ID`/`EXDATE` overrides; editing/un-completing
a past repeating occurrence; retention/pruning; per-todo history/stats; a title/list snapshot
upgrade; multi-device sync beyond the per-owner model) and in the owner spec's Open Questions.
The cross-chapter `todo-custom-repeat` re-sync is recorded above and is out of scope here.
