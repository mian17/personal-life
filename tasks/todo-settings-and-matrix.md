# Task Ledger: settings-and-matrix

Plan: `tasks/plan-settings-and-matrix.md` · Map + specs:
`docs/specs/MAP-settings-and-matrix.md` +
`SPEC-{ui-settings,ui-tabs,app-kit-settings,todo-importance,matrix-ui}.md` (plus the amended
`SPEC-ui-list-shell.md` / `SPEC-todo-service.md`) · Intent:
`docs/intent/eisenhower-matrix-and-settings.md`.

Branch: `feat/eisenhower-matrix`. Process: the global protocol
(`~/.config/opencode/AGENTS.md`) + this repo's `AGENTS.md` Project Profile/Contracts. Each
task = one subagent (mandatory §5 template), TDD, tech-lead diff review + commit (Blast
Radius + Contract + Project Contract checks + execution audit). Targeted tests, ≤2 runs per
task (profile `max-test-runs`). No E2E (global protocol §3; no e2e spec is modified by this
chapter). Merge to `master` on the user's explicit request only. Acceptance criteria are
referenced by spec section, never by count.

Workspace names verified: `@life/ui`, `@life/app-kit`, `@life/todo-service`, `@life/app`.

## Tasks

- [ ] T1: `ui-settings` — `Switch` atom — module `ui-settings`
  - Description: Add the controlled boolean `Switch` atom upstream (`SPEC-ui-settings.md`
    Components / CSS ownership). One real `<button type="button" role="switch">`; the
    track/thumb is pure CSS (`.ui-switch` + `.ui-switch--on` in `atoms.css`); accessible name
    from `label`; `onCheckedChange(!checked)` on activation; `disabled` blocks the callback;
    `name` passes through; `className` merges. No state in the atom.
  - Files: `packages/ui/src/components/switch.tsx` (new),
    `packages/ui/src/styles/atoms.css`, `packages/ui/src/index.ts`,
    `packages/ui/test/switch.test.tsx` (new).
  - Acceptance: `SPEC-ui-settings.md` Testing Strategy `Switch` cases pass; `role="switch"`
    + `aria-checked` + `aria-label` render; `disabled` blocks the callback; class merges;
    token-only CSS (Contract 1 mechanical greps green).
  - Verify: `npm run typecheck -w @life/ui` && `npm run test:unit -w @life/ui -- test/switch.test.tsx`
  - Dependencies: none. Size: S.
- [ ] T2: `ui-settings` — `SettingsRow` + `SettingsBlock` blocks — module `ui-settings`
  - Description: Add the two presentational blocks (`SPEC-ui-settings.md`): `SettingsRow`
    (label + optional muted description left, caller's `control` right — two-column,
    token-spaced, wraps on narrow widths) and `SettingsBlock` (optional `title` heading over
    an ordered group) composing existing `Section` + `Card` + `Stack` with **no** new CSS.
  - Files: `packages/ui/src/components/settings-row.tsx` (new),
    `packages/ui/src/components/settings-block.tsx` (new),
    `packages/ui/src/styles/blocks.css`, `packages/ui/src/index.ts`,
    `packages/ui/test/settings-row.test.tsx` (new),
    `packages/ui/test/settings-block.test.tsx` (new).
  - Acceptance: `SettingsRow` label left, description muted and omitted when `undefined`,
    `control` verbatim right; `SettingsBlock` `title` becomes the heading and omitted `title`
    renders no heading, children in order inside the `Card`; the composition test
    (`ManagerBlock` + blocks) yields one `h1` and ordered rows; no domain copy; Contract 1
    greps green.
  - Verify: `npm run typecheck -w @life/ui` && `npm run test:unit -w @life/ui -- test/settings-row.test.tsx` && `npm run test:unit -w @life/ui -- test/settings-block.test.tsx`
  - Dependencies: none. Size: S.
