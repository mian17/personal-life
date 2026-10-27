# Spec: ui-shadcn-primitives — shadcn/ui primitive migration for `@life/ui`

Module id: `ui-shadcn-primitives` (single capability, one spec; no capability map — the
endpoint "no hand-written `atoms.css`/`blocks.css`, new primitive = registry copy" is only
reached by the whole migration, so no slice ships or verifies independently).

Serves the confirmed intent in `docs/intent/shadcn-primitive-migration.md`.

## 1. Objective

Reimplement every replaceable primitive in `packages/ui` from shadcn/ui source (Radix
behaviour + Tailwind v4 utilities), so that adding or changing a shared primitive means
copying a shadcn registry item plus a theme mapping — zero behaviour code written by us —
and no per-component manual eyeball QA pass is ever needed.

**Replaceable primitive** = every visually-styled component in `packages/ui/src/components`
that has a shadcn/ui registry counterpart. The rule is unconditional: if a counterpart exists,
the component is replaced by it. A component with no counterpart keeps its markup and behaviour
and is styled with Tailwind utilities only; it is listed once in the plan so the omission is
recorded, never half-migrated.

No exemption list narrows that rule. What used to be "frozen" — the e2e selector surface
(`ui-*` class strings, `aria-current="page"`, `button.trash-delete`), stylesheet-reading
assertions, snapshots of replaced markup — is not frozen: a registry replacement owns its
markup, and the assertion that pinned the old markup is updated or deleted in the same change.

Only genuinely non-visual helpers are out of scope: `feedback-status.ts`, `feedback-types.ts`,
`lib/date-parts.ts`, `lib/format-date.ts`, `lib/panel-dismiss.ts`.

App-specific blocks that own no visual language of their own (`page-shell`, `editor-chrome`,
`fab-menu`, `trash-block`, `manager-surface`, `tag-picker`) keep their composition and are
rebuilt on the replaced primitives; they do not keep bespoke CSS.

User stories:

- As the maintainer, when I need a new shared primitive I copy a vendored shadcn registry
  item and add a theme-mapping entry; I write no behaviour code and run no eyeball QA.
- As the maintainer, colour parity is proven by computed-style assertions in jest, not by
  looking at the app.
- As an app developer, `@life/ui`'s public exports are unchanged, so `apps/*` compiles
  untouched.

Acceptance criteria (one cluster — see §8 for the testable form):

- AC1: `@life/ui` public exports unchanged. `apps/*` **source** untouched — the one added file is
  `apps/app/postcss.config.mjs`, which is the CSS pipeline entry point, not application code.
  Tests inside `apps/*` may be updated where they pinned markup a registry replacement removed.
- AC2: no hand-written `atoms.css` or `blocks.css`; styling is Tailwind v4 utilities mapped
  to the existing tokens.
- AC3: the colour theme in light and dark resolves to the exact current values
  (`packages/ui/test/tokens.test.ts` value table untouched, computed-style assertions added).
- AC4: a new primitive is a shadcn registry copy plus theme mapping.

## 2. Tech Stack

- TypeScript 5.7.x, React 19.x, Next.js ^16 (peer), npm workspaces, Node 22.
- Testing: jest 29.7.x, ts-jest 29.2.x, jest-environment-jsdom 29.7.x,
  @testing-library/react ^16 (all already configured in `packages/ui/package.json`).
- New dependencies (approved by the intent; nothing else may be added without asking):
  - `tailwindcss` v4 + `@tailwindcss/postcss` v4 (CSS-first `@theme` configuration).
  - Radix UI primitives (`@radix-ui/react-*`) and `class-variance-authority` exactly as the
    vendored shadcn registry source imports them.
  - `cmdk` for the `combobox` recipe (`Popover` + `Command`) that replaces `autosuggest`.
  - `lucide-react` ^1.59 for icons (existing peer).
- `apps/app/postcss.config.mjs` is added, carrying only the `@tailwindcss/postcss` plugin. It is
  the CSS pipeline entry point, not application source.
- shadcn/ui registry source: vendored as a pinned snapshot inside `packages/ui` (copied
  once, attributed, theme-mapped). Not fetched at build or test time, not an npm dependency.
- `packages/ui/src/lib/cx.ts` is reused where it matches `clsx` semantics; `clsx`/
  `tailwind-merge` are not added unless the vendored source genuinely requires them.

## 3. Commands

Repo profile commands only. The repo profile declares no build command, so this spec has no
build step and none may be added.

