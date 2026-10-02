# Spec: todo-due-repeat-notify (time + recurrence + push reminders)

Module id: `todo-due-repeat-notify` (see `MAP-todo-ecosystem.md`). Backend capability of
`apps/todo-service` + UI of `apps/app`, plus **two bounded, replaceable new backend modules**
inside `todo-service`: `push` (Web Push subscription/key storage) and `reminders` (the
sweep + sender). No new process.

Traces to intent: `docs/intent/todo-due-repeat-notify.md` (locked decisions N1–N5).
Contracts: `AGENTS.md` Contract 1 (Shared UI) and Contract 2 (BE → cache → DB),
`SPEC-service-kernel.md`, `SPEC-todo-service.md`, `SPEC-todo-ui.md`.
Governing prior decisions read before writing (lesson 0012): `docs/intent/redis-shared-state.md`
decision 3, `docs/specs/MAP-redis.md`, `docs/specs/MAP-todo-ecosystem.md`, lesson 0003
(frontend dates), 0011 (per-service Redis), 0012 (cross-chapter invariants), 0014 (visible
labels / page chrome), 0015 (size the process).

## Objective

A todo's `dueDate` becomes optionally **timed** and optionally **repeating**, and a dated
todo can deliver a **Web Push reminder to the user's iPhone** even when the app is closed.
The todo row remains the single source of the "this wants attention at <instant>" letter the
future centralized postman will read. Todo owns the sender for now, as two **separate bounded
modules** — `push` (subscription/key storage) and `reminders` (the sweep/sender) — so the
future postman replaces them rather than extracting them from the todo write
path (lesson 0012).

## Data model

Columns added to `SPEC-todo-service.md`'s existing `todo` table (SQLite; `synchronize: true` —
there is no migration framework, so new columns are additive and non-destructive):

```
todo(
  ...
  dueDate              TEXT NULL,   -- 'YYYY-MM-DD' (date-only) OR canonical UTC instant '…Z' (timed)
  repeat               TEXT NULL,   -- null | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
  reminderScheduledAt  TEXT NULL,   -- canonical UTC instant of the current occurrence's reminder; null = no reminder
  ...
)

push_subscription(
  id         TEXT PRIMARY KEY,      -- service-generated UUID v4
  ownerSub   TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,  -- push service URL (Web Push endpoint)
  p256dh     TEXT NOT NULL,         -- subscription public key (base64url)
  auth       TEXT NOT NULL,         -- subscription auth secret (base64url)
  createdAt  DATETIME NOT NULL
)
```

- `dueDate` keeps its single-column shape. A **date-only** value stays the naive
  `YYYY-MM-DD` and never round-trips through `Date` (lesson 0003 unchanged). A **timed**
  value is a canonical UTC instant (`YYYY-MM-DDTHH:mm:ss.sssZ`). The entity
  (`apps/todo-service/src/todos/todo.entity.ts`) changes `dueDate` from `type: 'date'` to
  `type: 'text'` (SQLite stores the ISO text) and gains the `repeat`/`reminderScheduledAt`
  text columns; `synchronize: true` applies the additive change (no migration framework).
- `repeat` is a **plaintext, non-content enum** (like `done`/`important`/`dueDate`) — no
  `@life/crypto` envelope, no AAD. It carries no user text.
- `reminderScheduledAt` is a plaintext instant — non-content, like `dueDate`. It **is** the
  lasting reminder record ("the letter"); no separate notification table is introduced.
- `push_subscription` stores **delivery capability only** (endpoint + keys). It carries no
  user content; no encryption envelope, but it is owner-scoped and never returned in any
  todo response.
- Index `IDX_todo_reminder_scheduled_at` on `reminderScheduledAt` (the sweep predicate).
- `CachedTodoRow` (and `toCachedTodoRow` / `decodeCachedTodoRow`) gain `repeat` and
  `reminderScheduledAt` verbatim; the ciphertext guards (`isCiphertextTodoRow*`) are
  unchanged and still fail closed on any content plaintext.

## Timezone model (N1 — the load-bearing decision)

