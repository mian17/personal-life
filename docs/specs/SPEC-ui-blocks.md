# Spec: ui-blocks — app-level composition blocks

Module id: `ui-blocks` (map: `docs/specs/MAP-ui-primitives.md`). Depends on `ui-atoms`.

## Objective

The block layer: page-scale pieces a new app assembles screens from. Generalized from
the notes app's markup but **not notes-shaped** — no domain verbs in props or classes.
Success = a future app composes PageShell/NavBar/List/EmptyState into working screens,
and the notes app's current pages map onto these one-to-one.

## Components (prop contracts)

```tsx
<PageShell>children</PageShell>                    // <main>: content-width, safe-area padding
<NavBar leading? trailing? />                      // .nav-bar + .header-actions slot
<PageTitle>children</PageTitle>                    // <h1>
<EmptyState heading? body: ReactNode />            // .empty block (used twice today)
<List> <ListItem …> </List>                        // ul/li; ListItem: href?, title, meta,
                                                   //   snippet, trailing, deleteAction?,
                                                   //   children? (render slots; no domain types)
<TagFilterNav items: {name, href, active}[] />     // .filters pill nav
<FabLink href label>children</FabLink>             // .add-note fixed action
<EditorToolbar back={{label, onBack: () => void}}  // back is a BUTTON (frozen:
               status?: ReactNode                  //   onBack is leave(), which
               actions?: ReactNode />              //   flushes autosave) — never an href
<AlertBanner tone="warning" actions?: ReactNode>   // .editor-conflict generalized
   children</AlertBanner>
<SearchField label placeholder value?: string      // controlled current query
             onQueryChange: (q: string) => void /> // visual + 300ms debounce ONLY;
<Stack gap?="sm|md|lg" as?="div" role? aria-* …>   // vertical rhythm: grid, gap: var(--space-*)
   children</Stack>                                //   (default md); no outer margins
<Section label? headingLevel?="h2|h3" actions?     // <section> → heading row (label+actions)
         gap?>children</Section>                   //   → Stack body; section margin-block-start
                                                   //   --space-2; heading margin-block-end --space-0-5
                                                   //   (added by the ui-blocks revision change)
<Row gap?="sm|md|lg">children</Row>                // horizontal companion to Stack: flex, wraps,
                                                   //   same token gap, no outer margins (added by the
                                                   //   ui-blocks revision change)
<EditorStack gap?="sm|md|lg">children</EditorStack> // full-height field stack under an EditorToolbar
                                                   //   (flex:1, token gap; no outer margins; added by the
                                                   //   /todos redesign)
<EditorToolbar back title? status? actions? />    // back {label,onBack}; title = centred <h1>
                                                   //   (create/edit screens carry a heading)
                                                   //   routing stays in the app
<EditorScreen>children</EditorScreen>            // full-screen fixed editor container
                                                 //   (safe-area aware) — owns .editor-screen
<PillGroup label?: ReactNode
           actions?: ReactNode>children</PillGroup> // pill container (with optional
                                                    //   label + per-pill remove slots) —
                                                    //   owns .editor-legacy-tags
<PageActions>children</PageActions>                // page-level action container —
                                                   //   owns .trash-actions
<TagPicker tags: {id: number; name: string}[]      // attach/detach tags by id
           selectedIds: number[]
           onToggle: (id: number) => void
           onCreate?: (name: string) => void
           disabled? label? placeholder? createLabel? />
<TagManager tags: {id: number; name: string}[]     // registry management
            onCreate: (name: string) => void
            onRename: (id: number, name: string) => void
            onDelete: (id: number) => void
            disabled? label? placeholder? createLabel? />
<DueDatePill dueDate: string | null                // grouping read-out (atom —
             today?: string                        //   documented in SPEC-ui-atoms)
             emptyLabel? />
<ListManager lists: {id: string; name: string}[]   // todo-list management
             onCreate: (name: string) => void
             onRename: (id: string, name: string) => void
             onDelete: (id: string) => void
             disabled? label? placeholder? createLabel? />
```

### Todo-ecosystem additions (T7)

The `todo-ui` module needs a shared tag UX (used identically from `/notes` and
`/todos`) and management surfaces. Three blocks are presentational + prop-driven:
**no data fetching, no routing, no domain copy baked in** — the app supplies data and
callbacks. (`DueDatePill` is a leaf atom; its contract lives in `SPEC-ui-atoms`.)

- **`TagPicker`** — attach/detach tags by `id`. Renders one toggle per available
  tag (id + display name supplied as props) in the selected state, plus an optional
  create-from-input affordance.
- **`TagManager`** — manage the registry: list tags with inline rename + delete, and
  create from a draft input.
- **`ListManager`** — todo-list management (`Array<{id: string; name: string}>`), the
  same create/rename/delete shape as `TagManager` (the id is a string, not a number).

#### Composition (element by element)

