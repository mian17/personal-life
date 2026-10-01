# Spec: matrix-ui — Eisenhower matrix view + settings pages (app integration)

Module id: `matrix-ui` (map: `docs/specs/MAP-settings-and-matrix.md`, the terminal module in
the build order). Traces to intent `docs/intent/eisenhower-matrix-and-settings.md`
(decisions L1–L7 / D1–D7).

Depends on (integrates, never forks): `ui-settings` (`SPEC-ui-settings.md`),
`ui-tabs` (`SPEC-ui-tabs.md`), `app-kit-settings` (`SPEC-app-kit-settings.md`),
`todo-importance` (`SPEC-todo-importance.md`).

Upstream ownership registered in `docs/specs/MAP-ui-primitives.md`: the `MatrixBlock` block
belongs to `ui-blocks`; its prop contract is declared here.

## Objective

Deliver the Eisenhower matrix and the two settings pages in `apps/app`, wiring the four
dependency modules together:

- `@life/ui` gains one presentational block, `MatrixBlock` (ui-blocks).
- `apps/app` gains app-owned matrix domain logic (`lib/matrix.ts`: `isUrgent` + quadrant
  grouping), the matrix route `/todos/matrix` (server-gated), the settings routes
  `/todos/settings` and `/notes/settings`, the `/todos` TabBar wiring, and the nav gear
  that replaces the theme toggle in **both** apps' `navTrailing`.

Success = with the opt-in off, `/todos` is byte-identical (no tabs node) and `/todos/matrix`
is a 404; with it on, a Matrix tab appears and each todo lands in exactly one quadrant from
`effectiveImportant` + derived urgency — no other input, no new backend code. The nav's
former theme-toggle slot opens Settings; Theme behaves exactly as before.

Quadrant labels are plain (intent L6) — `Urgent & Important`, `Urgent & Not Important`,
`Not Urgent & Important`, `Not Urgent & Not Important` — and are app-supplied copy; the
block bakes none. Never `Do First` / `Delegate` / `Drop`.

## Components (prop contracts)

### Upstream — `MatrixBlock` (`@life/ui`, ui-blocks)

```tsx
import type { ReactNode } from 'react';

// ui-blocks — a labelled 2×2 (or stacked) presentation of four quadrants.
// Presentational only: no data, no domain types, no domain copy, no routing.
export interface MatrixQuadrant {
  /** Stable key for the quadrant (app-supplied, e.g. `'urgent-important'`). */
  id: string;
  /** Quadrant heading text (app-supplied copy; the block bakes none). */
  label: string;
  /** The quadrant's content — usually an app-composed todo `List`. */
  items: ReactNode;
}

export interface MatrixBlockProps {
  /** Exactly the quadrants to render, in render order. */
  quadrants: MatrixQuadrant[];
  /** Class passthrough (e2e hooks ride on it). */
  className?: string;
}

export function MatrixBlock(props: MatrixBlockProps): JSX.Element;
```

Rendered structure (one `<section>` per quadrant, in the given order):

```tsx
<div className={cx('ui-matrix', className)}>
  {quadrants.map((quadrant) => (
    <section key={quadrant.id} className="ui-matrix__quadrant">
      <h2 className="ui-matrix__label">{quadrant.label}</h2>
      <div className="ui-matrix__items">{quadrant.items}</div>
    </section>
  ))}
</div>
```

Semantics and edge cases:

- The block is a server component (no `'use client'`) and renders `items` verbatim; the app
  owns the todo nodes inside. Zero data, zero domain copy, zero routing (mirrors
  `ListShell`/`Section` contracts).
- A quadrant with empty `items` still renders its labelled section (an empty quadrant is
  meaningful in a matrix — it says "nothing Urgent & Important"). The app decides whether to
  pass an `EmptyState` inside `items`; the block imposes neither.
- Quadrant order is exactly the app's array order — fixed by `groupByQuadrant` (below):
  Urgent & Important, Urgent & Not Important, Not Urgent & Important,
  Not Urgent & Not Important.

### App-owned — `apps/app/lib/matrix.ts` (pure domain logic)

