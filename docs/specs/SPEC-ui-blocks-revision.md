# Spec: ui-blocks revision — Stack + Section (for /todos parity)

Module id: `ui-blocks` (map: `docs/specs/MAP-ui-primitives.md`). This is a revision
of the existing `ui-blocks` spec, not a new module: the two components' prop
contracts are owned by `docs/specs/SPEC-ui-blocks.md` (its "Components" table);
this file records the change, the root cause, and the `/todos` consumption.
Contract: AGENTS.md Contract 1 — Rule 3 upstream-first, spec-first.

## Objective

Add the two container primitives `@life/ui` is missing — a **vertical-rhythm stack**
and a **section with a heading** — then consume them from `/todos`, so a page that
stacks bare primitives (the composer) and groups content (the todo groups) gets the
same spacing and heading language as the pages that never needed it.

## Root cause this fixes

See `docs/intent/todos-presentation.md`. `Input`/`Textarea`/`Button`/`IconButton`
carry no margin rules (`packages/ui/src/styles/atoms.css`), and `/notes` never stacks
them directly — every notes section is a self-spacing block. `/todos` is the first
page that stacks bare primitives (`todo-composer.tsx`'s `<div role="group">`) and the
first that needs group headings (`todo-list.tsx` wraps each `<List>` in `PillGroup`,
a filter-pill flex row: `display:flex; flex-wrap:wrap`). Both are missing-primitive
symptoms. The fix is upstream (Contract 1 Rule 3), never app CSS.

## Components

Prop contracts live in `SPEC-ui-blocks.md` (owner). Summary of what this revision adds
there:

- **`Stack`** — vertical rhythm container: `gap?: StackGap` (`'sm' | 'md' | 'lg'`,
  token-mapped, default `'md'`), `as?: 'div'`, `className?`, children, ref. Renders a
  single `div` with `display: grid; gap: var(--space-*)`. `display: grid` (not flex)
  so it stacks children regardless of their own `display`. Purely presentational; no
  outer margins of its own.
- **`Section`** — labelled region: `label?: ReactNode`, `headingLevel?: 'h2' | 'h3'`
  (default `'h2'`), `actions?: ReactNode` (trailing heading-row slot), `gap?: StackGap`
  (default `'md'`, same as the `Stack` body), `className?`, children, ref. Renders
  `<section>` → heading row (label + actions) →
  `Stack` body. Owns `margin-block-start: var(--space-2)` and a
  `margin-block-end: var(--space-0-5)` on its heading. Non-interactive.
- `export type StackGap = 'sm' | 'md' | 'lg'` from `packages/ui/src/index.ts`.

## Consumption (this revision's app change)

- `apps/app/app/todo-list.tsx` — `Section label={group.label}` wrapping `<List>`
  (drops the `PillGroup`-as-heading misuse). **This adds heading roles to `/todos`**
  (user-approved per the intent's Frozen-surface line); it changes no existing
  `getByRole` query — the frozen suite's only heading query is
  `heading { name: 'Notes' }`, which is unaffected.
- `apps/app/app/todo-composer.tsx` — `<div role="group" aria-label="New todo">` →
  `<Stack role="group" aria-label="New todo" gap="md">` (the frozen selector is
  preserved by the pass-through). No "actions row" — the single "Add todo" `Button`
  stays the last stacked child.
- `apps/app/app/todo-item.tsx` — the edit block's bare `<div>` → `<Stack>`. The
  attached-chip `PillGroup` and the Save/Cancel `PillGroup` are both **kept** (they
  genuinely are pill rows).
- `apps/app/app/list-manager-section.tsx` — wrap its panel in
  `<Section label="Lists">`.
- `apps/app/app/todos/page.tsx` — wrap the shared tag-manager instance at the page
  level: `<Section label="Tags"><TagManagerSection /></Section>`. This gives both
  `/todos` manager panels the section treatment (the confirmed intent) WITHOUT
  touching `/notes` — **`apps/app/app/tag-manager-section.tsx` itself is not
  modified** (it is mounted on `/notes` too), only the `/todos` call site.

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/ui -- test/stack.test.tsx test/section.test.tsx
           npm run test:unit -w @life/app -- test/todo-groups.test.ts
Build:     npm run build -w @life/app
```

## Testing Strategy

- `@life/ui`: `stack.test.tsx` (grid gap per `gap` prop resolves to the token value;
  children render; `className`/ref/ARIA pass through), `section.test.tsx` (heading at
  the requested level, absent when no `label`, actions slot renders, body is a
  `Stack`).
- `@life/app`: the existing suite stays green; `todo-groups.test.ts` (grouping
  unchanged). Presentational change — the app assertion is non-regression, not new
  behavior.
- Mechanical (Contract 1), run by the tech lead: raw-HTML grep in `apps`, `next/link`
  grep, raw-color grep (tokens.css only), domain-word grep in `packages/ui/src`.
- Visual: the user eyeballs `/todos` in `npm run dev` — the acceptance that started
  this. Agents run no Playwright.

## Boundaries

- Always: prop contracts updated in `SPEC-ui-blocks.md` + `MAP-ui-primitives.md` in the
  same change; tokens only; `/notes` untouched.
- Ask first: new token *values* (frozen); any frozen-e2e-surface change.
- Never: app-side CSS/`style=`; raw interactive HTML; changing `/notes`; adding e2e
  assertions or running e2e.

## Success Criteria

1. `Stack` + `Section` exist in `@life/ui` with tests; contracts documented in
   `SPEC-ui-blocks.md` (owner) and listed in `MAP-ui-primitives.md`.
2. `/todos` uses them; no bare stacking `div` remains in the todo components;
   `PillGroup`-as-heading is gone.
3. `/notes`, the frozen e2e selector/role/text surface, and token values unchanged.
4. The named targeted suites pass; typecheck + app build clean.
