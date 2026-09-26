# Task Ledger: shared UI primitives (`ui-primitives`)

Plan: `tasks/plan-ui-primitives.md`. Specs: `docs/specs/MAP-ui-primitives.md` +
`SPEC-ui-{tokens,atoms,blocks}.md`, `SPEC-notes-port.md`. Branch: `feature/ui-primitives`.
Status: not started. Each task = one subagent (mandatory task template). Tech lead
reviews diffs, commits, runs checkpoints. Test runs: targeted, sequential, ≤3 per task.

## Task 1: `ui-tokens` — package skeleton + token layer + harness

**Objective:** Create `packages/ui` (`@life/ui`) registered in the workspace, wire
`transpilePackages`/jest mapping, land `src/styles/tokens.css` with the frozen
value table + theme contract, and a working test harness.

**Acceptance:**
- [ ] Root `package.json` `workspaces` gains `packages/ui`; `@life/ui` package.json
      (private, peerDeps react/react-dom 19, devDeps jest/ts-jest/jsdom/@testing-library/react
      + react/react-dom for tests), `tsconfig.json` extends `tsconfig.base.json`.
- [ ] `tokens.css`: all colors (dark + light + media-query block) byte-identical to
      `apps/app/app/globals.css`; spacing/radius/type/shadow/layout literals promoted
      to tokens at identical values; theme selectors unchanged.
