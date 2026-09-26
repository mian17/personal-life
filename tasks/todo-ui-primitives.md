# Task Ledger: shared UI primitives (`ui-primitives`)

Plan: `tasks/plan-ui-primitives.md`. Specs: `docs/specs/MAP-ui-primitives.md` +
`SPEC-ui-{tokens,atoms,blocks}.md`, `SPEC-notes-port.md`. Branch: `feature/ui-primitives`.
Status: **pre-IMPLEMENT gate VALIDATED 3/3** (8 fresh-context validator rounds; 33
empirically-proven findings closed in `db26b25..3190d8d`) — implementation ready.
Each task = one subagent (mandatory task template). Tech lead
reviews diffs, commits, runs checkpoints. Test runs: targeted, sequential, ≤3 per task.

## Task 1: `ui-tokens` — package skeleton + token layer + harness

**Objective:** Create `packages/ui` (`@life/ui`) registered in the workspace, wire
`transpilePackages`/jest mapping, land `src/styles/tokens.css` with the frozen
value table + theme contract, and a working test harness.

**Acceptance:**
- [ ] Root `package.json` `workspaces` gains `packages/ui`; `@life/ui` package.json:
      private; `main`/`types` → `src/index.ts`; `exports` map `{".": "./src/index.ts",
      "./styles.css": "./src/styles.css"}` (so bare `@life/ui` and `@life/ui/styles.css`
      both resolve); `scripts` `{lint: "tsc --noEmit", test: "jest"}`; peerDeps
      react/react-dom 19, next, lucide-react (all already provided by `apps/app`);
      devDeps jest/ts-jest/jest-environment-jsdom/
      @testing-library/react + react/react-dom for tests; `tsconfig.json` extends
      `tsconfig.base.json` with `jsx: react-jsx`, `noEmit: true`, and `lib` extended
      with DOM (base has `lib: ["ES2022"]` only).
- [ ] Test harness wired like `apps/app`: inline `jest` key in `package.json`
      (`testEnvironment: "jsdom"`, `transform` via ts-jest against a
      `tsconfig.test.json` variant, `moduleFileExtensions: ["ts","tsx","js"]`,
      `testRegex` for `*.test.tsx?`), plus the `tsconfig.test.json` itself —
      `npm run test -w packages/ui` must run, not just exist.
- [ ] `tokens.css`: all colors (dark + light + media-query block) byte-identical to
      `apps/app/app/globals.css`; spacing/radius/type/shadow/layout literals promoted
      to tokens at identical values; theme selectors unchanged.
- [ ] `src/styles.css` entry exists and `@import`s `./styles/tokens.css` and
      `./styles/base.css` in that order (the entry the consumer imports; later tasks
      append `atoms.css`/`blocks.css` imports).
- [ ] `base.css` owns the base element rules: `* { box-sizing: border-box }` and
      `html, body` margin/padding/background/color/font (values from tokens only —
      globals.css:39-50 relocated verbatim).
