# Implementation Plan: todo-due-repeat-notify (due time + recurrence + Web Push reminders)

Branch: `feat/todo-due-repeat-notify` (`master` stays untouched; never merged without the
user's explicit request). Module id: `todo-due-repeat-notify` (see `MAP-todo-ecosystem.md`).
Spec (owner, referenced by every task): `docs/specs/SPEC-todo-due-repeat-notify.md`.
Specs/maps amended in this chapter: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
`docs/specs/MAP-todo-ecosystem.md`, `docs/specs/MAP-redis.md`.
Ledger: `tasks/todo-todo-due-repeat-notify.md`.
Governing intent: `docs/intent/todo-due-repeat-notify.md` (N1–N5).
Prior decisions read before planning (lesson 0012): `docs/intent/redis-shared-state.md` dec. 3,
`docs/specs/MAP-redis.md`, `docs/specs/MAP-todo-ecosystem.md`, lessons 0003/0011/0012/0014/0015.

Process: global protocol §3 (testing policy), §5 (mandatory task template), §6 (plan-validation
gate), §7 (review), §7.6 (five-lane for feature work). Every task is in §5 template form.
Test runs are targeted, named files only, max 2 executions; no full suite, no E2E. The five-lane
gate (T13) is five parallel subagent lanes, not a shell command.

## Overview

A todo's `dueDate` becomes optionally **timed** and optionally **repeating**, and a dated todo
can deliver a **Web Push reminder to the user's iPhone** even when the app is closed. The client
submits local wall-clock; the todo-service interprets it in its configured national zone
(`TODO_TIMEZONE`, default `Asia/Ho_Chi_Minh`), stores a canonical UTC instant, and owns
recurrence + reminder timing. Todo owns the push sender for now as a **bounded `reminders`
module** (plus a `push` subscription module), so the future central postman replaces it rather
than extracting it from the todo write path.

## Architecture Decisions

- D1: **Timezone model** — client submits local; service (`TODO_TIMEZONE`) maps local ⇄ canonical
  UTC instant. Date-only values stay naive `YYYY-MM-DD` and never round-trip through `Date`
  (lesson 0003 intact). One conversion owner, pure `Intl.DateTimeFormat` math (no new dep).
- D2: **Storage** — `todo.dueDate TEXT NULL` holds either `YYYY-MM-DD` (date-only) or a canonical
  `…Z` instant (timed). New plaintext metadata columns `repeat TEXT NULL` and
  `reminderScheduledAt TEXT NULL`. These are non-content (mirror `dueDate`/`done`): no envelope.
- D3: **Ordering key** — `dueSortKey(value, tz)`: null→`~`, date-only→its date, timed→its **local**
  `YYYY-MM-DDTHH:mm`. `compareTodos` and the cursor use this key, so a timed due sorts by the
  user's local day, not the UTC day. `repeat`/`reminderScheduledAt` never enter the key.
- D4: **Recurrence** — anchored on the due date; `daily | weekdays | weekly | monthly | yearly`.
  A repeat **requires** a due date (400 otherwise). `PATCH {done:true}` on a recurring todo
  **advances** to the next occurrence on/after "now", clears `done`, reschedules the reminder,
  bumps `version` once — no scheduler, no history (N2/N3).
- D5: **Reminder record** — `reminderScheduledAt` (server-computed): timed→the due instant,
  date-only→09:00 national (N5); no due→null. It is the lasting letter the future postman reads.
  Firing sets it to null; only a tick or an edit re-arms it.
- D6: **Sender is bounded and replaceable** — a `reminders` module with an injectable
  `PushSender` interface (production adapter wraps `web-push`; tests use a fake). `sweep()` is a
  plain `setInterval` (no `@nestjs/schedule`/`node-cron` dependency) and is callable directly.
- D7: **Sweep reads the DB directly — recorded Contract 2 deviation** — time-triggered delivery
  is system-side and per-owner cache state is stale/fail-open, so the sweep is the one documented
  exception to "DB behind cache"; it serves no user read and invalidates the owner's cache after
  clearing a fired reminder.
- D8: **Push subscription** — `push_subscription(endpoint UNIQUE, p256dh, auth, ownerSub)` stores
  delivery capability only, outside the cache; `GET /api/push/key`, `POST/DELETE /api/push/subscribe`.
- D9: **Payload privacy (deliberate)** — the push payload carries the decrypted title and transits
  Apple's push service; recorded decision; never persisted; upgrade path = generic body + in-app
  fetch. `@life/crypto` still owns all at-rest content.
- D10: **UI reuses existing primitives** — time is `Input type="time"`; repeat is `PillGroup`+`Pill`;
  push is `Switch`; the settings row is `SettingsRow`/`SettingsBlock`. No new upstream atom. SW is
  a static `public/sw.js` (no bundler). Date formatting keeps one owner (`@life/ui`).
- D11: **One new dependency** — `web-push` in `apps/todo-service` (VAPID + encryption). It is the
  standard sender; the alternative (hand-rolled VAPID with `jose`+`fetch`) is more code and more
  risk. Flagged as the only new dependency.

## Task List

### Phase 1 — Spec (spec-first)
- [ ] T1: amend `SPEC-todo-service.md` + `SPEC-todo-ui.md` to the due/repeat/push contract.

### Checkpoint: Spec
- [ ] `grep -n "reminderScheduledAt" docs/specs/SPEC-todo-service.md` non-empty.
- [ ] `grep -n "Due time" docs/specs/SPEC-todo-ui.md` non-empty.

### Phase 2 — Shared + UI date model
- [ ] T2: `@life/shared` wire types (`TodoRepeat`, `repeat`, `reminderScheduledAt`, push input).
- [ ] T3: `@life/ui` date helpers (`dueDay`, timed `dueDateLabel`, day-granular `dueDateState`).

### Checkpoint: Shared + UI
- [ ] `npm run typecheck -w @life/shared` exits 0.
- [ ] `npm run typecheck -w @life/ui` exits 0.
- [ ] `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx` green.

### Phase 3 — Timezone + recurrence core
- [ ] T4: `due-time.ts` (local ⇄ UTC, sort key) + `recurrence.ts` (advance) with unit tests.

### Checkpoint: Core math
- [ ] `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts` green.

### Phase 4 — Todo service
- [ ] T5: due normalization + repeat validation + reminder computation + advance-on-tick +
      entity columns/index + DTOs + `CachedTodoRow` + `markReminded` seam.

### Checkpoint: Service
- [ ] `npm run typecheck -w @life/todo-service` exits 0.

### Phase 5 — Push + reminders modules
- [ ] T6: `push` subscription module (entity + service + controller + module + registration).
- [ ] T7: `reminders` module (sweep + `PushSender` web-push adapter + `web-push` dep +
      registration).

### Checkpoint: Modules
- [ ] `npm run typecheck -w @life/todo-service` exits 0.
- [ ] `npm run build -w @life/todo-service` exits 0.

### Phase 6 — Backend tests
- [ ] T8: due/repeat/reminder/advance behavior suite + reminders sweep suite + cache additions.

### Checkpoint: Backend tests
- [ ] `npm run test:unit -w @life/todo-service -- test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/push.e2e-spec.ts test/todo-cache.e2e-spec.ts` green.

### Phase 7 — BFF
- [ ] T9: push key/subscribe/unsubscribe client + server actions + `push-client.ts`.

### Checkpoint: BFF
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/app` exit 0.

### Phase 8 — App UI
- [ ] T10: editor time + repeat fields; row time/repeat display; recurring tick does not hide;
      matrix `isUrgent` timed-safe.
- [ ] T11: settings "Reminders" block + `PushToggle` + static `sw.js`.

### Checkpoint: App UI
- [ ] `npm run typecheck -w @life/app` exits 0.
- [ ] `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts` green.
- [ ] Contract 1 mechanical greps clean.

### Phase 9 — Close
- [ ] T12: app UI regression tests + mechanical-check pass.
- [ ] T13: five-lane verification gate (§7.6) on the final state; user reviews in dev.

## Tasks in §5 template form

### T1 — Spec amendments (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Record the due-time / recurrence / push-reminder contract in `SPEC-todo-service.md` and
  `SPEC-todo-ui.md` before any code changes.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
    `docs/specs/MAP-todo-ecosystem.md`, `docs/specs/MAP-redis.md`.
  - Reference files (read-only): `docs/specs/SPEC-todo-due-repeat-notify.md` (the module spec),
    `docs/intent/todo-due-repeat-notify.md`, `docs/intent/redis-shared-state.md` (decision 3).
  - Strictly prohibited files: every file not listed above (no code, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - SPEC-todo-service.md data model: extend the `todo(...)` block with
    `repeat TEXT NULL` and `reminderScheduledAt TEXT NULL`; note `dueDate` now holds either
    `YYYY-MM-DD` or a canonical `…Z` instant; add the `push_subscription` table; record the
    `IDX_todo_reminder_scheduled_at` index and the entity column changes (T5 owns the entity).
  - SPEC-todo-service.md Behavior/API: add the `repeat`/`reminderScheduledAt` fields to the DTO
    contract; add the due-time normalization + `repeat requires dueDate` rule; add the
    advance-on-tick rule; add the `/api/push/key`, `/api/push/subscribe` (POST/DELETE) routes.
  - SPEC-todo-service.md Cache Rules (Contract 2 Rule 4): add `repeat`/`reminderScheduledAt` to
    the cached row shapes; state `push_subscription` is outside the cache; record the sweep's
    direct-DB deviation verbatim from the module spec.
  - SPEC-todo-service.md Health/Testing/Boundaries/Success: add the new testing group; move
    recurrence out of the "Ask first (v2)" list.
  - SPEC-todo-ui.md `/todos` bullet + UI contract: add the editor `Time`/`Repeat` fields, the row
    time/repeat display, the no-hide-on-recurring-tick rule, the settings `Reminders` block +
    `PushToggle` + `sw.js`, and the frozen-surface additions (new names only).
  - MAP-todo-ecosystem.md: the `todo-due-repeat-notify` module row already exists — reconcile its
    responsibility text with this spec; no new module. MAP-redis.md: record that `redis-todo`
    ownership is unchanged (the sweep still invalidates via the existing generation counter; no
    new Redis instance or module).
  - No spec text may claim a second notification service, a scheduler dependency, or occurrence
    history.

[VERIFICATION & TESTING RULES]
  - Permitted test command: none. This is a docs task; no test execution.
  - Verification: `grep -n "reminderScheduledAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "Due time" docs/specs/SPEC-todo-ui.md` are both non-empty.
  - Strict constraints: NO full suites, NO E2E; typecheck not required (docs only); max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] Code meets all implementation requirements.
  - [ ] No files outside the allowed scope were modified.
  - [ ] Both grep verifications return non-empty.
  - [ ] MAP-todo-ecosystem row reconciled; MAP-redis records `redis-todo` ownership unchanged.
  - [ ] No placeholder or contradictory "v2/deferred recurrence" text remains.