App-owned because it is domain behavior (importance × due-date), not presentation;
`@life/ui` owns no domain (Contract 1). It reuses `@life/ui`'s timezone-safe date helpers
rather than parsing ISO in the app (lesson 0003 — one owner for date reads).

```ts
import { dueDateLabel, dueDateState } from '@life/ui';
import type { Todo } from '@life/shared';

/** The four matrix cells; the id is also the quadrant's stable key. */
export type QuadrantId =
  | 'urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-important'
  | 'not-urgent-not-important';

/** The fixed quadrant order + labels (plain labels, intent L6). */
export const QUADRANTS: ReadonlyArray<{ id: QuadrantId; label: string }> = [
  { id: 'urgent-important', label: 'Urgent & Important' },
  { id: 'urgent-not-important', label: 'Urgent & Not Important' },
  { id: 'not-urgent-important', label: 'Not Urgent & Important' },
  { id: 'not-urgent-not-important', label: 'Not Urgent & Not Important' },
];

/**
 * Urgency is derived from `dueDate`, never stored (map D4). True iff `dueDate` is
 * non-null and lands on an overdue day, today, or tomorrow; a missing/empty date is
 * not urgent. Calendar-part-safe: delegates to `@life/ui`'s `dueDateState` /
 * `dueDateLabel`, which read the parts out of the ISO string (lesson 0003) and never
 * round-trip through a locale formatter.
 */
export function isUrgent(dueDate: string | null, today: string): boolean;

/** The quadrant a todo falls in: (`effectiveImportant`, `isUrgent`). */
export function quadrantOf(todo: Pick<Todo, 'effectiveImportant' | 'dueDate'>, today: string): QuadrantId;

/** One quadrant's labelled bucket, in the fixed `QUADRANTS` order. */
export interface QuadrantBucket {
  id: QuadrantId;
  label: string;
  todos: Todo[];
}

/** Group the given todos into the four quadrants, `QUADRANTS` order, in memory. */
export function groupByQuadrant(todos: readonly Todo[], today: string): QuadrantBucket[];
```

Reference implementation of the two derivations (the whole feature is these lines):

```ts
export function isUrgent(dueDate: string | null, today: string): boolean {
  const state = dueDateState(dueDate, today); // 'overdue' | 'today' | 'later' | 'none'
  return state === 'overdue' || state === 'today' || dueDateLabel(dueDate, today) === 'Tomorrow';
}

export function quadrantOf(todo: { effectiveImportant: boolean; dueDate: string | null }, today: string): QuadrantId {
  const urgent = isUrgent(todo.dueDate, today);
  const important = todo.effectiveImportant;
  if (urgent) return important ? 'urgent-important' : 'urgent-not-important';
  return important ? 'not-urgent-important' : 'not-urgent-not-important';
}
```

`groupByQuadrant` buckets with `quadrantOf` and returns `QUADRANTS.map(({ id, label }) =>
({ id, label, todos: buckets[id] }))` — no re-sort; the service's stable order (due-ascending,
undated last) is preserved within each quadrant.

Semantics and edge cases:

- `important` is **not** recomputed here: the app reads `Todo.effectiveImportant` (already
  `important ?? list.importantDefault ?? false`, `SPEC-todo-importance.md`). `matrix-ui`
  consumes it and adds no todo input (map D4, module boundary).
- Overdue, today, and tomorrow are all urgent; the day after tomorrow and later are not.
  Month/year rollovers are handled by `dueDateLabel`'s UTC `addDay` (e.g. `2027-01-01` is
  tomorrow from `2026-12-31`).
