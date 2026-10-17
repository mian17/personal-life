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
                                                   //   snippet, leading?, trailing,
                                                   //   deleteAction?,
                                                   //   variant?="todo" | "nested",
                                                   //   size?="default|dense",
                                                   //   tone?="danger|amber|accent",
                                                   //   done?, collapsing?,
                                                   //   children? (render slots; no domain types)
<TagFilterNav items: {name, href, active}[]        // .filters pill nav; label? sits BESIDE the pills
                                                   //   (shared .ui-field-label; also the nav's aria-label)
<FabLink href label>children</FabLink>             // .add-note fixed action
<FabMenu label: string                             // FabLink's fixed corner + a panel of link options;
         icon: ReactNode                            //   controlled (open/onOpenChange), closes on Escape /
         open: boolean                              //   outside pointerdown; anchors inside role="menu"
         onOpenChange: (open: boolean) => void      //   panel keep their own hrefs (meals FAB doors)
         children: ReactNode
         className? />
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
<TagPicker tags: {id: number; name: string}[]      // attach/detach tags by id; label? sits BESIDE the chips
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
             disabled? label? placeholder? createLabel?
             rowExtra?: (list: {id: string; name: string}) => ReactNode />
<Menu label: string                                  // per-row disclosure: controlled (no internal
      summary: ReactNode                             //   open state), inline panel (never absolute/
      open: boolean                                  //   fixed, no portal — `.ui-card { overflow:
      onOpenChange: (open: boolean) => void          //   hidden }` would clip a floating layer)
      children: ReactNode                            //   summary + `⋯` trigger (`MoreVertical`,
      disabled? className? />                        //   aria-haspopup="menu", aria-expanded);
                                                     //   when open: `role="menu"` panel, closes on
                                                     //   Escape / outside pointerdown
<Snackbar message: string                            // transient status toast
          actionLabel?: string
          onAction?: () => void
          onDismiss: () => void
          duration?: number />                       // default 5000
<SnackbarProvider>children</SnackbarProvider>       // holds current snackbar; useSnackbar()
                                                    //   returns { showSnackbar }
<Dialog open: boolean                               // controlled modal on native <dialog>;
        onOpenChange: (open: boolean) => void       //   stores no open state
        title: ReactNode                            //   → .ui-dialog__title
        children: ReactNode                         //   → .ui-dialog__body
        footer?: ReactNode                          //   → .ui-dialog__footer (action row)
        size?="default|full"                        //   "full" → .ui-dialog--full: edge-to-edge,
                                                    //   100dvh, square corners (a full-screen sheet)
        className? />                               // native backdrop/top-layer/Escape
