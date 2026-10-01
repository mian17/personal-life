# Spec: ui-settings — shared settings surface

Module id: `ui-settings` (map: `docs/specs/MAP-settings-and-matrix.md`). Depends on
`ui-atoms`, `ui-blocks`.

Component ownership (registered in `docs/specs/MAP-ui-primitives.md`): the `Switch` atom
belongs to `ui-atoms`; `SettingsRow` and `SettingsBlock` belong to `ui-blocks`. This
module spec declares their contracts and the settings-page composition.

## Objective

A reusable settings surface: a boolean `Switch` atom, two presentational blocks
(`SettingsRow` label + control, `SettingsBlock` an ordered group of rows), and a page
composition. Success = any app renders a settings page from the same blocks and spacing;
Todos is only the first consumer (Theme + Eisenhower matrix). Zero data, zero domain
types, zero routing — the app supplies copy, values and change handlers.

The surface is reusable across apps **by construction** (Contract 1 layering; lesson 0006
— shared UI is whole-page blocks, scoped by consistency, not byte-similarity). A second
app consumes `ManagerBlock` + `SettingsBlock`/`SettingsRow` instead of re-assembling
fragments that can drift.

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';

// ui-atoms — a controlled boolean switch. Client component ('use client'):
// it attaches onClick. Never holds state; the caller owns `checked`.
export interface SwitchProps {
  /** Current state; controlled. The atom never stores it. */
  checked: boolean;
  /** Called with the next value on activation; omit to render a read-only switch. */
  onCheckedChange?: (next: boolean) => void;
  /** Accessible name (`aria-label`); frozen text supplied by the app. */
  label: string;
  /** Disables the control (no callback fires). */
  disabled?: boolean;
  /** Optional field name, passed through as the button's `name`. */
  name?: string;
  /** Class passthrough (e2e hooks ride on it). */
  className?: string;
}

// ui-blocks — one setting: label (+ optional muted description) on the left,
// the caller's control on the right. No data, no domain types.
export interface SettingsRowProps {
  /** Row label (left column). App-supplied copy. */
  label: ReactNode;
  /** Optional muted description under the label. */
  description?: ReactNode;
  /** The control rendered in the right column (e.g. `<ThemeToggle />`, `<Switch/>`). */
  control: ReactNode;
  /** Class passthrough. */
  className?: string;
}

// ui-blocks — an ordered group of `SettingsRow`s under an optional heading.
// Reuses `Section` (heading + token rhythm) and `Card` (panel surface); adds no
// fork of either.
export interface SettingsBlockProps {
  /** Group heading; omitted renders no heading row. */
  title?: string;
  /** The `SettingsRow`s (or any content) in render order. */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}
```

Rendered structure:

```tsx
// Switch — a single real <button>; the track/thumb are drawn by `.ui-switch`
// (pure CSS) so the DOM stays one element. Accessible name comes from `label`.
<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  name={name}
  disabled={disabled}
  className={cx('ui-switch', checked && 'ui-switch--on', className)}
  onClick={() => onCheckedChange?.(!checked)}
/>

// SettingsRow
<div className={cx('ui-settings-row', className)}>
  <div className="ui-settings-row__text">
    <span className="ui-settings-row__label">{label}</span>
    {description != null && (
      <span className="ui-settings-row__desc">{description}</span>
    )}
  </div>
  <div className="ui-settings-row__control">{control}</div>
</div>

// SettingsBlock — Section owns the heading + rhythm, Card the panel surface.
<Section label={title} gap="sm">
  <Card>
    <Stack gap="sm">{children}</Stack>
  </Card>
</Section>
```

### Settings-page composition (Contract 1 Rule 3 fit test — applied)

**Chosen: compose the existing `ManagerBlock`; add no new page block.** Fit test: read
`docs/specs/SPEC-ui-manager-block.md` and `packages/ui/src/components/manager-block.tsx`.
`ManagerBlock` already provides exactly the settings page template — `PageShell` +
back `NavBar` + `PageTitle` (`title`) + a `children` slot for grouped content. A settings
page is that shape with `SettingsBlock`s in the slot, so defining a `SettingsShell` would
fork a template that already fits (the mis-fork Contract 1 Rule 3 forbids). The settings
page therefore composes `ManagerBlock` with the blocks above and introduces no page-level
component.

### Semantics and edge cases

- `Switch` is fully controlled: it renders `checked` verbatim and calls
  `onCheckedChange(!checked)` on activation; it never toggles its own state. Without
  `onCheckedChange` it renders the given state and activation is inert (caller's choice).
- `Switch` does not own form submission: `name` is passed through to the `<button>`, and
  persistence (a server-readable cookie per the intent's D1) is the app's job, not the
  atom's.
- `SettingsRow` renders `control` verbatim in the right column; the block owns only the
  two-column layout and the muted description, never the control's behavior.
- `SettingsBlock` with no `title` renders no heading row (`Section` already omits it).
- Neither block bakes domain copy, reads data, or imports a router; all copy/values arrive
  as props.

### Element-by-element composition — Todos settings page

| Page element | Composed from |
|---|---|
| Page template (`PageShell` + back `NavBar` + `PageTitle`) | `ManagerBlock` (`title="Settings"`, `backHref="/todos"`) |
| Appearance group (`Section` + `Card`) | `SettingsBlock title="Appearance"` |
| Theme row (label left, toggle right) | `SettingsRow label="Theme" control={<ThemeToggle />}` |
| Todos group | `SettingsBlock title="Todos"` |
| Matrix row (label left, switch right) | `SettingsRow label="Eisenhower matrix" control={<Switch … />}` |
| Switch accessible name | `Switch`'s `label` (frozen text `"Eisenhower matrix"`, supplied by the app) |

## CSS ownership

- `Switch` owns `.ui-switch` (+ `.ui-switch--on`) in `atoms.css` — one class for the
  token-styled track and an `::after` thumb; no extra element, no raw values. All colors,
  sizes, radii and transitions come from `ui-tokens` tokens.
- `SettingsRow` owns `.ui-settings-row`, `.ui-settings-row__text`,
  `.ui-settings-row__label`, `.ui-settings-row__desc` (muted: `var(--muted)`), and
  `.ui-settings-row__control` in `blocks.css`. Two-column layout (label left, control
  right, wrap on narrow widths), token spacing only.
- `SettingsBlock` adds **no** CSS: it composes `Section` (`.ui-section*`), `Card`
  (`.ui-card`) and `Stack` (`.ui-stack*`), whose classes are already owned upstream.
- `ManagerBlock` reuses `.ui-page` / `.ui-nav-bar` / `.ui-page-title`; no app stylesheet.

## Tech Stack

React 19 TSX source, `@life/ui/styles.css` (`atoms.css` / `blocks.css`), `ui-*` generic
class names, token values only. `Switch` is `'use client'` (onClick); `SettingsRow` /
`SettingsBlock` render from a server component and compose `ui-blocks` (`Section`, `Card`,
`Stack`) with no router or fetch. `ThemeToggle` is the app-supplied `control` for the
Theme row (a client atom), so the page needs no client boundary of its own.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/settings-row.test.tsx`
- `npm run test:unit -w packages/ui -- test/settings-block.test.tsx`
- `npm run test:unit -w packages/ui -- test/switch.test.tsx`

