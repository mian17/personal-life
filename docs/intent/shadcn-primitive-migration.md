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
  type scale are free to take shadcn defaults. Frozen surfaces stay frozen: the e2e selector
  surface, `packages/ui/test/tokens.test.ts`, PWA `viewport.themeColor` and
  `public/manifest-*.json`; any unavoidable selector change is proposed individually for
  approval. Branch is cut from `origin/dev`, the PR targets `dev`, and it is not merged
  without the user's say-so.
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

## Confirmation

Confirmed: yes — the user explicitly answered "yes" to the six-line restate above, then
"yes" again to the save-and-run handoff. Approved to proceed.