The client submits **local wall-clock**; the process interprets it in its configured
**national** zone and stores the canonical UTC instant (user: "the user defines the local
time, but the process should store time that is national"). One timezone owner: the service.

- Service env `TODO_TIMEZONE` (IANA name, default `Asia/Ho_Chi_Minh`) is the national zone.
  The service is the only party that maps local ⇄ canonical. `TodosService` reads
  `process.env.TODO_TIMEZONE` **once at construction** into a `private readonly tz` field and
  passes it to every helper (`normalizeDue`, `reminderAt`, `dueSortKey`, the advance path) —
  one owner for the zone lookup, never sourced at two call sites (lesson 0016). `TODO_TIMEZONE`,
  `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_PRIVATE_KEY`, and the VAPID subject/contact var are
  documented in `.env.example` / `.env.development.example` and wired into `compose.yaml`'s
  `todo-service` environment; Redis keys remain compose-injected only (never in the env files).
- **Timed due, request:** `dueDate = 'YYYY-MM-DDTHH:mm'` (the browser `datetime-local`
  value, no zone). The service converts local → UTC in `TODO_TIMEZONE` and stores the
  instant.
- **Date-only due, request/read:** `dueDate = 'YYYY-MM-DD'`, stored verbatim.
- **Read:** date-only → `YYYY-MM-DD`; timed → the UTC instant.
- **Display:** the client renders the returned value in the **browser's** zone (the user's
  "follow the client's timezone"); for the single-zone user this equals `TODO_TIMEZONE`.
- **Reminder instant (server-computed):** timed → the due instant itself; date-only →
  `dueDate` at **09:00** in `TODO_TIMEZONE` (N5).
- **Recurrence** advances the **local** calendar in `TODO_TIMEZONE`, then re-derives the
  canonical instant.

Conversion contract (pure, unit-testable, no new dependency — `Intl.DateTimeFormat` only):

```
zoneOffsetMs(instant: Date, tz: string): number   // local(instant) treated as UTC minus instant
localToUtc(local: 'YYYY-MM-DDTHH:mm', tz): Date   // two-pass offset resolve (handles DST zones)
utcToLocal(instant: Date, tz): { y, m, d, hh, mm } // calendar parts in tz
```

Edge cases: a date-only due is **never** converted (stays naive). A DST-zone `TODO_TIMEZONE`
is correct via the two-pass resolve; the user's zone is fixed-offset. `TODO_TIMEZONE` and the
deployment `TZ` should match so SSR "today" agrees with storage.

## Behavior / API (kernel contracts apply)

Wire types live in `@life/shared` (the `Todo` precedent); the app consumes, never
re-declares. Optionality splits by direction: **request** fields optional, **read** fields
required-but-nullable.

### Todo fields

| Field | Type (shared) | Create | Update |
|---|---|---|---|
| `dueDate` | `string \| null` | optional; omitted/`null` ⇒ no due; a date-only or local-timed string is normalized (timed → instant) | optional; omitted ⇒ unchanged; `null` ⇒ clears the due **and** the reminder |
| `repeat` | `TodoRepeat \| null` | optional; omitted/`null` ⇒ none | optional; omitted ⇒ unchanged; `null` ⇒ clears the repeat |
| `reminderScheduledAt` (read only) | `string \| null` | — | — (server-computed) |

- `export const TODO_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;`
  and `export type TodoRepeat = (typeof TODO_REPEATS)[number];` (the array is the single source;
  the DTO validates with `@IsIn(TODO_REPEATS)`).
- Read DTO `Todo` gains `repeat: TodoRepeat | null` and
  `reminderScheduledAt: string | null` (the exact stored instant). Both are present on
  every todo read (`POST`, `GET /api/todos`, `GET /api/todos/:id`, `PATCH`, `POST /:id/restore`).
- Validation: `repeat` is `@IsOptional() @ValidateIf(v => v !== null) @IsIn(TODO_REPEATS)`;
  `dueDate` is `@IsOptional() @ValidateIf(v => v !== null) @Matches(ISO_DUE)` where
  `ISO_DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/` on the **request** (the service then
  normalizes a timed request to an instant). The existing `@MaxLength(10)` on `dueDate` is
  dropped (or raised to 16) in **both** `create-todo.dto.ts` and `update-todo.dto.ts`: a timed
  value `YYYY-MM-DDTHH:mm` is 16 chars and the cap would reject it before `@Matches(ISO_DUE)`
  is reached. Read values are always `DATE_ONLY` or `UTC_INSTANT`.
- **A repeat requires a due date.** Create/update with `repeat != null` and no resulting
  `dueDate` → 400 (`BadRequestException('repeat requires a dueDate')`).