### T2 — Shared wire types (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Add the `TodoRepeat` type and the `repeat`/`reminderScheduledAt` wire fields, plus the push
  subscription input type, to `@life/shared`.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/shared/src/index.ts`.
  - Reference files (read-only): `packages/shared/src/index.ts` (the `Todo`/`List` precedent),
    `apps/todo-service/src/todos/dto/create-todo.dto.ts`,
    `apps/todo-service/src/todos/dto/update-todo.dto.ts`.
  - Strictly prohibited files: every file not listed above (no service, no entity, no UI).

[IMPLEMENTATION REQUIREMENTS]
  - Export `export const TODO_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;`
    and `export type TodoRepeat = (typeof TODO_REPEATS)[number];`.
  - `interface Todo`: add `repeat: TodoRepeat | null;` and `reminderScheduledAt: string | null;`
    (required-but-nullable, like `deletedAt`/`important`).
  - `interface CreateTodoInput`: add `repeat?: TodoRepeat | null;` (optional).
  - `interface UpdateTodoInput`: add `repeat?: TodoRepeat | null;` (optional; `null` clears).
  - Add `export interface PushSubscribeInput { endpoint: string; keys: { p256dh: string; auth: string } }`.
  - No other signature changes.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/shared`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `TODO_REPEATS`, `TodoRepeat`, the three `repeat` fields, `reminderScheduledAt`, and
        `PushSubscribeInput` exist exactly as specified.
  - [ ] `npm run typecheck -w @life/shared` passes with zero errors.
  - [ ] No files outside the allowed scope were modified.

