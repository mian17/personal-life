# Spec: todo-completion-history (append-only completion log)

Module id: `todo-completion-history` (map: `docs/specs/MAP-todo-ecosystem.md`). Backend +
UI capability of the todo ecosystem. Traces to intent:
`docs/intent/todo-completion-history.md` (locked decisions **C1–C8**).

Contracts: `AGENTS.md` Contract 1 (Shared UI) and Contract 2 (BE → cache → DB);
`SPEC-service-kernel.md`, `SPEC-todo-service.md`, `SPEC-todo-ui.md`,
`SPEC-todo-due-repeat-notify.md`, `SPEC-todo-custom-repeat.md`.
Governing decisions read before writing (lesson 0012): the intent's C1–C8, lesson 0017
(Apple Reminders is the reference: completing a repeating reminder records that occurrence
as completed **and** reveals the next occurrence — never advance-only), lesson 0003
(frontend dates), 0011 (per-service Redis), 0016 (one owner per rule).

This chapter **changes the tick/completion contract** established by
`todo-due-repeat-notify`: a repeating tick is now a recorded completion *and* an advance
(C4, lesson 0017), superseding that spec's "advance, not a completion" wording. It therefore
lands **after `todo-due-repeat-notify` and before `todo-custom-repeat`** (which builds on the
new tick contract).

## Objective

Split the todo row into a **definition** (title, note, list, due, repeat rule, current
next-due) and an **append-only occurrence log** (`todo_completion`). Completing a todo
appends one occurrence row for the due that was satisfied; the definition row is
unchanged except for its flag/advance. The **Done** view reads the log, not `todo.done`.

Success looks like: a repeating todo due Mon Oct 5 is ticked on Mon Oct 5 → one completion
row is appended (`occurrence = 2026-10-05`), the todo advances to Mon Oct 12 and stays
**open**, and `/todos?done=true` lists the Oct 5 occurrence with its real completion date
while `/todos` (Open) still shows the Oct 12 instance. A one-off tick appends one row and
closes the todo; Undo removes that row and reopens it. A double tick can never
double-record (`UNIQUE (todoId, occurrence)`).

User: the single account owner, in the todos app (shared `@life/ui` surface).

## Tech Stack

Inherited unchanged: NestJS + TypeORM + better-sqlite3 (`apps/todo-service`), Redis
read-through cache (`@life/cache` → `TodosCache`), `@life/crypto` at rest, `@life/shared`
wire types, `@life/ui` primitives, React 19 / Next App Router (`apps/app`). No new
dependency. The tick/undo transaction uses TypeORM's injected `DataSource` (already used by
`HealthService`), no new package.

## Commands

Project Profile (`AGENTS.md`) commands, per touched workspace:

```
Precondition: npm run build -w @life/shared   # consumers resolve "types": "dist/index.d.ts"
Typecheck:    npm run typecheck -w @life/shared && npm run typecheck -w @life/todo-service
              npm run typecheck -w @life/app
Test:         npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts
              npm run test:unit -w @life/todo-service -- test/todo-completions.e2e-spec.ts
              npm run test:unit -w @life/todo-service -- test/todo-completions-cache.e2e-spec.ts
              npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx
Mechanical:   grep -rln "getThrough" apps/*/src        # read flows go through the cache
              grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'
```

Never run a full suite; never run E2E (no spec file is added/changed and the flow is
verifiable by the targeted specs below — global protocol §3).

## Project Structure

```
packages/shared/src/index.ts                                 # TodoCompletion + TodoCompletionPage
apps/todo-service/src/todos/todo-completion.entity.ts        # NEW entity (todo_completion)
apps/todo-service/src/todos/todos.service.ts                 # tick/undo completion writes + findCompletions
apps/todo-service/src/todos/todos.controller.ts              # GET /api/todos/completions
apps/todo-service/src/todos/todos.module.ts                  # register TodoCompletion repo
apps/todo-service/src/app.module.ts                          # entities: [..., TodoCompletion]
apps/todo-service/src/cache/todo-cache.ts                    # TODO_COMPLETIONS rest key
apps/app/lib/todo-api.ts                                     # listTodoCompletions()
apps/app/lib/todo-query.ts                                   # collectTodoCompletions()
apps/app/app/todos/page.tsx                                  # done=true branch
apps/app/app/todo-completion-list.tsx                        # NEW Done-view log (+ row anatomy)
docs/specs/SPEC-todo-completion-history.md                   # this spec
docs/specs/MAP-todo-ecosystem.md                             # module row + build order
```