```bash
# typecheck — run in the touched workspace
npm run typecheck -w @life/ui
# typecheck — all workspaces (before handing the PR over)
npm run typecheck

# unit tests — one file, from the owning workspace; max 2 runs per command
npm run test:unit -w @life/ui -- test/button.test.tsx

# e2e — only to verify the frozen selector surface after a DOM-structure change
npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

## 4. Project Structure

```
packages/ui/src/components/   vendored shadcn registry copies, one file per primitive
packages/ui/src/lib/          existing helpers (cx.ts etc.) the vendored source reuses
packages/ui/src/styles/tokens.css   frozen colour values — the ONLY file with colour literals
packages/ui/src/styles/theme.css    Tailwind v4 @theme mapping (var() references to tokens.css)
packages/ui/src/styles/base.css     base/reset layer (Tailwind preflight mapped to tokens)
packages/ui/src/styles.css          package entry: theme + base imports only
packages/ui/test/                   jest suites: behaviour, theme parity, frozen tokens
docs/specs/                         this spec (SPEC-ui-shadcn-primitives.md)
docs/intent/                        confirmed intent (already present)
```

Deleted by the migration: `packages/ui/src/styles/atoms.css`,
`packages/ui/src/styles/blocks.css`, and their imports in `src/styles.css`.

## 5. Code Style

Vendored registry shape kept intact (cva variants, `data-slot` attributes, Radix behaviour);
only the class strings are theme-mapped. Tailwind colour names equal the token names without
`--` (`--accent` → `bg-accent`).

```tsx
// packages/ui/src/components/button.tsx — shadcn/ui registry copy, theme-mapped
import { cva, type VariantProps } from 'class-variance-authority';
import { cx } from '../lib/cx';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent/90',
        danger: 'bg-danger text-on-accent hover:bg-danger/90',
      },
      size: { md: 'h-tap px-4', icon: 'h-icon-btn w-icon-btn' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);
```

```css
/* packages/ui/src/styles/theme.css — mapping only; values live in tokens.css */
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@theme {
  --color-bg: var(--bg);
  --color-accent: var(--accent);
  --color-on-accent: var(--on-accent);
}
```

Conventions: no raw hex/rgb/px outside `tokens.css`; no hand-rolled markup recreating a
primitive's visuals; each vendored file carries a one-line provenance comment (registry
item name + snapshot date). Tailwind's preflight is deliberately not imported — `base.css`
owns the resets, and loading a second reset under it would re-order every app's box model.

## 6. Testing Strategy

- Framework: jest + ts-jest + jsdom + @testing-library/react; suites in
  `packages/ui/test/*.test.tsx`, one per component.
- Behaviour suites pass against the new implementations. Assertions that read a deleted
  stylesheet (`atoms.css`/`blocks.css`) file text are **deleted together with the CSS rule they
  read** — not rewritten as computed-style, not kept as a tripwire on a file that no longer
  exists. Assertions on behaviour, rendered DOM, roles and visible text that still hold stay.
- Assertions pinning the old selector surface (`ui-*` class strings, `aria-current="page"`,
  nesting depth, snapshot files) are retired with the markup they pinned. The selector surface is
  **not** a frozen surface; a registry replacement decides its own markup.
- `packages/ui/test/tokens.test.ts` is frozen (value table byte-identical) and stays green.
- New suite `packages/ui/test/theme-parity.test.ts`: renders representative primitives in
  light and dark and asserts `getComputedStyle(...)` resolves each frozen colour token to
  the exact value in the table.
- Coverage expectations: every replaced primitive has a green suite; every frozen colour
  token is asserted in both themes.
- Levels: unit (component behaviour) + parity (computed styles) inside `packages/ui`; e2e only
  when a flow under test end-to-end changed. No screenshot baselines, no Storybook.
- Budget: max 2 test runs per command.

## 7. Boundaries

**Always do**

- Keep `@life/ui` public exports (component names, prop types, `./styles.css` entry)
  unchanged.
- Derive each replaced primitive from the vendored shadcn source; adapt theme mapping only.
- Keep `tokens.test.ts` value table byte-identical; prove colour parity with computed-style
  assertions.
- Run `npm run typecheck -w @life/ui` and the touched test suites; run the Contract 1
  mechanical greps (`raw HTML elements in apps`, `next/link in apps`, colour literals
  outside `tokens.css`, `note|trash|tag-chip` in `packages/ui/src` code) at every review.
- Delete any assertion, snapshot, selector pin or spec line that blocks a registry
  replacement. Migration outranks the old surface: no hand-written CSS survives to keep a
  stale assertion green.

**Ask first**

- Any dependency beyond the §2 list that the vendored registry source genuinely needs.
- Any edit to `packages/ui/test/tokens.test.ts` or PWA constants (`viewport.themeColor`,
  `public/manifest-*.json`).
- Branch/PR mechanics beyond the agreed flow: the PR targets `dev` and is never merged
  without the user's say-so.

**Never do**

- Change a colour token value.
- Write or keep hand-written `atoms.css`/`blocks.css`, or hand-rolled markup/CSS that
  recreates a primitive's visuals inside `apps/*`.
- Add a second app-wide stylesheet; `@life/ui/styles.css` stays imported exactly once in the
  root layout.
- Add per-app component copies or raw hex/rgb/px values outside `tokens.css`.
- Add a build command or a build step (the repo profile declares none).
- Touch `apps/*` business logic, app-specific block composition, backend code.
- Introduce Storybook or a screenshot-baseline store.
- Widen the test commands, or exceed 2 runs per command. (Deleting an assertion that reads a
  deleted stylesheet is the §6 policy, not a skipped test.)
- Merge the PR or push to `main`/`dev`.

## 8. Success Criteria

1. `npm run typecheck` is green and `git diff --name-only origin/dev...HEAD -- 'apps/**/*'`
   lists only `apps/app/postcss.config.mjs` in source and, at most, test files whose assertions
   pinned markup a replacement removed.
