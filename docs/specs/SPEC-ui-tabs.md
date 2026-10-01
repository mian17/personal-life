# Spec: ui-tabs — tab navigation + ListShell `tabs` slot

Module id: `ui-tabs` (map: `docs/specs/MAP-settings-and-matrix.md`). Depends on `ui-atoms`.

Component ownership (registered in `docs/specs/MAP-ui-primitives.md`): `Tab` and `TabBar`
belong to `ui-blocks`. This module also adds a `tabs?` slot to `ListShell`
(`docs/specs/SPEC-ui-list-shell.md`).

## Objective

A tab navigation row: a `TabBar` (`<nav aria-label>`) wrapping ordered `Tab` links, plus a
`tabs?` slot on `ListShell` positioned directly under `PageTitle`. Success = a list page
shows server-rendered tab links (List / Matrix) with the active tab marked, no client JS
required to switch, and the `ListShell` byte-identical when `tabs` is omitted.

`TabBar`/`Tab` is a genuinely **new** component — navigation, **not** filters — so it does
**not** reuse or restyle `PillGroup` (the user requested it explicitly; intent L1 / map D2).
`PillGroup`'s filter semantics and visuals would be a mis-fork (Contract 1 Rule 3).

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';

// ui-blocks — one tab: a server-rendered link. Renders `next/link`'s Link
// (the package owns `next/link`), so tab switching is client-side navigation
// with no client state in the component itself.
export interface TabProps {
  /** Destination, e.g. `/todos` or `/todos/matrix` (app-supplied). */
  href: string;
  /** Marks the current tab: renders `aria-current="page"`. */
  active?: boolean;
  /** Tab label (frozen visible text, app-supplied). */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

// ui-blocks — the ordered tab row: a <nav> landmark with an accessible name.
// Server-renderable: no state, no effects, no 'use client'.
export interface TabBarProps {
  /** Nav landmark name (`aria-label`); frozen text, app-supplied. */
  'aria-label': string;
  /** The `Tab`s in render order. */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}
```

Rendered structure:

```tsx
// Tab — the package owns next/link; active marks the current page.
<Link
  href={href}
  aria-current={active ? 'page' : undefined}
  className={cx('ui-tab', active && 'ui-tab--active', className)}
>
  {children}
</Link>

// TabBar
<nav aria-label={ariaLabel} className={cx('ui-tab-bar', className)}>
  {children}
</nav>
```

### `ListShell` `tabs?` slot

`ListShell` gains one optional slot, rendered **immediately after `PageTitle`**:

```tsx
export interface ListShellProps {
  // …existing props unchanged…
  /** Tab navigation (`TabBar`); rendered directly under the page title. */
  tabs?: ReactNode;
}
```

Rendered structure, in the fixed order (the new slot is bolded):

```tsx
<PageShell>
  <NavBar trailing={navTrailing} />
  <PageTitle>{title}</PageTitle>
  {tabs}
  {search}
  {filters}
  {body}
  <FabLink href={fabHref} label={fabLabel}>{fabIcon}</FabLink>
</PageShell>
```

`tabs` renders nothing when omitted, so today's pages are byte-identical (no wrapper, no
extra element). `SPEC-ui-list-shell.md` documents the slot, order and omitted-case.

### Semantics and edge cases

- `Tab` is a link, not a button: switching tabs is a navigation (full href, works without
  JS in the default case), never client state. The Matrix route is server-gated by the app
  (intent L2 / map D3) — the `TabBar` only renders the tab the app passes to it.
- `active` renders `aria-current="page"`; when not `active` the attribute is absent.
- `TabBar` orders `children` verbatim; it imposes no layout beyond the `nav` wrapper and
  its token rhythm, and holds no selected-index knowledge (the app computes `active`).
- `ListShell` still renders every slot verbatim; the `tabs` slot is app-supplied nodes, and
  the shell adds no data, URL or routing logic for it (same contract as `search`/`filters`).

### Element-by-element composition — `/todos` TabBar

| Element | Composed from |
|---|---|
| Tab row (landmark) | `TabBar aria-label="Todos views"` |
| List tab (default) | `Tab href="/todos" active` → `List` |
| Matrix tab (only when enabled) | `Tab href="/todos/matrix"` → `Matrix` |
| Shell slot | `ListShell tabs={<TabBar …>…</TabBar>}` |

The enabled/disabled decision and the server gate on `/todos/matrix` stay in `apps/*`
(`matrix-ui`); `TabBar` receives only the tabs to render.

## CSS ownership

- `Tab` owns `.ui-tab` (+ `.ui-tab--active`) and `TabBar` owns `.ui-tab-bar` in
  `blocks.css` — token-only (colors, spacing, radii, focus ring). `Link` is styled as the
  tab; no raw values, no app stylesheet.
- The `ListShell` slot adds **no** class of its own: `tabs` renders the app-supplied node
  (`TabBar`'s `.ui-tab-bar`) verbatim; the shell still owns only the fixed element order.

## Tech Stack

React 19 TSX source, `@life/ui/styles.css` (`blocks.css`), `ui-*` generic class names,
token values only. `Tab` imports `next/link`'s `Link` (the package owns `next/link`;
`next` is a peer dependency of `@life/ui` — `SPEC-ui-tokens`). `TabBar` and `Tab` are
server components (no `'use client'`, no state); `ListShell` composes them like any slot.
No `next/navigation`, no fetch.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/tab-bar.test.tsx`
- `npm run test:unit -w packages/ui -- test/list-shell.test.tsx`

## Project Structure

```
packages/ui/src/components/tab-bar.tsx       # Tab + TabBar source + exported prop types
packages/ui/src/index.ts                     # re-exports Tab, TabBar + types
packages/ui/src/components/list-shell.tsx    # adds the tabs? slot
packages/ui/src/styles/blocks.css            # .ui-tab, .ui-tab--active, .ui-tab-bar
packages/ui/test/tab-bar.test.tsx            # one suite for tabs
packages/ui/test/list-shell.test.tsx         # extends the slot-order suite with `tabs`
```

## Code Style

Server-rendered links; the app decides which tabs exist:

```tsx
<ListShell
  title="Todos"
  tabs={
    <TabBar aria-label="Todos views">
      <Tab href="/todos" active>List</Tab>
      {matrixEnabled && <Tab href="/todos/matrix">Matrix</Tab>}
    </TabBar>
  }
  search={<TodoSearchBox q={q} listId={list} tag={tag} done={done} />}
  filters={<StatusAndTagFilters … />}
  body={<TodoList groups={groups} today={today} lists={lists} availableTags={availableTags} />}
  fabHref="/todos/new"
  fabLabel="New todo"
  fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
/>
```

`matrixEnabled` comes from the server-readable preference cookie (intent D1); the
`/todos/matrix` route gate stays in `apps/*`.

## Testing Strategy

Unit tests only (jest, `packages/ui`; harness per `SPEC-ui-atoms`). Cover:

- `Tab`: renders an anchor with `href`; `active` sets `aria-current="page"` and omits it
  otherwise; children render verbatim.
- `TabBar`: renders a `<nav>` with the `aria-label`; tabs render in order.
- `ListShell`: the slot order becomes
  `nav → h1 → tabs → search → filters → body → fab` when `tabs` is passed; with `tabs`
  omitted nothing renders in its place and the existing omitted-slots assertion still holds.

No routing behavior is asserted (the app owns hrefs). E2E is not run by this module.

## Boundaries

- Always: keep `Tab` a link (`next/link` `Link`) and `TabBar` a `nav` with an `aria-label`;
  preserve `aria-current="page"` semantics; tokens only; `className` merges.
- Ask first: a `tabs` slot variant that owns URL/active computation; any new CSS class
  beyond `.ui-tab*` / `.ui-tab-bar`; running E2E.
- Never: reuse/restyle `PillGroup` for tabs (navigation ≠ filters); client state or
  `'use client'` in `Tab`/`TabBar`; `next/navigation`, `useRouter`/`URLSearchParams`/fetch
  inside `packages/ui`; domain copy or route knowledge baked into the components; raw
  hex/rgb/px/rem values; a per-app fork of the tab row.

## Success Criteria

1. `/todos` renders its TabBar from `TabBar`/`Tab`; the Matrix tab is present only when the
   app passes it (server-gated route), and List is the default `active` tab.
2. `Tab` renders a `next/link` `Link`; `active` reproduces `aria-current="page"`.
3. `ListShell` slot order is `PageTitle → tabs → search → filters → body → FabLink`, and
   omitting `tabs` renders nothing (today's pages byte-identical).
4. `grep -riE "note|todo" packages/ui/src/components/tab-bar.tsx` → no domain hits; no
   `PillGroup` import in `tab-bar.tsx`.
5. `npm run typecheck -w packages/ui` and the tab + list-shell unit suites are green.

## Open Questions

- None.