## Project Structure

```
packages/ui/src/components/switch.tsx            # atom (ui-atoms)
packages/ui/src/components/settings-row.tsx      # block (ui-blocks)
packages/ui/src/components/settings-block.tsx    # block (ui-blocks)
packages/ui/src/index.ts                         # re-exports Switch/SettingsRow/SettingsBlock + types
packages/ui/src/styles/atoms.css                 # .ui-switch (Switch)
packages/ui/src/styles/blocks.css                # .ui-settings-row* (SettingsRow)
packages/ui/test/switch.test.tsx                 # one suite per component
packages/ui/test/settings-row.test.tsx
packages/ui/test/settings-block.test.tsx
```

The settings **page** has no file of its own — it composes `ManagerBlock` (see above); the
`/todos/settings` and `/notes/settings` routes are app code in the `matrix-ui` module.

## Code Style

Compose blocks; pass copy, values and handlers as props (`/todos/settings`):

```tsx
import { ManagerBlock, SettingsBlock, SettingsRow, Switch, ThemeToggle } from '@life/ui';

<ManagerBlock title="Settings" backHref="/todos">
  <SettingsBlock title="Appearance">
    <SettingsRow
      label="Theme"
      description="System, light, or dark."
      control={<ThemeToggle />}
    />
  </SettingsBlock>

  <SettingsBlock title="Todos">
    <SettingsRow
      label="Eisenhower matrix"
      description="Add a Matrix tab that groups todos into four quadrants."
      control={
        <Switch
          label="Eisenhower matrix"
          checked={matrixEnabled}
          onCheckedChange={setMatrixEnabled}
        />
      }
    />
  </SettingsBlock>
</ManagerBlock>
```

`/notes/settings` is the same composition with the Appearance block only. `matrixEnabled`,
its cookie persistence and the change handler stay in `apps/*` (via `app-kit-settings`).

## Testing Strategy

Unit tests only (jest, `packages/ui`; harness per `SPEC-ui-atoms`). Cover:

- `Switch`: renders a `<button type="button" role="switch">` with `aria-checked={checked}`
  and `aria-label={label}`; `onCheckedChange` fires with the negated value; `disabled`
  blocks the callback; `className` merges (e2e hook rides on it); no client state leaks.
- `SettingsRow`: label renders in the left column, `description` renders muted (and is
  omitted when `undefined`), `control` renders verbatim in the right column.
- `SettingsBlock`: `title` becomes the group heading; omitted `title` renders no heading;
  children render in order inside the `Card` surface.
- Composition: `ManagerBlock` + blocks produce a single `h1` settings title and the rows in
  order.

No routing, fetch or layout assertions here. E2E is not run by this module.

## Boundaries

- Always: preserve accessible names/labels supplied via props (frozen text); route all
  spacing/colors/radii through tokens; `className` merges, never replaces; keep element
  semantics (`button role="switch"`, `section`, `h1`).
- Ask first: new props not listed above; any new CSS class beyond `.ui-switch*` and
  `.ui-settings-row*`; introducing a page-level block instead of composing `ManagerBlock`.
- Never: domain types/copy baked into the blocks; data fetching, `next/navigation`, API
  clients or server actions inside `packages/ui`; storing switch state in the atom; raw
  hex/rgb/px/rem values outside `tokens.css`; a per-app fork of the settings page.

## Success Criteria

1. Both settings routes (`/todos/settings`, `/notes/settings`) render from `ManagerBlock` +
   `SettingsBlock`/`SettingsRow` with zero bespoke layout markup in the app.
2. `Switch` is controlled, token-styled, and exposes `role="switch"` + `aria-label` from
   `label`.
3. `grep -riE "note|todo" packages/ui/src/components/settings-{row,block}.tsx` and
   `.../switch.tsx` → no domain hits.
4. `npm run typecheck -w packages/ui` and the three unit suites are green.
5. No second settings-page template exists when `ManagerBlock` already fits (Contract 1
   Rule 3).

## Open Questions

- None. (`Switch`'s `name` passthrough is inert today; revisit only if a form-based
  submission path replaces the cookie mechanism of the intent's D1.)