- A malformed/empty `dueDate` is treated as not urgent (mirrors `dueDateState`'s `'none'`);
  the todo API delivers `YYYY-MM-DD` or `null`.
- Every quadrant is returned even when empty, so the matrix always shows four labelled cells.

### Settings `Switch` wrapper — `apps/app/app/settings/matrix-switch.tsx`

`Switch` is a controlled atom (`SPEC-ui-settings.md`); state and the server-action call stay
in the app. This is the small app-owned client wrapper the settings page consumes:

```tsx
'use client';

import { useState } from 'react';
import { Switch } from '@life/ui';
import { setPref } from '@life/app-kit/preference-action';

/** Controlled wrapper: seeds local state from the server-read `checked` value and
 *  persists each toggle through app-kit's server action. The atom stays presentational. */
export function MatrixSwitch({ checked }: { checked: boolean }) {
  const [on, setOn] = useState(checked);
  return (
    <Switch
      label="Eisenhower matrix"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        void setPref('matrix', next);
      }}
    />
  );
}
```

- `checked` is read server-side (`readPref('matrix')`) and passed down; the wrapper owns the
  client state. `setPref` is the `'use server'` action of `SPEC-app-kit-settings.md`, imported
  through the **subpath** `@life/app-kit/preference-action` — not through the `@life/app-kit`
  barrel and not through the app's `@/lib/preferences`, because both of those also re-export
  the server-only `readPref` (which imports `next/headers`), which would pull `next/headers`
  into this client module's graph. The subpath entry is mapped in `apps/app/tsconfig.json`
  `paths` and the app's jest `moduleNameMapper` (`SPEC-app-kit-settings.md`, Subpath export).
  `readPref` (server-only, `next/headers`) is imported only by the server components below,
  never by this client module.
- `label="Eisenhower matrix"` is the atom's accessible name — the frozen switch selector.

## Pages & routing (integration)

### `/todos` (List) — `tabs` slot

Read the opt-in server-side and render the tab row through the `tabs` slot added by
`SPEC-ui-tabs.md`; when the opt-in is off, the slot is `undefined` and the shell output is
byte-identical (no tabs node):

```tsx
const matrixEnabled = await readPref('matrix'); // @/lib/preferences

<ListShell
  title="Todos"
  navTrailing={<>{/* …existing links… */
    <IconLink href={settingsHref('/todos')} label="Settings"><Settings size={20} aria-hidden /></IconLink>
  </>}
  tabs={matrixEnabled ? (
    <TabBar aria-label="Todos views">
      <Tab href="/todos" active>List</Tab>
      <Tab href="/todos/matrix">Matrix</Tab>
    </TabBar>
  ) : undefined}
  // …existing search / filters / body / fab unchanged…
/>
```

- Off ⇒ `tabs` omitted ⇒ `ListShell` renders no tabs node (byte-identical, map D3).
- Selectors: links named `List` and (when on) `Matrix`.

### `/todos` importance inputs — list default + per-todo (L6 consumer path)

Importance is manual (intent L6), so the same `/todos` integration also carries the two
surfaces that set it; without them every `important` stays `null` and the two "Important"
quadrants are permanently empty. This is `apps/app` wiring only — no new module, no new
backend, and both controls compose the upstream `Switch` atom (`SPEC-ui-settings.md`); the
field contracts live in `SPEC-todo-importance.md`.

- **List importance-default** — `apps/app/app/list-manager-panel.tsx` renders a `Switch`
  (label `Default important`) per list, writing `list.importantDefault` through the existing
  list action in `apps/app/app/todo-actions.ts`.
- **Per-todo importance** — `apps/app/app/todo-editor.tsx` renders a `Switch` (accessible name
  `Important`) wrapped in a visible `PillGroup` labelled `Important` (the same field shape as
  `Due`/`List`), whose displayed value is the user's explicit override when one has been made,
  otherwise a seed: edit mode `todo.important ?? todo.effectiveImportant`, create mode the
  selected list's `importantDefault ?? false`. `important` is written through
  `apps/app/app/todo-actions.ts` **only when the user actually toggles it** (both the
  `updateTodoAction` patch and the `createTodoAction` input omit the key otherwise), so an
  untouched todo keeps `important: null` (inherit the list default); a toggled todo writes an
  explicit `true`/`false` override.

The frozen accessible names `Important` and `Default important` are app copy (`Switch`'s
`label`); no raw HTML, tokens only.

### `/todos/matrix` (server-gated) — `apps/app/app/todos/matrix/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { readPref } from '@/lib/preferences';
import { listTodos, listLists } from '@/lib/todo-api';
import { collectTodos } from '@/lib/todo-query';
import { groupByQuadrant } from '@/lib/matrix';
import { ListShell, MatrixBlock, Tab, TabBar, todayIso } from '@life/ui';
import { Plus } from 'lucide-react';
import { TodoItem } from '../../todo-item';
import { TodosNav } from '../../todos-nav';

export const dynamic = 'force-dynamic';

export default async function TodosMatrixPage() {
  if (!(await readPref('matrix'))) notFound();

  const [todos, lists] = await Promise.all([
    collectTodos((cursor) => listTodos({ cursor })),
    listLists(),
  ]);
  const today = todayIso();

  const quadrants = groupByQuadrant(todos, today).map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    items: bucket.todos.map((todo) => (
      <TodoItem key={todo.id} todo={todo} today={today} lists={lists} availableTags={[]} />
    )),
  }));

  return (
    <ListShell
      title="Todos"
      navTrailing={<TodosNav />}
      tabs={
        <TabBar aria-label="Todos views">
          <Tab href="/todos">List</Tab>
          <Tab href="/todos/matrix" active>Matrix</Tab>
        </TabBar>
      }
      body={<MatrixBlock quadrants={quadrants} />}
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
```

- The server gate (`notFound()` when the pref is off) makes a disabled matrix a real 404, not
  a dead tab (map D3); the route stays inside the Todos manifest scope (per-route PWA
  identity, lesson 0005) — it is not a new app.
- Fetching reuses the existing `apps/app` API clients only (`collectTodos`/`listTodos`,
  `listLists`); grouping is in memory after the service's post-decrypt assembly.
- Search and filters are omitted on this lens; the fab is kept. The nav toolbar is rendered
  from the shared `apps/app/app/todos-nav.tsx` fragment, so the matrix lens carries the same
  nav icons as `/todos` (lesson 0014).
- `availableTags={[]}`: the matrix lens does not fetch the tag registry, so attached-tag
  names are not shown on its rows; the row still links to the todo's edit screen. No new
  fetch is added for a lens.
- Quadrant order is exactly `groupByQuadrant`'s: Urgent & Important, Urgent & Not Important,
  Not Urgent & Important, Not Urgent & Not Important.

### `/todos/settings` — `apps/app/app/todos/settings/page.tsx`

```tsx
import { readPref } from '@/lib/preferences';
import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { MatrixSwitch } from '../../settings/matrix-switch';

export const dynamic = 'force-dynamic';

export default async function TodosSettingsPage() {
  const matrixEnabled = await readPref('matrix');
  return (
    <ManagerBlock title="Settings" backHref="/todos">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle />} />
      </SettingsBlock>
      <SettingsBlock title="Todos">
        <SettingsRow
          label="Eisenhower matrix"
          description="Add a Matrix tab that groups todos into four quadrants."
          control={<MatrixSwitch checked={matrixEnabled} />}
        />
      </SettingsBlock>
    </ManagerBlock>
  );
}
```

### `/notes/settings` — `apps/app/app/notes/settings/page.tsx`

The same composition, Appearance only (no Todos group, no matrix switch):

```tsx
import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';

