# Spec: todo-service (standalone todo domain)

Module id: `todo-service` (see `MAP-todo-ecosystem.md`). New workspace app
`apps/todo-service`, mirroring note-service's stack (NestJS + TypeORM better-sqlite3
+ `@life/cache` + `@life/crypto` + IdP JWKS auth).

## Objective

The todo domain: capture and clear todos daily. MVP fields per the confirmed intent
(I2): title, optional note, done toggle, due date — organized by todo-local lists
(I4) and shared tags (TagRef). Contracts are the orchestrator seam (I1).

## Data model

```
todo(
  id        TEXT PRIMARY KEY,        -- service-generated UUID v4
  title     TEXT NOT NULL,           -- enc.v1, AAD life.v1|<sub>|todo|title|<id>
  note      TEXT NULL,               -- enc.v1, AAD life.v1|<sub>|todo|note|<id>
  done      BOOLEAN NOT NULL DEFAULT 0,
  important BOOLEAN NULL,            -- plaintext metadata, NULL = inherit list default (L6)
  dueDate   TEXT NULL,               -- 'YYYY-MM-DD' (date-only) or canonical UTC
                                     -- instant '…Z' (timed); plaintext metadata
  repeat    TEXT NULL,               -- null | daily | weekdays | weekly | monthly | yearly | custom
  repeatDays TEXT NULL,              -- CSV of ISO weekdays 1..7 (Mon..Sun), e.g. '4,5'; null = not custom
  reminderScheduledAt TEXT NULL,     -- canonical UTC instant of the current reminder; null = none
  listId    TEXT NULL,               -- FK list.id, ON DELETE SET NULL (detach)
  origin    TEXT NULL,               -- JSON {service,id} — kernel orchestrator seam
  ownerSub  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  deletedAt DATETIME NULL            -- null = active
)
todo_tag(todoId TEXT, tagId INTEGER, PRIMARY KEY(todoId, tagId),
         FOREIGN KEY(todoId) REFERENCES todo(id) ON DELETE CASCADE)  -- TagRefs, no names
todo_completion(                   -- append-only completion log (SPEC-todo-completion-history)
  id          TEXT PRIMARY KEY,    -- service-generated UUID v4
  ownerSub    TEXT NOT NULL,
  todoId      TEXT NOT NULL,       -- FK todo.id, ON DELETE CASCADE (permanent delete cascades)
  occurrence  TEXT NOT NULL,       -- the satisfied due: 'YYYY-MM-DD' or canonical UTC instant, or '~'
  completedAt TEXT NOT NULL,       -- canonical UTC instant of the tick
  UNIQUE (todoId, occurrence)      -- idempotency key: at most one row per (todoId, occurrence)
)
-- IDX_todo_completion_owner_completed (ownerSub, completedAt): paginated read
-- IDX_todo_completion_todo (todoId, completedAt): per-todo delete / history
list(
  id        TEXT PRIMARY KEY,        -- service-generated UUID v4
  name      TEXT NOT NULL,           -- enc.v1, AAD life.v1|<sub>|list|name|<id>
  importantDefault BOOLEAN NULL,     -- plaintext metadata, NULL = false (L6)
  ownerSub  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 0,   -- kernel concurrency contract
  createdAt DATETIME NOT NULL
)
user_keys(sub, wrappedDek, kekVersion, createdAt)   -- own key custody (M3)
push_subscription(
  id        TEXT PRIMARY KEY,        -- service-generated UUID v4
  ownerSub  TEXT NOT NULL,
  endpoint  TEXT NOT NULL,           -- push service URL (Web Push endpoint)
  p256dh    TEXT NOT NULL,           -- subscription public key (base64url)
  auth      TEXT NOT NULL,           -- subscription auth secret (base64url)
  createdAt DATETIME NOT NULL,
  UNIQUE (ownerSub, endpoint)        -- per-owner uniqueness; endpoint is not globally unique
)
```

