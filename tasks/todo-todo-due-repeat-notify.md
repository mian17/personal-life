# Task Ledger: todo-due-repeat-notify (due time + recurrence + Web Push reminders)

Plan: `tasks/plan-todo-due-repeat-notify.md` · Spec (owner):
`docs/specs/SPEC-todo-due-repeat-notify.md` · Specs amended (T1):
`docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
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
    - Allowed files to edit/create: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`.
    - Reference (read-only): `docs/specs/SPEC-todo-due-repeat-notify.md`,
      `docs/specs/MAP-todo-ecosystem.md`, `docs/specs/MAP-redis.md`,
      `docs/intent/todo-due-repeat-notify.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `repeat`/`reminderScheduledAt` columns + `push_subscription`
    table; `dueDate` holds date-only or canonical instant; DTO fields + repeat-requires-due +
    advance-on-tick; `/api/push/key` + `/api/push/subscribe` routes; Cache Rules gain the two
    plaintext fields and the recorded sweep deviation; spec gains the new testing group; recurrence
    leaves the "v2" Ask-first list; SPEC-todo-ui names the editor `Time`/`Repeat`, the row display,
    no-hide-on-recurring-tick, and the settings Reminders block + `sw.js`.
  - [VERIFICATION & TESTING RULES] Permitted: none (docs task). Verify
    `grep -n "reminderScheduledAt" docs/specs/SPEC-todo-service.md` and
    `grep -n "Due time" docs/specs/SPEC-todo-ui.md` non-empty. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] Both greps return non-empty.
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
  - [IMPLEMENTATION REQUIREMENTS] `export type TodoRepeat = 'daily'|'weekdays'|'weekly'|'monthly'|'yearly';`;
    `Todo` gains `repeat: TodoRepeat|null` + `reminderScheduledAt: string|null`; `CreateTodoInput`
    and `UpdateTodoInput` gain `repeat?: TodoRepeat|null`; add
    `export interface PushSubscribeInput { endpoint: string; keys: { p256dh: string; auth: string } }`.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/shared`. NO full
    suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] All listed types exist exactly as specified.
    - [ ] `npm run typecheck -w @life/shared` passes with zero errors.
    - [ ] No file outside scope modified.
  - Dependencies: T1. Size: XS.

