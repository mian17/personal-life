# Spec: ui-list-shell — list-page shell

Module id: `ui-list-shell` (map: `docs/specs/MAP-shared-page-blocks.md`). Depends on `ui-blocks`.

## Objective

A whole-page `@life/ui` list-page shell: `NavBar` trailing slot + `PageTitle` + search
slot + filter slots (`TagFilterNav`/`PillGroup`) + an empty-state/list render slot +
`FabLink`. Slots only — zero data fetching, zero routing, zero domain types. Success =
`/notes` and `/todos` render from this shell with every filter/search/list decision passed
in as a slot, and the page keeps its current roles, labels and spacing.

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';

export interface ListShellProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text, e.g. "Notes". */
  title: string;
  /** Trailing nav actions: icon links + `ThemeToggle`, in render order. */
  navTrailing?: ReactNode;
  /** Tab navigation (`TabBar`); rendered directly under the page title. */
  tabs?: ReactNode;
  /** The param-preserving search box (app-kit's `SearchField` wrapper). */
  search?: ReactNode;
  /** Filter rows: `PillGroup` status pills and/or `TagFilterNav`, in render order. */
  filters?: ReactNode;
  /** Empty-state OR list body. The app decides which it passes. */
  body: ReactNode;
  /** Fixed action button (`FabLink` href + label + icon, e.g. `/notes/new` / "New note"). Omit and no `FabLink` renders — a page with no create action (the feedback inbox). */
  fabHref?: string;
  /** Fab aria-label; frozen visible/accessible text, e.g. "New note". Used only when `fabHref` is given. */
  fabLabel?: string;
  /** Fab icon node (e.g. `<Plus size={28} strokeWidth={2.5} aria-hidden />`). Used only when `fabHref` is given. */
  fabIcon?: ReactNode;
  /** Opt into a full-viewport-height page: the `body` slot grows to fill the
   * remaining space (for a full-height body such as the matrix). Off by default. */
  fill?: boolean;
}

export function ListShell(props: ListShellProps): JSX.Element;
```

Rendered structure, in order:

```tsx
<PageShell className={fill ? 'ui-list-shell--fill' : undefined}>
  <NavBar trailing={navTrailing} />
  <PageTitle>{title}</PageTitle>
  {tabs}
  {search}
  {filters}
  {fill ? <div className="ui-list-shell__body">{body}</div> : body}
  {fabHref != null && (
    <FabLink href={fabHref} label={fabLabel ?? ''}>
      {fabIcon}
    </FabLink>
  )}
