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
  Entry points: `main`/`types` → `src/index.ts`; `exports` map `{".": "./src/index.ts",
  "./styles.css": "./src/styles.css"}` so bare `@life/ui` and `@life/ui/styles.css`
  both resolve.
- Styling: plain CSS with custom properties (no Tailwind/CSS-in-JS — matches the app).
- React 19, Next 15, `lucide-react` as **peerDependencies** (consumer provides —
  `apps/app` already depends on all three; `next` is required by the Link-bearing
  atoms/blocks, `lucide-react` by ThemeToggle's icons).

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
  src/styles.css        # the single consumer entry, fixed import order:
                        #   @import './styles/tokens.css'; './styles/base.css';
                        #   './styles/atoms.css'; './styles/blocks.css';
                        #   (atoms/blocks appended by later modules)
  src/styles/tokens.css # the token layer (only token file in this module)
  src/styles/base.css   # base element layer: `* { box-sizing: border-box }` and
                        #   `html, body` margin/padding/background/color/font — values
                        #   from tokens only (owns globals.css:39-50)
  test/                 # unit tests
```

Ownership note: the base element rules (`*`, `html, body`) are owned by `base.css`
(this module); the bare `h1` and `main` element rules are owned by `PageTitle` /
`PageShell` respectively (see `SPEC-ui-blocks.md`). Every rule that leaves
`globals.css` has exactly one relocation target.

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
  --border-width: 1px; --focus-ring: 2px;
  --icon-btn-size: 40px; --fab-size: 56px;
  --font-size: 16px; --leading: 1.5;
  --shadow-fab: 0 4px 12px rgba(0, 0, 0, 0.25);
  --font-stack: system-ui, -apple-system, sans-serif;
  color-scheme: light dark;
}
```

Spacing/dimension tokens cover **exactly** the length literals present in
`globals.css` (both inventories grep-derived and locked in the token-value test):
rem values `0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9,
0.95, 1, 1.05, 1.25, 2, 3, 5` (20 distinct; `1.05rem` is the `.editor-body`
font-size → type token) and px values `1, 2, 4, 10, 12, 16, 40, 48, 56, 640, 999`
(11 distinct: `1px` borders, `2px` focus outline/offset, `4px`/`12px` shadow
offset/blur inside `--shadow-fab`, `10px`/`12px`/`999px` radii, `16px` body font,
`40px` icon square, `48px` tap height, `56px` FAB, `640px` content width). No
invented scale values; the test asserts the full table.

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

- Test harness dependencies (`jest-environment-jsdom` +
  `@testing-library/react`) are proposed **once**
  at the map level (see `SPEC-ui-atoms.md`); this module alone needs none.
