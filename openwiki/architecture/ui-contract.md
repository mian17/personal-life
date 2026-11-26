---
type: "Reference"
title: "Shared UI contract"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-0d8b2ba21ac2a0ecea9055df
    resource: repo://apps/app/proxy.ts
  - id: openwiki-source-cafaff4d57e1143d174dcf55
    resource: repo://packages/ui/src/components/button.tsx
  - id: openwiki-source-78996d2d33e7eaee55260daf
    resource: repo://packages/ui/src/styles/tokens.css
  - id: openwiki-source-4e84162612b175153d97c0a9
    resource: repo://packages/ui/test/tokens.test.ts
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Shared UI contract

`@life/ui` (atoms + blocks + `tokens.css`) is the single owner of the visual
language. Apps own domain behavior and nothing visual. This is Contract 1 in
`AGENTS.md`; what follows is the contract as the repo enforces it.

## Rule 1 — a raw HTML element is not an implementation

If you are writing a bare `<button>`, `<input>`, `<textarea>`, `<select>`,
`<a>`, `<img>`, `<label>`, `<progress>`, or a styled `<div>`/`<span>` in
`apps/*` UI code, you have taken a wrong turn — that markup is a symptom, not an
implementation. Structural exceptions are tags with **zero** visual
responsibility: `div`/`span`/`p`/`form`/fragments as behavior glue (no
`className`, no inline `style`), non-rendering plumbing (`hidden inputs`,
`meta`, `script`), and `app/layout.tsx`'s `html`/`body`/`script`. The moment one
of these needs a class or style to look right, it has become a visual element.

## Rule 2 — when a primitive exists, compose it

- Never hand-roll markup or CSS that recreates a primitive's visuals; never
  fork, copy, or wrap-reimplement a primitive inside an app.
- Never add a second app-wide stylesheet; `@life/ui/styles.css` is imported
  exactly once in the root layout.
- Style through tokens only (`var(--token)`). No raw colors or lengths in app
  CSS — `packages/ui/src/styles/tokens.css` is the only place hex/px/rem may
  appear.
- A fit problem (missing prop, wrong shape) is fixed **upstream** in
  `packages/ui`, never worked around in the app.

## Rule 3 — when no primitive fits

1. Extend `@life/ui` upstream, spec first: write `docs/specs/SPEC-ui-*.md` (and
   a `MAP-ui-primitives.md` entry for a new component), implement in
   `packages/ui` with tests, then consume from the app. Prop/slot/variant first;
   a new atom/block only when the concept is genuinely reusable across apps.
2. Genuinely app-specific **behavior** (page glue, domain widgets) stays in
   `apps/*` — but it must be composed FROM primitives and may not introduce new
   visual language. A new visual concept is case 1, not case 2.
3. Forbidden in both cases: inline `style=` for anything a token or variant
   covers, ad-hoc app CSS classes recreating primitive visuals, per-app
   component copies, raw hex/rgb/px/rem outside `tokens.css`.

## Frozen surfaces (human-owned)

Move these only with explicit user approval, in the same commit as the test that
guards them:

- **E2E selector surface** — roles, visible text, aria-labels,
  `button.trash-delete`.
- **Token values** — `packages/ui/test/tokens.test.ts` is the value table; a
  deliberate theme change updates it in the same commit. These are tripwires.
- **PWA constants** — `public/manifest-*.json`, `viewport.themeColor`
  (app-owned).

## Mechanical checks (run at every review touching UI)

```
grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'   # zero hits in UI code
grep -rn "next/link" apps --include='*.tsx'                                              # zero; anchors are IconLink/FabLink/ListItem/Pill as="a"
grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'              # hits only in tokens.css
grep -riE "note|trash|tag-chip" packages/ui/src                                          # zero in code (CSS mapping comments exempt)
```

No `.tsx` in `apps/*` may re-implement a `packages/ui` component's markup.

## Shape of the package

`packages/ui/src/components/` holds atoms and blocks (button, dialog,
editor-*, due-date, autosuggest, …) each with its own `.test.tsx`; `styles/`
holds `tokens.css` and the mapping layer; `styles.css` is the one import. A UI
task's delegation plan must include a **Primitive reuse plan** — which `@life/ui`
primitives compose the change, element by element.

## See also

- [Testing strategy](../testing/strategy.md) — the token tripwire and the
  selector surface.
- [System overview](overview.md) — where `@life/ui` sits in the monorepo.