</PageShell>
```

Optional slots (`navTrailing`, `tabs`, `search`, `filters`) render nothing when omitted, so
a simpler list page composes the same shell. When `tabs` is omitted the render is
byte-identical to today's pages (no wrapper element is added).

The fab is optional as a set: **`fabHref` is the gate**. Given it, the shell renders the
`FabLink` last, with `fabLabel` as its aria-label and `fabIcon` as its child; omitted, no
`FabLink` node exists in the DOM (a page with no create action — the feedback inbox, which
submits from its toolbar instead). `/notes` and `/todos` always pass all three and are
unchanged; the omitted-fab case is covered by `packages/ui/test/list-shell.test.tsx`.

New frozen strings introduced by `SPEC-feedback-ui` (recorded here, not in the selector list
below, which is unchanged): `getByRole('heading', { name: 'Feedback' })` → the inbox
`PageTitle` (from `title`), `getByLabel('Send feedback')` → the toolbar `IconButton` from
`FeedbackNavItem` (in `navTrailing`), the dialog title `Send feedback`,
`aria-label="Feedback type"`, the type labels `Feature request` / `Enhancement` /
`Bug report`, `aria-label="Description"`, and `Send` / `Sending…` / `Cancel`.

### Semantics and edge cases

- `fill?: boolean` opts into a full-height page: the page column becomes a flex column
  of **definite** viewport height (`height: 100dvh; overflow: hidden`, not `min-height`) and
  the `body` slot grows via the `.ui-list-shell__body` wrapper (`flex: 1`) to fill the
  remaining space. Its row track is `minmax(0, 1fr)` (not a bare `1fr`, whose `auto` minimum
  would let an overflowing child grow the body), so the body is bounded and an overflowing
  child scrolls inside it. The definite height is what bounds a full-height child — e.g. a
  matrix quadrant scrolls inside its box instead of growing the page. Off by default, so other
  pages are unchanged; used by `/todos/matrix` so the 2×2 matrix spans the screen height.
- The shell renders `body` verbatim; empty-state versus list is the app's decision, so the
  block carries no emptiness knowledge and no domain copy.
- `filters` is one slot so a page can stack `PillGroup` + multiple `TagFilterNav` nodes in
  the order it wants; each child keeps its own spacing class.
- The `FabLink` is fixed-position (token-owned); the shell does not add layout around it.
- The shell owns no URL logic: search/filter `href`s come pre-built from `app-kit`.

### Element-by-element mapping (duplication evidence)

`apps/app/app/notes/page.tsx:42-72` (return) vs `apps/app/app/todos/page.tsx:82-143`
(return) — the same page shape.

| Shell slot | notes/page.tsx | todos/page.tsx |
|---|---|---|
| `PageShell` | `:43` | `:83` |
| `NavBar` trailing | `:45-58` | `:85-101` |
| `PageTitle` | `:61` | `:104` |
| `search` | `:63` (`<SearchBox q tag />`) | `:106` (`<TodoSearchBox q list tag done />`) |
| `filters` | `:65` (`TagFilterNav`) | `:108-136` (`PillGroup` status + `TagFilterNav` tags + `TagFilterNav` lists) |
| `body` | `:67` (`<NoteList notes />`) | `:138` (`<TodoList groups today lists availableTags />`) |
| `FabLink` | `:69-71` | `:140-142` |

The empty-state decision lives in `apps/app/app/note-list.tsx:8-10` and
`apps/app/app/todo-list.tsx:24-26` — still app-owned, passed in via `body`.

### Frozen e2e surface (what the suite actually queries — must not change)

- `getByRole('heading', { name: 'Notes' | 'Today' })` → `PageTitle` (from `title`)
  (`journey.ts:40`; `journey.suite.ts:41,85,154`; the todos heading is now `Today`
  — `journey.suite.ts:160` still asserts `Todos`, a pending human-owned suite update
  that agents must not edit).
- `getByLabel('New note')` → `FabLink` aria-label (from `fabLabel`) (`journey.ts:65`).
- `getByLabel('Search notes')` → the `SearchField` inside the `search` slot
  (`journey.ts:84`).
- `getByLabel('Trash')` → an `IconLink` in `navTrailing` (`journey.suite.ts:93,102`).
- `getByRole('link', { name: 'errand', exact: true })` → `TagFilterNav` filter pills in
  the `filters` slot (`journey.suite.ts:74` — the **notes** page; `/todos` no longer
  passes a `filters` slot).
- `getByRole('listitem')` (`journey.ts:104`), `getByLabel(`Delete ${title}`)`
  (`journey.ts:90`) and `getByRole('link', { name: <note title> })` (`journey.ts:74`) →
  rows/links inside `body` (the app-owned list component).

Preserved but **not** asserted by any test today — the shell must not alter them all the
same: the todos fab label `New todo` and the
`navTrailing` links `Manage tags` / `Manage lists` / `Notes` / `Todos`.

Frozen-surface change approved by the user (intent L4 / map D7, `SPEC-matrix-ui.md`): the
theme toggle **leaves `navTrailing`** and its exact former slot is taken by the Settings
gear — so `navTrailing` now ends with
`getByLabel('Settings')` → an `IconLink` rendering `<Settings size={20} aria-hidden />`
(`href` from `app-kit`'s `settingsHref`). This applies to **both** `apps/app/app/notes/page.tsx`
and `apps/app/app/todos/page.tsx`, which both carried the toggle. The toggle's former dynamic
`Theme: …` aria-label no longer appears in `navTrailing`; `ThemeToggle` itself is unchanged
(still `localStorage`-backed) and is now rendered on `/todos/settings` and `/notes/settings`.
The existing `getByLabel('Trash')` assertion (above) is unaffected; no current test asserted
the toggle. The same change updates the frozen e2e spec's recorded surface — documented here
and in `SPEC-todo-ui.md`; the human-owned suite is not edited by agents. The `tabs` slot's
`Today`/`Matrix` links are recorded in `SPEC-ui-tabs.md` / `SPEC-matrix-ui.md` and add no
assertion to this shell.

The `tabs` slot adds **no frozen assertion** of its own: the tab row is a `TabBar`/`Tab`
node supplied by the app, and the shell renders it verbatim like every other slot. The
shell still owns no tab semantics — element order, roles and the aria-labels above are
unchanged, and omitting `tabs` renders nothing.

## CSS ownership

The shell composes existing blocks: `PageShell` (`.ui-page`), `NavBar` (`.ui-nav-bar`),
`PageTitle` (`.ui-page-title`), `FabLink` (`.ui-fab-link`); search and filters are slot
nodes whose classes (`SearchField`'s `.ui-search-box`, `TagFilterNav`'s `.ui-tag-filter-nav`,
`PillGroup`'s `.ui-pill-group`) are already owned by `ui-atoms`/`ui-blocks` (verified:
`TagFilterNav`'s class is `.ui-tag-filter-nav`,
`packages/ui/src/components/tag-filter-nav.tsx:23`). The shell owns only the opt-in
`fill` classes (`.ui-list-shell--fill`, `.ui-list-shell__body`); it adds no raw values and
owns the *page's* vertical rhythm by the fixed element order, so both segments render
identically from tokens only.

## Tech Stack

React 19 TSX source, `@life/ui/styles.css`, token values only. Composes `ui-blocks`
(`PageShell`, `NavBar`, `PageTitle`, `FabLink`). No `next/navigation`, no fetch.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/list-shell.test.tsx`

