# Spec: todo-custom-repeat (custom weekly recurrence)

Module id: `todo-custom-repeat` (map: `docs/specs/MAP-todo-ecosystem.md`). Backend + UI
capability of the todo ecosystem. Traces to intent: `docs/intent/todo-custom-repeat.md`
(locked decisions C1–C6).

Extends two existing modules: `todo-due-repeat-notify` (the `repeat` field, the tick engine
that **records a completion then advances**, the reminder record) and `todo-ui` (the editor's
Repeat field). It does not change how any existing canned repeat behaves.

## Objective

Let a todo repeat on a **chosen set of weekdays** (e.g. every **Thu + Fri**) — a
fixed-calendar pattern the five canned repeats cannot express. The editor's Repeat field
gains a **`Custom…`** option that opens a **modal**: a **Frequency** dropdown (only
*Weekly* today, the seam for monthly later) over a **Mon–Sun multi-select**. Confirming
sets a weekly rule on the chosen day(s); the field then reads the concrete days
(`Custom (Thu, Fri)`).

Success looks like: the user edits a todo due Mon Oct 5, picks Repeat → `Custom…`, opens
the modal (Thursday pre-ticked from the due), ticks Fri, Confirms; the field reads
`Custom (Thu, Fri)`; ticking the todo advances it to Thu Oct 8 (the next chosen weekday),
then Oct 9, then Oct 15 …; each occurrence fires its push reminder. The due date itself
was never moved — it stays the first occurrence.

User: the single account owner, in the todos app editor (shared `@life/ui` surface).

## Tech Stack

Inherited unchanged: React 19 / Next App Router (`apps/app`), NestJS + TypeORM +
better-sqlite3 (`apps/todo-service`), Redis read-through cache, `@life/crypto` at rest,
`@life/shared` wire types, `@life/ui` primitives. No new dependency. The modal uses the
**native `<dialog>` element** (no portal library).

## Commands