- [ ] T3: `ui-tabs` — `TabBar`/`Tab` + `ListShell` `tabs?` slot — module `ui-tabs`
  - Description: Add the new tab navigation atom (`SPEC-ui-tabs.md`): `Tab` renders a
    `next/link` `Link` (`aria-current="page"` when `active`, omitted otherwise); `TabBar`
    renders a `<nav aria-label>` wrapping ordered children. Add the `tabs?: ReactNode` slot
    to `ListShell`, rendered immediately after `PageTitle`; omitting it renders nothing (no
    wrapper). Server components only.
  - Files: `packages/ui/src/components/tab-bar.tsx` (new),
    `packages/ui/src/components/list-shell.tsx`, `packages/ui/src/styles/blocks.css`,
    `packages/ui/src/index.ts`, `packages/ui/test/tab-bar.test.tsx` (new),
    `packages/ui/test/list-shell.test.tsx`.
  - Acceptance: `ListShell` slot order becomes
    `PageTitle → tabs → search → filters → body → FabLink` when `tabs` is passed; with `tabs`
    omitted nothing renders in its place and the existing omitted-slots assertion still holds;
    `Tab` renders an anchor with the `href` and `aria-current` semantics; no `PillGroup`
    import; Contract 1 greps green.
  - Verify: `npm run typecheck -w @life/ui` && `npm run test:unit -w @life/ui -- test/tab-bar.test.tsx` && `npm run test:unit -w @life/ui -- test/list-shell.test.tsx`
  - Dependencies: none. Size: S.
- [ ] T4: `matrix-ui` — `MatrixBlock` upstream block — module `matrix-ui`
  - Description: Add the presentational `MatrixBlock` upstream (`SPEC-matrix-ui.md` Upstream
    section): one `<section>` per `MatrixQuadrant` (id key, label heading, items verbatim),
    fixed CSS responsive behaviour — one column (four stacked labelled sections) default,
    `grid-template-columns: repeat(2, minmax(0, 1fr))` at `@media (min-width: 640px)`. No JS,
    no data, no domain copy, no routing.
  - Files: `packages/ui/src/components/matrix-block.tsx` (new),
    `packages/ui/src/styles/blocks.css`, `packages/ui/src/index.ts`,
    `packages/ui/test/matrix-block.test.tsx` (new).
  - Acceptance: `SPEC-matrix-ui.md` Testing Strategy upstream cases pass (one section per
    quadrant in order, label heading, items verbatim, empty `items` still renders the labelled
    section); `className` merges; no domain copy in code; the 640px breakpoint is the
    documented non-tokenizable media-query literal; Contract 1 greps green.
  - Verify: `npm run typecheck -w @life/ui` && `npm run test:unit -w @life/ui -- test/matrix-block.test.tsx`
  - Dependencies: none. Size: S.
- [ ] T5: `todo-importance` — importance data model + request DTOs — module `todo-importance`
  - Description: Add the two nullable plaintext boolean columns (`SPEC-todo-importance.md`
    Data model, `SPEC-todo-service.md` Data model): `todo.important BOOLEAN NULL` and
    `list.importantDefault BOOLEAN NULL`; the todo create/update **request** DTOs gain the
    optional nullable `important` field with the `@IsOptional() @ValidateIf((_o, v) =>
    v !== null) @IsBoolean()` pattern; the `GET /api/todos` query gains the optional
    `important?: boolean` filter.
  - Files: `apps/todo-service/src/todos/todo.entity.ts`,
    `apps/todo-service/src/lists/list.entity.ts`,
    `apps/todo-service/src/todos/dto/create-todo.dto.ts`,
    `apps/todo-service/src/todos/dto/update-todo.dto.ts`,
    `apps/todo-service/src/todos/dto/list-todos.query.ts`.
  - Acceptance: the two columns are nullable plaintext metadata (never `@life/crypto`); the
    todo request DTOs accept `boolean | null` where `null` is a valid clearing value; the query
    parses `important=true|false` into a typed filter; existing request behaviour unchanged.
  - Verify: `npm run typecheck -w @life/todo-service` && `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts`
  - Dependencies: none. Size: S.
