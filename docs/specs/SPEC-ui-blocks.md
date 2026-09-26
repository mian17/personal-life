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
<List> <ListItem …> </List>                        // ul/li; ListItem: href, title, meta,
                                                   //   snippet, trailing, deleteAction? (render prop)
<TagFilterNav items: {name, href, active}[] />     // .filters pill nav
<FabLink href label>children</FabLink>             // .add-note fixed action
<EditorToolbar back={{href,label}} status?: ReactNode
               actions?: ReactNode />              // .editor-toolbar
<AlertBanner tone="warning" actions?: ReactNode>   // .editor-conflict generalized
   children</AlertBanner>
<SearchField label placeholder
             onQueryChange: (q: string) => void /> // visual + 300ms debounce ONLY;
                                                   //   routing stays in the app
```

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