- packages/shared: `npm run typecheck` · `npm run test:unit -- test/*.test.ts`
- packages/ui:     `npm run typecheck` · `npm run test:unit -- test/<suite>.test.tsx`
- apps/todo-service: `npm run typecheck` · `npm run test:unit -- test/<suite>.e2e-spec.ts`
- apps/app:        `npm run typecheck` · `npm run test:unit -- test/<suite>.test.tsx`
- Mechanical (UI): `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
  (only test files may match); `grep -rln "getThrough" apps/*/src`.

## Project Structure

```
packages/shared/src/index.ts                 # TodoRepeat gains 'custom'; Todo/Create/Update gain repeatDays
packages/ui/src/components/dialog.tsx        # NEW Dialog block (native <dialog>)
packages/ui/src/lib/date-parts.ts            # NEW short-weekday + ISO-weekday helpers (one owner)
packages/ui/src/styles/blocks.css            # .ui-dialog* rules (tokens only)
apps/todo-service/src/todos/recurrence.ts    # custom rule step (BYDAY set)
apps/todo-service/src/todos/todo.entity.ts   # repeatDays additive text column
apps/todo-service/src/todos/dto/*.dto.ts     # repeatDays validation
apps/todo-service/src/todos/todos.service.ts # CachedTodoRow + write/advance/label paths
apps/app/lib/todo-repeat-label.ts            # repeatLabel gains the custom days
apps/app/app/todo-editor.tsx                 # Custom… option + modal wiring
apps/app/app/recurrence-dialog.tsx           # NEW app composition: frequency + weekday chips + Confirm/Cancel
docs/specs/SPEC-todo-custom-repeat.md        # this spec
```

## Code Style

Additive column, text metadata (mirrors `repeat`):

```ts
// todo.entity.ts
@Column({ type: 'text', nullable: true })
repeatDays: string | null; // CSV of ISO weekdays 1..7 (Mon..Sun), e.g. '4,5'; null = not custom
```

Wire contract (`@life/shared`, the single owner of the vocabulary):

```ts
export const TODO_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const;
export type TodoRepeat = (typeof TODO_REPEATS)[number];

// Todo read DTO + Create/Update inputs gain:
repeatDays: number[] | null;   // ISO weekdays 1..7; non-empty iff repeat === 'custom'
```

The custom rule is stated once, as a set:

```ts
// recurrence.ts — custom = next calendar day (strictly after the current) whose ISO
// weekday is in the set; ≤ 7 steps; time-of-day preserved.
function nextCustomDay(local: Local, days: ReadonlySet<number>): string {
  do { local.d += 1; normalize(local); } while (!days.has(isoWeekday(local.y, local.m, local.d)));
  return format(local);
}
```

## Data model & wire contract

- **Storage:** `repeat` keeps its flat enum and gains the value `'custom'`. A new additive
  text column `repeatDays` holds the ISO weekday set as CSV (`'4,5'`). `synchronize: true`
  applies the column additively — **no migration framework, no row rewrite**; every
  existing row keeps `repeatDays = null`. (Extending to monthly later adds a sibling
  frequency/pattern column additively; existing `custom` rows are weekly by definition.)
- **Read DTO `Todo`** gains `repeatDays: number[] | null` (required-but-nullable, like
  `important`). **Create/Update inputs** gain `repeatDays?: number[] | null`.
- **Validation (DTO):** `repeatDays` is `@IsOptional() @ValidateIf((_, v) => v !== null) @IsArray() @ArrayNotEmpty() @IsIn(TODO_REPEAT_DAYS, { each: true })`. `repeat` validation (`@IsIn(TODO_REPEATS)`) now
  accepts `'custom'`.
- **Invariants (service, both create and update, against the resulting state):**
  1. `repeat === 'custom'` ⟺ `repeatDays` is a non-empty set. `custom` with no days → 400
     (`BadRequestException('custom repeat requires repeatDays')`).
  2. Any non-`custom` repeat stores `repeatDays = null` (a provided set is normalized away).
  3. The existing **repeat requires a due date** invariant is unchanged and applies to
     `custom` too (400 `repeat requires a dueDate`).
  4. Clearing the due clears `repeat` **and** `repeatDays` (the existing cascade).
- **`repeatDays` is plaintext, non-content metadata** — exactly like `repeat`/`dueDate`/
  `reminderScheduledAt`; it carries no note/title/tag content.

## Recurrence advance

`nextOccurrence` / `advanceToOnOrAfter` (in `recurrence.ts`) keep their signatures for the
canned repeats and gain a custom branch driven by the weekday set. The engine stays
**pure and UTC-calendar based** (no host-zone dependence), date-only and timed shapes both
preserved.

- Canned repeats: unchanged.
- `custom` (weekly, BYDAY set): step the local date forward one day at a time until the ISO
  weekday is in the set (≤ 7 steps); the time-of-day is preserved. From a due that is
  **not** in the set, the first step moves to the next chosen day (the due itself remains
  the first occurrence, per C2).
- `advanceToOnOrAfter(local, rule, nowLocal)` loops `nextOccurrence` as today; custom
  converges within a small number of steps.
- The tick **records a completion for the pre-advance due, then advances** (N2/N3, the tick
  contract amended by `SPEC-todo-completion-history.md` C4): ticking a recurring todo records a
  `todo_completion` row for the pre-advance due (owned by `todo-completion-history`), **then**
  moves it to the next chosen day matching the set on/after now, **keeping `done: false`**,
  and recomputes `reminderScheduledAt`; no scheduler. Reminder derivation (`reminderAt`) is
  unchanged.

## Cache Rules (Contract 2)

- **Cached shape:** `CachedTodoRow` gains `repeatDays: number[] | null` (serialized as
  stored). No new cache entry and no new key.
- **Key composition:** unchanged — `todo:<sub>:v<gen>:<rest>`. `repeat`/`repeatDays`/
  `reminderScheduledAt` are row data and **never enter the key**. One `todo:all` entry per
  owner still serves every filter/page variant.
- **Invalidation:** unchanged — a successful create/update/delete/restore bumps the owner
  generation (`cache.bumpGeneration(sub)` after the DB write); TTL is the backstop.
- **Failure mode:** unchanged — fail-open to the direct loader on any cache error. The
  loader returns ciphertext rows; `repeatDays` is metadata alongside `repeat`.
- The ciphertext assertion (values contain `enc.v1.`, no known plaintext) is unaffected:
  `repeatDays` is non-content metadata, not an encrypted column.

## UI

### `Dialog` block (new upstream primitive, `@life/ui`)

Contract 1 Rule 3: the app needs an overlay; there is no popover/dialog primitive today.
Build the smallest reusable one on the **native `<dialog>`** element — the platform gives
the backdrop, top-layer rendering (so `.ui-card { overflow: hidden }` cannot clip it),
Escape-to-close, and focus trapping for free.

```ts
export interface DialogProps {
  open: boolean;              // controlled; the block stores no open state
  onOpenChange: (open: boolean) => void;  // Escape / backdrop / close button
  title: ReactNode;           // heading (rendered in .ui-dialog__title)
  children: ReactNode;        // body
  footer?: ReactNode;         // action row (Confirm/Cancel), right-aligned
  className?: string;
}
```

- `'use client'`. On `open` change, call the native `showModal()` / `close()` via a ref
  effect; the element's `close` event maps to `onOpenChange(false)` (Escape/backdrop).
- The close affordance is an `IconButton` (`X`, label `Close`) — no raw `<button>`.
- Tokens only: `.ui-dialog` surface (`--panel`, `--radius-lg`), padding/gap from `--space-*`.
  The native `<dialog>`'s platform-default backdrop is used; `.ui-dialog::backdrop` is **not**
  styled (a backdrop colour would need a literal outside `tokens.css`, and no backdrop colour
  token exists — `tokens.css` stays untouched). No new token.
- Registered in `MAP-ui-primitives.md`; recorded in `SPEC-ui-blocks.md`.

### Recurrence builder (`apps/app/app/recurrence-dialog.tsx`, app behavior)

Composed from primitives, no new visual language:

- A `Dialog` titled `Custom repeat`.
- **Frequency:** a `Select` (aria-label `Frequency`) with one option, `Weekly` (C1). The
  field is present now so monthly slots in without a UI rewrite.
- **Days:** seven `Pill as="button"` toggles, `size="chip"`, `active` = selected,
  labelled `Mon`…`Sun` (short names from the `@life/ui` weekday owner), each
  `aria-pressed`. Multi-select. Wrapped in a visible `PillGroup label="Days"`.
- **Footer:** `Button variant="ghost"` `Cancel` + `Button` `Confirm` (primary). Confirm is
  `disabled` while zero days are selected.
- **Open seeding:** the first day(s) come from the committed custom set if any, else the
  due date's ISO weekday (C3).
- **No-op cancel:** Escape / backdrop / Cancel leaves the committed repeat untouched.
- The whole modal state (freq, draft days) is local; only Confirm writes back.

### Editor wiring (`todo-editor.tsx`)

- The Repeat `Select` gains a `Custom…` option. Its `value` is the **committed** repeat.
  Choosing `Custom…` **opens the modal and does not commit** (the controlled `Select` snaps
  back to the committed value); Confirm sets `repeat: 'custom'` + the days; Cancel changes
  nothing. Selecting any canned option (or `None`) clears the custom days.
- Editor state adds `repeatDays: number[]`; the due-date clear cascade resets it to `[]`
  and closes the modal.
- The save payload sends `repeatDays` only when `repeat === 'custom'` (omitted otherwise).
- A custom row seeds the editor from `todo.repeatDays`.

### Label (one owner, lesson 0016)

`apps/app/lib/todo-repeat-label.ts` `repeatLabel(repeat, dueDate?, repeatDays?)` maps
`custom` → `Custom (Thu, Fri)` (days sorted ISO Mon→Sun, short names). Short weekday names
come from the single `@life/ui` owner (below), never `toLocale*` (lesson 0003). The row meta
and the editor's Repeat option both read this one function.

### `@life/ui` weekday owner (one owner, lesson 0003/0016)

`packages/ui/src/lib/date-parts.ts` gains the short-weekday vocabulary shared by the day
picker and the label: `WEEKDAY_SHORT` (`Mon`…`Sun`, ISO 1..7) and `weekdayShort(iso)`.
`formatWeekday(isoDate)` (long weekday from a date) stays as-is.

## Testing Strategy

- **shared:** `TODO_REPEATS` includes `custom`; DTO/type compile.
- **recurrence (unit):** custom step from a due in the set and not in the set; ≤7-step
  convergence; time-of-day preserved; `advanceToOnOrAfter` converges; date-only and timed.
- **todo-service (e2e-spec):** create/update with `custom` + days round-trips `repeatDays`;
  `custom` without days → 400; non-custom with days normalizes to null; clearing due clears
  both; the tick records a completion for the pre-advance due then jumps to the next chosen
  day and keeps `done: false`; cache values carry `repeatDays` and no plaintext (ciphertext
  assertion).
- **packages/ui:** `Dialog` opens (`showModal`), closes on `close` event → `onOpenChange`,
  close button, tokens-only; weekday helper unit tests.
- **apps/app:** editor shows `Custom…`; choosing it opens the modal without committing;
  Confirm sets the payload `repeat: 'custom'` + days; Cancel is a no-op; the label renders
  `Custom (Thu, Fri)`; due-clear cascade resets days.
- No E2E: no spec file is added/changed and no core flow change is unverifiable by the
  above (global §3).

## Boundaries

- **Always:** one owner per rule (label, weekday names, recurrence math — lessons 0003/0016);
  UI composed from `@life/ui` (Contract 1); service keeps BE → cache → DB and the cache
  contract (Contract 2); `repeatDays` non-content metadata; additively extend, never rewrite
  existing rows.
- **Ask first (user):** any change to the frozen e2e selector surface beyond the additions
  recorded in `SPEC-todo-ui.md`; any new token value; anything frozen by
  `AGENTS.md` `frozen-surfaces`.
- **Never:** a data migration that rewrites existing rows; plaintext content in Redis/logs;
  `repeat`/`repeatDays` in the cache key; a per-app fork of the recurrence math or the day
  picker; a custom popover/portal when native `<dialog>` covers it; merge to `master`
  without the user's explicit request.

## Success Criteria

1. A todo can be saved with `repeat: 'custom'` + `repeatDays: [4,5]` and reads back
   identically (create and update).
2. The editor renders `Custom (Thu, Fri)` for that todo and opens the modal seeded with the
   committed/custom days.
3. Ticking the custom todo advances its `dueDate` to the next chosen weekday on/after now,
   in `TODO_TIMEZONE`, preserving time-of-day, and recomputes `reminderScheduledAt`.
4. `custom` without days is a 400; any non-custom repeat stores `repeatDays = null`;
   clearing the due clears both.
5. The `Dialog` block renders nothing outside the top layer when closed, traps focus when
   open, and closes on Escape/backdrop.
6. No raw HTML in `apps/*` UI code; tokens only; cache values carry no plaintext.

## Open Questions

- None blocking. (Deferred by C1/C6 and recorded as follow-on: monthly patterns and
  every-N-weeks interval reuse the Frequency dropdown and the stored rule shape.)