- [ ] T6: `todo-importance` — shared read contract + effective computation + list default —
  module `todo-importance`
  - Description: Deliver the importance signal end-to-end (`SPEC-todo-importance.md` Behavior
    / API). Extend the `@life/shared` read types (`Todo.important: boolean | null` +
    `Todo.effectiveImportant: boolean`; `List.importantDefault: boolean | null`) and the
    `CreateTodoInput`/`UpdateTodoInput` request shapes. Populate the service: carry
    `important` through the cached row (`CachedTodoRow`) and the DTO; compute
    `effectiveImportant(todo, list) = todo.important ?? list.importantDefault ?? false`
    **post-decrypt** by resolving the list default from the owner's cached `todo:lists`
    row-set; apply the `important` filter in memory against `effectiveImportant`; thread
    `importantDefault` through list create/update, the list request DTOs
    (`CreateListDto`/`UpdateListDto`) and the list DTO.
  - Files: `packages/shared/src/index.ts`,
    `apps/todo-service/src/todos/todos.service.ts`,
    `apps/todo-service/src/lists/lists.service.ts`,
    `apps/todo-service/src/lists/lists.controller.ts`.
  - Acceptance: `SPEC-todo-importance.md` Testing Strategy cases 1–6, 8 pass (round-trip,
    inheritance, no write fan-out on a list-default change, null semantics, detach, in-memory
    filter served from one `todo:all` entry, concurrency/trash unaffected); `effectiveImportant`
    is never stored; `important` never enters the cache key; `null` via PATCH clears to
    inherit.
  - Verify: `npm run build -w @life/shared` && `npm run typecheck -w @life/todo-service` && `npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts` && `npm run test:unit -w @life/todo-service -- test/lists.e2e-spec.ts`
  - Dependencies: T5. Size: M.
- [ ] T7: `todo-importance` — cache ciphertext suite — module `todo-importance`
  - Description: Pin the updated `## Cache Rules` (`SPEC-todo-importance.md` Cache Rules,
    `SPEC-todo-service.md` Cache Rules): the cached `todo:all`/`todo:trash` row values carry
    the plaintext `important: boolean | null` and the `todo:lists` values carry
    `importantDefault: boolean | null`, while every content field (`title`/`note`/`name`)
    stays `enc.v1.`-only and the no-known-plaintext assertions still fail closed. A list write
    that changes `importantDefault` bumps `todo:gen:<sub>` exactly once.
  - Files: `apps/todo-service/test/todo-cache.e2e-spec.ts`.
  - Acceptance: `SPEC-todo-importance.md` Testing Strategy case 7 passes; captured Redis
    values contain the new booleans, contain `enc.v1.` for content, and contain no known
    content plaintext; the generation bump on a list `importantDefault` write is asserted.
  - Verify: `npm run typecheck -w @life/todo-service` && `npm run test:unit -w @life/todo-service -- test/todo-cache.e2e-spec.ts`
  - Dependencies: T6. Size: S.
- [ ] T8: `app-kit-settings` — preference cookie name/parse/read — module `app-kit-settings`
  - Description: Add the server-only preference read path (`SPEC-app-kit-settings.md` Public
    API): `PrefKey` in `types.ts`; `prefCookieName(name) => 'pref_<name>'`,
    `parsePrefValue(raw) => raw === 'on'`, and `readPref(name)` that awaits `cookies()` and
    returns `false` for any absent/malformed/error value, wrapped so it **never throws**. Add
    the two jest `moduleNameMapper` stub entries for `next/headers`.
  - Files: `packages/app-kit/src/preferences.ts` (new),
    `packages/app-kit/src/types.ts`, `packages/app-kit/package.json`,
    `packages/app-kit/test/stubs/next-headers.ts` (new),
    `packages/app-kit/test/pref-cookie.test.ts` (new),
    `packages/app-kit/test/read-pref.test.ts` (new).
  - Acceptance: the `pref-cookie` parse matrix passes (`'on' → true`; `'off' | undefined | ''
    | 'ON' | '1' | 'true' → false`); `read-pref` passes (stub returning `'on' → true`,
    absent/malformed → false, a throwing stub still resolves `false`, `get` receives
    `pref_<key>`); no concrete key or markup in the package.
  - Verify: `npm run typecheck -w @life/app-kit` && `npm run test:unit -w @life/app-kit -- test/pref-cookie.test.ts` && `npm run test:unit -w @life/app-kit -- test/read-pref.test.ts`
  - Dependencies: T1 (build order; no code import). Size: S.
