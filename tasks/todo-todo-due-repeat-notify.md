# Task Ledger: todo-due-repeat-notify (due time + recurrence + Web Push reminders)

Plan: `tasks/plan-todo-due-repeat-notify.md` · Spec (owner):
`docs/specs/SPEC-todo-due-repeat-notify.md` · Specs/maps amended (T1):
`docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`, `docs/specs/MAP-todo-ecosystem.md`,
`docs/specs/MAP-redis.md`.
Governing intent: `docs/intent/todo-due-repeat-notify.md` (N1–N5).
Branch: `feat/todo-due-repeat-notify`. Module id: `todo-due-repeat-notify`.

Process: global protocol (§5 template, §6 plan-validation gate, §7 review, §7.6 five-lane for
feature work) + repo AGENTS.md (Project Profile, Contract 1/2). Every task carries the full §5
template (in the plan). Test runs stay within §3: targeted, named files only, max 2 executions;
no full suite, no E2E. The five-lane gate (T13) is five parallel subagent lanes, not a shell command.

## Tasks

- [ ] T1: Spec amendments — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Record the due-time/recurrence/push contract in both specs before code.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
      `docs/specs/MAP-todo-ecosystem.md`, `docs/specs/MAP-redis.md`.
    - Reference (read-only): `docs/specs/SPEC-todo-due-repeat-notify.md`,
      `docs/intent/todo-due-repeat-notify.md`, `docs/intent/redis-shared-state.md` (decision 3).
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `repeat`/`reminderScheduledAt` columns + `push_subscription`
    table + `IDX_todo_reminder_scheduled_at`; `dueDate` holds date-only or canonical instant; DTO
    fields + repeat-requires-due + advance-on-tick; `/api/push/key` + `/api/push/subscribe` routes;
    Cache Rules gain the two plaintext fields and the recorded sweep deviation; spec gains the new
    testing group; recurrence leaves the "v2" Ask-first list; SPEC-todo-ui names the editor
    `Time`/`Repeat`, the row display, no-hide-on-recurring-tick, and the settings Reminders block +
    `sw.js`; MAP-todo-ecosystem row reconciled; MAP-redis records `redis-todo` ownership unchanged.
  - [VERIFICATION & TESTING RULES] Permitted: none (docs task). Verify
    `grep -n "reminderScheduledAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "Due time" docs/specs/SPEC-todo-ui.md` non-empty. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] Both greps return non-empty.
    - [ ] MAP-todo-ecosystem reconciled; MAP-redis records `redis-todo` ownership unchanged.
    - [ ] No placeholder or contradicting "v2/deferred recurrence" text remains.
    - [ ] No file outside scope modified.
  - Dependencies: none. Size: S.

- [ ] T2: Shared wire types — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Add `TodoRepeat`, `repeat`, `reminderScheduledAt`, and `PushSubscribeInput`.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `packages/shared/src/index.ts`.
    - Reference (read-only): `packages/shared/src/index.ts` (Todo/List precedent),
      `apps/todo-service/src/todos/dto/*.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `export const TODO_REPEATS = ['daily','weekdays','weekly','monthly','yearly'] as const;`
    + `export type TodoRepeat = (typeof TODO_REPEATS)[number];`; `Todo` gains
    `repeat: TodoRepeat|null` + `reminderScheduledAt: string|null`; `CreateTodoInput`
    and `UpdateTodoInput` gain `repeat?: TodoRepeat|null`; add
    `export interface PushSubscribeInput { endpoint: string; keys: { p256dh: string; auth: string } }`.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/shared`. **Shared-build
    precondition (stated once; referenced by T4–T8):** consumers resolve `@life/shared` via
    `packages/shared` `"types": "dist/index.d.ts"`, and `typecheck` never emits `dist`, so run
    `npm run build -w @life/shared` before any `npm run typecheck -w @life/todo-service`;
    T9–T13 repeat it. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] `TODO_REPEATS` + all listed types exist exactly as specified.
    - [ ] `npm run typecheck -w @life/shared` passes with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T1. Size: XS.