## Code Style

The entity mirrors `todo.entity.ts`/`todo-tag.entity.ts`: a plaintext, non-content log row
with a `CASCADE` FK. No content column in v1 (C7 — the title is **not** snapshotted).

```ts
// todo-completion.entity.ts
@Entity('todo_completion')
@Unique('UQ_todo_completion_todo_occurrence', ['todoId', 'occurrence'])
@Index('IDX_todo_completion_owner_completed', ['ownerSub', 'completedAt'])
@Index('IDX_todo_completion_todo', ['todoId', 'completedAt'])
export class TodoCompletion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  ownerSub: string;

  /** The definition row this occurrence belongs to; CASCADE removes the log with the todo. */
  @Column({ type: 'text' })
  todoId: string;

  /**
   * The due this tick satisfied, in `dueDate`'s dual shape: `YYYY-MM-DD` (date-only) or a
   * canonical UTC instant `…Z` (timed). The undated sentinel `'~'` (one-off todos with no
   * due) mirrors `dueSortKey`'s undated sentinel.
   */
  @Column({ type: 'text' })
  occurrence: string;

  /** Canonical UTC instant of the tick (`new Date().toISOString()`). */
  @Column({ type: 'text' })
  completedAt: string;

  @ManyToOne(() => Todo, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'todoId' })
  todo: Todo;
}
```

`todo_completion` is created additively by `synchronize: true`; register it in
`TypeOrmModule.forFeature([Todo, TodoTag, TodoCompletion])` (`todos.module.ts`) and in
`app.module.ts`'s `entities` array. No migration framework, no existing row is rewritten.

The wire contract is owned by `@life/shared` (the `Todo`/`TodoPage` precedent); the app
consumes it, never re-declares it:

```ts
// packages/shared/src/index.ts
/** One appended completion occurrence (`SPEC-todo-completion-history`, C2/C6/C7). */
export interface TodoCompletion {
  id: string;
  todoId: string;                       // link to the live definition (edit screen)
  occurrence: string;                   // the satisfied due, or '~' (undated one-off)
  completedAt: string;                  // canonical UTC instant of the tick
  title: string;                        // DECRYPTED, joined at read time (C7 — never a snapshot)
  listId: string | null;                // the todo's list at read time
  listName: string | null;              // DECRYPTED list name, joined from todo:lists; null when unlisted
}

export interface TodoCompletionPage {
  completions: TodoCompletion[];
  nextCursor: string | null;
}
```

`title`/`listName` are decrypted **in the request path** from the existing cached row-sets
(`todo:all` for `title`, `todo:lists` for the list name) — never stored in the log, never
cached in the completions entry. `listId`/`listName` are included because the Done row
renders the same list-name meta as `todo-item.tsx`; the name resolves from todo-service's
own `todo:lists` cache (list names are **not** a `tags-service` concern — `SPEC-todo-service`
owns `list.name`).

## Data model & wire contract

- **Log row** (`todo_completion`): `id` uuid, `ownerSub` text, `todoId` text (FK → `todo.id`
  `ON DELETE CASCADE`), `occurrence` text (dual due shape or `'~'`), `completedAt` text
  (canonical UTC instant). Append-only: a row is **inserted** or **deleted**, never updated;
  it has no `version` and takes no OCC.
- **`UNIQUE (todoId, occurrence)`** is the idempotency key (C3): at most one row per
  **`(todoId, occurrence)`**. `occurrence` is `NOT NULL` in every case — the dual due shape
  for a dated todo, `'~'` for a due-less one-off — so uniqueness is total. A single todo may
  hold many rows across occurrences, and may hold history after its repeat is removed
  (clearing the due clears the repeat; the log is unaffected).
- **Indexes:** `IDX_todo_completion_owner_completed (ownerSub, completedAt)` backs the
  paginated read; `IDX_todo_completion_todo (todoId, completedAt)` backs the per-todo
  delete and future per-todo history (C2).
- **Delete lifecycle (C7):** permanent delete (`removePermanent`, `emptyTrash`) hard-deletes
  the todo and the FK cascades the log. Soft delete/trash leaves the log **intact** (history
  survives restore); the Done view joins only active todos, so a trashed todo's occurrences
  are hidden until restore and reappear after it.
- **No crypto envelope:** the log carries no user text, so it is plaintext metadata
  (like `done`/`dueDate`/`repeat`). Content (`title`, `list.name`) stays `enc.v1.`-only in
  SQL; it is never copied into this table.