### T3 — UI date helpers (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Make one `@life/ui` helper own the local day and the timed/date label, so grouping, state and
  the row render a timed due correctly without app-side parsing.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/lib/date-parts.ts` (new),
    `packages/ui/src/lib/format-date.ts`, `packages/ui/src/components/due-date-pill.tsx`,
    `packages/ui/src/index.ts`, `packages/ui/test/format-date.test.ts`,
    `packages/ui/test/due-date-pill.test.tsx`.
  - Reference files (read-only): `packages/ui/src/components/due-date.tsx` (calls
    `dueDateLabel`; unchanged), `packages/ui/src/lib/cx.ts`, `docs/lessons/0003-*.md`.
  - Strictly prohibited files: every file not listed above (no app code, no service).

[IMPLEMENTATION REQUIREMENTS]
  - Primitive reuse plan (Contract 1): no new visual primitive; this is the existing
    `formatDate`/`dueDateLabel`/`dueDateState`/`todayIso` surface only.
  - **Import-cycle fix:** `format-date.ts` currently imports `todayIso` from
    `./due-date-pill`; adding `dueDay` (used by `due-date-pill.tsx`) would create a cycle.
    Add `packages/ui/src/lib/date-parts.ts` (new, low level) exporting `todayIso`,
    `dueDay`, and the leading-`YYYY-MM-DD` `datePart` helper. `format-date.ts` and
    `due-date-pill.tsx` both import from it; `index.ts` re-exports `todayIso` **and `dueDay`**
    from the new module, so the public surface is preserved (and `dueDay` is consumable by the app).
  - `date-parts.ts`: `export function dueDay(value: string | null | undefined): string` →
    the local calendar day `YYYY-MM-DD`; date-only (`^\d{4}-\d{2}-\d{2}$`) returns its own parts
    (no `Date`); a timed instant returns its **local** parts via `new Date(value)` (local getters).
    Missing/malformed → `''`. `todayIso` and `datePart` move here unchanged.
  - `format-date.ts`: keeps `formatDate`/`dueDateLabel`; `dueDateLabel(value, today?)` keeps
    `No date`/`Today`/`Tomorrow`/`dd/mm/yyyy` for date-only and adds
    `Today HH:mm` / `Tomorrow HH:mm` / `dd/mm/yyyy HH:mm` for a timed value (time via local
    `HH:mm`, zero-padded). Comparison is by `dueDay`.
  - `due-date-pill.tsx`: `dueDateState(value, today)` derives `overdue`/`today`/`later` by
    comparing `dueDay(value)` to `today` (day-granular, so a timed todo due earlier today is
    `today`, not `overdue`). `todayIso` is re-exported through `index.ts` (preserved).
  - `dueDate.tsx` is unchanged (it already delegates to `dueDateLabel`).
  - Update the two UI tests to cover: a timed value today → `dueDateState 'today'` and label
    `Today HH:mm`; a timed value tomorrow → `Tomorrow HH:mm`; a date-only value is byte-identical
    to today (existing assertions stay green).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx`
    and `npm run typecheck -w @life/ui`.
  - Strict constraints: NO full suites, NO E2E; only these two named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `dueDay` is exported and is the single day-derivation helper; `todayIso` stays exported
        from `@life/ui` via `date-parts.ts`.
  - [ ] Date-only behavior is unchanged (existing tests still pass).
  - [ ] Timed `dueDateLabel`/`dueDateState` behave as specified.
  - [ ] `npm run typecheck -w @life/ui` passes with zero errors; no file outside scope modified.