- [ ] T3: UI date helpers — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] One `@life/ui` helper owns the local day and the timed/date label.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `packages/ui/src/lib/date-parts.ts` (new),
      `packages/ui/src/lib/format-date.ts`,
      `packages/ui/src/components/due-date-pill.tsx`, `packages/ui/src/index.ts`,
      `packages/ui/test/format-date.test.ts`, `packages/ui/test/due-date-pill.test.tsx`.
    - Reference (read-only): `packages/ui/src/components/due-date.tsx`, `docs/lessons/0003-*.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] New low-level `date-parts.ts` exports `todayIso`, `dueDay`
    (`value` → local `YYYY-MM-DD`; date-only: own parts, no `Date`; timed: local getters) and
    `datePart`; `format-date.ts` and `due-date-pill.tsx` both import from it (breaks the
    `format-date → due-date-pill` cycle); `due-date-pill.tsx` **re-exports** `todayIso`
    (`export { todayIso } from '../lib/date-parts';`) so `due-date.tsx` (imports `dueDateState`
    + `todayIso`) and `format-date.test.ts` (imports `todayIso` from `../src/components/due-date-pill`)
    keep working unchanged — `due-date.tsx` is not in scope; `index.ts` re-exports `todayIso`
    **and `dueDay`**.
    `dueDateLabel` adds `Today/Tomorrow/dd-mm-yyyy HH:mm` for timed; `dueDateState` compares
    `dueDay` (day-granular); `dueDate.tsx` unchanged. Update the two tests for timed values +
    date-only non-regression.
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx` and
    `npm run typecheck -w @life/ui`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] `dueDay` is the single day-derivation helper; `todayIso` stays exported from `@life/ui`
          (via `due-date-pill.tsx`'s re-export of `date-parts.ts`) so its existing importers
          (`due-date.tsx`, `format-date.test.ts`) compile unchanged.
    - [ ] Date-only behavior unchanged; timed behavior as specified.
    - [ ] `npm run typecheck -w @life/ui` passes; no file outside scope modified.
  - Dependencies: T1. Size: S.

- [ ] T4: Timezone + recurrence helpers — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Implement the pure conversion/sort-key/advance helpers with unit tests.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/src/todos/due-time.ts` (new),
      `apps/todo-service/src/todos/recurrence.ts` (new),
      `apps/todo-service/test/due-time.test.ts` (new),
      `apps/todo-service/test/recurrence.test.ts` (new).
    - Reference (read-only): `apps/todo-service/src/todos/todos.service.ts`,
      `packages/shared/src/index.ts`, `docs/intent/todo-due-repeat-notify.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `due-time.ts`: `ISO_DUE`, `zoneOffsetMs`, `localToUtc` (two-pass),
    `utcToLocal`, `dueSortKey`, `reminderLocal`. `recurrence.ts`: `nextOccurrence` (one step,
    shape-preserving, monthly/yearly clamp, weekdays skip) and `advanceToOnOrAfter`. Only `Intl`
    (no `@nestjs/schedule`/`node-cron`/`date-fns`/`luxon`).
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` (the T2
    shared-build precondition) then
    `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts` and
    `npm run typecheck -w @life/todo-service`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] Every listed signature exists exactly.
    - [ ] Tests cover fixed-offset + DST zones (pinned to actual `America/New_York` transition
          instants: local `2026-03-08T02:30` spring-forward and local `2026-11-01T01:30` fall-back),
          date-only untouched, sort key, daily/weekdays/
          weekly/monthly-clamp/yearly-clamp, and no past occurrence.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T2. Size: M.

- [ ] T5: Todo service + DTOs — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Normalize timed dues, validate repeat, compute the reminder, advance on tick,
    carry the fields through cache + DTO, and sort by the local key.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/src/todos/todos.service.ts`,
      `apps/todo-service/src/todos/todos.controller.ts`,
      `apps/todo-service/src/todos/dto/create-todo.dto.ts`,
      `apps/todo-service/src/todos/dto/update-todo.dto.ts`,
      `apps/todo-service/src/todos/todo.entity.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/due-time.ts`,
      `apps/todo-service/src/todos/recurrence.ts`, `packages/shared/src/index.ts`, `apps/todo-service/src/cache/todo-cache.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `todo.entity.ts`: `dueDate` → `@Column({type:'text'})`,
    `repeat`/`reminderScheduledAt` text columns + `@Index('IDX_todo_reminder_scheduled_at', …)`
    (`synchronize:true`). DTOs accept `ISO_DUE` + optional `repeat` (`@IsIn(TODO_REPEATS)`, nullable
    pattern) and drop/raise the existing `@MaxLength(10)` on `dueDate` to 16 in BOTH DTOs (a timed
    `YYYY-MM-DDTHH:mm` is 16 chars); `normalizeDue`, `reminderAt`; create/update store `repeat` + normalized due +
    `reminderScheduledAt`; repeat-requires-due → 400; advance-on-tick for recurring;
    `TodosService` reads `process.env.TODO_TIMEZONE` once at construction (default
    `Asia/Ho_Chi_Minh`) into a `private readonly tz` field and passes it to every helper (one owner
    per rule, lesson 0016);
    `compareTodos`/cursor use `dueSortKey`; `CachedTodoRow` carries `repeat`/`reminderScheduledAt`
    verbatim; ciphertext guards unchanged. Public `markReminded(sub, id)` clears the reminder and
    bumps the generation (the sweep seam; `todos.module.ts` exports `TodosService`). The sweep
    clears through this seam — it never **writes** the todo table directly (it reads the due rows
    through its own T7 repository handle).
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` (the T2
    shared-build precondition) then `npm run typecheck -w @life/todo-service`.
    NO full suites/E2E (behavior is T8), max 2.
  - [DEFINITION OF DONE]
    - [ ] Entity carries text `dueDate` + `repeat`/`reminderScheduledAt` + index; timed→instant,
          date-only verbatim; repeat-without-due 400; recurring tick advances and stays open;
          non-recurring tick unchanged.
    - [ ] `markReminded` is public, clears + bumps; `CachedTodoRow` carries both fields; guards
          untouched; ordering/cursor use `dueSortKey`.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T4. Size: L (one bounded concern: the todo due/repeat data layer).

- [ ] T6: Push subscription module — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Store the Web Push subscription and serve the VAPID public key.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/src/push/push-subscription.entity.ts` (new),
      `apps/todo-service/src/push/push-subscribe.dto.ts` (new),
      `apps/todo-service/src/push/push.service.ts` (new),
      `apps/todo-service/src/push/push.controller.ts` (new),
      `apps/todo-service/src/push/push.module.ts` (new),
      `apps/todo-service/src/app.module.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/todos.module.ts`,
      `apps/todo-service/src/todos/todos.controller.ts`, `apps/todo-service/src/keys/keys.module.ts`,
      `apps/todo-service/src/auth/auth.guard.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `PushSubscription` entity (`ownerSub` indexed, composite
    `UNIQUE (ownerSub, endpoint)` — never endpoint alone); a decorated `PushSubscribeDto` class
    for the `POST` body (the global `ValidationPipe` cannot validate the erased shared
    interface); `PushService` (`getPublicKey`, `subscribe` upsert scoped by `(sub, endpoint)`,
    `unsubscribe` idempotent, `listFor`); `PushController` `GET key`, `POST/DELETE subscribe`;
    `PushModule` registered; `push_subscription` outside the cache.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` (the T2
    shared-build precondition) then `npm run typecheck -w @life/todo-service`.
    NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] The three routes exist with the exact paths/methods; subscribe upserts by endpoint.
    - [ ] Entity registered; `PushService` exported.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T2. Size: M.

- [ ] T7: Reminders sweep + sender — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Fire one Web Push per due occurrence via a bounded sender that clears the
    reminder and invalidates the cache.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/src/reminders/reminder.service.ts` (new),
      `apps/todo-service/src/reminders/push-sender.ts` (new),
      `apps/todo-service/src/reminders/reminders.module.ts` (new),
      `apps/todo-service/src/todos/todos.module.ts` (export `TodosService` for the T5
      `markReminded` seam), `apps/todo-service/package.json` (add `web-push` + `@types/web-push`),
      `package-lock.json` (root; `web-push` dep for Docker `npm ci`), `.env.example`,
      `.env.development.example`, `compose.yaml` (`TODO_TIMEZONE`/`TODO_VAPID_*`),
      `apps/todo-service/src/app.module.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/todos.service.ts` (decrypt + generation
      bump + `markReminded`), `apps/todo-service/src/push/push.service.ts`, `apps/todo-service/src/keys/keys.service.ts`,
      `packages/cache/src/index.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `PushSender` interface
    `send(sub, endpoint, payload) => Promise<{ endpoint; statusCode }>` (the endpoint identifies
    the attempted subscription and is returned so the caller deletes the exact row on 404/410) +
    `WebPushSender` (`web-push`); `ReminderService.sweep()` (one DB query through its own
    repository handle for `deletedAt IS NULL AND done=0 AND reminderScheduledAt IS NOT NULL AND
    <= now`; decrypt title; `send(sub, endpoint, payload)`; call `TodosService.markReminded(sub,id)`
    which clears + bumps; delete the returned endpoint on 404/410; never writes the todo table
    directly);
    `RemindersModule` with `setInterval(30s)` in `onModuleInit` and clear in `onModuleDestroy`;
    missing VAPID env ⇒ no-op. Env wiring for `TODO_TIMEZONE`/`TODO_VAPID_PUBLIC_KEY`/
    `TODO_VAPID_PRIVATE_KEY`/VAPID subject in both env examples + `compose.yaml`; Redis stays
    compose-injected only. No scheduler dep. The Dockerfile lists explicit per-workspace
    `COPY … package.json` lines (not a glob) and already includes
    `apps/todo-service/package.json`, so no Dockerfile edit is needed (verify); root lockfile
    updated.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` (the T2
    shared-build precondition) then `npm run typecheck -w @life/todo-service` and
    `npm run build -w @life/todo-service`. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] `sweep()` fires once per due row, calls `markReminded` (clear + bump), skips
          done/trashed/null; 404/410 deletes that subscription.
    - [ ] Missing VAPID env ⇒ no-op; env vars wired in both examples + compose; lockfile updated;
          build passes.
    - [ ] Typecheck + build pass; no file outside scope modified.
  - Dependencies: T5, T6. Size: M.

