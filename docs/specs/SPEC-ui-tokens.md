# Spec: ui-tokens — `@life/ui` package + visual language

Module id: `ui-tokens` (see `docs/specs/MAP-ui-primitives.md`). Source of facts:
frontend recon 2026-09-27 (`apps/app` has 469-line `app/globals.css`, plain global CSS,
color tokens only — spacing/radius/font/shadow are hard-coded literals).

## Objective

Create the `@life/ui` workspace package and move the notes app's visual language into
it as a token layer + theme contract. Success = the token layer computes to **exactly
today's values** (pixel-identical at the value level) while future apps get one named
visual language instead of copy-pasted literals.

## Tech Stack

- Package: `packages/ui`, name `@life/ui` (sibling of `@life/shared`). **Ships TSX/CSS
  source, no build step** — consumers add `@life/ui` to Next `transpilePackages`
  (pattern already used for `@life/shared`) and map it in jest `moduleNameMapper`.
- Styling: plain CSS with custom properties (no Tailwind/CSS-in-JS — matches the app).
- React 19 / Next 15 types as **peerDependencies** (consumer provides).

## Commands

- Typecheck: `npm run lint -w packages/ui` (`tsc --noEmit`)
- Tests: `npm run test -w packages/ui`
- Consumer integration: `npm run lint -w apps/app && npm run build -w apps/app`

## Project Structure

```
packages/ui/
  package.json          # @life/ui, workspace-registered (root workspaces += "packages/ui")
  tsconfig.json         # extends tsconfig.base.json, jsx react-jsx, noEmit
  src/index.ts          # barrel (components exported from later modules)
  src/styles.css        # the single consumer entry: @import './styles/tokens.css';
                        #   later modules append @import './styles/atoms.css' / 'blocks.css'
  src/styles/tokens.css # the token layer (only token file in this module)
  test/                 # unit tests
```

## Code Style

Token naming: `--<category>-<qualifier>`, values preserved verbatim from today:

```css
:root {
  /* colors — byte-identical to apps/app/app/globals.css */
  --bg: #0f1115; --panel: #181b22; --text: #e8eaf0; --muted: #8b93a7;
  --accent: #5b8cff; --danger: #ff6b6b; --border: #2a2f3a;
  /* literals promoted to tokens — values unchanged */
  --radius-md: 10px; --radius-lg: 12px; --radius-pill: 999px;
  --tap-height: 48px; --content-width: 640px;
  --shadow-fab: 0 4px 12px rgba(0, 0, 0, 0.25);
  --font-stack: system-ui, -apple-system, sans-serif;
  color-scheme: light dark;
}
```

Spacing tokens cover only the literals that exist (`0.25/0.4/0.5/0.75/0.9/1/1.25rem`,
`3rem`, `5rem`) — no invented scale values.

## Testing Strategy

Framework: jest + ts-jest, same pattern as `apps/app` (inline config, `tsconfig.test`).
This module's tests assert the token contract: both themes define the same property
names; values match the frozen literal table (a test reads `tokens.css` and asserts
each token's value); the theme selectors are exactly
`:root[data-theme='light']`, `:root[data-theme='dark']`, and
`@media (prefers-color-scheme: light) :root:not([data-theme])`.

## Boundaries

- Always: preserve computed values exactly; keep the theme attribute contract
  (`document.documentElement.dataset.theme` = `'' | 'light' | 'dark'`) and the
  pre-hydration inline-script behavior (no FOUC).
- Ask first: adding any dependency; changing any token *value*; touching
  `apps/app/test/e2e/**`.
- Never: introduce a webfont (system stack is load-bearing for metrics); change
  `color-scheme` semantics; run e2e; write to `apps/*/data/**`; stage `AGENTS.md`.

## Success Criteria

1. `tokens.css` defines every color/radius/spacing/type/shadow/layout literal the
   notes app uses, at identical values (test-enforced table).
2. Theme behavior is byte-equivalent: same selectors, same attribute contract.
3. `npm run lint -w packages/ui` passes; the package is consumable via
   `transpilePackages` + jest mapping (verified in `notes-port`).
4. PWA constants (`manifest.json`, `viewport.themeColor`) stay app-owned and
   unchanged.

## Open Questions

- Test harness dependencies (jsdom + `@testing-library/react`) are proposed **once**
  at the map level (see `SPEC-ui-atoms.md`); this module alone needs none.