| Element | Composed from |
|---|---|
| `TagPicker` root (`role="group"`, `aria-label`) | block container `.ui-tag-picker` (structural glue) |
| per-tag toggle | `Pill as="button" size="chip" active aria-pressed disabled` + lucide `Check`/`Plus` icon + tag name |
| `TagPicker` create | `Input` (`aria-label`/`placeholder`) + `IconButton` (`Plus`, `createLabel`) |
| `TagManager` / `ListManager` root | block container `.ui-tag-manager` / `.ui-list-manager` (structural glue) |
| create row | `Input` + `IconButton` (`Plus`) |
| rows | `ul`/`li` (`.ui-*-manager__row`) with a name `span` |
| view affordances | `IconButton label="Rename tag <name>"` (`Pencil`) + `IconButton label="Delete tag <name>"` (`CircleX`) |
| inline edit | `Input` (`aria-label="Rename tag <name>"`) + `IconButton` `Save` (`Check`) + `IconButton` `Cancel` (`X`) |

#### Accessibility

- The tag toggle chips are **real buttons** (via `Pill as="button"`) carrying
  `aria-pressed`; the whole picker is a `role="group"` with an `aria-label`.
- Icon-only actions carry verbatim `aria-label`s (`Rename tag <name>`,
  `Delete tag <name>`, `Rename list <name>`, `Delete list <name>`, `Save`, `Cancel`);
  create inputs are labelled by `placeholder`, and Enter submits a draft or an edit.
- `onCreate`/`onRename` fire only on a non-blank trimmed name; with a blank name the
  Save/Add control is `disabled` and no callback fires. `disabled` propagates to every
  control in the block.

## CSS ownership (legacy `globals.css` classes owned by blocks)

`List`/`ListItem` own the row internals: `.notes`, `.note` (surface **and** row
layout — the legacy class rode the row `li`, now carried by `ListItem`), `.note-link`,
`.note form`, `.note-text`, `.note-title`, `.note-sub`, `.note-sub time`, `.note-sep`,
`.note-snippet`. `AlertBanner` owns the conflict-banner tree: `.editor-conflict`,
`.editor-conflict-text`, `.editor-conflict-actions` (its action *buttons* are owned
by `Button`, see `SPEC-ui-atoms`). Element defaults: bare `h1` → `PageTitle`,
`main` → `PageShell`. The remaining legacy classes are owned per
`SPEC-ui-atoms` and the block contracts above (`.empty` → EmptyState, `.filters` →
TagFilterNav, `.nav-bar`/`.header-actions` → NavBar, `.page-title` → PageTitle,
`.add-note` → FabLink, `.search-box` → SearchField, `.editor-toolbar` →
EditorToolbar, `.editor-screen` → EditorScreen, `.editor-legacy-tags` → PillGroup).
`Card` is a generic surface atom with **no** legacy class counterpart: the legacy
`.note` surface *and* row both rode the row `li`, so `ListItem` owns the surface
declarations (panel bg, `--radius-lg`, overflow) as well as the row layout.
Invariant: every class in `globals.css` has **exactly one** owner — zero classes
unowned or double-owned.

## Tech Stack

Same as `ui-atoms`: React 19 TSX source, `@life/ui/styles.css` (`blocks.css` section),
`ui-*` generic class names, token values only.

## Commands

- `npm run lint -w packages/ui`
- `npm run test -w packages/ui`

## Project Structure

```
packages/ui/src/components/page-shell.tsx   # one file per block
packages/ui/src/styles/blocks.css           # imported by styles.css
packages/ui/test/page-shell.test.tsx        # one suite per block
```

## Code Style

Blocks compose atoms and accept children; data-shaped lists use small typed item
objects or render props — never `Note[]`:

```tsx
<List>
  {notes.map((n) => (
    <ListItem key={n.id} href={`/notes/${n.id}`} title={titleOf(n)}
              meta={<LocalTime dateTime={n.updatedAt} />}
              snippet={snippetOf(n)}
              deleteAction={deleteFormFor(n)} />
  ))}
</List>
```

The notes-specific transforms (`splitBody`, delete server action) stay in `apps/app`.

## Testing Strategy

Same harness as `ui-atoms`. Per block: rendered structure (landmarks/headings/lists),
slot composition (leading/trailing/actions render), `SearchField` debounce timing
(fake timers — only `onQueryChange` fires, no routing knowledge),
`EmptyState` copy override, `ListItem` trailing/delete slot rendering. Layout at the
CSS level is covered by the pixel-identical acceptance in `notes-port`, not here.

## Boundaries

- Always: semantic markup preserved (`main`, `h1`, `ul/li`, `nav`, `form`, `time`) —
  the e2e suite queries roles and headings; ARIA labels pass through verbatim.
- Ask first: blocks not listed above; any fetch/router import in `packages/ui`.
- Never: domain copy defaults (empty-state text is passed in, not baked); run e2e.

## Success Criteria

1. Every current page of `apps/app` maps onto blocks with no bespoke layout markup
   left in the app (verified in `notes-port`).
2. `SearchField` contains zero routing knowledge; `ListItem` zero notes types.
3. Unit tests green; `npm run lint -w packages/ui` clean.
4. No notes-domain identifiers in `packages/ui` (grep-enforced in review).

## Open Questions

- None beyond the map-level test-harness dependency question.
