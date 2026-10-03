# Spec: ui-blocks revision — Disclosure (collapsible region)

Module id: `ui-blocks` (map: `docs/specs/MAP-ui-primitives.md`). This is a revision
of the existing `ui-blocks` spec, not a new module: the `Disclosure` prop contract is
owned by `docs/specs/SPEC-ui-blocks.md` (its "Components" table); this file records
the change, the root cause, and the first consumption (`meal-capture-ui`).
Contract: AGENTS.md Contract 1 — Rule 3 upstream-first, spec-first.

## Objective

Add the one composition primitive `@life/ui` is missing — a **collapsible region** —
then consume it from the meal entry editor, so a long optional field group can be
folded away without the app hand-rolling `<details>`/`<summary>` or a toggle + CSS.
Success = a future app folds any optional content behind one primitive, and the
expand/collapse semantics (keyboard, screen reader, no-JS) are owned upstream.

## Root cause this fixes

`meal-capture-ui` needs to show the full 27-nutrient set for a meal item while keeping
the four headline nutrients inline (see `SPEC-meal-capture-nutrients.md`). That needs a
collapsible region. `@life/ui` has none: the repo contains no `<details>`/`<summary>`
and no disclosure/accordion primitive (`packages/ui/src/components/` has none). A raw
`<details>` in the app would put an unstyled element and its visual language in app
code — a Contract 1 Rule 1/3 symptom. The fix is upstream, never app markup.

## Component

Prop contract lives in `SPEC-ui-blocks.md` (owner). Summary of what this revision adds
there:

- **`Disclosure`** — native collapsible region, uncontrolled only.
  - Props: `label: ReactNode` (the always-visible summary text), `defaultOpen?: boolean`
    (default `false`), `className?`, `children`.
  - Renders `<details class="ui-disclosure">` → `<summary class="ui-disclosure__summary">`
    (the `label`, plus a CSS-rendered chevron) → `<div class="ui-disclosure__body">{children}</div>`.
  - **Native `<details>` is deliberate:** open/close, keyboard toggle, and the
    expanded/collapsed state exposed to assistive tech come from the platform, not JS —
    so the primitive stays a server component, works without hydration, and needs no
    `'use client'`. The chevron is a pure CSS transform on `details[open]`.
  - **Uncontrolled only.** `defaultOpen` covers the one need (open on first render when
    the region already holds data). No controlled `open`/`onToggle` — no consumer needs
    it yet; add it only when one does (YAGNI).
  - Purely presentational; no outer margins of its own (the parent's rhythm owns
    spacing, same rule as `Stack`/`Row`).

## Consumption (first consumer)

`meal-capture-ui` (`docs/specs/SPEC-meal-capture-nutrients.md`): one `Disclosure` per
meal item, labelled `All nutrients (27)`, holding the grouped 27-nutrient field list.
It is **collapsed by default**; its `label` carries the `· N estimated` hint. This
revision's only consumer is that editor — the primitive does not enter `apps/*` markup.

## Testing Strategy

| Concern | Test level | Why |
|---|---|---|
| `Disclosure` renders `<details>`/`<summary>`, label text, and children | unit (packages/ui) | the primitive's contract |
| Collapsed by default; `defaultOpen` renders `open` | unit (packages/ui) | the one prop that has behavior |
| Summary text and body both reach the DOM | unit (packages/ui) | guard against a body rendered outside the `<details>` |

The primitive carries no domain logic, so unit coverage of the emitted markup is the
whole contract (lesson 0025 — verify the rendered result, not a prop value).

## Boundaries

- **Always:** compose `@life/ui` primitives; keep the primitive domain-free (no `meal`
  vocabulary in props or classes); native semantics over JS.
- **Ask first:** any token addition; making the primitive controlled.
- **Never:** a raw `<details>`/`<summary>` in `apps/*` UI code (Contract 1 Rule 1);
  app CSS; a JS toggle that reimplements what `<details>` gives for free.

## Success Criteria

1. `packages/ui` exports `Disclosure`; its prop contract is recorded in
   `SPEC-ui-blocks.md` and `Disclosure` is listed in `MAP-ui-primitives.md`'s
   `ui-blocks` row.
2. The component renders native `<details>`/`<summary>` and works with JavaScript
   disabled (no client component, no hydration needed).
3. `grep -rn "<details\|<summary" apps --include='*.tsx'` returns zero hits — the
   element exists only inside `packages/ui`.
4. The `packages/ui` unit tests for the primitive pass.