- `dueDate` now holds **either** a date-only `YYYY-MM-DD` **or** a canonical UTC instant
  (`YYYY-MM-DDTHH:mm:ss.sssZ`) — the entity column changes from `type: 'date'` to
  `type: 'text'` and gains `repeat`/`reminderScheduledAt` text columns
  (`SPEC-todo-due-repeat-notify.md`; the entity change is T5's). A date-only value stays
  naive and never round-trips through `Date` (lesson 0003). Index
  `IDX_todo_reminder_scheduled_at` on `reminderScheduledAt` backs the reminder sweep
  predicate. `synchronize: true` applies the additive columns (no migration framework).
  `repeatDays` is additive too: `repeat` keeps its flat enum and gains `'custom'`, and
  `repeatDays` holds the ISO weekday set as CSV (`'4,5'`) — no row rewrite; every existing
  row keeps `repeatDays = null` (`SPEC-todo-custom-repeat.md`).
- `repeat`, `repeatDays`, and `reminderScheduledAt` are **plaintext, non-content** metadata (like
  `done`/`important`/`dueDate`): no `@life/crypto` envelope, no AAD, no user text.
  `reminderScheduledAt` is the lasting reminder record ("the letter"); no separate
  notification table is introduced. `push_subscription` stores **delivery capability
  only** (endpoint + keys), owner-scoped, never returned in a todo response, never
  cached; uniqueness is the composite `(ownerSub, endpoint)`, never the endpoint alone.

- Content fields (`title`, `note`, `list.name`) encrypted at rest; `dueDate`,
  `done`, `important`, `list.importantDefault`, timestamps are metadata and stay queryable
  in SQL (decision: dueDate is operational data, not content; documented here
  deliberately). The two importance booleans are non-content and therefore **not**
  `@life/crypto`-wrapped — the documented plaintext exception mirroring `done`
  (`SPEC-todo-importance.md`).
- No dual-read (M5). Master key `TODO_MASTER_KEY` (32-byte base64), fail-closed.
- DB wiring: `DB_PATH` env (default `apps/todo-service/data/todo.db` via `@life/shared`'s `resolveDbPath`
  (note-service's split: the service reads `DB_PATH` inline, scripts resolve their
  own vars); compose bind-mounts
  `./apps/todo-service/data:/data` with `DB_PATH=/data/todo.db`.
- Soft delete / trash (user-authorised full soft-delete scope): `deletedAt DATETIME
  NULL` — null = active; `DELETE /api/todos/:id` is a **soft** delete (sets
  `deletedAt`) and the todo stays recoverable from `GET /api/todos/trash`. Trash and
  restore verbs never change `version` (only `update` bumps the OCC counter). No
  separate trash table, no scheduled purge (mirrors `SPEC-notes.md`).
- `todo_completion` (append-only; `SPEC-todo-completion-history.md`) is **plaintext
  metadata**: `occurrence` is the dual due shape or the undated `'~'` sentinel, and the
  table has **no content column and no `enc.v1.` envelope** — `title`/`list.name` are
  never copied into it (C7). A **permanent delete** (`removePermanent`/`emptyTrash`)
  hard-deletes the todo and the FK **cascades** the log; **soft delete preserves** it
  (history survives restore, hidden from Done while trashed).

## Behavior / API (kernel contracts apply)

DTO shapes: every mutable entity's DTO carries `version` (todo and list — tags are
registry-owned `TagRef`s, their `version` comes from the registry DTO) so clients
can send `expectedVersion` (kernel concurrency contract). The wire types (`Todo`,
`TodoPage`, `CreateTodoInput`, `UpdateTodoInput`, `List`) are exported from
`@life/shared` (the `Note`/`CreateNoteInput` precedent) — this module owns them;
the app consumes, never re-declares (the orchestrator seam is the wire contract).

Importance field contracts (`SPEC-todo-importance.md`, intent L6) — additive, plaintext,
non-content:

- `Todo` (read DTO) carries `important: boolean | null` (stored override; `null` =
  inherit) and `effectiveImportant: boolean` (`important ?? list.importantDefault ??
  false`, computed post-decrypt, never stored).
- `CreateTodoInput.important?: boolean | null` and
  `UpdateTodoInput.important?: boolean | null` — omitted = unchanged (PATCH) / inherit
  (POST); `null` = clear to inherit.
- `List` (read DTO) carries `importantDefault: boolean | null` (`null` = false); the
  list create/update request bodies accept optional `importantDefault: boolean | null`
  (`CreateListDto`/`UpdateListDto`; there is no shared list-input type — `List` is the
  exported wire shape, mirroring the service DTOs).

Due-time / recurrence / reminder field contracts (`SPEC-todo-due-repeat-notify.md`) —
additive, plaintext, non-content. Optionality splits by direction: request fields optional,
read fields required-but-nullable:

- `Todo` (read DTO) carries `repeat: TodoRepeat | null`,
  `repeatDays: number[] | null`, and
  `reminderScheduledAt: string | null`, present on every read (`POST`, `GET /api/todos`,
  `GET /api/todos/:id`, `PATCH`, `POST /:id/restore`).
  `export const TODO_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const;`
  and `export type TodoRepeat = (typeof TODO_REPEATS)[number];` — the array is the single
  source; the DTO validates with `@IsIn(TODO_REPEATS)` (owner: `@life/shared`).
- `CreateTodoInput.dueDate?: string | null` and `UpdateTodoInput.dueDate?: string | null`;
  `repeat?: TodoRepeat | null` on both. Update: omitted = unchanged; `null` on `dueDate`
  clears the due **and** the reminder; `null` on `repeat` clears the repeat.
- `repeatDays?: number[] | null` on both inputs, validated
  `@IsOptional() @ValidateIf((_, v) => v !== null) @IsArray() @ArrayNotEmpty() @IsIn(TODO_REPEAT_DAYS, { each: true })`
  (`TODO_REPEAT_DAYS` = ISO weekdays `1..7`, owner `@life/shared`). `null`/omitted = no custom
  days; present only meaningful when `repeat === 'custom'` (`SPEC-todo-custom-repeat.md`).
- Request `dueDate` is a date-only `YYYY-MM-DD` or a local-timed `YYYY-MM-DDTHH:mm`
  (`datetime-local`, no zone); the service normalizes a timed request to the canonical UTC
  instant in `TODO_TIMEZONE` (below) before storing. Validation is
  `@IsOptional() @ValidateIf(v => v !== null) @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)`;
  the existing `@MaxLength(10)` is dropped (or raised to 16) in **both** `create-todo.dto.ts`
  and `update-todo.dto.ts` so a 16-char timed value reaches `@Matches`. `repeat` is
  `@IsOptional() @ValidateIf(v => v !== null) @IsIn(TODO_REPEATS)`. Read values are always
  date-only or UTC instant.
- **Timezone:** the client submits local wall-clock; the service is the single zone owner.
  `TODO_TIMEZONE` (IANA, default `Asia/Ho_Chi_Minh`) is read once at construction; the
  conversion helpers (`zoneOffsetMs`, `localToUtc`, `utcToLocal`) are pure
  (`Intl.DateTimeFormat` only, no new dependency); a date-only value is never converted.
- **Reminder rule:** any todo with a `dueDate` gets a reminder — timed → the due instant;
  date-only → `dueDate` at **09:00** in `TODO_TIMEZONE` (N5). No due ⇒
  `reminderScheduledAt = null`. A **done** todo keeps its stored reminder until
  ticked/cleared; the sweep skips `done` rows.
- **A repeat requires a due date.** Create/update with `repeat != null` and no resulting
  `dueDate` → 400 (`BadRequestException('repeat requires a dueDate')`). This applies to
  `custom` too.
- **Custom day-set invariants (`SPEC-todo-custom-repeat.md`):** `repeat === 'custom'` ⟺
  `repeatDays` is a non-empty set — `custom` with no days → 400
  (`BadRequestException('custom repeat requires repeatDays')`); any non-`custom` repeat stores
  `repeatDays = null` (a provided set is normalized away); clearing the due clears `repeat`
  **and** `repeatDays`.
- **Advance-on-tick records a completion (N2/N3, no scheduler; amended by
  `SPEC-todo-completion-history.md` C4, lesson 0017):** `PATCH /api/todos/:id { done: true }`
  where the todo has `repeat` **records a completion and** advances. Let `D = todo.dueDate`
  (normalized, pre-advance). In one `DataSource` transaction: guarded-insert one
  `todo_completion` row with `occurrence = D` (the pre-advance due, in its stored shape) and
  `completedAt = new Date().toISOString()`, then advance the todo: step strictly past `D`
  (`nextOccurrence`, one `repeat` step, so the due can never jam on the just-completed
  occurrence) and roll forward to on/after "now" in the `TODO_TIMEZONE` local calendar
  (daily +1d; weekdays next Mon–Fri;
  weekly +7d; monthly +1 month clamped to month end; yearly +1 year, Feb 29 → Feb 28;
  custom next day whose ISO weekday is in `repeatDays`, ≤ 7 steps, time-of-day preserved),
  skipping candidates before now, re-derive `reminderScheduledAt`, and return the advanced
  row. `done` stays **`false`** — the row advances and remains open. `version` bumps once;
  the generation counter bumps after the write. **`UNIQUE (todoId, occurrence)`** is the
  idempotency key: a repeat tick for an already-recorded occurrence inserts nothing. **The
  sweep is unchanged (open rows only) and no reopen path exists** — the repeating tick never
  sets `done = true`, so there is nothing to reopen. A **non-recurring** `done: true` still
  marks done and (new) records `occurrence = D ?? '~'`; `done: false` on a one-off deletes
  **only that occurrence's** row (any other rows are preserved). `done: false` on a
  **repeating** todo undoes the last tick: it deletes that occurrence's latest
  `todo_completion` row and restores the due it recorded (re-arming the reminder); with no
  dated row it is a no-op. Ticking a recurring todo hides nothing (no auto-hide; the Undo
  snackbar wording is owned by `SPEC-todo-ui.md`). Trash/restore semantics are unchanged.

- `POST /api/todos {title, note?, dueDate?, repeat?, repeatDays?, listId?, important?, tagIds?}` → 201 (version 0).
  `important` is `boolean | null`; omitted or `null` stores `null` (inherit the list default).
- `GET /api/todos?{q, listId, tagId, done, important, dueBefore, dueAfter}` → cursor page.
  Cursor payload: `base64(<due sort key>|<createdAt>|<id>)` (`~` = undated sentinel).
  Order: dated by the **local** sort key `dueSortKey(value, tz)` ASC (overdue first),
  undated (`~`) last, `createdAt DESC` tiebreak. `dueSortKey` is `null` ⇒ `~`, date-only ⇒
  its `YYYY-MM-DD`, timed ⇒ its **local** `YYYY-MM-DDTHH:mm` in `TODO_TIMEZONE` (not the
  stored UTC day); `repeat`/`reminderScheduledAt` never enter the key.
  `q` matches decrypted `title`+`note` via `likeMatch` (parity contract
  per kernel); `tagId` filters over `todo_tag`; all content filtering happens after
  cache hits (AGENTS.md Contract 2).
- `GET /api/todos/:id` · `PATCH /api/todos/:id {title?, note?, done?, dueDate?, repeat?,
  repeatDays?, important?, listId?, tagIds?, expectedVersion?}` (409 on stale; omit = last-write-wins;
  `important: null` clears the override back to inherit) ·
  `DELETE /api/todos/:id` (**soft** delete: sets `deletedAt`).
- `GET /api/todos/trash?{limit, cursor}` → cursor page of soft-deleted todos,
  ordered `deletedAt DESC, id DESC` (cursor payload `base64(<deletedAt>|<id>)`; same
  `limit` rules as the main list) · `DELETE /api/todos/trash` → `{ok: true, count}`
  (empties the caller's trash).
- `POST /api/todos/:id/restore` → clears `deletedAt`, preserving `createdAt`, tags,
  and `version` · `DELETE /api/todos/:id/permanent` → hard-deletes a trashed todo
  (404 if it is not in trash; a failed mutation never bumps the generation).
- `GET /api/todos/completions?{limit, cursor}` → `TodoCompletionPage` (newest first,
  `completedAt DESC, id DESC`; default `limit 50`, capped 200; cursor payload
  `base64(<completedAt>|<id>)`). Reuses `ListTodosQuery` (only `limit`/`cursor` are read),
  exactly as `GET /api/todos/trash` does — no new query DTO. `title`/`listName` are
  **decrypted in the request path** (joined from the existing `todo:all`/`todo:lists`
  row-sets); there is **no snapshot column**. Read through the completions cache
  (`SPEC-todo-completion-history.md`).
- **Declare the static `trash` routes before the `:id` routes** (`GET`/`DELETE
  /api/todos/trash` before `GET /api/todos/:id`) so `/trash` is not parsed as an id
  (kernel route-ordering clause, notes precedent). The literal `completions` route is
  likewise declared **before** `@Get(':id')`.
- Trashed todos are hidden from `GET /api/todos` (list), `GET /api/todos/:id`,
  `PATCH /api/todos/:id`, and `GET /api/todos/tags` (a tag with only trashed todos is
  hidden) — only the trash routes surface them.
- Lists: `POST /api/lists {name, importantDefault?}` · `GET /api/lists` · `PATCH /api/lists/:id
  {name, importantDefault?, expectedVersion?}` (case-insensitive collision within owner → 409; stale
  `expectedVersion` → 409, omit = last-write-wins) · `DELETE /api/lists/:id` —
  detach semantics: its todos survive with `listId` cleared. `importantDefault` is
  `boolean | null` (`null` = false), additive and not part of list identity.
- `GET /api/todos/tags` → `[{tagId, count}]` (kernel usage surface; names resolved
  by the app via the registry). **Declare this route before `GET /api/todos/:id`** —
  Nest matches in declaration order and the literal path must not be shadowed.
- Detach handling (kernel `TagRef` semantics, no S2S): todo-service stores exactly
  the `tagIds` each write carries — updates replace the set (and `todo_tag` rows
  cascade on todo delete); the BFF omits unresolvable ids when rendering.

### Push subscription endpoints (`push` module)

All owner-scoped, guarded by the auth guard `sub`. The `/api/push/*` family is distinct from
`/api/todos/*`; declare it so it never collides with a `:id`. `POST` binds to a decorated
DTO class (`PushSubscribeDto`, mirroring the shared `PushSubscribeInput`): the global
`ValidationPipe({ whitelist, transform, forbidNonWhitelisted })` cannot validate an erased
TypeScript interface.

- `GET /api/push/key` → `{ publicKey: string }` — the VAPID public key (config only, not the DB).
- `POST /api/push/subscribe { endpoint, keys: { p256dh, auth } }` → `{ ok: true }` — upsert
  scoped by `(sub, endpoint)` (a repeat subscription refreshes its keys rather than
  duplicating); a caller can never overwrite another owner's row.
- `DELETE /api/push/subscribe { endpoint }` → `{ ok: true }` — removes the caller's
  subscription (idempotent; unknown endpoint still 200).

### Reminder delivery (`reminders` module)

A bounded NestJS module `apps/todo-service/src/reminders/` (the only sender; no
`@nestjs/schedule`/`node-cron`):

- `ReminderService.sweep()` runs **one** system-side DB query
  (`SELECT r.* FROM todo r WHERE r.deletedAt IS NULL AND r.done = 0
  AND r.reminderScheduledAt IS NOT NULL AND r.reminderScheduledAt <= :nowIso`,
  lexicographic ISO compare, index-backed), builds `{ title, body, url: '/todos/<id>/edit' }`
  with the title decrypted in-request, sends via the injected `PushSender` to the owner's
  `push_subscription` rows, then calls the public `TodosService` seam `markReminded(sub, id)`
  which clears `reminderScheduledAt` and bumps the owner's generation counter after the
  write. The sweep never writes the todo table directly.
- `PushSender` interface: `send(sub, endpoint, payload) => Promise<{ endpoint; statusCode }>`;
  production wraps `web-push`, a test fake records calls. A `404`/`410` deletes **that**
  subscription and continues.
- Scheduling: `onModuleInit` registers `setInterval(() => void this.sweep(), 30_000)`;
  `onModuleDestroy` clears it; `sweep()` is public so tests call it without timers.
- **Fail-safe:** if `TODO_VAPID_PUBLIC_KEY`/`TODO_VAPID_PRIVATE_KEY` are unset, the module
  starts but `sweep()` is a no-op that logs once (dev/test never crash).
- **One ping per occurrence:** firing clears `reminderScheduledAt`; only a tick or an edit
  re-arms it (N3). The payload carries the decrypted title (decision: useful notification;
  transits the platform push service; never persisted).

## Cache Rules (AGENTS.md Contract 2)

- Cached shapes: serialized **ciphertext** todo rows (`todo:all` — the owner's full
  row set; **each row carries its `tagIds`** so the tag filter and counts serve from
  the hit), trash rows (`todo:trash` — the owner's soft-deleted rows serialized
  exactly as stored, each carrying its `deletedAt` and `tagIds`), list rows
  (`todo:lists`), and tag-usage rows (`todo:tags`, metadata-only:
  ids + counts, no ciphertext by design), and completion rows
  (`todo:completions` — `CachedCompletionRow { id, todoId, occurrence, completedAt }`,
  serialized rows as persisted; the log has **no content column**, so this shape carries
  **no `enc.v1.` assertion** — there is no content to guard). The cached todo rows also
  carry the
  plaintext `important: boolean | null` (non-content, alongside `done`) and the
  cached list rows carry `importantDefault: boolean | null` (`SPEC-todo-importance.md`);
  the cached todo rows also carry the plaintext `repeat: TodoRepeat | null`,
  `repeatDays: number[] | null`, and
  `reminderScheduledAt: string | null` (non-content, `SPEC-todo-due-repeat-notify.md`,
  `SPEC-todo-custom-repeat.md`);
  content columns (`title`/`note`/`name`) remain `enc.v1.`-only.
- Key composition `todo:<sub>:v<gen>:<rest>` — including `todo:<sub>:v<gen>:trash` and
  the completion log's `todo:<sub>:v<gen>:completions` (`TODO_COMPLETIONS` rest).
  `q`/`tagId`/`listId`/`done`/`important`/`due*`/cursor/limit never enter the key —
  `listId`, `important` (matched against `effectiveImportant`), and every other filter
  are applied in memory off `todo:all` after the hit; one entry serves every
  filter/page variant, one trash entry serves every trash cursor/limit variant, and one
  completions entry serves every completion `limit`/`cursor` variant.
- **Completions loader (Contract 2 Rule 1):** the DB is reached only through the loader
  inside `getThrough` —
  `SELECT * FROM todo_completion WHERE ownerSub = :sub ORDER BY completedAt DESC, id DESC`
  (index-backed by `IDX_todo_completion_owner_completed`). A malformed hit fails open to
  the loader. Per-owner isolation is the `<sub>` segment.
- Loader guards: the `todo:all` loader (and the `findOne`/`update`/`todo:tags`
  paths) apply `deletedAt IS NULL`, so a generation bump makes a trashed row vanish
  from the list; the `todo:trash` loader applies `deletedAt IS NOT NULL`.
- Per-owner generation counter bumped **after** every successful write — including
  the four trash writes (`remove` soft, `restore`, `removePermanent`, `emptyTrash`)
  on the same `todo:all` counter; every successful tick and un-complete (which add or
  remove completion rows) bumps the same counter; a list write that changes
  `importantDefault` bumps
  the same counter so every inheriting todo picks up the new default on its next read
  (computed, never denormalized); a failed mutation never bumps; 60s TTL backstop;
  fail-open on cache errors (direct loader); the fallback path never writes
  plaintext. Soft delete/restore bump the counter too (existing), keeping the
  completions join to the active-todo set consistent.
- Decrypt, filter, and paginate after every hit. The plaintext `important`/
  `importantDefault` booleans are the documented non-content exception (mirroring
  `done`); they are stored in the clear in SQL and Redis, while no content plaintext
  ever enters Redis. The cache suite's ciphertext assertions (content fields
  `enc.v1.`-only, no known plaintext) are unchanged and still fail on any content leak.
  `repeat`/`repeatDays`/`reminderScheduledAt` extend the same plaintext exception;
  `repeat`/`repeatDays`/`reminderScheduledAt` never enter the cache key.
- **`push_subscription` is outside the cache:** it is delivery capability, read directly
  (config + subscribe/unsubscribe writes), never a request-path read-through shape and
  never cached. `GET /api/push/key` reads config, not the DB.
- **Deviation — the reminder sweep reads the DB directly (recorded, per Contract 2 Rule 4):**
  the sweep is a system-side maintenance scan across owners, not a user request-path read.
  The per-owner read-through cache is stale/fail-open and cannot be the source of truth for
  time-triggered delivery, so the sweep queries the DB directly and is the one documented
  exception to "the DB sits behind the cache". It never serves a user read; its write
  (`markReminded` clearing a fired reminder) invalidates the owner's cache via the existing
  generation counter.

## Health

Per `SPEC-service-kernel`: `/health/live`, `/health/ready` (DB + key custody), and
the `/health` deprecated alias (readiness semantics).

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/todo-service
Build:     npm run build -w @life/todo-service
```

## Testing Strategy

1. Envelope round-trip: title/note unicode, empty note, large note; raw columns
   start `enc.v1.`; list names too.
2. AAD binding: swap two todos' title ciphertexts → both reads fail closed (ids-only
   log).
3. Search parity: `likeMatch` expectations generated by real SQLite `LIKE` bindings
   over title+note (empirical corpus, incl. user wildcards).
4. Ordering + filters + pagination: due-dated ASC/undated-last, done/`dueBefore`
   filters, cursor continuity (no dup/skip).
5. Lists: rename collision 409; delete detaches todos (they survive).
6. TagRefs: attach/detach by id, dangling-id replacement (a write replaces the
   set; no registry call), `[{tagId, count}]`.
7. Cache: content-bearing shapes (`todo:all`, `todo:lists`) assert `enc.v1.`-only
   serialized values — the `todo:tags` shape is ids+counts metadata by design and
   asserts no plaintext content (no names); gen-counter invalidation; fail-open.
8. Health routes; version/`expectedVersion` 409 semantics.
9. Soft delete / trash: a soft-deleted todo is absent from the list, `GET /:id`
   (404), and tag filters but present in `GET /api/todos/trash`; restore returns it
   with the same `createdAt`, tags, and `version`; permanent delete removes it (and
   its `todo_tag` rows) and 404s on a second call; `DELETE /api/todos/trash` empties
   the caller's trash and returns a `count`; trash/restore never bump `version`.
10. Due-time / recurrence / push: timezone math round-trips (fixed-offset and DST zones;
    date-only never converted); a timed due normalizes to a UTC instant and a date-only
    value survives verbatim; reminder = due instant (timed) / 09:00 national (date-only);
    a repeat without a due → 400; advance-on-tick steps strictly past the ticked occurrence
    then lands on the next occurrence on/after
    now (`daily`/`weekdays`/`monthly` clamp/`yearly` Feb 29) with `done:false`, version+1;
    `done:false` on a repeating todo deletes that occurrence's log row, restores the due and
    re-arms the reminder;
    the sweep fires once, clears `reminderScheduledAt`, re-arms only on tick/edit, and
    deletes a subscription on `404`/`410`; push endpoints reject a malformed body and
    scope by `(sub, endpoint)`; list order/cursor use the local `dueSortKey`.

## Boundaries

- Always: kernel contracts as written; content encrypted; cache values
  ciphertext-only.
- Ask first: adding fields beyond the I2 MVP plus the accepted due-time / recurrence
  chapter (recurrence, scheduled reminders, due time — `SPEC-todo-due-repeat-notify.md`);
  subtasks/priorities are still v2 and need their own intent; trash was moved out of this
  list by the user-authorised full soft-delete scope.
- Never: store tag names (M1); plaintext in cache or logs; SQL content matching over
  encrypted columns.

## Success Criteria

1. `apps/todo-service` boots with `TODO_MASTER_KEY`; all ten test groups green.
2. A todo created with tags + a list round-trips through cache and cold paths
   identically; a timed/repeating due and its `reminderScheduledAt` do too, with content
   still ciphertext-only, and list order/cursor keyed on the local `dueSortKey`.
3. A dated todo fires exactly one Web Push at its reminder instant; the sender is a
   bounded, replaceable module and `SPEC-todo-ui` can build `/todos` against these contracts.
