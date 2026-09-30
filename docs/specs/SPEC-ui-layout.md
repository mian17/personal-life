# Spec: ui-layout (upstream layout primitives: Stack + Section)

Module id: `ui-layout` (see `MAP-todo-ecosystem.md` — this is the follow-up module
that unblocks `/todos` presentation parity). Package: `packages/ui`. Contract:
AGENTS.md Contract 1 (Shared UI Contract) — Rule 3 upstream-first.

## Objective

Add the two container primitives `@life/ui` is missing — a **vertical-rhythm
stack** and a **section with a heading** — so pages that stack bare primitives
(`/todos` composer) and group content (`/todos` todo groups) get the same spacing
and heading language as the pages that never needed it (`/notes`). Then consume
them from `/todos`. No app-side CSS; tokens only.

## Root cause this fixes

See `docs/intent/todos-presentation.md`. In short: `Input`/`Textarea`/`Button`/
`IconButton` carry no margin rules; `/notes` never stacks them directly, `/todos`
does (composer) — so its controls touch. And `/todos` wraps each group's `<List>`
in `PillGroup` (a filter-pill flex row) to fake a heading, which breaks the list
layout. Both are missing-primitive symptoms, not styling bugs.

## Components

### `Stack` (block — `ui-blocks`)

A vertical rhythm container. This is the primitive whose absence produced the
"no margin at all" symptom.

- Props: `gap?: 'sm' | 'md' | 'lg'` (token-mapped: `--space-0-5` / `--space-1` /
  `--space-2`; default `md`), plus `as?`, `className?`, standard children/ref.
- Renders a single `div` with `display: grid; gap: var(--space-*)`.
  `display: grid` (not flex) so a single column stacks regardless of child
  `display` — no child needs to know it is in a stack.
- Accessibility: purely presentational; `role="group"` + `aria-label` pass-through
  when a caller groups a form region (the composer does).
- Never sets its own outer margins — outer spacing is a section's job.

### `Section` (block — `ui-blocks`)

A labelled content region: an optional heading + a stacked body.

- Props: `label?: ReactNode` (renders as the heading), `headingLevel?: 'h2' | 'h3'`
  (default `'h2'`), `actions?: ReactNode` (trailing heading row slot),
  `gap?: StackGap`, plus `className?`, children, ref.
- Renders: region wrapper → heading row (`label` + `actions`) → `Stack` body.
  Spacing: `margin-block-start: var(--space-2)` between sections, heading
  `margin-block-end: var(--space-0-5)`.
- Replaces the `PillGroup`-as-heading usage in `todo-list.tsx`: the group label
  becomes a real heading, the `<List>` is the section body with correct layout.
- Purely presentational; no interactivity, so no `@life/ui` data/routing concerns.

## Consumption (this module's app change)

- `apps/app/app/todo-list.tsx` — `Section label={group.label}` wrapping `<List>`
  (drops the `PillGroup` misuse).
- `apps/app/app/todo-composer.tsx` — bare `<div role="group">` → `<Stack role="group"
  aria-label="New todo" gap="md">`; controls get rhythm; the actions row uses
  `Stack` too.
- `apps/app/app/todo-item.tsx` — the edit block's bare `<div>` → `<Stack>`; the
  attached-chip `PillGroup` stays (it genuinely is a pill row).
- `apps/app/app/list-manager-section.tsx` / `tag-manager-section.tsx` — wrap their
  panels in `Section` for a consistent heading + spacing.
- No other app file changes; `/notes` is untouched.

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/ui
           npm run test:unit -w @life/app
Build:     npm run build -w @life/app
```

## Testing Strategy

- `@life/ui` unit tests: `Stack` renders children in a grid with the token gap per
  `gap` prop; `Section` renders the heading at the requested level, the actions
  slot, and a `Stack` body; both accept `className`/ref and pass through ARIA.
- `@life/app` tests: a render/logic test is thin here (presentational), so the
  meaningful app assertion is that `/todos` still composes the same data (groups,
  composer submit, item save) — the existing app suite must stay green.
- Mechanical (Contract 1): no raw interactive HTML in `apps`, no `next/link` in
  `apps`, raw colors only in `tokens.css`, no domain words in `packages/ui/src`,
  no app CSS recreating primitives.
- Visual verification: the user eyeballs `/todos` in `npm run dev` (the acceptance
  that started this) — agents do not run Playwright.

## Boundaries

- Always: spec + `MAP-ui-primitives.md` updated with the code; tokens only;
  compose from existing primitives where possible.
- Ask first: new token *values* (frozen); any change to the frozen e2e surface.
- Never: app-side CSS/`style=` recreating visuals; raw interactive HTML; a second
  app-wide stylesheet; changing `/notes`; adding e2e assertions.

## Success Criteria

1. `Stack` and `Section` exist in `@life/ui` with tests, documented in
   `SPEC-ui-blocks.md` + `MAP-ui-primitives.md` in the same change.
2. `/todos` uses them; no bare stacking `div` remains in the todo components; the
   `PillGroup`-as-heading misuse is gone.
3. `/notes`, the frozen e2e surface, and token values are unchanged.
4. `npm run test:unit -w @life/ui` + `-w @life/app` green; typecheck + app build clean.