- [ ] T3: UI date helpers — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] One `@life/ui` helper owns the local day and the timed/date label.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `packages/ui/src/lib/format-date.ts`,
      `packages/ui/src/components/due-date-pill.tsx`, `packages/ui/src/index.ts`,
      `packages/ui/test/format-date.test.ts`, `packages/ui/test/due-date-pill.test.tsx`.
    - Reference (read-only): `packages/ui/src/components/due-date.tsx`, `docs/lessons/0003-*.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `dueDay(value)` → local `YYYY-MM-DD` (date-only: own parts, no
    `Date`; timed: local getters); `dueDateLabel` adds `Today/Tomorrow/dd-mm-yyyy HH:mm` for timed;
    `dueDateState` compares `dueDay` (day-granular); export `dueDay` from `index.ts`; `dueDate.tsx`
    unchanged. Update the two tests for timed values + date-only non-regression.
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx` and
    `npm run typecheck -w @life/ui`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] `dueDay` is the single day-derivation helper, exported.
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
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts` and
    `npm run typecheck -w @life/todo-service`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] Every listed signature exists exactly.
    - [ ] Tests cover fixed-offset + DST zones, date-only untouched, sort key, daily/weekdays/
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
      `apps/todo-service/src/todos/dto/update-todo.dto.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/due-time.ts`,
      `apps/todo-service/src/todos/recurrence.ts`, `apps/todo-service/src/todos/todo.entity.ts`,
      `packages/shared/src/index.ts`, `apps/todo-service/src/cache/todo-cache.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] DTOs accept `ISO_DUE` + optional `repeat` (nullable pattern);
    `normalizeDue`, `reminderAt`; create/update store `repeat` + normalized due +
    `reminderScheduledAt`; repeat-requires-due → 400; advance-on-tick for recurring;
    `compareTodos`/cursor use `dueSortKey`; `CachedTodoRow` carries `repeat`/`reminderScheduledAt`
    verbatim; ciphertext guards unchanged.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/todo-service`.
    NO full suites/E2E (behavior is T8), max 2.
  - [DEFINITION OF DONE]
    - [ ] Timed→instant, date-only verbatim; repeat-without-due 400; recurring tick advances and
          stays open; non-recurring tick unchanged.
    - [ ] `CachedTodoRow` carries both fields; guards untouched; ordering/cursor use `dueSortKey`.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T4. Size: L (one bounded concern: the todo due/repeat data layer).

- [ ] T6: Push subscription module — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Store the Web Push subscription and serve the VAPID public key.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/src/push/push-subscription.entity.ts` (new),
      `apps/todo-service/src/push/push.service.ts` (new),
      `apps/todo-service/src/push/push.controller.ts` (new),
      `apps/todo-service/src/push/push.module.ts` (new),
      `apps/todo-service/src/app.module.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/todos.module.ts`,
      `apps/todo-service/src/todos/todos.controller.ts`, `apps/todo-service/src/keys/keys.module.ts`,
      `apps/todo-service/src/auth/auth.guard.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `PushSubscription` entity (`endpoint` unique, `ownerSub` indexed);
    `PushService` (`getPublicKey`, `subscribe` upsert-by-endpoint, `unsubscribe` idempotent,
    `listFor`); `PushController` `GET key`, `POST/DELETE subscribe`; `PushModule` registered;
    `push_subscription` outside the cache.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/todo-service`.
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
      `apps/todo-service/src/todos/todos.module.ts` (export a thin `markReminded` seam if wiring
      requires), `apps/todo-service/package.json` (add `web-push` + `@types/web-push`),
      `apps/todo-service/src/app.module.ts`.
    - Reference (read-only): `apps/todo-service/src/todos/todos.service.ts` (decrypt + generation
      bump), `apps/todo-service/src/push/push.service.ts`, `apps/todo-service/src/keys/keys.service.ts`,
      `packages/cache/src/index.ts`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] `PushSender` interface + `WebPushSender` (`web-push`);
    `ReminderService.sweep()` (one DB query for `deletedAt IS NULL AND done=0 AND
    reminderScheduledAt IS NOT NULL AND <= now`; decrypt title; send; clear; bump; delete on
    404/410); `RemindersModule` with `setInterval(30s)` in `onModuleInit` and clear in
    `onModuleDestroy`; missing VAPID env ⇒ no-op. No scheduler dep. Dockerfile glob-inclusive
    (verify).
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/todo-service` and
    `npm run build -w @life/todo-service`. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] `sweep()` fires once per due row, clears/re-arms correctly, skips done/trashed/null.
    - [ ] Missing VAPID env ⇒ no-op; build passes.
    - [ ] Typecheck + build pass; no file outside scope modified.
  - Dependencies: T5, T6. Size: M.

- [ ] T8: Backend tests — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Prove the due/repeat/reminder/advance behavior and the sweep.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/todo-service/test/todos-due-repeat.e2e-spec.ts` (new),
      `apps/todo-service/test/reminders.e2e-spec.ts` (new),
      `apps/todo-service/test/todo-cache.e2e-spec.ts`.
    - Reference (read-only): `apps/todo-service/test/todo-harness.ts`,
      `apps/todo-service/test/fake-redis.ts`, `apps/todo-service/test/todos.e2e-spec.ts`.
    - Strictly prohibited: every production source file (a failing gate re-opens T5/T6/T7).
  - [IMPLEMENTATION REQUIREMENTS] As in the plan: timed round-trip + reminder present; date-only
    09:00; repeat-requires-due 400; daily-missed advance; weekdays Fri→Mon; monthly clamp;
    non-recurring done; clear-due clears reminder; `dueSortKey` order. Reminders: fake `PushSender`,
    exactly-once, clear + bump, 404/410 delete, no-VAPID no-op, done/trashed skip. Cache:
    `todo:all`/`todo:trash` carry both fields, `enc.v1.`-only, sweep-clear bump. No production edit
    to pass.
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/todo-service -- test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/todo-cache.e2e-spec.ts`
    and `npm run typecheck -w @life/todo-service`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] The three suites cover every case above.
    - [ ] The prescribed three-file command passes; typecheck passes.
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
    `subscribePushAction`/`unsubscribePushAction` in `todo-actions.ts`; `push-client.ts` client
    helper returning explicit `unsupported`/`not-installed`/`denied` reasons; reuse `callService`.
  - [VERIFICATION & TESTING RULES] Permitted: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/app`. NO full suites/E2E, max 2.
  - [DEFINITION OF DONE]
    - [ ] Three BFF functions + two actions exist with exact paths/methods.
    - [ ] `push-client.ts` handles unsupported/not-installed/denied without throwing.
    - [ ] Build + typecheck pass; no file outside scope modified.
  - Dependencies: T6. Size: S.