## Project Structure

```
packages/ui/src/components/list-shell.tsx   # shell source + exported prop type
packages/ui/src/index.ts                    # re-exports ListShell + type
packages/ui/test/list-shell.test.tsx        # one suite for the shell
```

## Code Style

Slots, not data:

```tsx
<ListShell
  title="Today"
  navTrailing={<>
    <IconLink href="/notes" label="Notes"><StickyNote size={20} aria-hidden /></IconLink>
    <IconLink href="/todos/tags" label="Manage tags"><Tags size={20} aria-hidden /></IconLink>
    <IconLink href="/todos/trash" label="Trash"><Trash2 size={20} aria-hidden /></IconLink>
    <ThemeToggle />
  </>}
  body={<TodoList groups={groups} today={today} lists={lists} availableTags={availableTags} />}
  fabHref="/todos/new"
  fabLabel="New todo"
  fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
/>
```

Fetching, grouping, href building and the list components stay in `apps/app`.

## Testing Strategy

Unit tests only (jest, `packages/ui`). Cover: slot render order (title → tabs → search →
filters → body → fab); omitted optional slots render nothing; `fabLabel` becomes the
`FabLink` aria-label; no `FabLink` renders when the fab props are omitted (the feedback
inbox shape); `title` becomes the `h1`; `body` passes through unmodified. No URL or
fetch behavior — that is `app-kit`'s suite. E2E is not run by this module; `segment-port`
runs the journey unchanged.

## Boundaries

- Always: preserve element order, roles and every aria-label listed under *Frozen e2e
  surface*; spacing via tokens only; the shell renders slots verbatim.
- Ask first: adding a slot that would own data or URL logic; any new CSS class; running
  E2E.
- Never (hard exclusions): `Note`/`Todo`/`List` types, domain copy, `next/navigation`
  imports, `useRouter`/`URLSearchParams`/fetch inside `packages/ui`; the shell may not
  compute an `href` or a search param — that is `app-kit`'s; raw hex/px/rem values; a
  per-app fork of the shell.

## Success Criteria

1. `/notes` and `/todos` render from `ListShell` with all data/copy passed as slots.
2. The *Frozen e2e surface* list above is reproduced verbatim.
3. `grep -riE "note|todo" packages/ui/src/components/list-shell.tsx` → no domain hits; no
   `next/navigation` anywhere in `packages/ui`.
4. `npm run typecheck -w packages/ui` and the shell's unit suite are green.
5. The existing journey E2E is unchanged when the routes are ported (`segment-port`).

## Open Questions

- None.