- [ ] T9: `app-kit-settings` — server action write — module `app-kit-settings`
  - Description: Add the `'use server'` preference write action
    (`SPEC-app-kit-settings.md`): `setPref(name, value)` writes `pref_<name>` =
    `value ? 'on' : 'off'` with `path: '/'`, `sameSite: 'lax'`, `httpOnly: true`,
    `secure: <production>`, `maxAge: 365 * 24 * 60 * 60`, then `revalidatePath('/', 'layout')`.
    It must live in its own `'use server'` module (never beside `readPref`). Add the jest
    `moduleNameMapper` stub entry for `next/cache`.
  - Files: `packages/app-kit/src/preference-action.ts` (new),
    `packages/app-kit/package.json`,
    `packages/app-kit/test/stubs/next-cache.ts` (new),
    `packages/app-kit/test/set-pref.test.ts` (new).
  - Acceptance: `set-pref` suite passes — `setPref('matrix', true)` calls
    `store.set('pref_matrix', 'on', { path: '/', sameSite: 'lax', httpOnly: true,
    secure: <env>, maxAge: 31536000 })`, `false` writes `'off'`, and
    `revalidatePath('/', 'layout')` is called.
  - Verify: `npm run typecheck -w @life/app-kit` && `npm run test:unit -w @life/app-kit -- test/set-pref.test.ts`
  - Dependencies: T8. Size: S.
- [ ] T10: `app-kit-settings` — settings-route helper + barrel — module `app-kit-settings`
  - Description: Add `settingsHref(route)` (`SPEC-app-kit-settings.md`): the app-scoped
    settings path (`'/todos' → '/todos/settings'`, `'/notes' → '/notes/settings'`), trailing
    slash normalized so the join never yields `//settings`. Export `PrefKey`,
    `prefCookieName`, `parsePrefValue`, `readPref`, `setPref`, `settingsHref` from the barrel.
  - Files: `packages/app-kit/src/settings-route.ts` (new),
    `packages/app-kit/src/index.ts`,
    `packages/app-kit/test/settings-route.test.ts` (new).
  - Acceptance: `settings-route` suite passes (`/todos` and `/notes` joins; trailing-slash
    route yields no `//settings`); the barrel exports the six names and no extra surface;
    `grep -rnE "matrix|/todos|/notes|<IconLink|Switch" packages/app-kit/src` finds no concrete
    key, route literal, or markup.
  - Verify: `npm run typecheck -w @life/app-kit` && `npm run test:unit -w @life/app-kit -- test/settings-route.test.ts`
  - Dependencies: T8. Size: S.
- [ ] T11: `matrix-ui` — app wire-type conformance — module `matrix-ui`
  - Description: Update the four existing `apps/app` fixtures to the extended `@life/shared`
    read types (`Todo.important`/`Todo.effectiveImportant`, `List.importantDefault`) so the app
    typechecks against the new wire contract before any other Phase 4 task adds files that tsc
    would pull in. No behaviour change.
  - Files: `apps/app/test/todo-query.test.ts`, `apps/app/test/todo-groups.test.ts`,
    `apps/app/test/routes-todos-trash.test.tsx`, `apps/app/test/routes-todo-edit.test.tsx`.
  - Acceptance: the four suites pass unchanged in intent; every `Todo`/`List` fixture carries
    the new required read fields.
  - Verify: `npm run build -w @life/shared` && then from `apps/app`:
    `npm run typecheck` && `npm run test:unit -- test/todo-query.test.ts` &&
    `npm run test:unit -- test/todo-groups.test.ts` &&
    `npm run test:unit -- test/routes-todos-trash.test.tsx` &&
    `npm run test:unit -- test/routes-todo-edit.test.tsx`.
  - Dependencies: T6. Size: S.
- [ ] T12: `matrix-ui` — app matrix domain logic — module `matrix-ui`
  - Description: Add the pure app-owned matrix logic (`SPEC-matrix-ui.md` App-owned section):
    `QUADRANTS`, `QuadrantId`, `isUrgent` (overdue / today / tomorrow = urgent, via `@life/ui`'s
    `dueDateState` and the `'Tomorrow'` `dueDateLabel`), `quadrantOf`
    (`effectiveImportant` × urgency), and `groupByQuadrant` (fixed four-quadrant order, input
    order preserved within a quadrant, empty buckets returned as empty arrays).
  - Files: `apps/app/lib/matrix.ts` (new), `apps/app/test/matrix.test.ts` (new).
  - Acceptance: `SPEC-matrix-ui.md` Testing Strategy app cases pass — `isUrgent` for
    null/empty/overdue/today/tomorrow/day-after/rollovers, all four `quadrantOf`
    combinations, `groupByQuadrant` order + bucketing + empty buckets; the plain quadrant
    labels are exactly the four L6 strings.
  - Verify: `npm run build -w @life/shared` && then from `apps/app`:
    `npm run typecheck` && `npm run test:unit -- test/matrix.test.ts`.
  - Dependencies: T4, T11. Size: S.