- **Reminder rule:** any todo with a `dueDate` gets a reminder (timed → the instant;
  date-only → 09:00 national). No due ⇒ `reminderScheduledAt = null`. A **done** todo keeps
  its stored reminder until ticked/cleared; the sweep skips `done` rows.

### Recurrence advance (advance-on-tick, N2/N3 — no scheduler)

On `PATCH /api/todos/:id { done: true }` **where the todo has `repeat`**, the service does
**not** mark it done. It advances the todo to its **next occurrence on/after "now"**, clears
`done`, recomputes `reminderScheduledAt`, and returns the advanced row:

1. Compute the next occurrence in `TODO_TIMEZONE` local calendar from the current due:
   - `daily`: +1 day.
   - `weekdays`: next Mon–Fri (Fri → +3d, Sat → +2d, Sun → +1d).
   - `weekly`: +7 days (same weekday).
   - `monthly`: +1 month, same day-of-month, clamped to the month's last day (31 → 28/29/30).
   - `yearly`: +1 year, same month/day, Feb 29 clamped to Feb 28.
2. While the candidate is **before "now"**, apply the rule again (a daily missed for a week
   jumps clean to the next occurrence, never replaying missed days).
3. Re-derive the canonical instant for a timed due; advance the date string for a date-only
   due.
4. `reminderScheduledAt` = the new occurrence's reminder (timed → candidate instant; date-only
   → candidate at 09:00 national).
5. `done` stays `false`; `version` bumps once; the generation counter bumps after the write.

- A **non-recurring** todo's `done: true` is unchanged (marks done; row hides via the UI).
- Ticking a recurring todo is an advance, not a completion — the row **does not** hide and
  no undo snackbar is shown (UI section).
- Trash/restore semantics are unchanged; a recurring todo with a past occurrence and no tick
  simply stays **overdue** until ticked, with its stored reminder already fired (N3).

### Push subscription endpoints

All owner-scoped, guarded (auth guard `sub`). Declared before no `:id` collision; the
`/api/push/*` family is distinct from `/api/todos/*`.

- `GET /api/push/key` → `{ publicKey: string }` — the VAPID public key (application server
  key the browser needs to subscribe). Config only.
- `POST /api/push/subscribe { endpoint, keys: { p256dh, auth } }` → `{ ok: true }` —
  upsert by `endpoint` for the caller's `sub` (a repeat subscription for the same endpoint
  refreshes its keys rather than duplicating).
- `DELETE /api/push/subscribe { endpoint }` → `{ ok: true }` — removes the caller's
  subscription (idempotent; unknown endpoint still 200).

### Reminder delivery (the `reminders` module)

A bounded NestJS module `apps/todo-service/src/reminders/`:

- `ReminderService.sweep()` — **one** system-side DB query:
  `SELECT r.* FROM todo r WHERE r.deletedAt IS NULL AND r.done = 0
   AND r.reminderScheduledAt IS NOT NULL AND r.reminderScheduledAt <= :nowIso`
  (lexicographic ISO compare; index-backed). For each due row: build the payload
  `{ title, body, url: '/todos/<id>/edit' }` (title decrypted in-request), send to the owner's
  `push_subscription` rows via the injected `PushSender`, then call the public `TodosService`
  seam `markReminded(sub, id)`, which clears `reminderScheduledAt` and bumps the owner's
  generation counter after the write. The sweep never writes the todo table directly.
- `PushSender` interface: `send(sub, payload) => Promise<{ statusCode: number }>`. Production
  implementation wraps the `web-push` package; a **test fake** records calls. A `404`/`410`
  from the push service deletes that subscription (expired) and continues.
- Scheduling: `onModuleInit` registers `setInterval(() => void this.sweep(), 30_000)`;
  `onModuleDestroy` clears it. **No `@nestjs/schedule` / `node-cron`** dependency
  (`ponytail:` a single `setInterval` is the whole need). `sweep()` is public so tests call it
  directly without timers.
- **Fail-safe:** if `TODO_VAPID_PUBLIC_KEY`/`TODO_VAPID_PRIVATE_KEY` are unset, the module
  starts but `sweep()` is a no-op that logs once — dev/test never crash on missing keys.
- **One ping per occurrence:** firing clears `reminderScheduledAt`; only a tick (which
  reschedules) or an edit re-arms it (N3).
- **Payload privacy (decision):** the payload carries the decrypted title so the
  notification is useful; it transits the platform push service (Apple). Recorded as a
  deliberate decision; if the user later wants opaque payloads, the upgrade path is a
  generic body + an authenticated in-app fetch. The payload is never persisted.