export default function NotesSettingsPage() {
  return (
    <ManagerBlock title="Settings" backHref="/notes">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle />} />
      </SettingsBlock>
    </ManagerBlock>
  );
}
```

### Nav change (approved frozen surface, map D7)

In **both** `apps/app/app/notes/page.tsx` and `apps/app/app/todos/page.tsx`, `navTrailing`
keeps every existing link and **ends with the gear**, replacing `<ThemeToggle />` in its
exact former slot:

```tsx
import { settingsHref } from '@life/app-kit';
import { Settings } from 'lucide-react';

<IconLink href={settingsHref('/todos')} label="Settings">
  <Settings size={20} aria-hidden />
</IconLink>
```

- `settingsHref('/todos') === '/todos/settings'`, `settingsHref('/notes') ===
  '/notes/settings'` (`SPEC-app-kit-settings.md`). The app owns the label and the lucide
  `Settings` icon; app-kit owns only the href — app-kit owns no markup.
- `ThemeToggle` is removed from each page's imports (it is now rendered only on the two
  settings pages); the atom itself is unchanged (Theme still uses its existing localStorage
  mechanism — no theme migration, D1).
- Relocating only Todos' toggle would regress Notes' theme control, hence both apps swap it
  (map D7); each app therefore gets a settings page.

## Frozen e2e surface — exact selector changes

Existing specs were read (`apps/app/test/e2e/journey.ts`, `journey.suite.ts`, the dev/prod
wrappers, `access-gate.spec.ts`). **No current Playwright assertion queries the theme toggle
or any `navTrailing` link except `Trash`**, so the change is a frozen-surface *record* update,
not an assertion rewrite:

- `journey.ts:93` and `journey.suite.ts:93,102` — `getByLabel('Trash')` targets the Trash
  `IconLink` in `navTrailing`; **unchanged** (the link still renders).
- `journey.suite.ts:41,85,154,160` — `getByRole('heading', { name: 'Notes' | 'Todos' })`;
  **unchanged**. `journey.suite.ts:74` (`getByRole('link', { name: 'errand', exact: true })`)
  — **unchanged**.
- `apps/app/test/routes-todos-list.test.tsx:150` (unit, not e2e) asserts the frozen nav
  labels `arrayContaining(['Notes', 'Manage tags', 'Manage lists', 'Trash'])`; **unchanged**
  — the gear is additive, but it is now also part of the recorded surface.
- No assertion anywhere references the dynamic `Theme: …` aria-label, so nothing breaks; the
  **surface record** (the list in `SPEC-ui-list-shell.md`) must drop the theme toggle from
  `navTrailing` and record the gear instead.

The new/changed selectors this module records on the frozen surface (the user explicitly
approved the theme-toggle relocation; the same change updates the affected e2e specs — the
list-shell spec and `SPEC-todo-ui.md` — while the human-owned suite is not edited by agents):

| Surface | Selector | Where |
|---|---|---|
| Settings gear | `getByLabel('Settings')` | `navTrailing` on `/notes` **and** `/todos` (replaces the theme toggle's former slot) |
| List tab | `getByRole('link', { name: 'List' })` | `/todos` TabBar (and `/todos/matrix`) |
| Matrix tab | `getByRole('link', { name: 'Matrix' })` | `/todos` TabBar (present only when the pref is on) |
| Matrix switch | `getByRole('switch', { name: 'Eisenhower matrix' })` | `/todos/settings` (`Switch` from `label`) |
| Theme toggle | (former dynamic `Theme: …` label) **no longer in `navTrailing`** | moved to `/todos/settings` + `/notes/settings` |

Documentation updates in this change: `SPEC-ui-list-shell.md`'s *Frozen e2e surface* prose
(theme toggle → Settings gear), and `SPEC-todo-ui.md` (the `/todos` tabs, `/todos/matrix`,
`/todos/settings` entry, and the nav change). No test code is authored here.

## CSS ownership

- `MatrixBlock` owns `.ui-matrix` (grid container), `.ui-matrix__quadrant`,
  `.ui-matrix__label`, `.ui-matrix__items` in `blocks.css` — tokens only. Labels reuse the
  spacing scale for type (as `Section` does) with `margin: 0`; `Stack`-like `gap` only, no
  outer margins (a grid child with `Section`'s outer margin would double-space against the
  grid gap).
- Quadrants are separated by **inner hairline dividers only** — never an outer frame on
  `.ui-matrix` or `.ui-matrix__quadrant`. One column (phone) gets a single rule between
  consecutive stacked quadrants (never above the first); the 2×2 layout gets an inner cross
  (a rule between the rows and between the columns). Dividers use the `--border-width` /
  `--border` tokens.
- Responsive (map D6), decided in CSS, no JS, no horizontal scroll:

  ```css
  .ui-matrix { display: grid; gap: 0; }
  .ui-matrix__quadrant { display: grid; gap: var(--space-0-5); padding: var(--space-1); min-height: var(--space-5); }

  /* Phone (one column): a hairline between consecutive quadrants, never above the first. */
  .ui-matrix__quadrant + .ui-matrix__quadrant {
    border-top: var(--border-width) solid var(--border);
  }

  .ui-matrix__label { font-size: var(--space-1); font-weight: 700; margin: 0; }
  .ui-matrix__items { display: grid; gap: var(--space-0-5); }

  @media (min-width: 640px) {
    .ui-matrix { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; }
    /* 2×2: reset the phone rule, then draw the inner cross only (no outer frame). */
    .ui-matrix__quadrant + .ui-matrix__quadrant { border-top: 0; }
    .ui-matrix__quadrant:nth-child(n + 3) { border-top: var(--border-width) solid var(--border); }
    .ui-matrix__quadrant:nth-child(odd) { border-right: var(--border-width) solid var(--border); }
  }
  ```

  The 2×2 layout gives the top and bottom rows **equal height** (`grid-auto-rows: 1fr`), so an
  empty quadrant matches a populated one in the same row pair; `1fr` means `minmax(auto, 1fr)`,
  so content is never clipped. The phone layout stays a natural stacked height per section.
  One column (four stacked labelled sections) is the phone default; `minmax(0, 1fr)` tracks
  prevent overflow, so no horizontal scroll. The `640px` breakpoint literal matches
  `--content-width` and is the documented non-tokenizable exception (media conditions cannot
  read custom properties; `blocks.css` already carries such literals, e.g. `100dvh`, `700`).
- The `/todos`, `/todos/matrix`, `/todos/settings`, `/notes/settings` pages add **no** app
  stylesheet; every class comes from `@life/ui` (`ListShell`, `TabBar`/`Tab`, `ManagerBlock`,
  `SettingsBlock`/`SettingsRow`, `Switch`, `MatrixBlock`).

## Tech Stack

React 19 TSX, Next 15 App Router. Server components for `/todos` (tabs), `/todos/matrix`,
`/todos/settings`, `/notes/settings`; one app-owned client module (`matrix-switch.tsx`) for
the controlled `Switch` + server action. `@life/ui` (`MatrixBlock`, `TabBar`/`Tab`,
`ManagerBlock`, `SettingsBlock`/`SettingsRow`, `Switch`, `ThemeToggle`, `ListShell`,
`TodoItem`'s atoms), `@life/app-kit` (`readPref`/`setPref`, `settingsHref`), `@life/shared`
(`Todo`/`List`), `lucide-react` (`Settings`, `Plus`). Existing `apps/app` API clients only;
no new dependency, no backend code.

## Commands

```
Typecheck (upstream):  npm run typecheck -w @life/ui
Unit (upstream):       npm run test:unit -w @life/ui -- test/matrix-block.test.tsx
Typecheck (app):       npm run typecheck -w @life/app
Unit (app):            npm run test:unit -w @life/app -- test/matrix.test.ts
E2E (only if a spec changed):
  npx playwright test --config apps/app/playwright.config.ts test/e2e/journey.prod.spec.ts -g "<name>"