- [ ] T13: `matrix-ui` — settings pages + preference glue — module `matrix-ui`
  - Description: Add the app-owned preference barrel
    (`apps/app/lib/preferences.ts`: `AppPrefKey = 'matrix'`, re-export
    `readPref`/`setPref` from `@life/app-kit`), the controlled `MatrixSwitch` client wrapper
    (`SPEC-matrix-ui.md`), the `/todos/settings` page (Appearance Theme row + Todos matrix
    row composed from `ManagerBlock` + `SettingsBlock`/`SettingsRow` + `ThemeToggle` +
    `MatrixSwitch`) and the `/notes/settings` page (Appearance Theme row only).
  - Files: `apps/app/lib/preferences.ts` (new),
    `apps/app/app/settings/matrix-switch.tsx` (new),
    `apps/app/app/todos/settings/page.tsx` (new),
    `apps/app/app/notes/settings/page.tsx` (new),
    `apps/app/test/routes-settings.test.tsx` (new).
  - Acceptance: `/todos/settings` reads `readPref('matrix')` and renders the Theme row plus
    the `Switch` named "Eisenhower matrix" persisting through `setPref('matrix', …)`;
    `/notes/settings` renders the Appearance block only; both compose `ManagerBlock`
    (`title="Settings"`, correct `backHref`) with zero bespoke layout markup; the suite mocks
    the app-owned `@/lib/preferences` barrel (`jest.mock`) so the server-only `next/headers`
    module is never loaded in the node test env.
  - Verify: `npm run build -w @life/shared` && then from `apps/app`:
    `npm run typecheck` && `npm run test:unit -- test/routes-settings.test.tsx`.
  - Dependencies: T1, T2, T8, T9, T10, T11. Size: M.
- [ ] T14: `matrix-ui` — nav gear in both apps + `/todos` tabs slot — module `matrix-ui`
  - Description: Replace `<ThemeToggle />` with the Settings gear `IconLink`
    (`label="Settings"`, `href={settingsHref('/todos')}` / `settingsHref('/notes')`, lucide
    `Settings size={20} aria-hidden`) in the exact former slot of both `navTrailing`s; drop
    the `ThemeToggle` import from both pages. Read the opt-in server-side on `/todos` and pass
    `tabs={<TabBar aria-label="Todos views"><Tab href="/todos" active>List</Tab><Tab
    href="/todos/matrix">Matrix</Tab></TabBar>}` only when enabled, else `undefined`.
  - Files: `apps/app/app/todos/page.tsx`, `apps/app/app/notes/page.tsx`,
    `apps/app/test/routes-todos-list.test.tsx`.
  - Acceptance: both pages' `navTrailing` keep their existing links and end with the gear
    (`settingsHref`), replacing the toggle in place; the frozen nav labels assertion still
    holds; `/todos` renders the tab row only when the pref is on and renders no tabs node when
    off (byte-identical); Contract 1 greps green (`next/link` absent from `apps/*`); the suite
    mocks `@/lib/preferences` (`jest.mock`) so `next/headers` is not loaded in the node test
    env.
  - Verify: `npm run build -w @life/shared` && then from `apps/app`:
    `npm run typecheck` && `npm run test:unit -- test/routes-todos-list.test.tsx`.
  - Dependencies: T3, T10, T13. Size: S.
- [ ] T15: `matrix-ui` — `/todos/matrix` server-gated lens — module `matrix-ui`
  - Description: Add the server-gated matrix route (`SPEC-matrix-ui.md`): `dynamic =
    'force-dynamic'`; `if (!(await readPref('matrix'))) notFound()`; fetch via the existing
    `collectTodos`/`listTodos` + `listLists`; `groupByQuadrant(todos, todayIso())` mapped to
    `MatrixBlock` quadrants with `TodoItem` rows (`availableTags={[]}`); render through
    `ListShell` with the Matrix tab active and the fab kept, search/filters/navTrailing
    omitted.
  - Files: `apps/app/app/todos/matrix/page.tsx` (new),
    `apps/app/test/routes-matrix.test.tsx` (new).
  - Acceptance: with the opt-in off the page is a 404 (`notFound()` reached); with it on it
    renders a `MatrixBlock` of the four quadrants in `groupByQuadrant` order from
    `effectiveImportant` + derived urgency; no new API client, no new backend code; the route
    stays inside the Todos manifest scope; the suite mocks `@/lib/preferences` (`jest.mock`)
    so `next/headers` is not loaded in the node test env.
  - Verify: `npm run build -w @life/shared` && then from `apps/app`:
    `npm run typecheck` && `npm run test:unit -- test/routes-matrix.test.tsx`.
  - Dependencies: T3, T4, T6, T12, T13. Size: M.
