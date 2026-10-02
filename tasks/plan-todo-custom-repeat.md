# Implementation Plan: todo-custom-repeat (custom weekly recurrence)

Branch: `feat/todo-custom-repeat` (off `feat/todo-due-repeat-notify`; `master` stays untouched;
never merged without the user's explicit request). Module id: `todo-custom-repeat`
(see `MAP-todo-ecosystem.md`). Spec (owner, referenced by every task):
`docs/specs/SPEC-todo-custom-repeat.md`.
Specs/maps amended in this chapter: `docs/specs/SPEC-todo-service.md`,
`docs/specs/SPEC-todo-ui.md`, `docs/specs/SPEC-todo-due-repeat-notify.md`,
`docs/specs/SPEC-ui-blocks.md`, `docs/specs/MAP-ui-primitives.md`.
Ledger: `tasks/todo-todo-custom-repeat.md`.
Governing intent: `docs/intent/todo-custom-repeat.md` (C1–C6).

Process: global protocol §3 (testing policy), §5 (mandatory task template), §6 (plan-validation
gate), §7 (review), §7.6 (five-lane for feature work). Every task is in §5 template form. Test
runs are targeted, named files only, max 2 executions; no full suite, no E2E. The plan is not
executed until a `validating-plans` subagent returns PLAN VALIDATED (§6). The five-lane gate
(T11) is five parallel subagent lanes, not a shell command.

## Overview

The todo Repeat field gains a **`Custom…`** option that opens a **modal** for a **weekly**
rule on a chosen weekday set (e.g. every Thu + Fri). The change is additive end to end: the
existing flat `repeat` enum gains a `custom` value; a new plaintext `repeatDays` column holds
the ISO weekday set; the tick engine records a completion for the pre-advance due then
advances to the set's next chosen day (`done` stays false); a new `Dialog` block renders
the modal. The due date remains the first occurrence (no snapping), and the frequency
dropdown (weekly-only today) is the seam for monthly later. No row is rewritten.

## Architecture Decisions

- D1: **Additive data model** — `repeat` keeps its enum and gains `'custom'`; a new
  `repeatDays TEXT NULL` column stores the ISO weekday set as CSV (`'4,5'`). `synchronize: true`
  applies the column additively (no migration framework, no row rewrite); existing rows keep
  `repeatDays = null`. Extending to monthly later adds a sibling column, not a rewrite.
- D2: **Non-content metadata** — `repeatDays` is plaintext like `repeat`/`dueDate`/
  `reminderScheduledAt`; it is not an encrypted column and never enters the cache key.
- D3: **One owner per rule** — the recurrence math and the CSV parse/format live in
  `recurrence.ts`; the human label lives in `apps/app/lib/todo-repeat-label.ts`; the short
  weekday vocabulary lives in `@life/ui` (`date-parts.ts`). No `toLocale*` (lesson 0003).
- D4: **The rule is a set, stated once** — `nextOccurrence(local, repeat, days)` steps one
  calendar day until the ISO weekday is in `days` (≤ 7 steps), preserving time-of-day and the
  date-only/timed shape. Canned repeats ignore `days`. The tick records a completion for the
  pre-advance due then advances (`done` stays false); N2/N3, the completion half amended by
  `todo-completion-history`.
- D5: **Native `<dialog>`** — the modal is a new `Dialog` block on the platform element:
  backdrop + top-layer (cannot be clipped by `.ui-card { overflow: hidden }`) + Escape + focus
  trapping for free. No portal library, no new dependency.
- D6: **The builder is app behavior** — `recurrence-dialog.tsx` composes `Dialog` + `Select`
  (Frequency, weekly-only) + `Pill`/`PillGroup` (Mon–Sun multi-select) + `Button`
  (Confirm/Cancel). No new visual language; one new upstream primitive only (`Dialog`).
- D7: **Custom is a committed state, not a UI mode** — the Repeat `Select`'s value stays the
  committed repeat; picking `Custom…` opens the modal and does not commit; Confirm writes
  `repeat:'custom'` + days; Escape/backdrop/Cancel is a no-op. Selecting a canned option
  clears the days.
- D8: **Due is the first occurrence** (C2) — a due not in the set still fires on its own date,
  then the pattern governs.

## Task List

### Phase 1 — Spec
- [ ] T1: amend `SPEC-todo-service.md`, `SPEC-todo-ui.md`, `SPEC-todo-due-repeat-notify.md`,
      `SPEC-ui-blocks.md`, `MAP-ui-primitives.md`.

### Checkpoint: Spec
- [ ] `grep -n "repeatDays" docs/specs/SPEC-todo-service.md` non-empty.
- [ ] `grep -n "Dialog" docs/specs/MAP-ui-primitives.md` non-empty.

### Phase 2 — Shared
- [ ] T2: `@life/shared` — `'custom'` on `TODO_REPEATS`, `TODO_REPEAT_DAYS`, `repeatDays` on the
      DTOs + input types, and the app test-literal migration.

### Checkpoint: Shared
- [ ] `npm run typecheck -w @life/shared` exits 0.

### Phase 3 — UI atoms/blocks
- [ ] T3: `@life/ui` short-weekday vocabulary (`WEEKDAY_SHORT`, `weekdayShort`, `isoWeekday`)
      in `date-parts.ts` + tests.
- [ ] T4: `@life/ui` `Dialog` block (native `<dialog>`) + CSS + barrel export + tests.

### Checkpoint: UI
- [ ] `npm run typecheck -w @life/ui` exits 0.
- [ ] `npm run test:unit -w @life/ui -- test/format-date.test.ts test/dialog.test.tsx` green.

### Phase 4 — Recurrence core
- [ ] T5: `recurrence.ts` custom branch + `formatRepeatDays`/`parseRepeatDays` + unit tests.

### Checkpoint: Core math
- [ ] `npm run build -w @life/shared` then `npm run test:unit -w @life/todo-service -- test/recurrence.test.ts` green.

### Phase 5 — Todo service
- [ ] T6: entity column + DTO `repeatDays` + service write/invariant/advance/cache-row paths.
- [ ] T7: backend behavior suites + cache additions.

### Checkpoint: Service
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/todo-service` exits 0.
- [ ] `npm run test:unit -w @life/todo-service -- test/todos-custom-repeat.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts` green.

### Phase 6 — App
- [ ] T8: `repeatLabel` custom branch + `recurrence-dialog.tsx` + `todo-editor.tsx` wiring.
- [ ] T9: app tests + mechanical checks.

### Checkpoint: App
- [ ] `npm run build -w @life/shared` then `npm run typecheck -w @life/app` exits 0.
- [ ] `npm run test:unit -w @life/app -- test/routes-todo-edit.test.tsx test/todo-repeat-label.test.ts` green.

### Phase 7 — Verification
- [ ] T10: Tech Lead integration review + report.
- [ ] T11: five-lane verification (five parallel lanes; N/N PASS required).

---

### T1 — Spec amendments (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Record the custom-repeat contract in the consuming specs/maps so downstream tasks implement
  against written owners, not the chapter spec alone.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `docs/specs/SPEC-todo-service.md`, `docs/specs/SPEC-todo-ui.md`,
    `docs/specs/SPEC-todo-due-repeat-notify.md`, `docs/specs/SPEC-ui-blocks.md`,
    `docs/specs/MAP-ui-primitives.md`.
  - Reference files (read-only): `docs/specs/SPEC-todo-custom-repeat.md`, `docs/intent/todo-custom-repeat.md`.
  - Strictly prohibited files: every other file (no code).

[IMPLEMENTATION REQUIREMENTS]
  - `SPEC-todo-service.md`: the storage table gains the `repeatDays TEXT NULL` column
    (`CSV of ISO weekdays 1..7`, null = not custom); `repeat` enum gains `'custom'`; the DTO
    section records `repeatDays?: number[] | null` (exactly
    `@IsOptional() @ValidateIf((_, v) => v !== null) @IsArray() @ArrayNotEmpty() @IsIn(TODO_REPEAT_DAYS, { each: true })`,
    matching T6);
    the invariants section records `custom ⟺ non-empty days` (400 otherwise) and that any
    non-custom repeat stores `repeatDays = null`; the advance section records the BYDAY step.
    The `## Cache Rules` section records `CachedTodoRow` gaining `repeatDays` (key unchanged).
  - `SPEC-todo-due-repeat-notify.md` (the enum owner): the data-model column comment and the
    `TODO_REPEATS` literal both gain `'custom'`; note in one line that `custom` carries its
    weekday set via the `repeatDays` column owned by `todo-custom-repeat`. Do not add a
    `repeatDays` column definition to this spec; leave its Recurrence-advance section as-is
    (the set-aware detail is owned by `SPEC-todo-custom-repeat.md`).
  - `SPEC-todo-ui.md`: the editor section records the Repeat `Select` gaining `Custom…`, the
    `recurrence-dialog.tsx` composition (Frequency weekly-only + Mon–Sun multi-select), the
    no-commit-on-open / no-op-cancel behavior, and the label `Custom (Thu, Fri)`. The frozen
    selector-surface record gains `Custom repeat`, `Frequency`, `Days`, the seven day labels,
    `Confirm`, `Cancel`, `Close`.
  - `SPEC-ui-blocks.md`: add the `Dialog` block contract (the exact `DialogProps`) and its
    composition table row.
  - `MAP-ui-primitives.md`: register `Dialog` under `ui-blocks`.

[VERIFICATION & TESTING RULES]
  - Permitted command: `grep -n "repeatDays" docs/specs/SPEC-todo-service.md` and
    `grep -n "Dialog" docs/specs/MAP-ui-primitives.md`.
  - Strict constraints: docs only, NO test runs, NO E2E.

[DEFINITION OF DONE]
  - [ ] Every listed spec/map file carries the custom-repeat delta above.
  - [ ] No placeholder text; the `DialogProps` in `SPEC-ui-blocks.md` matches T4 exactly.
  - [ ] No file outside scope modified.

### T2 — Shared wire types (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Extend the `@life/shared` todo vocabulary with `'custom'`, the weekday-domain constant, and
  the `repeatDays` field on the read DTO and both input types.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/shared/src/index.ts`,
    `packages/shared/test/index.test.ts` (created — the file does not exist today), and the nine
    app test files whose
    `Todo` object literals gain `repeatDays: null` (the same migration pattern as
    `todo-due-repeat-notify` T2): `apps/app/test/todo-item.test.tsx`,
    `apps/app/test/routes-todo-edit.test.tsx`, `apps/app/test/matrix.test.ts`,
    `apps/app/test/todo-groups.test.ts`, `apps/app/test/todo-query.test.ts`,
    `apps/app/test/routes-todos-list.test.tsx`, `apps/app/test/routes-matrix.test.tsx`,
    `apps/app/test/routes-todos-trash.test.tsx`,
    `apps/app/test/routes-todos-completions.test.tsx` (created by `todo-completion-history`
    T8, commit `b15dbbd`).
  - Reference files (read-only): `docs/specs/SPEC-todo-custom-repeat.md`,
    `docs/specs/SPEC-todo-service.md`.
  - Strictly prohibited files: every other file (the service tests use `h.todos.create(...)`, not
    full row literals, so they need no migration).

[IMPLEMENTATION REQUIREMENTS]
  - `TODO_REPEATS` becomes `['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const`
    (`TodoRepeat` follows automatically).
  - Add `export const TODO_REPEAT_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;` (ISO Mon..Sun; the DTO
    `@IsIn` and tests import it — the single source of the valid-day domain).
  - `Todo` gains `repeatDays: number[] | null;` (required-but-nullable, like `important`).
  - `CreateTodoInput` and `UpdateTodoInput` gain `repeatDays?: number[] | null;` with a doc
    comment: `null`/omitted = no custom days; present only meaningful when `repeat === 'custom'`.
  - No runtime helpers in this package beyond the constants (parsing/formatting is T5's service
    concern and T8's label concern).
  - **App literal migration:** each of the nine named app test files' `Todo` object literal gains
    `repeatDays: null` (in `routes-todos-completions.test.tsx` beside `repeat: null` in the
    `todo()` factory) so `npm run typecheck -w @life/app` stays green. No app production code
    constructs a `Todo` literal (verified), so only tests change.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then `npm run typecheck -w @life/shared`,
    `npm run typecheck -w @life/app`, and `npm run test:unit -w @life/shared -- test/index.test.ts`.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `TODO_REPEATS` includes `'custom'`; `TODO_REPEAT_DAYS` is exported.
  - [ ] `Todo.repeatDays`, `CreateTodoInput.repeatDays`, `UpdateTodoInput.repeatDays` exist with
        the exact types above.
  - [ ] All nine app test files carry `repeatDays: null` in their `Todo` literal.
  - [ ] `npm run typecheck -w @life/shared` and `npm run typecheck -w @life/app` pass with zero
        errors; no file outside scope.

### T3 — UI short-weekday vocabulary (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Add the single owner of short weekday names and ISO weekday numbers, used by the day picker
  (T8) and the label (T8), read from the ISO string (never `toLocale*`).

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/lib/date-parts.ts`,
    `packages/ui/src/index.ts` (barrel export), `packages/ui/test/format-date.test.ts` (append cases).
  - Reference files (read-only): `packages/ui/src/lib/format-date.ts` (long weekday owner),
    `docs/intent/todo-custom-repeat.md`.
  - Strictly prohibited files: every other file.

[IMPLEMENTATION REQUIREMENTS]
  - `export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;`
    indexed by `ISO weekday − 1` (ISO 1 = Monday).
  - `export function isoWeekday(iso: string): number` — the ISO weekday `1..7` of an ISO date
    or datetime, computed via `Date.UTC(...).getUTCDay()` mapped `0(Sun)→7`, `1(Mon)→1`; `0`
    for empty/malformed input (mirrors `formatWeekday`'s guard).
  - `export function weekdayShort(iso: string): string` — `WEEKDAY_SHORT[isoWeekday(iso)-1]`,
    `''` when `isoWeekday` is `0`.
  - Reuse the existing `datePart`/`isRealDate` guards (`format-date.ts` precedent); place the
    helpers in `date-parts.ts` beside the other ISO-string owners. Export `isoWeekday` and
    `WEEKDAY_SHORT` from the package barrel (`packages/ui/src/index.ts`) — T8 imports them.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/ui` then
    `npm run test:unit -w @life/ui -- test/format-date.test.ts`.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `isoWeekday('2026-10-05')` is `1` (Monday); `'2026-10-08'` is `4` (Thursday).
  - [ ] `weekdayShort('2026-10-08')` is `'Thu'`; malformed input is `''`.
  - [ ] Helpers are exported from `@life/ui` (`packages/ui/src/index.ts`); `npm run typecheck -w
        @life/ui` passes; no file outside scope.

### T4 — `Dialog` block (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Add the reusable `Dialog` block on the native `<dialog>` element.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/components/dialog.tsx` (new),
    `packages/ui/src/index.ts`, `packages/ui/src/styles/blocks.css`, `packages/ui/test/dialog.test.tsx`.
  - Reference files (read-only): `packages/ui/src/components/icon-button.tsx`,
    `packages/ui/src/components/settings-block.tsx` (block precedent), `packages/ui/src/styles/tokens.css`.
  - Strictly prohibited files: every other file (`tokens.css` untouched — no new token).

[IMPLEMENTATION REQUIREMENTS]
  - `'use client'`. Controlled, stores NO open state:
    ```ts
    export interface DialogProps {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      title: ReactNode;
      children: ReactNode;
      footer?: ReactNode;
      className?: string;
    }
    ```
  - Renders a real `<dialog ref>` (the platform element; exempt plumbing like `layout.tsx`'s
    `html`/`body`, and unavoidable for a dialog). Structure: `.ui-dialog` root; a
    `.ui-dialog__head` with `.ui-dialog__title` and an `IconButton` (`X`, label `Close`) that
    calls `onOpenChange(false)`; a `.ui-dialog__body` for `children`; an optional
    `.ui-dialog__footer` for `footer`.
  - A client-only `useEffect` on `open` calls the native methods normally and unguarded —
    `open ? el.showModal() : el.close()`; attach a `close` listener on the element mapping to
    `onOpenChange(false)` (covers Escape and backdrop). Guard against the `close` event
    re-entrancy (only call when currently `open`). jsdom 20 (`testEnvironment: "jsdom"`,
    `packages/ui/package.json`) does not implement `showModal`/`close`, so the component never
    feature-detects them; the test owns the shim (next bullet).
  - `dialog.test.tsx` installs the jsdom shim: in a `beforeEach` (or setup block in the spec file)
    assign `HTMLDialogElement.prototype.showModal = jest.fn()` and
    `HTMLDialogElement.prototype.close = jest.fn()` (cast to satisfy TS), then assert against
    those mocks rather than the element's native open state.
  - CSS in `blocks.css` (tokens only, NO new token — token values are a frozen human-owned
    surface, `AGENTS.md` frozen-surfaces): `.ui-dialog` (`--panel`, `--radius-lg`, padding from
    `--space-*`, `border`), `.ui-dialog__head`/`__title`/`__body`/`__footer` layout via tokens.
    **Do NOT style `.ui-dialog::backdrop`** — the native `<dialog>`'s platform-default backdrop
    already dims the page; overriding it would need a colour literal, which is forbidden outside
    `tokens.css`. `tokens.css` is untouched by this task.
  - Export `Dialog`/`DialogProps` from the barrel.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/ui` then
    `npm run test:unit -w @life/ui -- test/dialog.test.tsx`.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `Dialog` matches the contract; no internal open state.
  - [ ] `dialog.test.tsx` owns the jsdom shim (`showModal`/`close` jest mocks installed in the
        spec's setup) and covers: closed → `showModal` not called; `open` → `showModal` called;
        the `Close` `IconButton` → `onOpenChange(false)`; dispatching the element's `close` event
        → `onOpenChange(false)`; footer renders when provided. The T4 checkpoint command
        (`test/format-date.test.ts test/dialog.test.tsx`) is green under this shim.
  - [ ] `tokens.css` and `packages/ui/test/tokens.test.ts` are untouched (frozen surface preserved).
  - [ ] No raw hex/rgb/px in `blocks.css`; no `::backdrop` colour override; `npm run typecheck -w @life/ui`
        passes; no file outside scope.

### T5 — Recurrence custom branch (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Extend the pure recurrence helpers with the custom BYDAY step and the CSV parse/format owners.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `apps/todo-service/src/todos/recurrence.ts`,
    `apps/todo-service/test/recurrence.test.ts`.
  - Reference files (read-only): `packages/shared/src/index.ts` (`TodoRepeat`, `TODO_REPEAT_DAYS`),
    `apps/todo-service/src/todos/todos.service.ts` (advance call site).
  - Strictly prohibited files: every other file (service wiring is T6).

[IMPLEMENTATION REQUIREMENTS]
  - `nextOccurrence(local: string, repeat: TodoRepeat, days: number[] | null = null): string` —
    canned branches unchanged; `repeat === 'custom'` loops `p.d += 1; normalize(p);` until
    `iso(p)` is in `days` (≤ 7 steps; if `days` is null/empty, return `local` unchanged — the
    service never lets that state persist). `iso(y,m,d)` = the existing UTC `weekday` mapped
    `0(Sun)→7`.
  - `advanceToOnOrAfter(local, repeat, nowLocal, days = null): string` — `days` is appended
    LAST for backward compatibility, so the existing 3-arg calls in `recurrence.test.ts` stay
    valid; loops `nextOccurrence` with `days` while `candidate < nowLocal`.
  - Add the CSV owners:
    - `export function formatRepeatDays(days: number[] | null): string | null` — sorted unique
      `'4,5'`, or `null` for null/empty.
    - `export function parseRepeatDays(csv: string | null): number[] | null` — `'4,5'` → `[4,5]`,
      `null`/`''` → `null`; drops out-of-range values defensively.
  - No new dependency; keep the helpers pure and UTC-calendar based (no host zone).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run test:unit -w @life/todo-service -- test/recurrence.test.ts`.
  - Strict constraints: NO full suites, NO E2E; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `recurrence.test.ts` covers: custom `[4,5]` from Thu → Fri; Fri → next Thu; a due outside
        the set (Mon) → next chosen day (Thu); `[1..7]` behaves as daily; time-of-day preserved;
        date-only vs timed shape preserved; `advanceToOnOrAfter` converges and never returns a
        past occurrence; `formatRepeatDays([5,4,4])` === `'4,5'`; `parseRepeatDays('4,5')` === `[4,5]`.
  - [ ] Canned-repeat cases from the existing suite still pass.
  - [ ] No file outside scope.

### T6 — Todo service + entity + DTOs (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Persist and validate the custom day set, enforce the invariants, and match the set on the
  advance path and in the cache row.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit: `apps/todo-service/src/todos/todo.entity.ts`,
    `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/todos/dto/create-todo.dto.ts`,
    `apps/todo-service/src/todos/dto/update-todo.dto.ts`.
  - Reference files (read-only): `apps/todo-service/src/todos/recurrence.ts` (T5),
    `packages/shared/src/index.ts`, `apps/todo-service/src/cache/todo-cache.ts`.
  - Strictly prohibited files: every other file (behavior tests are T7).

[IMPLEMENTATION REQUIREMENTS]
  - Entity: `@Column({ type: 'text', nullable: true }) repeatDays: string | null;` (CSV as stored).
  - DTOs (both): add
    `@IsOptional() @ValidateIf((_, v) => v !== null) @IsArray() @ArrayNotEmpty() @IsIn(TODO_REPEAT_DAYS, { each: true }) repeatDays?: number[] | null;`.
    `repeat`'s `@IsIn(TODO_REPEATS)` now admits `'custom'` automatically (T2).
  - `todos.service.ts`:
    - New private helper on `TodosService`:
      `private normalizeRepeat(repeat: TodoRepeat | null, days: number[] | null): number[] | null`
      — throws `BadRequestException('custom repeat requires repeatDays')` when `repeat === 'custom'`
      and `days` is null/empty; returns `null` for any non-custom repeat (a provided set is
      normalized away); otherwise returns the non-empty `days`.
    - `create(input)`: resolve `const days = this.normalizeRepeat(input.repeat ?? null, input.repeatDays ?? null)`;
      store `repeat`, `repeatDays: formatRepeatDays(days)`.
    - `update(patch)`: after resolving the resulting `dueDate`/`repeat`, apply `patch.repeatDays`
      when `patch.repeat !== undefined || patch.repeatDays !== undefined` (a repeat change without
      days clears days; a days change without repeat keeps the repeat), then run the same
      `normalizeRepeat` against the resulting pair. Clearing the due sets `repeat = null` **and**
      `repeatDays = null`. The existing repeat-requires-due 400 is unchanged.
    - Advance-on-tick: pass the parsed days as the trailing arg to
      `advanceToOnOrAfter(local, repeat, nowLocal, parseRepeatDays(todo.repeatDays))`.
    - **Integration into the completion transaction (critical):** `update()`'s `done` branch is
      now a single `this.dataSource.transaction` carrying the three completion rules landed by
      `todo-completion-history` (T5 of that plan; the current code at the `update()` `done`
      branch). The custom advance logic must be integrated **into that existing transaction
      branch** — replace the internal `advanceToOnOrAfter(local, todo.repeat!, this.nowLocal())`
      call with the set-aware form passing `parseRepeatDays(todo.repeatDays)` as the trailing
      arg — while **preserving** the `writeCompletion(manager, sub, id, occurrence, …)` call for
      the pre-advance due, the `reminderScheduledAt` recompute, and `todo.done = false`. It must
      **not** reintroduce the old linear `this.todos.save(todo)` path for a `done` patch and
      must **not** drop the completion write. The one-off tick, un-complete one-off, and
      un-complete-repeating branches are untouched.
    - `CachedTodoRow` gains `repeatDays: number[] | null`; `toCachedTodoRow` maps
      `parseRepeatDays(todo.repeatDays)`; `decodeCachedTodoRow` passes it through; the read DTO
      in `decodeCachedTodoRow` carries `repeatDays`.
    - The cache key, ciphertext guards, and `reminderAt` are unchanged (D2).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run typecheck -w @life/todo-service`.
  - Strict constraints: NO full suites, NO E2E (behavior is T7); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Entity carries `repeatDays` text column; DTOs validate the day array.
  - [ ] `custom` with no days is a 400; any non-custom repeat stores `repeatDays = null`;
        clearing the due clears both; the repeat-requires-due rule still holds.
  - [ ] A custom tick records a completion for the pre-advance due inside the existing
        `dataSource.transaction` branch, then advances to the next chosen day (via
        `advanceToOnOrAfter` with the parsed set), keeping `done: false`.
  - [ ] `CachedTodoRow` and the read DTO carry `repeatDays`; the cache key is unchanged.
  - [ ] `npm run typecheck -w @life/todo-service` passes; no file outside scope.

### T7 — Backend behavior suites (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Prove the custom contract end to end at the service boundary, including the cache assertion.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/todo-service/test/todos-custom-repeat.e2e-spec.ts` (new),
    `apps/todo-service/test/todo-cache.e2e-spec.ts` (append a `repeatDays` assertion),
    `apps/todo-service/test/todos.e2e-spec.ts` (update the exact DTO key-set array),
    `apps/todo-service/test/ownership.e2e-spec.ts` (update the exact DTO key-set array).
  - Reference files (read-only): `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/test/todos-due-repeat.e2e-spec.ts` (pattern).
  - Strictly prohibited files: every other file.

[IMPLEMENTATION REQUIREMENTS]
  - Required key-set edits (adding the required `repeatDays` key to the read DTO) in both
    exact-key-set suites:
    - `todos.e2e-spec.ts` `'creates a todo with version 0 and the exact DTO key set'`
      (~lines 108–124): insert `'repeatDays',` into the `Object.keys(created.body).sort()` array
      (between `'repeat'` and `'tagIds'`).
    - `ownership.e2e-spec.ts` `'serializes no owner field in the TodoDto (list and get)'`
      (~lines 214–230): insert `'repeatDays',` into the `todoKeys` array (between `'repeat'` and
      `'tagIds'`), which both `expect(Object.keys(...).sort()).toEqual(todoKeys)` assertions
      (~lines 240, 248) then cover.
  - New suite covers: create with `repeat:'custom', repeatDays:[4,5]` round-trips `repeatDays:[4,5]`;
    update sets/clears days; `custom` with no days → 400 `'custom repeat requires repeatDays'`;
    a non-custom repeat with days normalizes days to `null`; clearing the due clears repeat + days;
    the tick records a completion for the pre-advance due then jumps a Thu+Fri todo to the next
    chosen day and recomputes `reminderScheduledAt`; the same tick **records exactly one
    `todo_completion` row for the pre-advance due** (assert via the harness `dataSource`) and
    keeps `done:false`;
    the repeat-requires-due 400 still fires for `custom`.
  - Cache assertion: a stored custom todo's cached row carries `repeatDays` and the serialized
    values still contain `enc.v1.` with no known plaintext (the existing ciphertext test pattern).

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then
    `npm run test:unit -w @life/todo-service -- test/todos-custom-repeat.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts`.
  - Strict constraints: NO full suites, NO E2E; only these named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Every behavior above has a passing test.
  - [ ] `todo-cache.e2e-spec.ts` asserts `repeatDays` presence and the ciphertext invariant.
  - [ ] Both exact-key-set arrays (`todos.e2e-spec.ts`, `ownership.e2e-spec.ts`) include
        `repeatDays`.
  - [ ] The four named suites pass; no file outside scope.

### T8 — App label + dialog + editor wiring (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Render the custom label, the recurrence modal, and the editor wiring that opens it without
  committing until Confirm.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/todo-repeat-label.ts`,
    `apps/app/app/recurrence-dialog.tsx` (new), `apps/app/app/todo-editor.tsx`,
    `apps/app/app/todo-item.tsx` (updated `repeatLabel` call).
  - Reference files (read-only): `packages/ui/src/components/dialog.tsx` (T4),
    `packages/ui/src/lib/date-parts.ts` (T3), `packages/ui/src/components/select.tsx`,
    `packages/ui/src/components/pill.tsx`, `apps/app/app/todo-actions.ts`.
  - Strictly prohibited files: every other file (tests are T9).

[IMPLEMENTATION REQUIREMENTS]
  - `repeatLabel(repeat, dueDate?, repeatDays?)`: `custom` → `Custom (Thu, Fri)` — the days
    sorted ISO Mon→Sun and mapped directly through `@life/ui` `WEEKDAY_SHORT[i-1]` (the short
    label for ISO weekday `i`; never `toLocale*`). `weekdayShort(iso)` (T3) is only for turning a
    date into its short name and is not used here; empty days → bare `Custom`. The other repeats
    are unchanged.
  - `recurrence-dialog.tsx` (`'use client'`), props
    `{ open, onOpenChange, dueDate: string, value: number[], onConfirm(days: number[]) }`:
    - `Dialog` titled `Custom repeat`.
    - `Select` aria-label `Frequency`, one option `Weekly` (value `'weekly'`), value fixed to
      `'weekly'` (the extension seam; no other option yet).
    - Seven `Pill as="button" size="chip"` toggles labelled `Mon`…`Sun` (from `WEEKDAY_SHORT`),
      `active` = selected, `aria-pressed`; local draft state seeded when opened from the committed
      `value` when non-empty, else `[isoWeekday(dueDate)]` when `dueDate` is a valid date, else
      `[]` (C3). Wrapped in a visible `PillGroup label="Days"`.
    - Footer: `Button variant="ghost"` `Cancel` (→ `onOpenChange(false)`) and `Button` `Confirm`
      (primary, disabled while the draft is empty) → `onConfirm(draft)` then `onOpenChange(false)`.
  - `todo-editor.tsx`:
    - Add `const [repeatDays, setRepeatDays] = useState<number[]>(todo?.repeatDays ?? [])` and
      `const [recurrenceOpen, setRecurrenceOpen] = useState(false)`.
    - Repeat `Select` options: the canned `TODO_REPEATS` (excluding `'custom'`) + a `'custom'`
      entry whose label is `repeatLabel('custom', dueDate, repeatDays)` when committed, else
      `Custom…`. `onChange`: a canned value → `setRepeat(value); setRepeatDays([])`;
      `'custom'` → `setRecurrenceOpen(true)` **without** calling `setRepeat` (the controlled
      Select snaps back to the committed value).
    - Render `<RecurrenceDialog open={recurrenceOpen} onOpenChange={setRecurrenceOpen}
      dueDate={dueDate} value={repeatDays} onConfirm={(days) => { setRepeat('custom');
      setRepeatDays(days); }} />`.
    - `onDueDateChange('')` cascade also resets `repeatDays` to `[]` and closes the dialog.
    - Save payload: `repeat`, and `repeatDays: repeat === 'custom' ? repeatDays : undefined`.
  - `todo-item.tsx`: the row caller updates to
    `repeatLabel(todo.repeat, todo.dueDate, todo.repeatDays)` so a custom row renders the concrete
    days instead of a bare `Custom`.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run build -w @life/shared` then `npm run typecheck -w @life/app`.
  - Strict constraints: NO full suites, NO E2E (app tests are T9); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] `repeatLabel('custom', due, [4,5])` === `'Custom (Thu, Fri)'`; `[]` → `'Custom'`.
  - [ ] The modal composes only `Dialog`/`Select`/`Pill`/`PillGroup`/`Button`; no raw `<button>`/
    `<select>`/`<input>` in `recurrence-dialog.tsx` or the editor.
  - [ ] Picking `Custom…` opens the modal and does not change the committed repeat; Confirm sets
    `repeat:'custom'` + days; Cancel/Escape is a no-op; the due-clear cascade resets days.
  - [ ] The save payload omits `repeatDays` for non-custom repeats.
  - [ ] `todo-item.tsx` calls `repeatLabel(todo.repeat, todo.dueDate, todo.repeatDays)`.
  - [ ] `npm run typecheck -w @life/app` passes; no file outside scope.

### T9 — App tests + mechanical checks (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Prove the app wiring at the element-tree boundary and run the UI mechanical checks.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/test/todo-repeat-label.test.ts` (append custom cases —
    the file already exists with passing canned-repeat cases),
    `apps/app/test/routes-todo-edit.test.tsx` (append custom cases),
    `apps/app/test/routes-todo-edit.test.tsx` helpers.
  - Reference files (read-only): `apps/app/test/routes-todo-edit.test.tsx` (existing harness),
    `apps/app/app/recurrence-dialog.tsx`, `apps/app/lib/todo-repeat-label.ts`.
  - Strictly prohibited files: every other file.

[IMPLEMENTATION REQUIREMENTS]
  - Extend the existing `todo-repeat-label.test.ts` suite (it already has passing canned-repeat
    cases): add `custom` with `[4,5]` → `'Custom (Thu, Fri)'` (Tue is `[2]`); unsorted input
    `[5,4]` sorts; `[]`/null days → `'Custom'`; the canned repeats stay unchanged.
  - Editor suite (existing `stateHarness` + `findByType` pattern): the Repeat `Select` includes a
    `'custom'` option; its `onChange('custom')` does NOT change `select.props.value` for the
    committed repeat (still whatever was committed / `''`) but the tree now contains a
    `RecurrenceDialog` with `open: true`; `onConfirm([4,5])` then saving sends
    `repeat: 'custom', repeatDays: [4,5]`; clearing the due resets `repeatDays` to `[]` and closes
    the dialog; a saved custom todo seeds `repeatDays` from `todo.repeatDays`.
  - Mechanical checks (report output):
    - `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
      → only test files match.
    - `grep -rn "next/link" apps --include='*.tsx'` → zero hits.
    - `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → only
      `tokens.css`.

[VERIFICATION & TESTING RULES]
  - Permitted test command: `npm run typecheck -w @life/app` then
    `npm run test:unit -w @life/app -- test/todo-repeat-label.test.ts test/routes-todo-edit.test.tsx`.
  - Strict constraints: NO full suites, NO E2E; only these named files; max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Every case above passes.
  - [ ] The three mechanical greps return only the allowed hits.
  - [ ] No file outside scope.

### T10 — Integration review + report (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Tech Lead verification across the integrated boundary and a written report.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `tasks/report-todo-custom-repeat.md` (new).
  - Reference files (read-only): every changed file; the spec; the intent.
  - Strictly prohibited files: every other file.

[IMPLEMENTATION REQUIREMENTS]
  - Run the full mechanical checks, both typechecks, and the named targeted suites; inspect the
    diff for out-of-scope edits; confirm every success criterion in `SPEC-todo-custom-repeat.md`
    is met; record commands with results in the report.

[VERIFICATION & TESTING RULES]
  - Permitted commands: the typechecks, the named suites, and the mechanical greps (each ≤ 2 runs).
  - Strict constraints: NO full suites, NO E2E.

[DEFINITION OF DONE]
  - [ ] The report lists each command + result and each success criterion + evidence.
  - [ ] No file outside scope modified.

### T11 — Five-lane verification (module `todo-custom-repeat`)

[TASK OBJECTIVE]
  Run the §7.6 five-lane gate before any merge/commit of the chapter as done.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `tasks/five-lane-todo-custom-repeat.md` (new).
  - Reference files (read-only): the diff, the spec, the intent, the repo `AGENTS.md`.
  - Strictly prohibited files: every other file (lanes are read-only reviewers).

[IMPLEMENTATION REQUIREMENTS]
  - Five parallel fresh-context lanes — correctness, code quality, security, QA, plan-conformance —
    each returning PASS/FAIL; fail-closed (a crashed/empty lane is a failure). Fix blockers, re-run
    ONLY failed lanes, repeat until N/N PASS. Sequence the suite gate first within §3 limits.

[VERIFICATION & TESTING RULES]
  - Permitted commands: the targeted suites/typechecks the lane needs (≤ 2 runs each).
  - Strict constraints: NO full suites, NO E2E.

[DEFINITION OF DONE]
  - [ ] Five lane verdicts, all PASS; the report records them.
  - [ ] No file outside scope modified.
