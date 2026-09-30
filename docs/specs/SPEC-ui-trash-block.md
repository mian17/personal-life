# Spec: ui-trash-block — whole-page trash block

Module id: `ui-trash-block` (map: `docs/specs/MAP-shared-page-blocks.md`). Depends on `ui-blocks`.

## Objective

A whole-page `@life/ui` trash block: `PageShell` + back `NavBar` + `PageTitle` + empty
`EmptyState` + `List`/`ListItem` restore/delete rows + `PageActions` empty-trash control.
Data, copy and the bound mutations arrive as props; the block owns every element, its
spacing and the frozen control markup. Success = `/notes/trash` and `/todos/trash` shrink
to data + copy + two bound server actions, and render byte-identical structure and spacing.

The block is **domain-agnostic**: no `Note`/`Todo` types, no domain verbs, no baked copy,
no `next/navigation`, no API client. Dates arrive as a `meta` node (the app renders
`LocalTime`).

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';

/** A row the block renders; the app supplies presentation-free data. */
export interface TrashBlockItem {
  /** Stable React key + the id passed to the bound action mappers. */
  id: string;
  /** Row title; also feeds the frozen `Restore ${title}` label by default. */
  title: string;
  /** Trailing meta line, e.g. `<LocalTime dateTime={deletedAt} />`. */
  meta?: ReactNode;
  /** Secondary line under the title. */
  snippet?: string;
}

/** A Next server action already bound to one row. */
export type TrashFormAction = (formData: FormData) => void | Promise<void>;

export interface TrashBlockProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text, e.g. "Trash". */
  title: string;
  /** Back target (`IconLink` href). */
  backHref: string;
  /** Back control aria-label; default `"Back"` (frozen). */
  backLabel?: string;
  /** Rows; empty renders only the empty state. */
  items: readonly TrashBlockItem[];
  /** Empty-state body text (frozen), e.g. "Trash is empty.". */
  emptyMessage: string;
  /** Per-row restore action: returns the server action bound to that id. */
  restoreAction: (id: string) => TrashFormAction;
  /** Per-row permanent-delete action: returns the server action bound to that id. */
  deleteForeverAction: (id: string) => TrashFormAction;
  /** Confirm-dialog copy for permanent delete, e.g. "Delete this todo forever? This cannot be undone.". */
  deleteForeverMessage: (item: TrashBlockItem) => string;
  /** The empty-trash action bound to no row. */
  emptyTrashAction: TrashFormAction;
  /** Confirm-dialog copy for emptying trash, e.g. "Permanently delete all todos in trash? This cannot be undone.". */
  emptyTrashMessage: string;
  /** Restore button text; default `"Restore"` (frozen visible text). */
  restoreLabel?: string;
  /** Empty-trash button text; default `"Empty Trash"` (frozen visible text). */
  emptyTrashLabel?: string;
}

export function TrashBlock(props: TrashBlockProps): JSX.Element;
```

Rendered structure, top to bottom:

```tsx
<PageShell>
  <NavBar leading={<IconLink href={backHref} label={backLabel}><ArrowLeft size={20} aria-hidden /></IconLink>} />
  <PageTitle>{title}</PageTitle>
  {items.length === 0 ? (
    <EmptyState body={emptyMessage} />
  ) : (
    <>
      <List>
        {items.map((item) => (
          <ListItem
            key={item.id}
            title={item.title}
            meta={item.meta}
            snippet={item.snippet}
            trailing={
              <form action={restoreAction(item.id)}>
                <Button type="submit" variant="quiet" className="trash-restore"
                        aria-label={`${restoreLabel} ${item.title}`}>
                  {restoreLabel}
                </Button>
              </form>
            }
            deleteAction={
              <form action={deleteForeverAction(item.id)}>
                <ConfirmButton variant="danger" className="trash-delete"
                               message={deleteForeverMessage(item)}>
                  <Trash2 size={18} aria-hidden />
                </ConfirmButton>
              </form>
            }
          />
        ))}
      </List>
      <PageActions>
        <form action={emptyTrashAction}>
          <ConfirmButton variant="danger" size="bare" className="trash-empty"
                         message={emptyTrashMessage}>
            {emptyTrashLabel}
          </ConfirmButton>
        </form>
      </PageActions>
    </>
  )}