- [ ] T16: close — frozen-surface/e2e record + Contract 1 mechanical checks — module
  `matrix-ui` (close)
  - Description: Confirm the frozen-surface and spec record is complete: `SPEC-ui-list-shell.md`
    (theme toggle out of `navTrailing`, gear in its place; `tabs?` slot recorded) and
    `SPEC-todo-ui.md` (the `/todos` tabs, `/todos/matrix`, `/todos/settings` and the nav
    change) already carry the record; run the `AGENTS.md` Contract 1 mechanical greps and
    confirm zero hits outside the documented exemptions. No test code authored; no e2e run.
  - Files: none authored (verification only — the frozen-surface record was amended in the
    spec phase); read-only references: `docs/specs/SPEC-ui-list-shell.md`,
    `docs/specs/SPEC-todo-ui.md`, `docs/specs/SPEC-matrix-ui.md`.
  - Acceptance: the frozen-surface record names the Settings gear on `navTrailing` for both
    apps and the `List`/`Matrix` tab selectors; the Contract 1 greps
    (`<(button|input|textarea|select|a|img|label|progress)\b` in `apps/*.tsx`, `next/link` in
    `apps/*.tsx`, raw hex/rgb/px/rem outside `tokens.css`, `note|trash|tag-chip` in
    `packages/ui/src`) are green; E2E is documented as not run (no assertion queried the
    toggle or a tab).
  - Verify: `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
    → zero hits in UI code; `grep -rn "next/link" apps --include='*.tsx'` → zero hits;
    `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → hits only
    inside `packages/ui/src/styles/tokens.css`; `grep -riE "note|trash|tag-chip" packages/ui/src`
    → zero hits in code. No test command (E2E documented as not run).
  - Dependencies: T13, T14. Size: S.
- [ ] T17: close — five-lane verification gate — module `matrix-ui` (close)
  - Description: Run the `five-lane-verification` gate over the chapter (`feat/eisenhower-matrix`
    vs its base): correctness, code quality, security, QA, and plan-conformance lanes in
    parallel, fail-closed; any failed lane is fixed and only the failed lanes re-run until
    every lane returns PASS. Write `tasks/five-lane-settings-and-matrix.md` and report.
  - Files: `tasks/five-lane-settings-and-matrix.md` (new).
  - Acceptance: all five lanes return PASS (N/N); no partial verdict accepted; the ledger
    checkboxes are ticked; merge awaits the user's explicit request.
  - Verify: per-lane commands recorded in `tasks/five-lane-settings-and-matrix.md`; stays
    within the profile's targeted-command limits.
  - Dependencies: T1–T16. Size: M.

## Checkpoints (planning-skill gates, global protocol §8 self-reviewed and logged)

- After T4 (Upstream UI): `@life/ui` suites green, typecheck clean, Contract 1 greps green,
  `MAP-ui-primitives.md` lists every added component.
- After T7 (Backend): the cached values carry the new plaintext booleans, content stays
  `enc.v1.`-only, `effectiveImportant` computed post-decrypt, `@life/todo-service` typecheck
  clean.
- After T10 (app-kit): typecheck clean, suites green, `readPref` never throws, no concrete key
  or markup in the package.
- After T15 (UI integration): all four routes render from `@life/ui`/`@life/app-kit`, opt-in
  off ⇒ no tabs node and a 404 matrix, Contract 1 greps green, `apps/app` typecheck clean.
- After T17: five-lane gate N/N PASS → `tasks/five-lane-settings-and-matrix.md` → report;
  merge awaits the user.

## Gate log

- 2026-10-01: plan + ledger authored (branch `feat/eisenhower-matrix`). Governing-decisions
  reconciliation recorded per lesson 0012 — `MAP-ui-primitives.md`, `SPEC-ui-list-shell.md`,
  the `SPEC-app-kit.md` charter and `SPEC-todo-service.md` are reconciled rather than
  restated, and the theme-toggle relocation is an explicitly user-approved frozen-surface
  change. `validating-plans` gate: PENDING.