## Completion rules (single owner: `TodosService.update`)

All three paths are driven by the existing `PATCH /api/todos/:id` body (`done`); there is no
new mutation route. The `done`-bearing branch runs inside one `DataSource` transaction so the
log write and the definition write commit together.

Let `D = todo.dueDate` (already normalized) and `repeat = todo.repeat`.

1. **Repeating tick** — `patch.done === true`, `repeat !== null`, `D !== null` (invariant:
   a repeat requires a due):
   - `occurrence = D` (the **pre-advance** due, in its stored shape).
   - `next = advanceToOnOrAfter(dueSortKey(D, tz), repeat, nowLocal())` (unchanged engine;
     `custom` from `todo-custom-repeat` joins here later).
   - In one transaction: guarded-insert one completion row
     (`{ id: randomUUID(), ownerSub: sub, todoId: id, occurrence: D,
     completedAt: new Date().toISOString() }`); set
     `todo.dueDate = next.includes('T') ? localToUtc(next, tz).toISOString() : next`,
     `todo.reminderScheduledAt = reminderAt(todo.dueDate, tz)`, `todo.done = false`,
     `todo.version += 1`, `todo.updatedAt = now`; `manager.save(todo)`.
   - `todo.done` stays **`false`** (C4): the row advances and remains open; no reopen path.
2. **One-off tick** — `patch.done === true`, `repeat === null`:
   - `occurrence = D ?? '~'`.
   - In one transaction: guarded-insert the completion row; set `todo.done = true`,
     `todo.version += 1`, `todo.updatedAt = now`; `manager.save(todo)`.
3. **Un-complete (Undo)** — `patch.done === false`, `repeat === null`:
   - In one transaction: `manager.getRepository(TodoCompletion).delete({ ownerSub: sub, todoId: id,
     occurrence: D ?? '~' })` — **only** the row for the occurrence being un-completed
     (invariant: at most one row per `(todoId, occurrence)`). Other rows — e.g. prior
     repeating occurrences recorded before the repeat was cleared — are **preserved**; set
     `todo.done = false`, `todo.version += 1`, `todo.updatedAt = now`; `manager.save(todo)`.
4. **Un-complete on a repeating todo** — `patch.done === false`, `repeat !== null`: the log
   is **untouched** (append-only; un-completing a past occurrence is out of scope, intent
   Out of scope). `todo.done` is already `false`; the existing version/updatedAt bump stands.

After the transaction commits, `await this.cache.bumpGeneration(sub)` runs exactly once
(pre-mutation reads die; a thrown transaction never bumps). The tag-association handling and
all other (non-`done`) `update()` behavior are unchanged.

**Guarded insert (the "upsert-free guard", C3):**

```ts
private async writeCompletion(
  manager: EntityManager, sub: string, todoId: string, occurrence: string, completedAt: string,
): Promise<void> {
  const repo = manager.getRepository(TodoCompletion);
  if (await repo.findOne({ where: { todoId, occurrence } })) return; // already recorded
  try {
    await repo.insert({ id: randomUUID(), ownerSub: sub, todoId, occurrence, completedAt });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // concurrent duplicate: the UNIQUE key won
  }
}
```

`isUniqueViolation(err)` is `err instanceof QueryFailedError` with
`err.driverError?.code === 'SQLITE_CONSTRAINT_UNIQUE'` (fallback: the driver message contains
`UNIQUE constraint failed`). Exact behavior: a repeated tick for an already-recorded
occurrence is a **no-op insert** — no duplicate row, no error surfaced; a stale retry is
independently rejected with `409` by the existing `expectedVersion` OCC check, and the
one-off `done` flag makes a second tick a no-op on its own.

**Sweep-reopen hack deleted (C4).** The reminder sweep's WHERE is, and stays, **open rows
only**:

```
SELECT r.* FROM todo r
WHERE r.deletedAt IS NULL AND r.done = 0
  AND r.reminderScheduledAt IS NOT NULL AND r.reminderScheduledAt <= :nowIso
```

`ReminderService.sweep()` keeps `done: false` in its TypeORM `where`; no reopen path
(`done = true` write, timer, or sweep side-effect) exists anywhere after this chapter. The
repeating tick never sets `done = true`, so there is nothing to reopen.

## API

Kernel contracts apply. All routes are owner-scoped and guarded by the auth guard
(`@Principal()`); a foreign row is never returned.