- [ ] T10: App UI editor + row — module `todo-due-repeat-notify`
  - [TASK OBJECTIVE] Editor Time/Repeat fields, row time/repeat display, recurring tick doesn't
    hide, matrix urgency timed-safe.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed: `apps/app/app/todo-editor.tsx`, `apps/app/app/todo-item.tsx`, `apps/app/lib/matrix.ts`.
    - Reference (read-only): `packages/ui/src/index.ts`, `apps/app/lib/todo-groups.ts`,
      `docs/specs/SPEC-todo-ui.md`.
    - Strictly prohibited: every file not listed above.
  - [IMPLEMENTATION REQUIREMENTS] Primitive reuse: `PillGroup`+`Input type="time"` (Time),
    `PillGroup`+`Pill as="button" size="chip"` (Repeat), unchanged date field, `DueDate` (row).
    Editor joins date+time + carries `repeat`; repeat-with-no-due blocks save. Row shows the timed
    label + repeat label; `DoneToggle` hide/collapsing gated on `!todo.repeat`. `matrix.ts`
    `isUrgent` uses `dueDay`/`dueDateState` (timed-tomorrow still urgent).
  - [VERIFICATION & TESTING RULES] Permitted: `npm run typecheck -w @life/app` and
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts`.
    NO full suites/E2E, only these files, max 2.
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
    client `PushToggle` seeding `installed`/`supported`/`permission` and calling the T9 client;
    `sw.js` handles `push` (showNotification with `data.url`) + `notificationclick` (focus/open
    `/todos/<id>`); no PWA constant change.
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
      `apps/app/test/matrix.test.ts`.
    - Reference (read-only): `apps/app/app/todo-editor.tsx`, `apps/app/app/todo-item.tsx`,
      `apps/app/lib/matrix.ts`, `packages/ui/src/index.ts`, `AGENTS.md` (Contract 1 checks).
    - Strictly prohibited: every production source file (a failing test re-opens T10/T11).
  - [IMPLEMENTATION REQUIREMENTS] As in the plan: editor payload join+repeat; row timed/repeat
    label + no-hide recurring tick; `isUrgent` timed today/tomorrow; the two Contract 1 greps clean.
  - [VERIFICATION & TESTING RULES] Permitted:
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts`
    and `npm run typecheck -w @life/app`. NO full suites/E2E, only these files, max 2.
  - [DEFINITION OF DONE]
    - [ ] The three suites cover the listed cases and pass; the two greps are clean.
    - [ ] Typecheck passes; no file outside scope modified.
  - Dependencies: T10. Size: S.

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
    `npm run test:unit -w @life/todo-service -- test/due-time.test.ts test/recurrence.test.ts test/todos-due-repeat.e2e-spec.ts test/reminders.e2e-spec.ts test/todo-cache.e2e-spec.ts`;
    `npm run typecheck -w @life/ui`;
    `npm run test:unit -w @life/ui -- test/format-date.test.ts test/due-date-pill.test.tsx`;
    `npm run typecheck -w @life/app`;
    `npm run test:unit -w @life/app -- test/todo-item.test.tsx test/routes-todo-edit.test.tsx test/matrix.test.ts`.
    Then five parallel lane subagents (read-only; QA runs the suite gate), each returning
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    correctness/domain, code quality, security, QA, plan conformance. Fail-closed; any failed lane
    → fix blockers → re-run ONLY the failed lanes → repeat until N/N. Commit only on N/N, staged by
    explicit paths.
  - [VERIFICATION & TESTING RULES] Permitted: the suite-gate commands (QA lane only). NO full
    suites/E2E, max 2 per iteration. Evidence = per-round lane reports.
  - [DEFINITION OF DONE]
    - [ ] All suite-gate commands green.
    - [ ] Five lane verdicts all PASS (N/N).
    - [ ] No partial verdict treated as done; no commit outside explicit paths.
  - Dependencies: T8, T12. Size: M.