```

E2E is human-owned and is not run by this module's normal verification (global protocol §3).

## Project Structure

```
packages/ui/src/components/matrix-block.tsx   # MatrixBlock + exported prop types (ui-blocks)
packages/ui/src/styles/blocks.css             # .ui-matrix*
packages/ui/src/index.ts                      # re-exports MatrixBlock + types
packages/ui/test/matrix-block.test.tsx        # one suite for the block
apps/app/lib/matrix.ts                        # isUrgent, quadrantOf, groupByQuadrant, QUADRANTS, QuadrantId
apps/app/app/settings/matrix-switch.tsx       # app-owned controlled Switch wrapper
apps/app/app/todos/page.tsx                   # + tabs slot; gear replaces ThemeToggle
apps/app/app/todos/matrix/page.tsx            # server-gated matrix view
apps/app/app/todos/settings/page.tsx          # Theme + matrix switch
apps/app/app/notes/page.tsx                   # gear replaces ThemeToggle
apps/app/app/notes/settings/page.tsx          # Theme only
apps/app/test/matrix.test.ts                  # isUrgent + quadrant grouping (app logic)
```

## Code Style

App-owned domain logic, block-composed UI; copy/handlers/values as props (Contract 1):

```ts
// apps/app/lib/preferences.ts (app-owned, SPEC-app-kit-settings)
import { readPref, setPref } from '@life/app-kit';
export type AppPrefKey = 'matrix';
export { readPref, setPref };
```

```tsx
// apps/app/app/todos/matrix/page.tsx — the gate + the in-memory grouping
if (!(await readPref('matrix'))) notFound();
const quadrants = groupByQuadrant(todos, todayIso()).map((bucket) => ({ /* → MatrixBlock */ }));
```

The only key literal (`'matrix'`) and the only route literals (`/todos`, `/notes`,
`/todos/matrix`, `/todos/settings`, `/notes/settings`) live in `apps/app`; no app-local
cookie or path-join code (that is `app-kit-settings`').

## Testing Strategy

**Upstream unit (jest, `packages/ui`; harness per `SPEC-ui-atoms`)** — `matrix-block.test.tsx`:

- Renders one `<section>` per quadrant in the given order, each with its `label` as the
  heading and `items` verbatim.
- `className` merges onto the root; no domain copy is baked in
  (`grep -riE "note|todo|urgent|important" packages/ui/src/components/matrix-block.tsx` → no
  hits in code).
- Empty `items` still renders the labelled section.

**App unit (jest, `apps/app`; `test/matrix.test.ts`)** — the pure logic:

- `isUrgent(null, today)` → `false`; empty string → `false`.
- Overdue (`'2026-09-30'` from `'2026-10-01'`) → `true`; today → `true`; tomorrow → `true`;
  day-after-tomorrow (`'2026-10-03'`) → `false`; far future → `false`.
- Rollovers: `'2026-11-01'` is tomorrow from `'2026-10-31'`; `'2027-01-01'` from
  `'2026-12-31'`.
- `quadrantOf` maps all four `(effectiveImportant, isUrgent)` combinations.
- `groupByQuadrant` returns the four `QUADRANTS` in order, bucketing todos, preserving input
  order within a quadrant, and returning empty buckets as empty arrays.

**E2E:** not run by this module. The frozen surface changes are documented above; the
human-owned suite is updated when the user runs it (global protocol §3).

## Boundaries

- Always: compose `@life/ui` blocks (no raw HTML for interactive elements; anchors via
  `IconLink`/`Tab`); tokens only; labels plain and app-supplied; the matrix gate is
  server-side (`notFound()`); one `isUrgent` derivation, no urgency stored; consume
  `effectiveImportant` as delivered.
- Ask first: any change to the frozen selector surface beyond the recorded relocation; a
  second matrix lens that fetches tags for it; moving urgency/importance logic upstream
  (it is app domain, not presentation).
- Never: a per-app fork of `TabBar`/`MatrixBlock`/the settings composition; a new `@life/ui`
  primitive for the gear (reuse `IconLink`) or the switch (reuse `Switch`); re-implement
  `effectiveImportant` or the todo importance signal in the app; new backend code or a new
  API client; raw hex/rgb/px/rem outside `tokens.css` (the one documented media-query
  breakpoint literal excepted); a Matrix tab or route that exists when the opt-in is off.

## Success Criteria

1. `MatrixBlock` renders four labelled sections from `quadrants` alone (no domain copy, no
   data); registered in `MAP-ui-primitives.md`'s `ui-blocks` row.
2. `isUrgent(dueDate, today)` is true iff the date is overdue/today/tomorrow, using
   `@life/ui`'s timezone-safe helpers; `quadrantOf`/`groupByQuadrant` place every todo from
   `effectiveImportant` + urgency, in the fixed four-quadrant order.
3. Opt-in off ⇒ `/todos` renders no tabs node (byte-identical) and `/todos/matrix` returns
   `notFound()`; on ⇒ the Matrix tab links to a page grouping todos into the four quadrants.
4. `/todos/settings` and `/notes/settings` render from `ManagerBlock` +
   `SettingsBlock`/`SettingsRow`; the Todos switch is `role="switch"` named
   `Eisenhower matrix` and persists through `setPref('matrix', …)`.
5. Both apps' `navTrailing` end with the gear `IconLink` (`label="Settings"`,
   `settingsHref`), replacing the theme toggle in place; Theme is unchanged otherwise.
6. `SPEC-ui-list-shell.md` and `SPEC-todo-ui.md` record the relocated toggle and the new
   selectors; `npm run typecheck -w @life/ui`, `-w @life/app` and `test/matrix.test.ts` +
   `matrix-block.test.tsx` are green.

## Open Questions

- None. The map (D2–D7) fixes the tab/route/storage/nav decisions; `matrix-ui`'s added
  surface is `isUrgent`/`groupByQuadrant` (derived) and `MatrixBlock` (presentational).