## Cache Rules (AGENTS.md Contract 2 Rule 4)

- **Cached shapes (updated):** the serialized todo rows under `todo:all` / `todo:trash` gain
  the plaintext `repeat: TodoRepeat | null` and `reminderScheduledAt: string | null`
  alongside the already-plaintext `dueDate`/`done`/`important`. `CachedTodoRow`,
  `toCachedTodoRow`, `decodeCachedTodoRow` carry them verbatim; nothing else changes.
- **Content stays ciphertext:** `title`/`note`/`list.name` remain `enc.v1.`-only in SQL and
  Redis; the new fields are non-content and are the documented plaintext exception
  (mirroring `dueDate`/`done`). The cache suite's ciphertext assertions are unchanged and
  still fail closed on any content leak.
- **Key shape unchanged:** `todo:<sub>:v<gen>:<rest>`; `repeat`/`reminderScheduledAt` are
  row data, never key components; no new cache shape for push.
- **Invalidation unchanged:** the per-owner generation counter bumps **after** every
  successful todo write (create/update/tick-advance/delete/restore) and after the sweep
  clears fired reminders. A failed mutation never bumps. 60s TTL backstop; fail-open.
- **`push_subscription` is outside the cache:** it is delivery capability, read directly
  (config + subscribe/unsubscribe writes), never a request-path read-through shape and never
  cached. `GET /api/push/key` reads config, not the DB.
- **Deviation — the reminder sweep reads the DB directly (recorded, per Contract 2 Rule 4):**
  the sweep is a **system-side maintenance scan** across owners, not a user request-path
  read. The read-through cache is per-owner and may be stale/fail-open, so it cannot be the
  source of truth for time-triggered delivery. The sweep therefore queries the DB directly
  and is the one documented exception to "the DB sits behind the cache"; it never serves a
  user read, and its write (clearing a fired reminder) invalidates the owner's cache.

## Consumer surfaces (UI — Contract 1, `SPEC-todo-ui.md`)

All composition is from `@life/ui`; no raw HTML, tokens only. New visible labels must match
sibling fields (lesson 0014).