</PageShell>
```

### Semantics and edge cases

- `items.length === 0` renders `EmptyState` **and no** `PageActions` — an empty trash must
  not offer "Empty Trash".
- `meta`/`snippet` are omitted from the DOM when `undefined` (no empty wrapper elements).
- `restoreAction(id)` / `deleteForeverAction(id)` are called once per row at render; the
  block never calls an action itself — the browser submit does.
- The default `Restore ${title}` label uses the **rendered** title, matching the frozen e2e
  query exactly for any title, including titles with spaces.
- The block adds no `'use client'` of its own. Its only composed client atom is
  `ConfirmButton` (LocalTime may appear inside app-supplied `meta` nodes; `IconButton`
  carries no `'use client'` directive), so the block stays usable from a server component
  with server-action props.

### Element-by-element mapping (duplication evidence)

`apps/app/app/notes/trash/page.tsx:1-92` ≡ `apps/app/app/todos/trash/page.tsx:1-92`
(~95% identical JSX; only the fetch, the bound actions and the copy differ).

| Block element | notes/trash/page.tsx | todos/trash/page.tsx |
|---|---|---|
| `PageShell` | `:25` | `:28` |
| back `NavBar` + `IconLink` | `:26-32` | `:29-35` |
| `PageTitle` | `:34` | `:37` |
| empty `EmptyState` | `:36-38` | `:39-41` |
| `List` / `ListItem` | `:40-75` | `:43-75` |
| `trailing` restore form | `:49-60` | `:50-61` |
| `deleteAction` permanent-delete form | `:61-71` | `:62-72` |
| `PageActions` + empty-trash control | `:76-87` | `:76-87` |

### Frozen e2e surface (what the suite actually queries — must not change)

`apps/app/test/e2e/journey.ts` and `journey.suite.ts` query:

- `getByRole('listitem')` filtered by the row title → `ListItem`'s `li` (`journey.ts:104`).
- `button.trash-delete` inside the row → the permanent-delete `ConfirmButton` class
  (`journey.ts:106`).
- `getByLabel(`Restore ${title}`)` → restore control (`journey.ts:96-97`).
- `getByLabel('Back')` → the back `IconLink` (`journey.suite.ts:99`).
- `getByText('Trash is empty.')` → the `emptyMessage` prop value (`journey.suite.ts:105`).

Preserved but **not** asserted by any test today — keep them anyway, they are user-visible
and this block owns them: the restore control's visible text `Restore` and its class
`trash-restore`, the empty-trash control's class `trash-empty` and visible text
`Empty Trash`, and the `PageTitle` heading text.

## CSS ownership

The block composes existing blocks whose classes are already owned: `PageShell`
(`.ui-page`), `NavBar` (`.ui-nav-bar`), `PageTitle` (`.ui-page-title`), `EmptyState`
(`.ui-empty`), `List`/`ListItem` (`.ui-list`, `.ui-list-item`), `PageActions`
(`.ui-page-actions`). It adds **no** raw values and no app stylesheet. The frozen legacy
hook classes `trash-restore`, `trash-delete` and `trash-empty` ride on the composed
atoms via `className`; they are the block's e2e hooks, not new styling rules. Any wrapper
the block needs (none is required) would be structural glue with token-only spacing
(`var(--space-*)`, `var(--radius-*)`).

## Tech Stack

React 19 TSX source, `@life/ui/styles.css`, token values only. Assembles `ui-blocks`
(`PageShell`, `NavBar`, `PageTitle`, `EmptyState`, `List`, `ListItem`, `PageActions`) and
`ui-atoms` (`IconLink`, `Button`, `ConfirmButton`); `ArrowLeft`/`Trash2` from
`lucide-react` (consumer-provided peer dependency).

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/trash-block.test.tsx`

## Project Structure

```
packages/ui/src/components/trash-block.tsx   # block source + exported prop types
packages/ui/src/index.ts                     # re-exports TrashBlock + types
packages/ui/test/trash-block.test.tsx        # one suite for the block
```

## Code Style

Compose blocks and atoms; never raw markup and never `Note`/`Todo`:

```tsx
<TrashBlock
  title="Trash"
  backHref="/notes"
  items={notes.map((n) => ({ id: n.id, title: titleOf(n),
                             meta: n.deletedAt ? <LocalTime dateTime={n.deletedAt} /> : undefined,
                             snippet: snippetOf(n) || undefined }))}
  emptyMessage="Trash is empty."
  restoreAction={(id) => restoreNoteAction.bind(null, id)}
  deleteForeverAction={(id) => deleteForeverAction.bind(null, id)}
  deleteForeverMessage={() => 'Delete this note forever? This cannot be undone.'}
  emptyTrashAction={emptyTrashAction}
  emptyTrashMessage="Permanently delete all notes in trash? This cannot be undone."
/>
```

`splitBody` and the server actions stay in `apps/app`.

## Testing Strategy

Unit tests only (jest, `packages/ui`). Cover: non-empty render (rows, restore label, delete
control class `trash-delete`, `Empty Trash` control); empty render (`Trash is empty.`, no
`PageActions`); `meta`/`snippet` omission; per-row bound action identity; copy defaults vs
overrides (`restoreLabel`, `emptyTrashLabel`, `backLabel`). Layout at the CSS level is
covered by the segment port's pixel-identical acceptance, not here. E2E is not run by this
module; `segment-port` runs the journey unchanged.

## Boundaries

- Always: preserve the roles, headings, visible text, aria-labels and hook classes listed
  under *Frozen e2e surface*; route all spacing/margins/gaps through tokens.
- Ask first: new props not listed above; any new CSS class; running E2E.
- Never (hard exclusions): `Note`/`Todo`/`List` domain types or domain copy baked into the
  block; `next/navigation`, `next/link` imports beyond the composed `IconLink`, fetch,
  API clients or server-action definitions inside `packages/ui`; raw hex/px/rem values; a
  per-app fork of this block.

## Success Criteria

1. Both trash routes reduce to data + copy + bound actions, with zero bespoke JSX left.
2. The *Frozen e2e surface* list above is reproduced verbatim by the block.
3. `grep -riE "note|todo" packages/ui/src/components/trash-block.tsx` → no domain hits.
4. `npm run typecheck -w packages/ui` and the block's unit suite are green.
5. The existing journey E2E is unchanged when the routes are ported (`segment-port`).

## Open Questions

- None.