2. `npm run test:unit -w @life/ui -- <file>` is green for every suite in
   `packages/ui/test/`, each within 2 runs.
3. `packages/ui/test/tokens.test.ts` is byte-identical to `origin/dev` and green.
4. `packages/ui/test/theme-parity.test.ts` asserts, for all 11 frozen colour tokens
   (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--danger`, `--danger-soft`,
   `--amber`, `--green`, `--border`, `--on-accent`), that a rendered primitive's computed
   style equals the frozen value in both light and dark.
5. `packages/ui/src/styles/atoms.css` and `blocks.css` are deleted and no longer imported.
6. `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` hits only
   `packages/ui/src/styles/tokens.css`.
7. All Contract 1 mechanical greps are clean (zero raw UI elements in `apps/*` UI code, zero
   `next/link` in `apps/*`, zero `tag-chip` and zero `note` identifier in `packages/ui/src`
   code, no app re-implementation of a `packages/ui` component's markup).
8. No assertion in `packages/ui/test/` reads a deleted stylesheet file, and no snapshot pins
   markup a registry replacement removed. Behaviour and computed-style assertions are green.
9. PWA constants (`public/manifest-*.json`, `viewport.themeColor`) untouched.
10. Recipe holds: a replaced primitive is a vendored registry copy + theme mapping with zero
    hand-written behaviour code (every replaced component file traces to a registry item via
    its provenance comment).

## 9. Assumptions

1. "Replaceable primitive" is defined in §1; the six app-specific blocks and five non-visual
   helpers are out. Anything else without a shadcn counterpart is kept and recorded as a
   deviation, not half-migrated.
2. shadcn registry source is vendored as a pinned snapshot (network-independent,
   reproducible). New deps limited to §2.
3. Tailwind v4 compiles in each consuming app's Next CSS pipeline via
   `postcss.config.mjs` + `@tailwindcss/postcss`; `apps/*` **source** stays untouched, the
   config file is infrastructure (see Open Questions for the alternative).
4. The theme mapping is CSS-first (`@theme`) referencing `var(--…)` from `tokens.css`, so
   `tokens.css` remains the only file with colour literals.
5. Colour is locked to today's values; geometry, spacing, radii and type scale may take
   shadcn defaults.
6. Existing behaviour suites are the per-component verification. A suite whose assertion reads
   a stylesheet being deleted loses exactly that assertion, in the same change as the deletion.
7. The repo profile has no build command; the migration must not need one.

## 10. Open Questions

1. Tailwind compile pipeline final form: per-app `postcss.config.mjs` (assumption 3, zero
   source change) versus a compiled stylesheet generated inside `packages/ui` (needs a
   generation script — the repo profile has no build command). The user decides which
   reading of "apps/* compiles untouched" applies.
2. ~~DOM-structure approvals~~ — resolved: a registry replacement owns its markup, and suites
   pinning the old markup are updated or have that assertion deleted.
3. Snapshot policy for `packages/ui/test/__snapshots__`: regenerate or delete per replaced
   primitive in the same change. A snapshot of markup that no longer exists is deleted, not
   rewritten.
4. Whether vendored registry files need a licence/attribution note beyond the per-file
   provenance comment.