- [ ] T8: Backend tests — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Prove the due/repeat/reminder/advance behavior and the sweep.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/test/todos-due-repeat.e2e-spec.ts` (new),
      `apps/todo-service/test/reminders.e2e-spec.ts` (new),
      `apps/todo-service/test/push.e2e-spec.ts` (new),
      `apps/todo-service/test/todo-cache.e2e-spec.ts`,
      `apps/todo-service/test/todos.e2e-spec.ts` (existing DTO key list),
      `apps/todo-service/test/ownership.e2e-spec.ts` (existing `todoKeys`, asserted twice).
    - Reference (read-only): `apps/todo-service/test/todo-harness.ts`,
      `apps/todo-service/test/fake-redis.ts`, `apps/todo-service/test/setup-env.ts`.
    - Strictly prohibited: every production source file (a failing gate re-opens T5/T6/T7).
  - [IMPLEMENTATION REQUIREMENTS] As in the plan: timed round-trip + reminder present; date-only
    09:00; repeat-requires-due 400; daily-missed advance; weekdays Fri→Mon; monthly clamp;
    non-recurring done; clear-due clears reminder; `dueSortKey` order. Reminders: fake `PushSender`
    receives `(sub, endpoint, payload)`, exactly-once, clear + bump, a 404/410 (with its
    `endpoint`) deletes that subscription, no-VAPID no-op, done/trashed skip; zero
    `getThrough`/read-through reads during a `sweep()` (direct-DB deviation, spec Testing #8). Push
    endpoints: key returned; subscribe upserts scoped by `(sub, endpoint)` (no duplicate row);
    delete idempotent; another `sub` cannot read/affect the caller's subscriptions (nor overwrite
    a foreign row via a shared endpoint). Cache: `todo:all`/`todo:trash` carry both fields,
    `enc.v1.`-only, sweep-clear bump. The two existing DTO-shape suites: `todos.e2e-spec.ts`'s
    13-key list gains the two new fields → 15; `ownership.e2e-spec.ts`'s stale 11-key `todoKeys`
    (twice) is brought to the full 15 keys (also add `important`/`effectiveImportant`). No
    production edit to pass.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` (the T2
    shared-build precondition) then
    `npm run test:unit -w @life/todo-service -- test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/push.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts`
    and `npm run typecheck -w @life/todo-service`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] The three new suites and the two existing suites cover every case above; both existing
          key lists are the full 15-key set.
    - [ ] The prescribed six-file command passes; typecheck passes.
    - [ ] No file outside scope modified.
  - Dependencies: T7. Size: M.

