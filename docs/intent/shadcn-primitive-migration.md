# Intent: shadcn-primitive-migration

Source: `interview-me` session, 2026-10-26. The user confirmed the restate below with an
explicit "yes" before this file was written.

## Statement of Intent

- **Outcome:** every replaceable primitive in `packages/ui` is reimplemented from shadcn/ui
  source (Radix behaviour + Tailwind v4 utilities). No new shared primitive starts from a
  blank file, and no per-component manual eyeball QA pass is needed.
- **User:** the single maintainer of the shared UI layer across 8 apps.
- **Why now:** hand-built primitives (57 components; `autosuggest.tsx` alone is 299 lines)
  cost build time *plus* a bespoke manual verification pass each. That recurring cost has
  become blocking.
- **Success:** `@life/ui` public exports are unchanged so `apps/*` compiles untouched; the
  colour theme in light and dark resolves to the exact current values (`tokens.test.ts`
  value table untouched, computed-style assertions added); no hand-written `atoms.css` or
  `blocks.css`; a new primitive is a shadcn registry copy plus theme mapping, with zero
  behaviour code written by us.
- **Constraint:** colour theme is locked to today's values. Geometry, spacing, radii and
  type scale are free to take shadcn defaults. Frozen: `packages/ui/test/tokens.test.ts` (value
  table), PWA `viewport.themeColor` and `public/manifest-*.json`. The e2e selector surface is
  **not** frozen — see the amendment below. Branch is cut from `origin/dev`, the PR targets
  `dev`, and it is not merged without the user's say-so.
- **Out of scope:** app-specific blocks that have no shadcn equivalent (`page-shell`,
  `editor-chrome`, `fab-menu`, `trash-block`, `manager-surface`, `tag-picker`) keep their
  composition and are restyled only where they consume a replaced primitive. No Storybook,
  no screenshot-baseline store, no backend work, no `apps/*` business-logic change.

## Decisions taken during the interview

- Styling layer: **adopt Tailwind** (theme-mapped to the existing token values) rather than
  "shadcn without Tailwind", chosen by the user.
- Colour parity is proven in jest via `tokens.test.ts` plus computed-style assertions. A
  screenshot-baseline program was considered and dropped: "styling must be the same" was
  clarified to mean the colour theme only.

## Amendment — 2026-10-27: this is a migration, nothing blocks it

User, verbatim: *"approve … i said if there is a counterpart in shadcn, replace it, remove the
frozen spec. From now on, this is a migration, so anything that is blocking the migration must
all be removed."*

- **Approved:** `apps/app/postcss.config.mjs`, `cmdk` for the `autosuggest` → `combobox`
  (Popover + Command) swap, `tab-bar` → Radix `tabs`.
- **Revoked:** the frozen e2e selector surface. `ui-*` class strings, `aria-current="page"`,
  nesting depth and `button.trash-delete` are ordinary implementation details; a test that
  pinned the old markup is updated or the assertion deleted in the same change.
- **Test policy:** old stylesheet-reading assertions are deleted with the CSS rule they read
  (the user named the `opacity: 0.5` assertions specifically). Behaviour, rendered-DOM and
  computed-style assertions stay.
- **Still frozen:** the colour value table in `packages/ui/test/tokens.test.ts`, PWA constants,
  `@life/ui`'s public exports.

## Confirmation

Confirmed: yes — the user explicitly answered "yes" to the six-line restate above, then
"yes" again to the save-and-run handoff. Approved to proceed.