- [ ] A test asserts the token-value table and theme-selector shapes (fails on drift).
- [ ] `apps/app/package.json` gains `"@life/ui": "*"` dependency; jest
      `moduleNameMapper` gains `^@life/ui$` → `<rootDir>/../../packages/ui/src/index.ts`;
      `apps/app/next.config.mjs` transpilePackages gains `@life/ui`.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui` ·
`npm run test:unit -w apps/app` (existing tests untouched/green).

**Blast radius — allowed:** `packages/ui/**`, root `package.json`,
`apps/app/next.config.mjs`, `apps/app/package.json` (jest block + `@life/ui`
dependency entry only).
**Prohibited:** `apps/app/test/e2e/**`, `apps/app/app/**`, `apps/*/data/**`, lockfile
hand-edits (`npm install` for workspace registration is allowed and expected).

**Depends on:** none. **Scope:** M.

## Task 2: `ui-atoms` batch A — Button, IconButton, Input, Textarea, Pill

**Objective:** First five atoms with exact-computed-style CSS from tokens.

**Acceptance:**
- [ ] Components per `SPEC-ui-atoms.md` prop contracts; `cx` util; `className`
      passthrough merges; HTML attrs/refs forwarded.
- [ ] Variants reproduce today's rules exactly: Button (variants
      primary/ghost/danger/quiet; sizes default/bare), IconButton (40×40 bordered;
      default/ghost), Input/Textarea (global input rules;
      Textarea `variant="editor"` reproduces `.editor-body` values),
      Pill (chip/filter, active state; `onRemove`/`removeLabel` remove affordance
      owning `.tag-chip-remove`).
- [ ] Children/labels: Button accepts text `children` and forwards `aria-label`;
      IconButton renders icon `children` under its frozen `label` (never self-closing).
- [ ] Unit tests: rendered classes/roles/labels/element types, variant mapping,
      passthrough.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{button,icon-button,input,textarea,pill}.tsx`,
`packages/ui/src/styles/atoms.css`, `packages/ui/src/styles.css` (import append),
`packages/ui/src/index.ts`, `packages/ui/src/lib/cx.ts`, `packages/ui/test/*` (5 suites).
**Prohibited:** everything else — no app files, no spec files, no e2e.

**Depends on:** Task 1. **Scope:** M.

## Task 3: `ui-atoms` batch B — Card, StatusText, LocalTime, ConfirmButton, ThemeToggle, IconLink

**Objective:** The behavior-bearing atoms and the link-shaped icon control, each a
direct generalization of an existing app component.

**Acceptance:**
- [ ] Card (`.note` surface values), StatusText (`role="status" aria-live="polite"`,
      owns `.editor-status`), LocalTime (empty-first
      render, `<time dateTime>`), ConfirmButton (cancel path never submits;
      `className` passthrough carries frozen hooks such as `trash-delete`),
      ThemeToggle (system→light→dark cycle, `aria-pressed`, `localStorage('theme')`;
      Monitor/Sun/Moon icons from the `lucide-react` peerDep),
      IconLink (renders an anchor/Link — `.header-icon` is used on `next/link`
      anchors today, never a button).
- [ ] Behavior unit tests incl. fake timers/user events for confirm + toggle.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{card,status-text,local-time,confirm-button,theme-toggle,icon-link}.tsx`,
`packages/ui/src/styles/atoms.css`, `packages/ui/src/styles.css` (import append),
`packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 2. **Scope:** M.

## Task 4: `ui-blocks` batch A — PageShell, NavBar, PageTitle, FabLink, EditorToolbar, EditorScreen

**Acceptance:**
- [ ] Semantic markup preserved (`main`, `nav`, `h1`, `a`/`button`); slots compose
      (leading/trailing/actions/back/status); safe-area + content-width from tokens;
      EditorScreen is the full-screen fixed editor container owning `.editor-screen`;
      EditorToolbar's back control is a **button** with an `onBack` handler (today's
      `leave()` flushes autosave), never an href.
- [ ] Unit tests for structure + slot composition.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{page-shell,nav-bar,page-title,fab-link,editor-toolbar,editor-screen}.tsx`,
`packages/ui/src/styles/blocks.css`, `packages/ui/src/styles.css` (import append),
`packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 3. **Scope:** M.

## Task 5: `ui-blocks` batch B — EmptyState, List/ListItem, TagFilterNav, AlertBanner, SearchField, PillGroup, PageActions

**Acceptance:**
- [ ] EmptyState copy is passed in; List/ListItem typed item props + render-prop
      trailing/delete slots (zero notes types); TagFilterNav pill nav with active
      state (accessible names are the item names — frozen); AlertBanner tone/actions;
      SearchField visual + controlled `value` prop + 300ms debounce emitting
      `onQueryChange` only (no routing knowledge); PillGroup pill container (optional
      label + per-pill remove slots)
      owning `.editor-legacy-tags` values; PageActions page-level action container
      owning `.trash-actions` values.
- [ ] Unit tests: structure, slots, debounce with fake timers.

**Verify:** `npm run lint -w packages/ui` · `npm run test -w packages/ui`.

**Blast radius — allowed:** `packages/ui/src/components/{empty-state,list,tag-filter-nav,alert-banner,search-field,pill-group,page-actions}.tsx`,
`packages/ui/src/styles/blocks.css`, `packages/ui/src/styles.css` (import append),
`packages/ui/src/index.ts`, `packages/ui/test/*`.
**Prohibited:** everything else.

**Depends on:** Task 4. **Scope:** M.

## Checkpoint: library complete (tech lead, after Task 5)

- [ ] `npm run lint -w packages/ui` + `npm run test -w packages/ui` green.
- [ ] `grep -ri "note\|trash\|tag-chip" packages/ui/src` → zero domain names (words
      like `editor`, `status`, `pill` are generic UI vocabulary and allowed; component
      files named for their primitive only).
- [ ] Spec drift check: specs match what shipped (update specs first if not).

## Task 6: `notes-port` — layout + home + trash + note pages

**Objective:** Port `app/layout.tsx`, `app/page.tsx`, `app/trash/page.tsx`,
`app/notes/[id]/page.tsx`, `app/notes/new/page.tsx`, `app/note-list.tsx`,
`app/search-box.tsx` onto `@life/ui`; retire `theme-toggle`/`local-time`/
`confirm-submit` local components in favor of the atoms.

**Acceptance:**
- [ ] Frozen contract byte-identical: every `aria-label`/heading/visible text verbatim
      — including the `` `Restore ${title}` `` label pattern, the `Trash is empty.`
      copy, and tag-filter link accessible names; `button.trash-delete` hook present
      (on the ConfirmButton); theme script + `suppressHydrationWarning` preserved;
      LocalTime empty-first preserved; anchors stay anchors (Trash/Back nav uses
      IconLink, never IconButton).
- [ ] `splitBody`/delete actions/routing/debounce wiring stay in app code; JSX only
      from `@life/ui`.
- [ ] PWA constants in `layout.tsx` unchanged (`viewport.themeColor` values stay
      app-owned and byte-identical).
- [ ] lint + unit + build green.

**Verify:** `npm run lint -w apps/app` · `npm run test:unit -w apps/app` ·
`npm run build -w apps/app`.

**Blast radius — allowed:** `apps/app/app/**` (except `app/api/**`, `app/auth/**`,
`app/actions.ts`), `apps/app/package.json`.
**Prohibited:** `apps/app/test/e2e/**`, `apps/app/lib/**`, `apps/app/middleware.ts`,
`packages/ui/**` (primitives misfits are reported upstream to the tech lead, not fixed here).

**Depends on:** Task 5. **Scope:** L (the largest; reviewed hardest).

## Task 7: `notes-port` — note editor markup

**Objective:** Split `app/note-editor.tsx` (401 lines): JSX → `EditorScreen`
(`.editor-screen`), `EditorToolbar`, `AlertBanner`, `Textarea variant="editor"`
(`.editor-body`), `PillGroup` (`.editor-legacy-tags`); the autosave engine stays
byte-identical (drain/keepalive/expectedVersion/409/history.replaceState).

**Acceptance:**
- [ ] Engine logic bytes unchanged (diff-reviewed); only markup moves.
- [ ] Conflict banner labels/actions verbatim; `Note body` label preserved; the
      `Saved tags` group label and per-chip `` `Remove tag ${name}` `` aria-labels
      verbatim (PillGroup/Pill `removeLabel` wiring).
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
- [ ] PWA constants untouched: `viewport.themeColor` (`layout.tsx`) and
      `public/manifest.json` colors byte-identical (SC4 of `SPEC-ui-tokens`).
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
