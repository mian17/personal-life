# Spec: ui-manager-block — whole-page manager template

Module id: `ui-manager-block` (map: `docs/specs/MAP-shared-page-blocks.md`). Depends on `ui-blocks`.

## Objective

A whole-page `@life/ui` manager template: back `NavBar` + `PageTitle` + a manager-section
slot the app fills (today `TagManager` / `ListManager`). Back href and copy are props; the
section body is a render slot so the block stays domain-agnostic. Success = `/notes/tags`,
`/todos/tags` and `/todos/lists` shrink to props + one slot, with identical structure and
spacing.

The block is **domain-agnostic**: no `Note`/`Todo`/`List` types, no management callbacks
of its own (the app passes a `TagManager`/`ListManager` node through the slot), no
`next/navigation`, no fetch.

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';

export interface ManagerBlockProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text, e.g. "Tags"/"Lists". */
  title: string;
  /** Back target (`IconLink` href). */
  backHref: string;
  /** Back control aria-label; default `"Back"` (frozen). */
  backLabel?: string;
  /** The manager surface: an app-composed `TagManager`/`ListManager` node. */
  children: ReactNode;
}

export function ManagerBlock(props: ManagerBlockProps): JSX.Element;
```

Rendered structure:

```tsx
<PageShell>
  <NavBar leading={<IconLink href={backHref} label={backLabel}><ArrowLeft size={20} aria-hidden /></IconLink>} />
  <PageTitle>{title}</PageTitle>
  {children}
</PageShell>
```

The app wraps its panel in the existing `Card` surface inside `children` when it wants a
panel — the block does not bake a surface in (the current manager sections each render
`<Card>` themselves, see mapping below).

### Semantics and edge cases

- `children` is a single render slot; the block imposes no layout on it beyond the page's
  flow. The app is responsible for its own card/panel composition.
- `backLabel` defaults to `"Back"`, matching the frozen e2e query.
- The block is a server component by default; any client interactivity lives inside the
  slot's node (e.g. `TagManager`, which is client) and does not require the block itself to
  cross the client boundary.

### Element-by-element mapping (duplication evidence)

`apps/app/app/notes/tags/page.tsx:1-23` ≡ `apps/app/app/todos/tags/page.tsx:1-23` are
byte-identical except one `href`; `apps/app/app/todos/lists/page.tsx:1-23` repeats the same
template again.

| Block element | notes/tags/page.tsx | todos/tags/page.tsx | todos/lists/page.tsx |
|---|---|---|---|
| `PageShell` | `:9` | `:9` | `:9` |
| back `NavBar` + `IconLink` | `:10-16` | `:10-16` | `:10-16` |
| `PageTitle` | `:18` | `:18` | `:18` |
| section slot | `:20` (`<TagManagerSection />`) | `:20` (`<TagManagerSection />`) | `:20` (`<ListManagerSection />`) |

The slot payload today (`apps/app/app/tag-manager-section.tsx:13-15`,
`apps/app/app/list-manager-section.tsx:9-11`) is a `Card` wrapping the manager panel; that
composition stays in the app and is passed as `children`.

### Frozen e2e surface (what the suite actually queries — must not change)

- `getByLabel('Back')` → the back `IconLink` (default `backLabel`) (`journey.suite.ts:99`).

Preserved but **not** asserted by any test today — the block must not alter them all the
same: the `PageTitle` heading text (`Tags` / `Lists`) and every manager control's label
(`Rename tag <name>`, `Delete tag <name>`, `Save`, `Cancel`, `Rename list <name>`,
`Delete list <name>`). Those labels are owned by `ui-blocks`' `TagManager`/`ListManager`
and are preserved because the slot renders them unchanged.

## CSS ownership

The block composes existing blocks only: `PageShell` (`.ui-page`), `NavBar`
(`.ui-nav-bar`), `PageTitle` (`.ui-page-title`). It adds no CSS of its own; the slot's
`Card` / manager classes are owned by `ui-atoms` and `ui-blocks`. No raw values, no app
stylesheet, no new class.

## Tech Stack

React 19 TSX source, `@life/ui/styles.css`, token values only. Composes `ui-blocks`
(`PageShell`, `NavBar`, `PageTitle`) and `ui-atoms` (`IconLink`); `ArrowLeft` from
`lucide-react`.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/manager-block.test.tsx`

## Project Structure

```
packages/ui/src/components/manager-block.tsx   # block source + exported prop type
packages/ui/src/index.ts                       # re-exports ManagerBlock + type
packages/ui/test/manager-block.test.tsx        # one suite for the block
```

## Code Style

Compose blocks; pass the manager node through the slot:

```tsx
<ManagerBlock title="Tags" backHref="/notes">
  <TagManagerSection />
</ManagerBlock>
```

The section (fetch + `Card` + panel + server actions) stays in `apps/app`.

## Testing Strategy

Unit tests only (jest, `packages/ui`). Cover: heading renders `title`; back `IconLink`
uses `backHref` and default label `Back` (and a `backLabel` override); `children` renders
inside the shell as-is. No layout assertions here. E2E is not run by this module;
`segment-port` runs the journey unchanged.

## Boundaries

- Always: preserve the heading text, the `Back` label and the `IconLink` href contract;
  spacing via tokens only.
- Ask first: adding props that turn this template into a data owner (it must not fetch);
  any new CSS class; running E2E.
- Never (hard exclusions): domain types (`Note`/`Todo`/`List`) or management callbacks
  (`onCreate`/`onRename`/`onDelete`) defined in the block; `next/navigation`, fetch, API
  clients or server actions inside `packages/ui`; raw hex/px/rem values; a per-app fork of
  this template.

## Success Criteria

1. `/notes/tags`, `/todos/tags`, `/todos/lists` reduce to `ManagerBlock` + a slot node,
   with no bespoke shell JSX left.
2. The *Frozen e2e surface* `Back` label is reproduced verbatim, and the heading text and
   manager-control labels listed under it keep their current values.
3. `grep -riE "note|todo|list" packages/ui/src/components/manager-block.tsx` → no domain
   hits.
4. `npm run typecheck -w packages/ui` and the block's unit suite are green.
5. The existing journey E2E is unchanged when the routes are ported (`segment-port`).

## Open Questions

- None.