- **Editor (`apps/app/app/todo-editor.tsx`):**
  - `PillGroup label="Due"` keeps the frozen `Input type="date"` (`aria-label="Due date"`).
  - New `PillGroup label="Time"` wraps an `Input type="time"` (`aria-label="Due time"`) —
    empty ⇒ date-only; present ⇒ timed. The editor joins them into
    `dueDate = 'YYYY-MM-DDTHH:mm'` (or the date alone) for the write; the service normalizes.
  - New `PillGroup label="Repeat"` composed of `Pill as="button" size="chip"` options
    (`None`/`Daily`/`Weekly`/`Monthly`/`Yearly`/`Weekdays`) — **reuses the existing `Pill`
    + `PillGroup` primitives; no new upstream atom.** `None` ⇒ `repeat: null`. The option
    labels come from the app-owned `repeatLabel(repeat)` helper
    (`apps/app/lib/todo-repeat-label.ts`) — `@life/ui` has no `@life/shared` dependency, so the
    label mapping stays in the app.
  - A repeat with no due shows the field but the save is **blocked** until a due date exists
    (mirroring the service's 400); there is no implicit/auto due date — the editor surfaces the
    server error by staying open.
- **Row (`apps/app/app/todo-item.tsx`):** the due read-out (`DueDate`) renders the time via
  the shared formatter when timed; a repeat todo shows `repeatLabel(todo.repeat)` in the row
  meta.
  Ticking a `repeat` todo must **not** hide/collapse the row (it advances instead) — the
  `DoneToggle` `hide`/`collapsing` behavior is gated on `!todo.repeat`.
- **`@life/ui` formatter (lesson 0003 — one helper owns date formatting):**
  - New low-level `packages/ui/src/lib/date-parts.ts` owns `todayIso`, `dueDay(value)` → the
    **local calendar day** `YYYY-MM-DD` from either a date-only string (read the parts directly
    — no `Date`) or a UTC instant (local parts via `Date`), and the leading-date `datePart`
    helper. `format-date.ts` and `due-date-pill.tsx` both import from it (this breaks the
    existing `format-date → due-date-pill` import cycle); `due-date-pill.tsx` **re-exports**
    `todayIso` (`export { todayIso } from '../lib/date-parts';`) so its existing consumers —
    `due-date.tsx` (imports `dueDateState` + `todayIso`) and `packages/ui/test/format-date.test.ts`
    (imports `todayIso` from `../src/components/due-date-pill`) — keep working unchanged
    (`due-date.tsx` stays out of scope); `index.ts` keeps re-exporting `todayIso` **and `dueDay`**
    from the new module so the public surface is preserved. `dueDay` is used by
    `dueDateState`, `dueDateLabel`, and matrix `isUrgent`; grouping consumes it transitively
    (`groupTodos` → `dueDateState` → `dueDay`, `apps/app/lib/todo-groups.ts` stays out of scope).
  - `dueDateLabel(value, today?)` → `Today`/`Tomorrow`/`dd/mm/yyyy` for date-only (unchanged)
    and `Today HH:mm` / `Tomorrow HH:mm` / `dd/mm/yyyy HH:mm` for a timed value.
  - Row state stays **day-granular** (a timed todo due earlier today still reads `Today` and
    groups in `Today`; the reminder is the time-precise signal). Recorded decision: matches
    TickTick and keeps grouping stable.
- **Settings (`apps/app/app/todos/settings/page.tsx`):** a new `SettingsBlock title="Reminders"`
  with `SettingsRow label="Push reminders"` and a client `PushToggle`:
  - The toggle renders client defaults (`supported=false`, `installed=false`,
    `permission='default'`) and reads `navigator` / `Notification.permission` in a `useEffect`;
    browser values are **not** server-seeded (avoids a hydration mismatch).
  - Unsupported browser → explanatory text, no control.
  - iPhone not installed to Home Screen (`!navigator.standalone`) → guidance to add the app
    to the Home Screen (iOS Web Push requires it).
  - Otherwise a `Switch` that requests `Notification` permission, registers
    `apps/app/public/sw.js`, subscribes via `pushManager.subscribe`, and calls a server
    action that upserts the subscription; disabling unsubscribes and calls the delete action.
    The VAPID public key is read through the `getPushKeyAction` server action (the client never
    imports the server-only `lib/todo-api.ts`).
- **Service worker:** new static `apps/app/public/sw.js` handles `push` (→
  `showNotification` with title/body, `data.url`, icon/badge `icon-todos.png`) and
  `notificationclick` (focus an existing `/todos` window, else `openWindow(data.url)`, where
  `data.url = '/todos/<id>/edit'`). No
  bundler, no `next-pwa`.
- **Frozen e2e surface (additions to the recorded surface in `SPEC-todo-ui.md`):** new
  accessible names `Due time`, `Time`, `Repeat`, `Reminders`, `Push reminders`; new roles
  (`getByRole('button', { name: 'Weekly' })`, the push `switch`). **No existing name/role/
  aria-label changes** (`Due`, `Due date`, `List`, `Important`, `Save todo`, `Add todo`,
  `Mark … done`, `Delete …`, `Trash`, `Manage tags`, `Manage lists` all stay). Recorded as
  surface additions, gated at review per AGENTS.md frozen-surface rule.

## Commands

```
Precondition: npm run build -w @life/shared   # consumers resolve "types": "dist/index.d.ts";
                                              # typecheck never emits dist — build once first
Typecheck: npm run typecheck -w @life/shared && npm run typecheck -w @life/todo-service
           npm run typecheck -w @life/ui && npm run typecheck -w @life/app
Test:      npm run test:unit -w @life/todo-service -- test/todos-due-repeat.e2e-spec.ts
           npm run test:unit -w @life/todo-service -- test/reminders.e2e-spec.ts
           npm run test:unit -w @life/todo-service -- test/push.e2e-spec.ts
           npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts test/ownership.e2e-spec.ts
           npm run test:unit -w @life/ui -- test/format-date.test.ts
           npm run test:unit -w @life/app  -- test/todo-item.test.tsx test/push-toggle.test.tsx
Build:     npm run build -w @life/shared && npm run build -w @life/todo-service
```

The `npm run build -w @life/shared` precondition is stated here once and referenced by T4–T8
in the plan/ledger; every `npm run typecheck -w @life/todo-service` runs after it.

## Testing Strategy

1. **Timezone math (pure):** `localToUtc`/`utcToLocal` round-trip for `Asia/Ho_Chi_Minh`
   (fixed offset) and `America/New_York` pinned to actual transition instants (local
   `2026-03-08T02:30` spring-forward and local `2026-11-01T01:30` fall-back); a date-only value
   is never converted.
2. **Due round-trip:** create with `dueDate:'2026-10-02T09:00'` + `repeat:'weekly'` → read
   returns the UTC instant + `repeat:'weekly'` + a non-null `reminderScheduledAt`; date-only
   create keeps `'YYYY-MM-DD'` and reminder = 09:00 national.
3. **Advance-on-tick:** `daily` missed 5 days, ticked today → next occurrence on/after now,
   `done:false`, version+1; `weekdays` from Fri → Mon; `monthly` on the 31st clamps in a
   30-day month; `yearly` Feb 29 → Feb 28; non-recurring `done:true` is unchanged.
4. **Repeat requires a due:** create/update `repeat` with no `dueDate` → 400.
5. **Reminder rule:** timed → reminder == due instant; date-only → 09:00 national; clearing
   the due clears the reminder; a done todo keeps its stored reminder until ticked/cleared.
6. **Sweep:** a due row fires once, calls the fake `PushSender` once, clears
   `reminderScheduledAt`, and re-arms only after an edit/tick; a `404`/`410` deletes that
   subscription; no VAPID env ⇒ no-op.
7. **Push endpoints:** key returned; subscribe upserts by endpoint (no duplicate row);
   delete idempotent; another `sub` cannot read/affect the caller's subscriptions.
8. **Cache:** `todo:all`/`todo:trash` values carry `repeat`/`reminderScheduledAt`; content
   fields remain `enc.v1.`-only; generation bumps on write and on sweep-clear; the direct-DB
   sweep deviation is asserted — a `sweep()` call performs **zero** read-through
   (`getThrough`) reads, and only the `markReminded` generation bump touches the cache.
9. **UI:** the editor payload joins date+time and carries `repeat`; the row renders the time
   and repeat label; a recurring tick does not hide the row; the settings push toggle
   branches (unsupported / not-installed / subscribe); mechanical Contract 1 checks green.
10. **Existing-suite reconciliation:** `todos.e2e-spec.ts`'s `Object.keys(created.body).sort()`
    list and `ownership.e2e-spec.ts`'s `todoKeys` (asserted twice) gain `repeat` and
    `reminderScheduledAt`; the five existing app fixtures (`todo-groups.test.ts`,
    `todo-query.test.ts`, `routes-todos-list.test.tsx`, `routes-matrix.test.tsx`,
    `routes-todos-trash.test.tsx`) add `repeat: null`/`reminderScheduledAt: null` to their
    `todo(...)` helpers so `npm run typecheck -w @life/app` compiles.

## Boundaries

- Always: content columns encrypted; cache values ciphertext-only for content; a repeat
  requires a due; the client submits local, the service stores canonical; UI from `@life/ui`.
- Ask first: any change to an existing frozen selector/name; any new upstream visual
  primitive (this spec reuses `PillGroup`/`Pill`/`Switch`); a custom per-todo reminder time
  (this spec uses the fixed due-time / 09:00 rule).
- Never: store tag/title/note plaintext in Redis or logs; put `repeat`/`reminderScheduledAt`
  in the cache key; add a second notification service (the bounded todo `reminders` module is
  the only sender); merge to `master` without the user's explicit request.

## Success Criteria

1. A todo can carry a date-only or timed due plus a repeat rule; all three round-trip
   through `redis-todo` as plaintext metadata with content still ciphertext-only.
2. `TODO_TIMEZONE` local input is normalized to a canonical UTC instant; the user's local
   display matches what they typed; the date-only path never round-trips through `Date`
   (lesson 0003 intact).
3. Ticking a repeat advances it to the next occurrence on/after "now" and keeps it open;
   an unticked occurrence stays overdue with no further pings (TickTick, N3).
4. A dated todo fires exactly one Web Push to the user's iPhone at its due instant (timed)
   or 09:00 national (date-only), even when the app is closed; tapping opens the todo at
   `/todos/<id>/edit`.
5. The reminder is a lasting, server-owned row field (`reminderScheduledAt`) the future
   postman can read; the sender is a bounded, replaceable module (lesson 0012).
6. `SPEC-todo-service.md`, `SPEC-todo-ui.md`, `MAP-todo-ecosystem.md`, and `MAP-redis.md`
   are updated in the same chapter; Contract 1 mechanical checks and Contract 2 cache review
   are green.