- **`GET /api/todos/completions?limit&cursor`** → `TodoCompletionPage` (newest first:
  `completedAt DESC, id DESC`; default `limit 50`, capped 200). Declared as
  `@Get('completions')` alongside the literal `tags`/`trash` routes, **before** `@Get(':id')`
  so it is not parsed as an id. Reuses `ListTodosQuery` (only `limit`/`cursor` are read),
  exactly as `GET /api/todos/trash` does — no new query DTO.
- **Cursor:** `base64(<completedAt>|<id>)`, a two-field descending keyset mirroring the
  trash cursor (`encodeTrashCursor`/`decodeTrashCursor`/`afterTrashCursor`). Completion-
  specific helpers `encodeCompletionCursor`/`decodeCompletionCursor`/`afterCompletionCursor`
  are defined by analogy (the field names differ; a generic extraction is deferred — the
  existing code already carries two parallel cursor trios).
- **Read path** (`TodosService.findCompletions(sub, { limit, cursor })`):
  1. Read the owner's log through the read-through cache (`TODO_COMPLETIONS`).
  2. Order `completedAt DESC, id DESC` in memory; join `todo:all` (the existing active
     row-set) and **omit** rows whose `todoId` has no active todo (soft-deleted → Trash;
     permanently deleted → already cascaded). Paginate the joined list (`afterCompletionCursor`).
  3. For the page only: decrypt each referenced todo's `title` (`todoTitleAad`), read its
     `listId`, and resolve `listName` from the owner's `todo:lists` (`ListsService.list`,
     skipped when no page row has a `listId`). Build `TodoCompletion[]`.
- **Tick / un-complete** stay on the existing `PATCH /api/todos/:id { done }` (Completion
  rules above); the tick response is the unchanged 15-key `Todo` DTO (no wire change to
  `Todo` — the frozen `todos.e2e-spec.ts`/`ownership.e2e-spec.ts` key sets are untouched).

## Cache Rules (AGENTS.md Contract 2, Rule 4)

- **Cached shape:** `CachedCompletionRow { id, todoId, occurrence, completedAt }` — serialized
  rows **as persisted**. The v1 log has no content column, so this shape has no `enc.v1.`
  assertion (there is no content to guard); content `title`/`list.name` is never copied here
  and is decrypted in the request path from the existing `todo:all`/`todo:lists` row-sets.
- **Key composition:** `todo:<sub>:v<gen>:completions` (`TODO_COMPLETIONS = 'completions'`,
  one of the reserved `<rest>` values in `todo-cache.ts`; the module comment is updated from
  "three" to four). `limit`/`cursor` never enter the key — one entry serves every page
  variant. Per-owner isolation is the `<sub>` segment.
- **Loader (Contract 2 Rule 1):** the DB is reached only through the loader inside
  `getThrough`:
  `SELECT * FROM todo_completion WHERE ownerSub = :sub ORDER BY completedAt DESC, id DESC`
  (index-backed by `IDX_todo_completion_owner_completed`). A `decodeCompletionRows` guard
  rejects a malformed hit (non-array, or a row whose `id`/`todoId`/`occurrence`/`completedAt`
  is not a string) and fails open to the loader.
- **Invalidation:** the existing per-owner generation counter `todo:gen:<sub>` (the **same**
  one) is bumped after every successful tick and un-complete, and after every permanent
  delete / empty-trash (whose FK cascade removes completion rows). Soft delete/restore bump
  it too (existing), keeping the active-todo join consistent. A failed mutation never bumps.
- **Failure mode:** 60s TTL backstop (`CACHE_TTL_SECONDS`); any cache error degrades to the
  direct loader; the fallback path only reads rows and never writes plaintext (the log has
  no content, and the joined content is decrypted in the request path either way).
- **Mechanical check:** `grep -rln "getThrough" apps/*/src` lists `todos.service.ts` — the
  new completion read flow goes through the read-through cache; no direct DB read in a
  request path.

## UI (Contract 1, `@life/ui` only)

`/todos?done=true` renders the **completion log** instead of the todo list. `All`/`Open`
keep `todo.done` semantics for todos; only the **Done** status pill switches source.

### Primitive reuse plan (element by element)

| Element | Composed from |
|---|---|
| Done-view body root | `List` (existing block; no new visual language) |
| completion row | `ListItem` (`href`, `title`, `meta`; **no** `leading`, **no** `deleteAction`, no `variant`) |
| completed-date meta | the `@life/ui` date owner: `dueDateLabel(completedAt, today)` (dd/mm/yyyy, `Today`/`Tomorrow` + local `HH:mm`) in a `span` |
| list-name meta | a `span` (same meta row as `todo-item.tsx` renders) |
| empty state | `EmptyState` (`heading="No completed todos"`, `body="Completed tasks appear here."`) |
| page chrome | the existing `ListShell` (title `Todos`, `TodosNav`, tabs, `PreservingSearchBox`, status/tag/list filters, FAB) — unchanged |