- [ ] A test asserts the token-value table and theme-selector shapes (fails on drift).
- [ ] `apps/app/next.config.mjs` transpilePackages gains `@life/ui`; apps/app jest
      `moduleNameMapper` gains `^@life/ui$` → `packages/ui/src`.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui` ·
`npm run test:unit -w apps/app` (existing tests untouched/green).

**Blast radius — allowed:** `packages/ui/**`, root `package.json`,
`apps/app/next.config.mjs`, `apps/app/package.json` (jest block only).
**Prohibited:** `apps/app/test/e2e/**`, `apps/app/app/**`, `apps/*/data/**`, lockfile
hand-edits (`npm install` for workspace registration is allowed and expected).

**Depends on:** none. **Scope:** M.

## Task 2: `ui-atoms` batch A — Button, IconButton, Input, Textarea, Pill

**Objective:** First five atoms with exact-computed-style CSS from tokens.

**Acceptance:**
- [ ] Components per `SPEC-ui-atoms.md` prop contracts; `cx` util; `className`
      passthrough merges; HTML attrs/refs forwarded.
- [ ] Variants reproduce today's rules exactly: Button (primary/ghost/danger/bare),
      IconButton (40×40 bordered; default/ghost), Input/Textarea (global input rules),
      Pill (chip/filter, active state).
- [ ] Unit tests: rendered classes/roles/labels, variant mapping, passthrough.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{button,icon-button,input,textarea,pill}.tsx`,
`packages/ui/src/styles/atoms.css`, `packages/ui/src/index.ts`, `packages/ui/src/lib/cx.ts`,
`packages/ui/test/*` (5 suites).
**Prohibited:** everything else — no app files, no spec files, no e2e.

**Depends on:** Task 1. **Scope:** M.

## Task 3: `ui-atoms` batch B — Card, StatusText, LocalTime, ConfirmButton, ThemeToggle

**Acceptance:**
- [ ] Card (`.note` surface values), StatusText (`aria-live`), LocalTime (empty-first
      render, `<time dateTime>`), ConfirmButton (cancel path never submits),
      ThemeToggle (system→light→dark cycle, `aria-pressed`, `localStorage('theme')`).
- [ ] Behavior unit tests incl. fake timers/user events for confirm + toggle.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{card,status-text,local-time,confirm-button,theme-toggle}.tsx`,
`packages/ui/src/styles/atoms.css`, `packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 2. **Scope:** M.

## Task 4: `ui-blocks` batch A — PageShell, NavBar, PageTitle, FabLink, EditorToolbar

**Acceptance:**
- [ ] Semantic markup preserved (`main`, `nav`, `h1`, `a`/`button`); slots compose
      (leading/trailing/actions/back/status); safe-area + content-width from tokens.
- [ ] Unit tests for structure + slot composition.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{page-shell,nav-bar,page-title,fab-link,editor-toolbar}.tsx`,
`packages/ui/src/styles/blocks.css`, `packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 3. **Scope:** M.

## Task 5: `ui-blocks` batch B — EmptyState, List/ListItem, TagFilterNav, AlertBanner, SearchField

**Acceptance:**
- [ ] EmptyState copy is passed in; List/ListItem typed item props + render-prop
      trailing/delete slots (zero notes types); TagFilterNav pill nav with active
      state; AlertBanner tone/actions; SearchField visual + 300ms debounce emitting
      `onQueryChange` only (no routing knowledge).
- [ ] Unit tests: structure, slots, debounce with fake timers.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{empty-state,list,tag-filter-nav,alert-banner,search-field}.tsx`,
`packages/ui/src/styles/blocks.css`, `packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 4. **Scope:** M.

## Checkpoint: library complete (tech lead, after Task 5)

- [ ] `npm run lint -w packages/ui` + `npm run test -w packages/ui` green.
- [ ] `grep -ri "note\|trash\|tag-chip\|editor" packages/ui/src` → zero domain names
      (component files named for their primitive only).
- [ ] Spec drift check: specs match what shipped (update specs first if not).

## Task 6: `notes-port` — layout + home + trash + note pages

**Objective:** Port `app/layout.tsx`, `app/page.tsx`, `app/trash/page.tsx`,
`app/notes/[id]/page.tsx`, `app/notes/new/page.tsx`, `app/note-list.tsx`,
`app/search-box.tsx` onto `@life/ui`; retire `theme-toggle`/`local-time`/
`confirm-submit` local components in favor of the atoms.

**Acceptance:**
- [ ] Frozen contract byte-identical: every `aria-label`/heading/visible text verbatim;
      `button.trash-delete` hook present; theme script + `suppressHydrationWarning`
      preserved; LocalTime empty-first preserved.
- [ ] `splitBody`/delete actions/routing/debounce wiring stay in app code; JSX only
      from `@life/ui`.
- [ ] lint + unit + build green.

**Verify:** `npm run lint -w apps/app` · `npm run test:unit -w apps/app` ·
`npm run build -w apps/app`.

**Blast radius — allowed:** `apps/app/app/**` (except `app/api/**`, `app/auth/**`,
`app/actions.ts`), `apps/app/package.json`.
**Prohibited:** `apps/app/test/e2e/**`, `apps/app/lib/**`, `apps/app/middleware.ts`,
`packages/ui/**` (primitives misfits are reported upstream to the tech lead, not fixed here).

**Depends on:** Task 5. **Scope:** L (the largest; reviewed hardest).

## Task 7: `notes-port` — note editor markup

**Objective:** Split `app/note-editor.tsx` (401 lines): JSX →
`EditorToolbar`/`AlertBanner`/`Textarea`/`Pill`; the autosave engine stays
byte-identical (drain/keepalive/expectedVersion/409/history.replaceState).

**Acceptance:**
- [ ] Engine logic bytes unchanged (diff-reviewed); only markup moves.
- [ ] Conflict banner labels/actions verbatim; `Note body` label preserved.
- [ ] lint + unit + build green.

**Verify:** `npm run lint -w apps/app` · `npm run test:unit -w apps/app` ·
`npm run build -w apps/app`.

**Blast radius — allowed:** `apps/app/app/note-editor.tsx` (+ split modules under
`apps/app/app/` if the engine is extracted to a sibling file **unchanged**).
**Prohibited:** `apps/app/test/e2e/**`, `apps/app/lib/**`, `packages/ui/**`.

**Depends on:** Task 6. **Scope:** M.

## Task 8: close-out — CSS absorption + drift closure

**Acceptance:**
- [ ] `apps/app/app/globals.css` deleted; `@life/ui/styles.css` imported in
      `layout.tsx`; any surviving app CSS is a documented frozen-hook rule only.
- [ ] All suites green both workspaces; specs updated for any drift discovered
      during the port (specs first).
- [ ] Chapter diff self-review against the plan's blast radii.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui` ·
`npm run lint -w apps/app` · `npm run test:unit -w apps/app` · `npm run build -w apps/app`.

**Blast radius — allowed:** `apps/app/app/globals.css`, `apps/app/app/layout.tsx`,
`packages/ui/src/styles/**`, `docs/specs/**` (drift closure), this ledger/plan.
**Prohibited:** `apps/app/test/e2e/**`, `apps/*/data/**`.

**Depends on:** Task 7. **Scope:** M.

## Final gate

- [ ] Five-lane verification on `git diff master...HEAD` (per `five-lane-verification`).
- [ ] Human acceptance: phone check (pixel-identical) + the human's e2e run.
- [ ] **Merge only on the user's explicit request** (standing rule).