### T4 — Timezone + recurrence helpers (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Implement the pure local ⇄ UTC conversion, the local sort key, and the recurrence advance as
  unit-tested helpers with no framework dependency.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/src/todos/due-time.ts` (new),
    `apps/todo-service/src/todos/recurrence.ts` (new),
    `apps/todo-service/test/due-time.test.ts` (new),
    `apps/todo-service/test/recurrence.test.ts` (new).
  - Reference files (read-only): `apps/todo-service/src/todos/todos.service.ts` (ordering/cursor
    call sites), `packages/shared/src/index.ts` (`TodoRepeat`), `docs/intent/todo-due-repeat-notify.md`.
  - Strictly prohibited files: every file not listed above (no service wiring, no entity).

[IMPLEMENTATION REQUIREMENTS]
  - `due-time.ts` exports:
    - `export const ISO_DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;`
    - `export function zoneOffsetMs(instant: Date, tz: string): number` — offset such that
      `localAsUtc(instant) - instant` (via `Intl.DateTimeFormat` parts).
    - `export function localToUtc(local: string, tz: string): Date` — two-pass offset resolve;
      handles a DST zone.
    - `export function utcToLocal(instant: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number }`.
    - `export function dueSortKey(value: string | null, tz: string): string` — null→`'~'`;
      date-only→the date; timed→its **local** `YYYY-MM-DDTHH:mm`.
    - `export function reminderLocal(due: string): string` — date-only→`${due}T09:00`;
      timed (`YYYY-MM-DDTHH:mm`)→itself.
  - `recurrence.ts` exports:
    - `export function nextOccurrence(local: string, repeat: TodoRepeat): string` — one step of
      the rule on the **local** value, preserving shape (`YYYY-MM-DD` stays date-only,
      `YYYY-MM-DDTHH:mm` keeps its time); `monthly` clamps to the month's last day; `yearly`
      clamps Feb 29 to Feb 28; `weekdays` skips Sat/Sun.
    - `export function advanceToOnOrAfter(local: string, repeat: TodoRepeat, nowLocal: string): string`
      — loops `nextOccurrence` while the candidate is `< nowLocal`.
  - No `@nestjs/schedule`, `node-cron`, `date-fns`, or `luxon`. Only `Intl`.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts`
    and `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; only these two named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Every listed signature exists exactly.
  - [ ] `due-time.test.ts` covers: `Asia/Ho_Chi_Minh` fixed offset; `America/New_York` DST
        boundary pinned to actual transition instants (local `2026-03-08T02:30` spring-forward and
        local `2026-11-01T01:30` fall-back); date-only never converted; sort key for a timed value
        equals its local string.
  - [ ] `recurrence.test.ts` covers: daily; weekdays Fri→Mon; weekly +7; monthly 31st clamp;
        yearly Feb 29→Feb 28; `advanceToOnOrAfter` never returns a past occurrence.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors; no file outside scope.

### T5 — Todo service + DTOs (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Normalize a timed due to a canonical instant, validate `repeat` (requires a due), compute
  `reminderScheduledAt`, advance a recurring todo on tick, and carry the new fields through the
  cache row and the DTO.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/todos/todos.controller.ts`,
    `apps/todo-service/src/todos/dto/create-todo.dto.ts`,
    `apps/todo-service/src/todos/dto/update-todo.dto.ts`,
    `apps/todo-service/src/todos/todo.entity.ts`.
  - Reference files (read-only): `apps/todo-service/src/todos/due-time.ts`,
    `apps/todo-service/src/todos/recurrence.ts`, `packages/shared/src/index.ts`
    (`TODO_REPEATS`/`TodoRepeat`), `apps/todo-service/src/cache/todo-cache.ts`.
  - Strictly prohibited files: every file not listed above (no push/reminders module, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - Entity (`todo.entity.ts`, owned here): change `dueDate` from `@Column({ type: 'date' })` to
    `@Column({ type: 'text', nullable: true })` (SQLite stores the ISO text), add
    `@Column({ type: 'text', nullable: true }) repeat: TodoRepeat | null;`, add
    `@Column({ type: 'text', nullable: true }) reminderScheduledAt: string | null;`, and
    `@Index('IDX_todo_reminder_scheduled_at', ['reminderScheduledAt'])`. `synchronize: true`
    applies the additive change; there is no migration framework.
  - DTOs: `CreateTodoDto`/`UpdateTodoDto` `dueDate` accepts `ISO_DUE` (`@Matches`), and gain
    `repeat?: TodoRepeat | null` (`@IsOptional() @ValidateIf(v => v !== null) @IsIn(TODO_REPEATS)`),
    mirroring the existing nullable-field pattern. In BOTH DTOs the current `@MaxLength(10)` on
    `dueDate` is dropped (or raised to 16): a timed value `YYYY-MM-DDTHH:mm` is 16 chars and the
    cap would reject it before `@Matches(ISO_DUE)` is reached. `reminderScheduledAt` is read-only
    (never a request field — `forbidNonWhitelisted` rejects it).
  - `todos.service.ts`:
    - `TodosService` reads `process.env.TODO_TIMEZONE` **once at construction** (default
      `Asia/Ho_Chi_Minh`) into a `private readonly tz: string` field and passes it to every helper
      (`normalizeDue`, `reminderAt`, `dueSortKey`, the advance path) — one owner for the zone
      lookup (lesson 0016).
    - `normalizeDue(value: string, tz: string): string` — date-only → itself; timed → the
      canonical instant `localToUtc(value, tz).toISOString()`. `assertDate` is replaced by an
      `ISO_DUE` guard (400 `'dueDate must be YYYY-MM-DD or YYYY-MM-DDTHH:mm'`).
    - `reminderAt(normalizedDue: string | null, tz: string): string | null` —
      null→null; else `localToUtc(reminderLocal(<local form of normalizedDue>), tz).toISOString()`
      (for a timed value the local form is recovered via `dueSortKey`).
    - `create()` stores `repeat`, `dueDate` normalized, and `reminderScheduledAt`; a `repeat`
      with a null due throws `BadRequestException('repeat requires a dueDate')`.
    - `update()` normalizes a due patch, enforces the repeat-requires-due rule against the
      **resulting** due (patch or stored), recomputes `reminderScheduledAt` whenever `dueDate`
      or `repeat` changes, and clears both when `dueDate` is set to `null`.
    - **Advance-on-tick:** when a patch sets `done:true` and the stored `repeat != null`, do NOT
      set done; compute `next = advanceToOnOrAfter(<local due>, repeat, <nowLocal in tz>)`,
      re-normalize to the canonical instant, set `dueDate`, `reminderScheduledAt = reminderAt(next)`,
      keep `done=false`, bump `version` once. A non-recurring `done:true` is unchanged.
    - **Sweep seam (public, unconditional):** `markReminded(sub: string, id: string): Promise<void>`
      on `TodosService` clears the todo's `reminderScheduledAt` and bumps the owner's generation
      counter (after the write). T7's sweep calls this seam — the sweep never writes the todo
      table directly and never imports the repository.
    - `compareTodos` and the cursor (`encodeCursor`/`decodeCursor`/`afterCursor`) use
      `dueSortKey(dto.dueDate, tz)` (D3) instead of the raw `dueDate`; `OrderedTodo.due` becomes
      the sort key. Cursor payload shape stays `base64(<due sort key>|<createdAt>|<id>)`.
    - `CachedTodoRow` gains `repeat: TodoRepeat | null` and `reminderScheduledAt: string | null`;
      `toCachedTodoRow`/`decodeCachedTodoRow` pass them through verbatim. Ciphertext guards
      unchanged.
  - Controller: no new todo route; the push routes are T6. Route declaration order unchanged.
  - `todos.module.ts` must export `TodosService` so T7 can inject the `markReminded` seam.
    (The module file is in T7's allowed set for that export.)

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E (behavior tests are T8); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The entity carries `dueDate` as text plus `repeat`/`reminderScheduledAt` and the index.
  - [ ] `TodosService` reads `TODO_TIMEZONE` once at construction and every helper receives that
        single `tz`; a timed due is stored as a canonical instant; a date-only due is stored verbatim.
  - [ ] `repeat` without a resulting due is a 400.
  - [ ] Ticking a recurring todo advances it and keeps it open; a non-recurring tick is unchanged.
  - [ ] `markReminded(sub, id)` is public, clears the reminder, and bumps the generation.
  - [ ] `CachedTodoRow` carries `repeat`/`reminderScheduledAt`; the ciphertext guards are untouched.
  - [ ] Ordering/cursor use `dueSortKey`; `npm run typecheck -w @life/todo-service` passes; no
        file outside scope modified.

### T6 — Push subscription module (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Add a bounded `push` module that stores the user's Web Push subscription and serves the VAPID
  public key.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/src/push/push-subscription.entity.ts` (new),
    `apps/todo-service/src/push/push.service.ts` (new),
    `apps/todo-service/src/push/push.controller.ts` (new),
    `apps/todo-service/src/push/push.module.ts` (new),
    `apps/todo-service/src/app.module.ts`.
  - Reference files (read-only): `apps/todo-service/src/todos/todos.module.ts` (module shape),
    `apps/todo-service/src/todos/todos.controller.ts` (guarded controller + `@Principal`),
    `apps/todo-service/src/keys/keys.module.ts`, `apps/todo-service/src/auth/auth.guard.ts`.
  - Strictly prohibited files: every file not listed above (no todos logic, no reminders module).

[IMPLEMENTATION REQUIREMENTS]
  - Entity `PushSubscription` (`@Entity('push_subscription')`): `id` uuid PK, `ownerSub` (indexed),
    `endpoint` unique, `p256dh`, `auth`, `createdAt`; registered in `app.module.ts` `entities`.
  - `PushService`: `getPublicKey(): { publicKey: string }` (from `TODO_VAPID_PUBLIC_KEY`);
    `subscribe(sub, input: PushSubscribeInput)` upsert-by-endpoint for that `sub`;
    `unsubscribe(sub, endpoint)` idempotent delete; `listFor(sub)` (used by the reminders module
    within the process).
  - `PushController` (`@Controller('api/push')`, guarded): `GET key` → public key;
    `POST subscribe` (body `PushSubscribeInput`) → `{ok:true}`; `DELETE subscribe`
    (body `{endpoint}`) → `{ok:true}`. Static paths only; no `:id` collision.
  - `PushModule` imports `TypeOrmModule.forFeature([PushSubscription])`, exports `PushService`;
    registered in `app.module.ts`.
  - `push_subscription` is not cached (Contract 2: outside the cache; delivery capability only).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The three routes exist with the exact paths/methods; subscribe upserts by endpoint.
  - [ ] The entity is registered and `PushService` is exported.
  - [ ] `npm run typecheck -w @life/todo-service` passes; no file outside scope modified.

### T7 — Reminders sweep + sender (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Fire one Web Push per due occurrence via a bounded `reminders` module with an injectable sender,
  clearing `reminderScheduledAt` and invalidating the owner's cache.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/src/reminders/reminder.service.ts` (new),
    `apps/todo-service/src/reminders/push-sender.ts` (new),
    `apps/todo-service/src/reminders/reminders.module.ts` (new),
    `apps/todo-service/src/todos/todos.module.ts` (export `TodosService` so the sweep can inject
    the T5 `markReminded` seam),
    `apps/todo-service/package.json` (add `web-push` + `@types/web-push`),
    `package-lock.json` (root; updated for the `web-push` dep — the Dockerfile runs `npm ci`),
    `.env.example`, `.env.development.example`, `compose.yaml` (add `TODO_TIMEZONE`,
    `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_PRIVATE_KEY`, and the VAPID subject/contact var),
    `apps/todo-service/src/app.module.ts` (register `RemindersModule`).
  - Reference files (read-only): `apps/todo-service/src/todos/todos.service.ts` (key decryption +
    generation bump + the `markReminded` seam), `apps/todo-service/src/push/push.service.ts`,
    `apps/todo-service/src/keys/keys.service.ts`, `packages/cache/src/index.ts`.
  - Strictly prohibited files: every file not listed above (no tests; the todo CRUD logic beyond
    T5's `markReminded` seam is not touched).

[IMPLEMENTATION REQUIREMENTS]
  - `PushSender` interface: `send(sub: string, payload: { title: string; body: string; url: string }): Promise<{ statusCode: number }>`.
    Production `WebPushSender` wraps `web-push` (`setVapidDetails` from `TODO_VAPID_*`, `sendNotification`);
    a `404`/`410` result is surfaced so the caller deletes that subscription.
  - `ReminderService.sweep(): Promise<number>` — one DB query
    `todo.deletedAt IS NULL AND todo.done = 0 AND todo.reminderScheduledAt IS NOT NULL AND todo.reminderScheduledAt <= nowIso`
    (repository find with `LessThanOrEqual`); for each due row: decrypt `title` in-request, build
    the payload, `PushSender.send` to every subscription of the owner, then call the T5
    `TodosService.markReminded(sub, id)` seam (which clears `reminderScheduledAt` and bumps the
    owner's generation counter after the write). Returns the fired count. A `404`/`410` deletes
    that subscription and continues. The sweep never writes the todo table directly.
  - Env wiring: `TODO_TIMEZONE` (IANA name, default `Asia/Ho_Chi_Minh`), `TODO_VAPID_PUBLIC_KEY`,
    `TODO_VAPID_PRIVATE_KEY`, and the VAPID subject/contact var (e.g. `TODO_VAPID_SUBJECT`) are
    added to `.env.example`, `.env.development.example`, and `compose.yaml` (service environment).
    The repo rule holds: Redis keys stay compose-injected only — no `REDIS_URL` enters the env
    files.
  - `RemindersModule` provides `ReminderService`, the `REMINDER_PUSH_SENDER` token bound to
    `WebPushSender`; `onModuleInit` sets `this.timer = setInterval(() => void this.sweep(), 30_000)`,
    `onModuleDestroy` clears it. If `TODO_VAPID_PUBLIC_KEY`/`TODO_VAPID_PRIVATE_KEY` are unset,
    `sweep()` is a no-op that logs once. **No `@nestjs/schedule`/`node-cron`.**
  - `package.json`: add `"web-push"` (with `@types/web-push` dev dep). The root
    `package-lock.json` is updated in the same task (the Dockerfile runs `npm ci`). The Dockerfile
    lists explicit per-workspace `COPY … package.json` lines rather than a glob; no Dockerfile edit
    is needed because `apps/todo-service/package.json` is already copied (verify in DoD).
  - Direct-DB sweep is the recorded Contract 2 deviation (D7); it serves no user read. The
    reminder clear goes through `markReminded`, so the cache is invalidated (Contract 2 Rule 1).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/todo-service` and
    `npm run build -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; typecheck + build only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `sweep()` fires once per due row, calls `markReminded` (clears + bumps), and skips
        `done`/trashed/null-reminder rows.
  - [ ] Missing VAPID env ⇒ no-op (no crash).
  - [ ] The four env vars are documented/wired in both env examples and `compose.yaml`; Redis stays
        compose-injected only; `package-lock.json` is updated.
  - [ ] `npm run typecheck -w @life/todo-service` and `npm run build -w @life/todo-service` pass;
        no file outside scope modified.

### T8 — Backend tests (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Prove the due/repeat/reminder/advance behavior and the reminder sweep in the todo-service suites.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/test/todos-due-repeat.e2e-spec.ts` (new),
    `apps/todo-service/test/reminders.e2e-spec.ts` (new),
    `apps/todo-service/test/push.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-cache.e2e-spec.ts`.
  - Reference files (read-only): `apps/todo-service/test/todo-harness.ts`,
    `apps/todo-service/test/fake-redis.ts`, `apps/todo-service/test/setup-env.ts`,
    `apps/todo-service/test/todos.e2e-spec.ts`.
  - Strictly prohibited files: every production source file (a failing gate re-opens T5/T6/T7).

[IMPLEMENTATION REQUIREMENTS]
  - `todos-due-repeat.e2e-spec.ts`: a timed due round-trips to a canonical instant with
    `repeat`/`reminderScheduledAt` present; a date-only due stays `YYYY-MM-DD` and gets a 09:00
    national reminder; `repeat` with no due → 400; `daily` missed several days advances to the
    next occurrence on/after now and keeps `done:false`; `weekdays` Fri→Mon; `monthly` 31→clamp;
    a non-recurring `done:true` marks done; clearing the due clears the reminder; `dueSortKey`
    ordering (a timed value sorts by its local day).
  - `reminders.e2e-spec.ts`: inject a fake `PushSender`; a due row fires exactly once, the fake
    receives one payload, `reminderScheduledAt` is cleared, and the generation bumps; a
    `404`/`410` deletes that subscription; no VAPID env ⇒ no-op; a `done`/trashed row is skipped.
  - `push.e2e-spec.ts`: `GET /api/push/key` returns a key; subscribe upserts by endpoint for the
    caller's `sub` (no duplicate row on repeat subscribe); delete is idempotent (unknown endpoint
    still 200); another `sub` cannot read or affect the caller's subscriptions.
  - `todo-cache.e2e-spec.ts`: the `todo:all`/`todo:trash` serialized values carry
    `repeat`/`reminderScheduledAt`; content fields remain `enc.v1.`-only and the no-known-plaintext
    assertions still pass; the invalidation table gains the sweep-clear bump.
  - No production file may be edited to make a test pass.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run test:unit -w @life/todo-service -- test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/push.e2e-spec.ts test/todo-cache.e2e-spec.ts`
    and `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E; only these four named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The four suites cover every behavior above.
  - [ ] The prescribed four-file test command passes.
  - [ ] `npm run typecheck -w @life/todo-service` passes with zero errors.
  - [ ] No file outside scope modified.

### T9 — BFF push client + actions (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Expose the push key/subscribe/unsubscribe to the app, and add the server actions the settings
  toggle calls.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/todo-api.ts`, `apps/app/app/todo-actions.ts`,
    `apps/app/lib/push-client.ts` (new).
  - Reference files (read-only): `apps/app/lib/client.ts` (`callService`),
    `packages/shared/src/index.ts` (`PushSubscribeInput`), `apps/app/lib/todo-api.ts` (todo calls).
  - Strictly prohibited files: every file not listed above (no UI, no `packages/ui`).

[IMPLEMENTATION REQUIREMENTS]
  - `lib/todo-api.ts`: add `getPushKey(): Promise<{ publicKey: string }>` (`GET /api/push/key`),
    `subscribePush(input: PushSubscribeInput): Promise<{ ok: true }>` (`POST /api/push/subscribe`),
    `unsubscribePush(endpoint: string): Promise<{ ok: true }>` (`DELETE /api/push/subscribe`).
    Reuse `callService`; re-declare no type.
  - `app/todo-actions.ts`: add `getPushKeyAction(): Promise<{ publicKey: string }>` (calls the
    server-only `lib/todo-api.ts` `getPushKey`), `subscribePushAction(input: PushSubscribeInput)`
    and `unsubscribePushAction(endpoint: string)` (each calls its T9 BFF function; no
    `revalidatePath` needed for unsubscribe/subscribe — subscriptions are not rendered todo data).
  - `lib/push-client.ts` (new, `'use client'`): `subscribeToPush(): Promise<{ ok: boolean; reason?: string }>`
    — registers `/sw.js`, reads the VAPID key via the `getPushKeyAction` server action (the client
    must not import the server-only `lib/todo-api.ts`), calls
    `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then
    `subscribePushAction`; `unsubscribeFromPush()` unsubscribes and calls `unsubscribePushAction`.
    Returns explicit reasons for `unsupported` / `not-installed` / `denied`.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; build + typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The three BFF functions, `getPushKeyAction`, and two push actions exist with the exact
        paths/methods.
  - [ ] `push-client.ts` reads the key through the server action (never imports `lib/todo-api.ts`)
        and handles unsupported/not-installed/denied without throwing.
  - [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/app` pass; no file outside scope.

### T10 — App UI editor + row (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Add the editor `Time`/`Repeat` fields, render the time/repeat in the row, keep a recurring tick
  from hiding the row, and make matrix urgency timed-safe.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/todo-editor.tsx`,
    `apps/app/app/todo-item.tsx`, `apps/app/lib/matrix.ts`,
    `apps/app/lib/todo-repeat-label.ts` (new; app copy).
  - Reference files (read-only): `packages/ui/src/index.ts` (`Input`, `PillGroup`, `Pill`,
    `Switch`, `dueDay`, `dueDateLabel`, `dueDateState`), `apps/app/lib/todo-groups.ts`,
    `docs/specs/SPEC-todo-ui.md`.
  - Strictly prohibited files: every file not listed above (no `packages/ui` edit, no settings
    page, no e2e spec).

[IMPLEMENTATION REQUIREMENTS]
  - Primitive reuse plan (Contract 1): `PillGroup` + `Input type="time"` (Time), `PillGroup` +
    `Pill as="button" size="chip"` (Repeat options: None/Daily/Weekly/Monthly/Yearly/Weekdays),
    `PillGroup` + `Input type="date"` (Due, unchanged), `DueDate` (row). No raw `<select>`/styled
    `<div>`; no `next/link`; app copy only.
  - **Repeat label helper (app copy):** add `apps/app/lib/todo-repeat-label.ts` exporting
    `repeatLabel(repeat: TodoRepeat | null): string | null` (null → null; else the human label,
    e.g. `daily` → `Daily`, `weekdays` → `Weekdays`). It is app-owned because `@life/ui` has no
    `@life/shared` dependency — do not put it in `@life/ui`. Consumed by the row and the editor
    option labels.
  - `todo-editor.tsx`: add `dueTime` state seeded from a timed due; `PillGroup label="Time"`
    (`Input type="time" aria-label="Due time"`); `PillGroup label="Repeat"` with the six options
    (`aria-pressed`, active); the save payload joins date+time into `dueDate = 'YYYY-MM-DDTHH:mm'`
    (or the date alone when no time) and carries `repeat` (null for None). The `PillGroup label="Due"`/
    `Input type="date" aria-label="Due date"` is unchanged. **A repeat with no due shows the
    field but blocks save** until a due date exists (mirroring the server's 400) — no auto-set of
    today; the editor surfaces the server error by staying open.
  - `todo-item.tsx`: the row shows the time/repeat via the `@life/ui` helpers (e.g. the existing
    `DueDate` for the timed label, plus the `repeatLabel` from `apps/app/lib/todo-repeat-label.ts`
    in the row `meta`). The `DoneToggle`
    `hide`/`collapsing` behavior is gated on `!todo.repeat`, so ticking a recurring todo does not
    hide the row.
  - `lib/matrix.ts`: `isUrgent` replaces `dueDateLabel(...) === 'Tomorrow'` with a `dueDay`
    comparison (using `dueDateState` + `dueDay`) so a timed "tomorrow" is still urgent.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/app` and
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts`.
  - Strict constraints: NO full suites, NO E2E; only these three named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The editor writes a joined date+time and a `repeat` value; existing `Due`/`Due date`
        selectors are unchanged.
  - [ ] A recurring tick does not hide/collapse the row; matrix urgency is timed-safe.
  - [ ] `npm run typecheck -w @life/app` and the three-file test command pass; no file outside scope.

### T11 — App UI settings + service worker (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Add the settings "Reminders" block with a push toggle and the static service worker that
  receives and displays pushes.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/todos/settings/page.tsx`,
    `apps/app/app/push-toggle.tsx` (new), `apps/app/public/sw.js` (new).
  - Reference files (read-only): `apps/app/app/settings/matrix-switch.tsx` (client toggle
    precedent), `packages/ui/src/index.ts` (`SettingsBlock`, `SettingsRow`, `Switch`),
    `apps/app/lib/push-client.ts`, `apps/app/app/layout.tsx`.
  - Strictly prohibited files: every file not listed above (no editor/row, no `packages/ui`).

[IMPLEMENTATION REQUIREMENTS]
  - Primitive reuse plan (Contract 1): `SettingsBlock`/`SettingsRow` + `Switch` only; the
    `PushToggle` is a client component (the `MatrixSwitch` precedent). No raw HTML.
  - `push-toggle.tsx`: render client defaults `supported = false`, `installed = false`,
    `permission = 'default'` and read `navigator` / `Notification.permission` in a `useEffect`
    (`supported` = `'serviceWorker' in navigator && 'PushManager' in window`; `installed` =
    `navigator.standalone`) — do **not** server-seed browser values (avoids a hydration
    mismatch). Renders the `Switch` (`label="Push reminders"`) and calls
    `subscribeToPush`/`unsubscribeFromPush`; shows guidance text when unsupported (no control)
    or not installed (add to Home Screen).
  - `todos/settings/page.tsx`: add `<SettingsBlock title="Reminders">` with
    `<SettingsRow label="Push reminders" description="…" control={<PushToggle />} />`.
  - `public/sw.js` (new, static): `push` → `event.waitUntil(self.registration.showNotification(data.title, { body, data: { url }, icon: '/icon-todos.png', badge: '/icon-todos.png' }))`;
    `notificationclick` → `clients.matchAll` and focus an existing `/todos` window if present,
    else `clients.openWindow(data.url)`, where the payload's `data.url = '/todos/<id>/edit'`.
  - No manifest / `viewport.themeColor` change (frozen PWA constants untouched).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; build + typecheck only; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The settings page renders the `Reminders` block with the push toggle; the three states
        (unsupported / not-installed / subscribe) are implemented; the toggle reads browser state
        in an effect (no server-seeded browser values).
  - [ ] `sw.js` displays a notification (with `icon`+`badge`) and routes a click to the todo
        (`data.url = '/todos/<id>/edit'`, focusing an existing `/todos` window).
  - [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/app` pass; no file outside scope.

### T12 — App UI tests + mechanical checks (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Add/update the app UI regression tests for the timed/repeat/advance behavior and run the
  Contract 1 mechanical checks.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/test/todo-item.test.tsx`,
    `apps/app/test/routes-todo-edit.test.tsx`, `apps/app/test/matrix.test.ts`,
    `apps/app/test/push-toggle.test.tsx` (new).
  - Reference files (read-only): `apps/app/app/todo-editor.tsx`, `apps/app/app/todo-item.tsx`,
    `apps/app/app/push-toggle.tsx`, `apps/app/lib/matrix.ts`,
    `packages/ui/src/lib/date-parts.ts`, `packages/ui/src/index.ts`,
    `AGENTS.md` (Contract 1 checks).
  - Strictly prohibited files: every production source file (a failing test re-opens T10/T11).

[IMPLEMENTATION REQUIREMENTS]
  - `routes-todo-edit.test.tsx`: the save payload joins date+time into `dueDate` and carries
    `repeat`; `PillGroup label="Time"`/`"Repeat"` render; a repeat-with-no-due save stays open.
  - `todo-item.test.tsx`: the row renders a timed label and a `repeatLabel`; a recurring tick does
    not set the `collapsing`/`hide` state.
  - `matrix.test.ts`: `isUrgent` is true for a timed value due today and a timed value due
    tomorrow; unchanged for date-only.
  - `push-toggle.test.tsx` (new): the three push-toggle branches — unsupported (no `PushManager`)
    renders guidance and no control; not-installed (`!navigator.standalone`) renders the add-to-
    Home-Screen guidance; supported+installed renders the `Switch` and the subscribe path calls
    `subscribeToPush`.
  - Mechanical checks (Contract 1, run in this task's verification):
    `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps/app --include='*.tsx'`
    → only the documented exemptions; `grep -rn "next/link" apps/app --include='*.tsx'` → zero.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts test/push-toggle.test.tsx`
    and `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E; only these four named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] The four suites cover the listed cases and pass.
  - [ ] The two mechanical greps are clean.
  - [ ] `npm run typecheck -w @life/app` passes; no file outside scope modified.

### T13 — Five-lane verification (module `todo-due-repeat-notify`)

[TASK OBJECTIVE]
  Run the global protocol §7.6 five-lane gate on the final integrated state and iterate until it
  returns N/N PASS.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: none (verification only; any fix re-opens its owning task).
  - Reference files (read-only): the working diff, `tasks/plan-todo-due-repeat-notify.md`,
    `tasks/todo-todo-due-repeat-notify.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
    `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
  - Strictly prohibited files: everything (this task changes nothing).

[IMPLEMENTATION REQUIREMENTS]
  - Step 1 — suite gate first, exact commands:
    `npm run build -w @life/shared`;
    `npm run typecheck -w @life/todo-service`;
    `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/push.e2e-spec.ts test/todo-cache.e2e-spec.ts`;
    `npm run typecheck -w @life/ui`;
    `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx`;
    `npm run typecheck -w @life/app`;
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts test/push-toggle.test.tsx`.
    Iterate fix → re-run until all are green.
  - Step 2 — fire five parallel lane subagents (read-only; the QA lane runs the Step 1 commands),
    each returning exactly
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    1. Correctness/domain (timezone, recurrence advance, reminder firing, no data loss);
    2. Code quality (five axes);
    3. Security (zero CRITICAL/HIGH/MEDIUM on changed files — esp. push payload, subscription
       ownership, no injected HTML in `sw.js`);
    4. QA (executes Step 1; scope = the named suites; the interactive push/notification path is a
       user-run dev check, recorded as a gap);
    5. Plan conformance (the diff vs the plan and the three specs).
  - Step 3 — fail-closed: a crashed, missing, or empty lane verdict is a failure. Any failed lane
    → fix blockers → re-run ONLY the failed lanes → repeat until every lane returns PASS.
  - Step 4 — commit only on N/N PASS, staged by explicit paths (never `git add -A`).

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
| Timezone conversion wrong under DST | High | T4 two-pass `localToUtc` + DST unit test; date-only never converted |
| A timed due sorts by the UTC day, not the local day | Med | D3 `dueSortKey`; T5 uses it for order + cursor; T8 asserts it |
| Cached row leaks content after adding fields | High | Guards unchanged (`isCiphertextTodoRow*`); T8 asserts `enc.v1.`-only |
| Sweep sends duplicate or missed pings | High | Clear-on-fire + generation bump; T8 asserts exactly-once and skip of done/trashed |
| Sweep bypasses the cache (Contract 2 deviation) | Med | Recorded (D7) in spec + plan; system-side only, no user read; the clear goes through T5 `markReminded` so the owner generation still bumps |
| iOS ignores push because the app isn't installed | Med | T11 gates on `navigator.standalone` + guidance; recorded in success criteria |
| Push payload carries the decrypted title to Apple | Med | Recorded decision (D9); never persisted; upgrade path documented |
| Frozen e2e surface / PWA constants touched | High | T1/T10/T11 add names only; no manifest/themeColor change; no e2e edit |
| New dependency (`web-push`) breaks the build | Med | T7 adds it to `apps/todo-service/package.json` **and** root `package-lock.json` (Docker `npm ci`), then runs `npm run build -w @life/todo-service`; the Dockerfile's explicit `COPY … package.json` already includes `apps/todo-service/package.json` |
| A repeat with no due slips through | Med | T5 enforces against the resulting due; T8 asserts the 400 |

## Open Questions

None. N1–N5 are locked; the remaining choices (payload privacy, sweep deviation, local sort key,
09:00 default) are recorded decisions in this plan and the module spec.