- [ ] T9: BFF push client + actions — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Expose push key/subscribe/unsubscribe and add the server actions.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/app/lib/todo-api.ts`, `apps/app/app/todo-actions.ts`,
      `apps/app/lib/push-client.ts` (new).
    - Reference (read-only): `apps/app/lib/client.ts`, `packages/shared/src/index.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `getPushKey`/`subscribePush`/`unsubscribePush` in `todo-api.ts`;
    `getPushKeyAction` + `subscribePushAction`/`unsubscribePushAction` in `todo-actions.ts`;
    `push-client.ts` client helper reads the key via `getPushKeyAction` (never imports the
    server-only `todo-api.ts`) and returns explicit `unsupported`/`not-installed`/`denied`
    reasons; reuse `callService`.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/app`. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] Three BFF functions + `getPushKeyAction` + two push actions exist with exact paths/methods.
    - [ ] `push-client.ts` reads the key through the server action and handles
          unsupported/not-installed/denied without throwing.
    - [ ] Build + typecheck pass; no file outside scope modified.
  - Dependencies: T6. Size: S.

- [ ] T10: App UI editor + row — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Editor Time/Repeat fields, row time/repeat display, recurring tick doesn't
    hide, matrix urgency timed-safe.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/app/app/todo-editor.tsx`, `apps/app/app/todo-item.tsx`,
      `apps/app/lib/matrix.ts`, `apps/app/lib/todo-repeat-label.ts` (new, app copy).
    - Reference (read-only): `packages/ui/src/index.ts`, `apps/app/lib/todo-groups.ts`,
      `docs/specs/SPEC-todo-ui.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] Primitive reuse: `PillGroup`+`Input type="time"` (Time),
    `PillGroup`+`Pill as="button" size="chip"` (Repeat), unchanged date field, `DueDate` (row).
    New `todo-repeat-label.ts` exports `repeatLabel(repeat: TodoRepeat | null): string | null`
    (app copy — `@life/ui` has no `@life/shared` dep), consumed by the row and editor options.
    Editor joins date+time + carries `repeat`; a repeat with no due **blocks save** until a due
    exists (no auto-set today). Row shows the timed label + repeat label; `DoneToggle`
    hide/collapsing gated on `!todo.repeat`. `matrix.ts` `isUrgent` uses `dueDay`/`dueDateState`
    (timed-tomorrow still urgent).
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/app` and
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts`.
    NO full suites/E2E, only these three files, max 2.
  - [DEFINITION OF DONE]
    - [ ] Editor writes joined date+time + `repeat`; existing Due/Due date selectors unchanged.
    - [ ] Recurring tick doesn't hide/collapse; matrix urgency timed-safe.
    - [ ] Typecheck + three-file tests pass; no file outside scope modified.
  - Dependencies: T3, T5. Size: M.

- [ ] T11: App UI settings + service worker — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Settings Reminders block + push toggle + static `sw.js`.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/app/app/todos/settings/page.tsx`, `apps/app/app/push-toggle.tsx` (new),
      `apps/app/public/sw.js` (new).
    - Reference (read-only): `apps/app/app/settings/matrix-switch.tsx`, `packages/ui/src/index.ts`,
      `apps/app/lib/push-client.ts`, `apps/app/app/layout.tsx`.
    - Strictly prohibited: every file not listed above (no manifest/themeColor change).
  - [IMPLEMENTATION REQUIREMENTS] Primitive reuse: `SettingsBlock`/`SettingsRow` + `Switch`; a
    client `PushToggle` rendering client defaults (`supported=false`, `installed=false`,
    `permission='default'`) and reading `navigator`/`Notification.permission` in a `useEffect`
    (no server-seeded browser values → no hydration mismatch), calling the T9 client; `sw.js`
    handles `push` (showNotification with icon+badge and `data.url`) + `notificationclick`
    (focus an existing `/todos` window else `openWindow(data.url)`, `data.url = '/todos/<id>/edit'`);
    no PWA constant change.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/app`. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] Settings renders the Reminders block + toggle with the three states.
    - [ ] `sw.js` displays a notification and routes a click to the todo.
    - [ ] Build + typecheck pass; no file outside scope modified.
  - Dependencies: T9. Size: M.

- [ ] T12: App UI tests + mechanical checks — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Add/update the UI regression tests and run the Contract 1 mechanical checks.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/app/test/todo-item.test.tsx`, `apps/app/test/routes-todo-edit.test.tsx`,
      `apps/app/test/matrix.test.ts`, `apps/app/test/push-toggle.test.tsx` (new), and the five
      existing fixtures whose `todo(...)` helpers gain `repeat: null`/`reminderScheduledAt: null`:
      `apps/app/test/todo-groups.test.ts`, `apps/app/test/todo-query.test.ts`,
      `apps/app/test/routes-todos-list.test.tsx`, `apps/app/test/routes-matrix.test.tsx`,
      `apps/app/test/routes-todos-trash.test.tsx`.
    - Reference (read-only): `apps/app/app/todo-editor.tsx`, `apps/app/app/todo-item.tsx`,
      `apps/app/app/push-toggle.tsx`, `apps/app/lib/matrix.ts`, `packages/ui/src/index.ts`,
      `AGENTS.md` (Contract 1 checks).
    - Strictly prohibited: every production source file (a failing test re-opens T10/T11).
  - [IMPLEMENTATION REQUIREMENTS] As in the plan: editor payload join+repeat; row timed/repeat
    label + no-hide recurring tick; `isUrgent` timed today/tomorrow and **malformed stays false**
    (`dueDateState` returns `'none'` for `dueDay === ''`); push-toggle branches
    (unsupported / not-installed / subscribe); the two Contract 1 greps clean; the five existing
    `todo(...)` fixtures gain the two required fields.
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts test/push-toggle.test.tsx`
    and `npm run typecheck -w @life/app`. NO full suites/E2E; only the four named test files run,
    the five fixture files add only the two literals (typecheck covers them), max 2.
  - [DEFINITION OF DONE]
    - [ ] The four suites cover the listed cases and pass; the five fixtures typecheck; the two greps are clean.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T10, T11. Size: S.

- [ ] T13: Five-lane verification — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Run the §7.6 gate on the final integrated state and iterate until N/N PASS.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: none (verification only; fixes re-open their owning task).
    - Reference (read-only): the working diff, `tasks/plan-todo-due-repeat-notify.md`,
      `tasks/todo-todo-due-repeat-notify.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
      `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
    - Strictly prohibited: everything (this task changes nothing).
  - [IMPLEMENTATION REQUIREMENTS] Suite gate first, exact commands:
    `npm run build -w @life/shared`; `npm run typecheck -w @life/todo-service`;
    `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/push.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts`;
    `npm run typecheck -w @life/ui`;
    `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx`;
    `npm run typecheck -w @life/app`;
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts test/push-toggle.test.tsx`.
    Then five parallel lane subagents (read-only; QA runs the suite gate), each returning
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    correctness/domain, code quality, security, QA, plan conformance. Fail-closed; any failed lane
    → fix blockers → re-run ONLY the failed lanes → repeat until N/N. Commit only on N/N, staged by
    explicit paths (never `git add -A`): the chapter's shared/UI files, todo-service source + tests,
    app source + tests (including the five fixtures), infra (`package-lock.json`, both env examples,
    `compose.yaml`), and the spec/plan/ledger files — the exact path list is in the plan T13 Step 4.
    Commit convention: Conventional Commits, e.g. `feat(todos): due time, recurrence, and Web Push reminders`.
  - [VERIFICATION & TESTING RULES] Permitted: the suite-gate commands (QA lane only). NO full
    suites/E2E, max 2 per iteration. Evidence = per-round lane reports.
  - [DEFINITION OF DONE]
    - [ ] All suite-gate commands green.
    - [ ] Five lane verdicts all PASS (N/N).
    - [ ] No partial verdict treated as done; no commit outside explicit paths.
  - Dependencies: T8, T12. Size: M.