```

### Dialog (`SPEC-todo-custom-repeat.md`)

The recurrence modal needs an overlay; there is no popover/dialog primitive. `Dialog` is the
smallest reusable one, built on the **native `<dialog>`** element so the platform supplies the
backdrop, top-layer rendering (`.ui-card { overflow: hidden }` cannot clip it), Escape-to-close,
and focus trapping for free — no portal library. It is **controlled** and stores no open state.

```ts
export interface DialogProps {
  open: boolean;                          // controlled; the block stores no open state
  onOpenChange: (open: boolean) => void;  // Escape / backdrop / close button
  title: ReactNode;                       // heading (rendered in .ui-dialog__title)
  children: ReactNode;                    // body
  footer?: ReactNode;                     // action row (Confirm/Cancel), right-aligned
  size?: 'default' | 'full';              // 'full' → .ui-dialog--full (full-screen sheet)
  className?: string;
}
```

- `size="full"` adds `.ui-dialog--full`: `width: 100%; height: 100dvh; max-width: none;
  border-radius: 0` (plus `margin: 0` so it fills the viewport, not the native centred
  box). It is the **full-screen sheet** — a surface that takes over the screen rather than
  floating (e.g. a long optional field group opened from a row). Default `size` (omitted)
  keeps the centred panel: `width: min(100% - var(--space-2), var(--content-width))`.
  Both sizes are token-only; no colour literal is introduced.

- `'use client'`. A ref effect on `open` calls the native `showModal()` / `close()`; a `close`
  listener maps the native `close` event to `onOpenChange(false)` — that is the **Escape** path.
  **Backdrop** is a separate explicit `onClick` handler on the `<dialog>`: it calls
  `onOpenChange(false)` only when `e.target` is the dialog element itself (child/keyboard-activated
  clicks are excluded by that check) *and* the pointer is outside the dialog's bounding box.
  A native `<dialog>` does not emit `close` on a backdrop click, so it cannot be part of that
  path. `jsdom` does not implement `showModal`/`close`, so the test owns the shim.
- The close affordance is an `IconButton` (`X`, label `Close`) — no raw `<button>`.
- Tokens only: `.ui-dialog` surface (`--panel`, `--radius-lg`), padding/gap from `--space-*`.
  `tokens.css` is untouched; `.ui-dialog::backdrop` is **not** styled (the native default
  backdrop dims the page; a colour would need a literal outside `tokens.css`).

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
  The optional `rowExtra?: (list: {id: string; name: string}) => ReactNode` prop renders
  the supplied node inside each row's `Menu` panel; it is a domain-free extension point
  (the block bakes no copy and knows no domain notion — the app supplies the node).
- **`Menu`** — the shared per-row disclosure both managers compose. Always draws the
  row `summary` (the entity name) plus a `⋯` `IconButton` trigger labelled by `label`
  (`aria-haspopup="menu"`, `aria-expanded`); the action controls live in the inline
  `role="menu"` panel revealed when `open`. **Controlled** — the block stores no open
  state; the owner passes `open` and `onOpenChange` (fired by the trigger toggle, Escape,
  and an outside `pointerdown`). The panel is intentionally INLINE, not a floating layer:
  the managers sit inside `Card`, whose `.ui-card { overflow: hidden }` would clip an
  absolutely/fixed-positioned panel.
- **`FabMenu`** — the fixed bottom-right action that opens a panel of link options
  (the meals day view's two entry doors). Reuses `FabLink`'s fixed-corner trigger
  visuals for its trigger (`aria-haspopup="menu"`, `aria-expanded`) and `Menu`'s
  semantics: **controlled**, closes on Escape and an outside `pointerdown`. The
  panel renders the app's own anchors (each with its own `href`), so the block bakes
  no route and no domain copy. Distinct from `Menu` (a per-row disclosure, inline
  panel) and from `FabLink` (a single link, no panel).

#### Composition (element by element)

| Element | Composed from |
|---|---|
| `TagPicker` root (`role="group"`, `aria-label`) | block container `.ui-tag-picker` (structural glue) |
| per-tag toggle | `Pill as="button" size="chip" active aria-pressed disabled` + lucide `Check`/`Plus` icon + tag name |
| `TagPicker` create | `Input` (`aria-label`/`placeholder`) + `IconButton` (`Plus`, `createLabel`) |
| `TagManager` / `ListManager` root | block container `.ui-tag-manager` / `.ui-list-manager` (structural glue) |
| create row | `Input` + `IconButton` (`Plus`) |
| rows | `ul`/`li` (`.ui-*-manager__row`); non-editing row is one `Menu` |
| row summary | `Menu` `summary` = the name `span` (`.ui-*-manager__name`), full row width |
| row disclosure trigger | `Menu` `⋯` (`MoreVertical`), label `Actions for <name>`, `aria-haspopup="menu"` |
| view affordances (in the `Menu` panel) | `IconButton label="Rename tag <name>"` (`Pencil`) + `IconButton label="Delete tag <name>"` (`CircleX`) |
| inline edit | `Input` (`aria-label="Rename tag <name>"`) + `IconButton` `Save` (`Check`) + `IconButton` `Cancel` (`X`) |
| `Dialog` root | native `<dialog class="ui-dialog">` (platform element — exempt plumbing) |
| `Dialog` head | `.ui-dialog__head` (structural glue) + title `<h2>` `.ui-dialog__title` + `IconButton` (`X`, label `Close`) |
| `Dialog` body | `.ui-dialog__body` (structural glue, holds `children`) |
| `Dialog` footer (when `footer` set) | `.ui-dialog__footer` (structural glue, holds `footer`) |

#### Accessibility

- The tag toggle chips are **real buttons** (via `Pill as="button"`) carrying
  `aria-pressed`; the whole picker is a `role="group"` with an `aria-label`.
- Icon-only actions carry verbatim `aria-label`s (`Rename tag <name>`,
  `Delete tag <name>`, `Rename list <name>`, `Delete list <name>`, `Save`, `Cancel`);
  the `Menu` trigger is labelled `Actions for <name>` and exposes
  `aria-haspopup="menu"` / `aria-expanded`. Opening a row's menu reveals its
  Rename/Delete controls; picking Rename/Delete closes the menu. Escape and an outside
  `pointerdown` close it too. Create inputs are labelled by `placeholder`, and Enter
  submits a draft or an edit.
- `onCreate`/`onRename` fire only on a non-blank trimmed name; with a blank name the
  Save/Add control is `disabled` and no callback fires. `disabled` propagates to every
  control in the block, including the `Menu` trigger and its panel controls.

### Snackbar (transient status)

A presentation-only toast for a transient confirmation with an optional action
(TickTick-style undo): **no domain copy is baked in** — the message and action label are
supplied by the app.

- **`Snackbar`** renders `<div role="status" class="ui-snackbar">` with a
  `.ui-snackbar__text` span; when `actionLabel` is set it adds an action composed from the
  `Button` atom (`variant="quiet" size="bare"`), never a raw button. `duration` (default
  5000ms) auto-dismisses by setting an internal `leaving` state; the action fires
  `onAction` then immediately leaves. Leaving adds `.ui-snackbar--leaving` and a 200ms
  timer calls `onDismiss` (matching `--duration-base`). Timers clear on unmount.
- **`SnackbarProvider` / `useSnackbar`** hold the current snackbar: `showSnackbar(options)`
  replaces any current one (keyed by `Date.now()`), rendering `{children}` plus the
  `Snackbar`; `onDismiss` clears it. The context default is a **no-op**, so `useSnackbar()`
  outside a provider is safe.
- **Position/presentation:** fixed bottom-left
  (`left/bottom: calc(var(--space-1) + env(safe-area-inset-*))`), `z-index: 20` (above the
  fab's 10), max-width clear of the viewport edges. `role="status"` announces the message
  politely. Styling is token-only: panel/text/border colors, radius/shadow tokens, spacing
  tokens, and the motion tokens (`--duration-base`, `--ease-standard`) for the enter
  animation and the fade/slide transition.

### FabMenu (the doors' FAB)

`FabMenu` fills the one gap the manual-log spec surfaced (`SPEC-manual-log-ui.md` §4):
`FabLink` is a single link and `Menu` is a per-row disclosure, and neither opens a
panel of link options from the fixed corner. The block reuses `FabLink`'s fixed
bottom-right corner (`right/bottom: calc(var(--space-1) + env(safe-area-inset-*))`,
`--fab-size` pill, accent background, `--shadow-fab`, `z-index: 10`) and `Menu`'s
open semantics: **controlled** (`open` / `onOpenChange`; the block stores no open
state), `aria-haspopup="menu"` + `aria-expanded` on the trigger, and the panel closes
on Escape and an outside `pointerdown`. The panel is a column anchored to the corner
(`flex-direction: column-reverse` on the root so the panel sits ABOVE the trigger,
`align-items: flex-end` so it hugs the right edge), carrying the `Menu` panel's
surface (border/panel/radius tokens + `--shadow-fab`). Only the trigger's chrome is
owned here — the options are the app's own anchors (each with its own `href`), which
the app marks `role="menuitem"`; the block bakes no route and no domain copy. The
trigger is a real `<button>` (a panel needs toggling, not navigation), so it takes
the trigger styles inline rather than forking `FabLink`'s anchor rule. The icon is a
prop (`icon`), not a baked `Plus` glyph — the app keeps its door icon.

```tsx
export interface FabMenuProps {
  label: string;                          // trigger accessible name
  icon: ReactNode;                        // the trigger glyph (app-supplied)
  children: ReactNode;                    // panel content: the link options
  open: boolean;                          // controlled; the block stores no open state
  onOpenChange: (open: boolean) => void;  // trigger toggle / Escape / outside pointerdown
  className?: string;
}
```

### MatrixBlock (Eisenhower quadrants)

Presentational only: `quadrants: MatrixQuadrant[]` where each quadrant is
`{ id, label, items, empty?, tone? }`; an `items == null` quadrant renders the `empty` slot.
Each quadrant is a labelled `<section class="ui-matrix__quadrant">` with an
`<h2 class="ui-matrix__label">` heading. `tone?`
(`danger | amber | accent | green`, off by default) adds
`ui-matrix__quadrant--<tone>`, tinting the heading through the matching token colour
(`--danger` / `--amber` / `--accent` / `--green`); no tone leaves the markup unchanged.
An overflowing quadrant scrolls inside its box: `.ui-matrix__quadrant` is
`max-height: 100%; overflow: hidden`, `.ui-matrix__items` is
`flex: 1; min-height: 0; overflow-y: auto` (the heading stays put). This bounded box
depends on the `fill` page's definite height: `.ui-page.ui-list-shell--fill` is
`height: 100dvh; overflow: hidden` (not `min-height`), so the body slot has a definite
height and an overflowing quadrant scrolls within itself instead of growing the page.
`ListItem.tone` (above) tints the row's leading done toggle to match a quadrant.

## CSS ownership (legacy `globals.css` classes owned by blocks)

`List`/`ListItem` own the row internals: `.notes`, `.note` (surface **and** row
layout — the legacy class rode the row `li`, now carried by `ListItem`), `.note-link`,
`.note form`, `.note-text`, `.note-title`, `.note-sub`, `.note-sub time`, `.note-sep`,
`.note-snippet`, and the todo variants `.ui-list-item--todo*` / `.ui-list-item--dense*`.
`ListItem`'s optional slots are `leading?` (a control rendered before the row body, e.g. a
done toggle), `variant?="todo"` (todo presentation, off by default; adds
`.ui-list-item--todo`) and `size?="default|dense"` (the todo row's scale, no effect
without the variant; `"dense"` adds `.ui-list-item--dense`). The todo variant owns the
leading anatomy: the DEFAULT size centres the row (the leading checkbox and the action
slots) through the base `align-items: center`; the leading toggle box is `width/height:
auto` with a token padding whose left inset (`var(--space-0-9)`) gives the checkbox room
from the row edge; `--checkbox-size` is 1.25rem (20px) normal; and the title clamps to at
most two lines then truncates with an ellipsis (`display: -webkit-box;
-webkit-line-clamp: 2; white-space: normal`). The DENSE scale alone restores
`align-items: flex-start` on the row and its link (top-aligned), and keeps only the
compact overrides: `min-height: 0`
(overriding the base two-line floor), compact link padding
(`padding: var(--space-0-6) var(--space-0-4)`) with a tighter gap (`gap: var(--space-0-5)`),
`--checkbox-size` 0.75rem (12px), and title/sub type at `font-size: var(--space-0-7)`.
The leading done toggle renders the `Checkbox` atom (rounded square, radius
`--space-0-2`, sized by `--checkbox-size`, owned by `SPEC-ui-atoms.md`). The dense scale
wins the `--checkbox-size` cascade by source order (`.ui-list-item--dense` follows
`.ui-list-item--todo`). `tone?`
(`danger | amber | accent`, off by default; adds `.ui-list-item--<tone>`) tints the row's
leading icon control via the matching token colour. Each tone rule is scoped
`.ui-list-item--<tone>:not(.ui-list-item--done) .ui-icon-btn`, so an OPEN toned row is
tinted and a completed row turns muted exactly like an un-toned one — a done row is never
coloured by its quadrant. The row action slots
(trailing / deleteAction) are vertically
centred against the row (`align-items: center`), while the row link still stretches
to full height (`align-self: stretch`) so the tap/hover area is unchanged. The row
also carries a token-derived `min-height` floor equal to one two-line row (title +
sub, ~75.6px at the frozen base), so a row with empty `meta`/`snippet` cannot
collapse.

The **`nested`** variant (`variant="nested"`, off by default; adds `.ui-list-item--nested`)
presents a row that owns an indented child region — a parent line (its `title`) with a stack
of children below it, one level in. It exists because the base row renders `title` and
`children` as siblings in a horizontal flex row (`.ui-list-item__link`, `align-items: center`),
so a row whose children are a *vertical field body* lays them out side by side. The variant
overrides the row link to a column (`flex-direction: column; align-items: stretch`) so the
title reads as the parent line and `children` stack beneath it. The indent is a token step on
the nested body (`padding-left: var(--space-1)`), not app CSS; a future tree spine would be a
left border on the same class. The area owns `.ui-list-item--nested` and the child body's
padding — no app-level indentation. It composes `Stack` and other blocks inside the body; it
adds no markup of its own beyond the wrapper the base row already renders.

The nested variant also takes an optional **`titleAction`** slot: a control rendered on the
parent line beside `title` (e.g. a row's delete affordance, so it sits against the title
control rather than beside the whole child body — a `deleteAction` sibling would steal
horizontal width from every child row). When set, `.ui-list-item__title` becomes a
horizontal flex line (`display: flex; align-items: stretch; gap: var(--space-0-5)`) whose
`title` content grows (`flex: 1; min-width: 0`) and whose `titleAction` stretches to the
line's height — so a button in the slot matches the height of a control in the title. The
slot is `nested`-only; without it the title line keeps the base block layout.

Declutter states (the completed-todo motion): `done?` adds
`.ui-list-item--done`, striking and muting the title
(`.ui-list-item--done .ui-list-item__title { color: var(--muted);
text-decoration: line-through; }`) and muting row icon buttons
(`.ui-list-item--done .ui-icon-btn { color: var(--muted); }`). Because the tone
rules above exclude `.ui-list-item--done`, this mute wins for a completed toned
row too — every done row is uniformly muted. `collapsing?` adds
`.ui-list-item--collapsing` (`height: 0; min-height: 0; opacity: 0; overflow:
hidden;`), which animates because the base `.ui-list-item` rule carries
`transition: height/opacity var(--duration-base) var(--ease-standard)` and
`interpolate-size: allow-keywords` (progressive `height: auto → 0` collapse;
engines without `interpolate-size` snap to 0). A group section whose every row
was removed collapses with it via
`.ui-section:has(.ui-list):not(:has(.ui-list-item)) { display: none; }` — a
section with no list is untouched.

`AlertBanner` owns the conflict-banner tree: `.editor-conflict`,
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
