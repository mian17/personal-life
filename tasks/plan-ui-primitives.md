# Implementation Plan: shared UI primitives (`ui-primitives`)

Topic docs: `docs/intent/ui-primitives.md`, `docs/specs/MAP-ui-primitives.md`,
module specs `SPEC-ui-{tokens,atoms,blocks}.md`, `SPEC-notes-port.md`.
Task ledger: `tasks/todo-ui-primitives.md`. Branch: `feature/ui-primitives`.

## Overview

Build `@life/ui` (tokens → atoms → blocks) and port `apps/app` onto it pixel-identically.
Eight tasks, each delegated to a subagent under the mandatory task template; the tech
lead reviews, commits, and runs the gates.

## Architecture Decisions

1. **Source-shipped package, no build step.** `packages/ui` exports TSX + CSS source;
   consumers use Next `transpilePackages` + jest `moduleNameMapper` (the proven
   `@life/shared` pattern). Avoids a dist rebuild loop in dev and a second build in CI.
2. **One stylesheet entry, composed of partials.** `@life/ui/styles.css` is the single
   file consumers import; it `@import`s the partials `src/styles/tokens.css`,
   `src/styles/atoms.css`, `src/styles/blocks.css` in that fixed order (added as each
   module lands). Mirrors today's single `globals.css`, so cascade behavior is
   preserved. Per-component CSS files are rejected: import-order specificity is a
   pixel-drift risk.
3. **Generic `ui-*` class names; frozen e2e hooks ride on `className` passthrough.**
   `button.trash-delete` keeps matching because the app passes `className="trash-delete"`
   (the class needs no CSS to exist). Package code contains zero notes-domain names.
4. **Token values are frozen.** Spacing/radius/type/shadow literals are promoted to
   named tokens at identical values — pixel-identical is enforced at the value level by
   a test table, not by eyeballing.
5. **Markup/logic split for `note-editor.tsx`.** The autosave engine (~300 lines:
   drain, expectedVersion/409, keepalive) is app logic and stays byte-identical in
   `apps/app`; only the JSX moves. The port must not "clean up" the engine.
6. **Test harness decision (the one dependency ask):** `packages/ui` devDeps gain
   `jsdom` + `@testing-library/react` (workspace-local, dev-only, zero runtime impact).
   Fallback if disallowed: `renderToStaticMarkup` markup assertions + stubbed globals.
   Note: the `transpilePackages` half of the `@life/shared` consumption pattern is the
   proven one; the jest `moduleNameMapper` entry for `@life/ui` is new to `apps/app`
   (only idp/note-service map `@life/shared` today).
7. **Agents never run Playwright.** The frozen-contract table is the mechanical
   defense; the human's e2e run + phone check are the acceptance (repo hard line).

## Task List (dependency order — full acceptance/blast radii in the ledger)

### Phase 1: Foundation
- [ ] Task 1: `ui-tokens` — package skeleton, wiring, `tokens.css`, theme contract, harness
- [ ] Task 2: `ui-atoms` batch A — Button, IconButton, Input, Textarea, Pill

### Checkpoint: after Tasks 1–2
- [ ] `packages/ui` lints/tests green; token-value table enforced; atoms render

### Phase 2: Component library
- [ ] Task 3: `ui-atoms` batch B — Card, StatusText, LocalTime, ConfirmButton, ThemeToggle, IconLink
- [ ] Task 4: `ui-blocks` batch A — PageShell, NavBar, PageTitle, FabLink, EditorToolbar, EditorScreen
- [ ] Task 5: `ui-blocks` batch B — EmptyState, List/ListItem, TagFilterNav, AlertBanner, SearchField, PillGroup, PageActions

### Checkpoint: after Tasks 3–5 (library complete)
- [ ] All atoms/blocks tested; grep proves zero notes-domain identifiers in `packages/ui`

### Phase 3: The port
- [ ] Task 6: `notes-port` — layout + home + trash + note pages onto blocks/atoms
- [ ] Task 7: `notes-port` — note editor markup onto primitives (engine untouched)
- [ ] Task 8: close-out — `globals.css` absorbed, app CSS minimal, all suites green, spec drift closed

### Checkpoint: complete
- [ ] lint/test:unit/build green (both workspaces); frozen contract table verified;
      awaiting the human's e2e run + phone check; five-lane gate on the chapter diff

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pixel drift from CSS/cascade changes | High | frozen token-value table (test), single stylesheet entry, markup semantics preserved, human phone check |
| Breaking the human-owned e2e suite | High | frozen-contract table (labels verbatim, `button.trash-delete` hook), never touch `test/e2e/**`, e2e run stays human-owned |
| Hydration regressions (LocalTime, theme script) | Med | behavior contracts unit-tested; `suppressHydrationWarning` + pre-hydration script preserved verbatim |
| Source-consumed package breaks Next build | Med | proven `@life/shared` pattern (`transpilePackages`); `next build` is Task 6/8 verification |
| `note-editor.tsx` engine disturbed during JSX move | High | strict markup/logic split (decision 5); engine file bytes reviewed at the diff gate |
| New devDeps (jsdom/RTL) rejected late | Low | flagged as the single Ask-first item now; documented fallback |
| jest config edits break existing app tests | Med | `moduleNameMapper` additions only; the 14 existing unit test files untouched; `test:unit` green at every checkpoint |

## Open Questions

- **The single human decision:** approve `jsdom` + `@testing-library/react` as
  `packages/ui` devDependencies (dev-only). Say no → zero-new-dep fallback.