No new atom/block is required (Contract 1 Rule 3 holds: everything fits existing
primitives). No raw `<a>`/`<button>` is introduced — `ListItem` owns the `next/link` anchor.

### Done view composition

- `apps/app/app/todos/page.tsx`: when `doneFilter === true`, load
  `collectTodoCompletions((cursor) => listTodoCompletions({ cursor }))` and pass
  `body={<TodoCompletionList completions={completions} today={today} />}`; otherwise the
  existing `TodoList`. Filters/search/nav/FAB are unchanged, and the Done pill stays active.
- `apps/app/app/todo-completion-list.tsx` (NEW): `TodoCompletionList({ completions, today })`
  maps to `<List>{completions.map((c) => <ListItem key={c.id} href={`/todos/${c.todoId}/edit`}
  title={c.title} meta={<><span>{dueDateLabel(c.completedAt, today)}</span>
  {c.listName && <span>{c.listName}</span>}</>} />)}</List>`; empty input → `EmptyState`.
  **No done-toggle** is rendered; the log is read-only (no per-row delete, no Undo here).
- `apps/app/lib/todo-api.ts`: add `listTodoCompletions(opts: { limit?: number; cursor?: string } = {}): Promise<TodoCompletionPage>`
  (`GET /api/todos/completions` with the `limit`/`cursor` params). `apps/app/lib/todo-query.ts`:
  add `collectTodoCompletions(fetchPage, maxItems = 1000)` mirroring `collectTodos`, so the
  Done view shows every completed occurrence (the intent's promise), not just the first page.
- **Revalidation:** `todo-actions.ts`'s `revalidateTodos()` already revalidates `/todos`;
  a one-off tick/undo therefore refreshes the Done view. Undo of a one-off tick removes the
  completion row server-side (Completion rules §3), and the generation bump invalidates the
  `completions` entry — the revalidated page no longer contains it. No action change needed.

### `DoneToggle` end state (`todo-item.tsx`)

The pre-change gate is the correct end state: `hide={hideDone && todo.repeat == null}` and
`collapsing={todo.repeat == null && collapsing}` **stay**. A repeating tick advances and
stays open, so a repeating row never auto-hides and never shows the Undo snackbar (undone
via the `repeat == null` gate — un-completing a past occurrence is out of scope; a one-off
tick keeps today's snackbar/Undo unchanged). No `DoneToggle` edit.

### Frozen selector-surface record (conceptually; the `SPEC-todo-ui.md` edit is plan T1)

- `/todos?done=true` completion rows are `ListItem` links whose accessible name is the todo
  **title** (`/todos/<todoId>/edit`). The Done-view empty state is `EmptyState` with heading
  `No completed todos`.
- No existing name/role/aria-label changes (`Done`, `All`, `Open`, `Status`, the row
  `href`s all stay). Recorded as surface **additions** only; the human-owned Playwright
  suite changes only if the user asks.

## Testing Strategy

Targeted named files only (Project Profile commands; no full suite, no E2E):

1. **Entity + tick/undo rules** — `apps/todo-service/test/todo-completion.e2e-spec.ts`:
   repeating tick appends exactly one row (`occurrence` = pre-advance due, correct dual
   shape), advances the due, re-arms `reminderScheduledAt`, and leaves `done: false`; a
   one-off tick appends one row and sets `done: true`; un-complete deletes **only that
   occurrence's** row and sets `done: false`; a due-less one-off records `occurrence = '~'`
   and un-complete uses the `'~'` sentinel; a todo carrying several completion rows whose
   repeat was cleared, ticked as a one-off and then un-ticked, retains its earlier rows; a
   double tick is a no-op insert (one row, `UNIQUE` guard); a stale `expectedVersion` retry
   is `409`;
   `removePermanent`/`emptyTrash` cascade-delete the rows; soft delete leaves them and
   restore makes them visible again.
2. **Endpoint** — `apps/todo-service/test/todo-completions.e2e-spec.ts`: `GET
   /api/todos/completions` returns `completedAt DESC, id DESC`; cursor continuity (no
   dup/skip across pages); `limit` default/cap; owner scoping (a foreign `sub` never sees
   another owner's rows); completions of a trashed todo are omitted from the page;
   `title`/`listName` are decrypted and `listId` is present.
3. **Cache** — `apps/todo-service/test/todo-completions-cache.e2e-spec.ts`: the log is
   cached under `todo:<sub>:v<gen>:completions` (one entry serves every page variant);
   `limit`/`cursor` never enter the key; a tick/undo/permanent-delete bumps the generation
   so the entry is refetched; every read flows through `getThrough` (no direct DB read); a
   corrupt hit fails open to the loader.
4. **App** — `apps/app/test/routes-todos-completions.test.tsx`: `/todos?done=true` renders
   the completion log (one row per occurrence, newest first) and **no** done-toggle; the row
   links to `/todos/<todoId>/edit`, shows the decrypted title, the `dueDateLabel` completed
   date, and the list name; an empty log renders `EmptyState` heading `No completed todos`;
   `All`/`Open` still render the todo list from `todo.done`.

No existing-suite reconciliation is due: the `Todo` DTO key set is unchanged (15 keys), so
`todos.e2e-spec.ts`/`ownership.e2e-spec.ts` are untouched.

## Boundaries

- **Always:** one owner per fact — the log owns history, `todo.done` owns only the Open-list
  flag; the tick/undo path is the single writer of the log; UI from `@life/ui` (Contract 1);
  BE → cache → DB with the read-through loader (Contract 2); content stays `enc.v1.`-only
  and is never copied into the log or the completions cache.
- **Ask first (user):** any change to the frozen e2e selector surface beyond the additions
  recorded above; any new token value; anything frozen by `AGENTS.md` `frozen-surfaces`.
- **Never:** a title/list snapshot column in v1 (C7); plaintext content in Redis/logs; a
  reopen path or a `done = true` write in the sweep/repeating tick (C4); `limit`/`cursor` in
  the cache key; a raw HTML element or app-side CSS in the Done view (Contract 1); un-
  completing or editing a past repeating occurrence from the UI (intent Out of scope);
  merge to `master` without the user's explicit request.
- **Cross-spec amendments (conceptual; landing in the same chapter):**
  `SPEC-todo-service.md` and `SPEC-todo-due-repeat-notify.md` restate the advance-on-tick
  clause as "advance **and** record a completion; `done` stays false; the sweep is
  unchanged"; `SPEC-todo-service.md`'s Cache Rules add the fourth shape;
  `SPEC-todo-ui.md` records the Done-view surface additions (plan T1).

## Success Criteria

1. Ticking a repeating todo appends exactly one `todo_completion` row for the pre-advance
   due, advances the due to the next occurrence on/after now (re-arming the reminder), and
   leaves `todo.done: false` — all in one transaction.
2. Ticking a one-off appends one row and sets `todo.done: true`; un-completing it deletes
   **only that occurrence's** row and sets `todo.done: false`. A todo whose repeat was
   cleared after carrying repeating-completion history keeps those earlier rows when ticked
   as a one-off and un-ticked.
3. A repeat tick for an already-recorded occurrence inserts nothing (the `UNIQUE (todoId,
   occurrence)` guard); a stale `expectedVersion` retry is `409`.
4. `GET /api/todos/completions` returns the owner's log newest first with working
   `limit`/cursor pagination; `title`/`listName` are decrypted at read time and no snapshot
   is stored.
5. Permanent delete cascades the log; soft delete preserves it (hidden from Done while
   trashed) and restore makes it visible again.
6. The reminder sweep fires **open** rows only (`done = 0`); no reopen path exists.
7. The cache holds one `todo:<sub>:v<gen>:completions` entry, invalidated by the per-owner
   generation bump on tick/undo/permanent-delete; filters/pagination never enter the key.
8. `/todos?done=true` renders the completion log from `@life/ui` primitives with no
   done-toggle; `All`/`Open` keep `todo.done` semantics.
9. Contract 1 mechanical checks are green (zero raw-HTML hits in the new app code) and
   Contract 2's `getThrough` check shows the completions read flows through the cache.

## Open Questions

- None blocking. Deferred follow-ons (recorded from the intent): materialized future
  occurrences; `RECURRENCE-ID`/`EXDATE` exception overrides; editing or un-completing a past
  repeating occurrence from the UI; a retention/pruning policy for old completion rows; a
  per-todo history view and stats; a denormalized title/list snapshot so history outlives a
  permanently deleted todo (C7 upgrade); multi-device sync of the log beyond the existing
  per-owner model.
