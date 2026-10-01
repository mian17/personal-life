# Implementation Plan: settings-and-matrix

Branch: `feat/eisenhower-matrix` (chapter work never touches `master` until the user's
explicit merge request). Intent: `docs/intent/eisenhower-matrix-and-settings.md`. Map +
specs: `docs/specs/MAP-settings-and-matrix.md`,
`SPEC-{ui-settings,ui-tabs,app-kit-settings,todo-importance,matrix-ui}.md` (plus the
amended `SPEC-ui-list-shell.md` / `SPEC-todo-service.md`). Ledger:
`tasks/todo-settings-and-matrix.md`.

## Overview

Ship one shared Settings surface that also carries the Eisenhower matrix opt-in. Upstream
first: `@life/ui` gains the `Switch` atom, the `SettingsRow`/`SettingsBlock` blocks, the
`TabBar`/`Tab` atom plus a `tabs?` slot on `ListShell`, the presentational
`MatrixBlock`, and a domain-free `rowExtra` slot on `ListManager` (the upstream host for the
per-list `Default important` switch). `@life/app-kit` gains the preference-cookie +
settings-href behavior glue.
`apps/todo-service` carries the manual importance signal through `redis-todo` (Contract 2).
`apps/app` then wires the pages: `/todos/settings` (Theme + matrix switch),
`/notes/settings` (Theme only), the `/todos` List/Matrix tab row, the server-gated
`/todos/matrix` lens, the L6 importance inputs (the list-manager `Default important` default
and the editor `Important` override), and the gear `IconLink` that replaces the theme toggle
in both apps' `navTrailing`. No new backend service, no new Redis instance, no theme
migration.

The matrix is opt-in (off by default). With it off, `/todos` is byte-identical (no tabs
node) and `/todos/matrix` is a 404; with it on, each todo lands in exactly one quadrant
from `effectiveImportant` + urgency derived from `dueDate`.

## Architecture Decisions

- **Binding decisions** are the map's D1–D7 and the intent's L1–L7, reconciled here:
  - D1/L3 — preference storage is split by reach: the matrix opt-in is a server-readable
    cookie (`pref_matrix`); theme stays on its existing client-only localStorage mechanism.
    No theme migration.
  - D2/L1 — `TabBar`/`Tab` is a genuinely new `@life/ui` atom, never a restyled `PillGroup`
    (navigation ≠ filters).
  - D3/L2 — tabs are server-rendered `next/link` `Link`s to `/todos` (List, default) and
    `/todos/matrix`; the Matrix route is server-gated (`notFound()`), so it remains inside
    the Todos manifest scope (per-route PWA identity, lesson 0005) and is absent — route and
    tab — when the opt-in is off.
  - D4/L6 — importance is manual, defaulted by the list
    (`todo.important ?? list.importantDefault ?? false`) and overridable per todo; urgency is
    derived from `dueDate` (overdue / today / tomorrow = urgent). No per-item triage, no
    manual urgency, no configurable windows.
  - D5/L7 — the settings surface is reusable across apps by construction (atom → block →
    page composition); Todos is the first consumer.
  - D6/L5 — `MatrixBlock` is responsive in CSS (2×2 grid at ≥640px, four stacked labelled
    sections below), no JS, no horizontal scroll.
  - D7/L4 — the gear `IconLink` takes the theme toggle's exact former slot in `navTrailing`
    in **both** apps; `ThemeToggle` moves to the two settings pages and is otherwise
    unchanged.
- **Governing decisions (lesson 0012).** This chapter extends surfaces owned by earlier
  chapters, so it reconciles with their standing artifacts instead of restating a choice:
  - `MAP-ui-primitives.md` already registers `Switch` (ui-atoms) and
    `SettingsRow`/`SettingsBlock`/`TabBar`/`Tab`/`MatrixBlock` (ui-blocks) — the map is the
    contract for component ownership, and this plan adds no primitive outside it.
  - `SPEC-ui-list-shell.md` is amended (same change) with the `tabs?` slot and its fixed
    order, and its frozen-surface record drops the theme toggle from `navTrailing` in favour
    of the Settings gear. The theme-toggle relocation is an **explicitly user-approved
    frozen-surface change** (intent L4 / map D7); no Playwright assertion queried the toggle
    or a tab (verified by grep over `apps/app/test/e2e/**`), so this is a record update, not
    an assertion rewrite.
  - `SPEC-todo-service.md` is amended (same change) with the `important`/`importantDefault`
    columns and the updated `## Cache Rules`; `SPEC-todo-importance.md` is the module spec.
  - `SPEC-app-kit.md`'s charter (behavior only, no markup, no domain identifiers) is honored
    by `app-kit-settings`: it contributes the href and the read/write glue only.
  - `MAP-redis.md`: no new cache instance (lesson 0011 — per-service ownership already
    holds). The importance signal rides the existing `redis-todo` read-through cache; the two
    booleans are non-content plaintext metadata, the documented exception mirroring `done`.
- P1: Contract 1 Rule 3 upstream-first — every new visual component lands in `packages/ui`
  (with the spec) before `apps/*` consumes it. The settings page composes the existing
  `ManagerBlock`; no new page block is created (fit test applied in `SPEC-ui-settings.md`).
- P2: Build order follows the map: (`todo-importance` ∥ `ui-settings` ∥ `ui-tabs` ∥
  `ui-blocks`) → `app-kit-settings` → `matrix-ui`. The parallelism is a dependency fact; execution stays
  sequential under tech-lead review/commit discipline (global protocol §1).
- P3: No E2E (global protocol §3). Typecheck first, then targeted unit suites. No existing
  e2e assertion queries the theme toggle or any tab, and no e2e spec is modified by this
  chapter, so the frozen-surface change is a documentation record; E2E is not run. The human
  runs the Playwright pass if and when they ask.
- P4: Every task is delegated under the §5 mandatory subagent template (single
  responsibility, exact blast radius, prescribed targeted tests, `max-test-runs: 2`).
  `apps/app` tasks that consume `@life/shared` build it first (tsc resolves its types from
  `dist/`): run `cd /home/night/WebstormProjects/personal-life && npm run build -w
  @life/shared`, then verify from the app with `cd
  /home/night/WebstormProjects/personal-life/apps/app && npm run typecheck`.
- P5: Tasks are S–M and ≤ ~5 files (a 6-file task is allowed only where one coherent change
  spans a DTO + its service + its controller/test).

## Task List

### Phase 1 — Upstream UI (`@life/ui`; parallelizable, executed sequentially under review)

- [ ] T1: `ui-settings` — `Switch` atom (`switch.tsx`, `atoms.css`, `index.ts`,
  `test/switch.test.tsx`); verify `grep -riE "note|todo" packages/ui/src/components/switch.tsx`
  → zero hits (`SPEC-ui-settings.md` Success Criteria 3)
- [ ] T2: `ui-settings` — `SettingsRow` + `SettingsBlock` blocks (`settings-row.tsx`,
  `settings-block.tsx`, `blocks.css`, `index.ts`, `test/settings-{row,block}.test.tsx`);
  verify `grep -riE "note|todo" packages/ui/src/components/settings-row.tsx
  packages/ui/src/components/settings-block.tsx` → zero hits (`SPEC-ui-settings.md`
  Success Criteria 3)
- [ ] T3: `ui-tabs` — `TabBar`/`Tab` + `ListShell` `tabs?` slot (`tab-bar.tsx`,
  `list-shell.tsx`, `blocks.css`, `index.ts`, `test/tab-bar.test.tsx`,
  `test/list-shell.test.tsx`); verify
  `grep -riE "note|todo" packages/ui/src/components/tab-bar.tsx` → zero hits and
  `grep -rn "PillGroup" packages/ui/src/components/tab-bar.tsx` → zero hits
  (`SPEC-ui-tabs.md` Success Criteria 4)
- [ ] T4: `ui-blocks` — `MatrixBlock` upstream block, `@life/ui` (`matrix-block.tsx`,
  `blocks.css`, `index.ts`, `test/matrix-block.test.tsx`); verify
  `grep -riE "note|todo|urgent|important" packages/ui/src/components/matrix-block.tsx`
  → zero hits in code (`SPEC-matrix-ui.md` Testing Strategy)
- [ ] T5: `ui-blocks` — `ListManager` per-row slot (`list-manager.tsx`, `index.ts`,
  `test/list-manager.test.tsx`, `docs/specs/SPEC-ui-blocks.md`); adds one optional
  domain-free `rowExtra?: (list: TodoListOption) => ReactNode` rendered in each row (the
  block must not know the word "important"); verify `npm run typecheck -w @life/ui` &&
  `npm run test:unit -w @life/ui -- test/list-manager.test.tsx`

### Checkpoint: Upstream UI

- [ ] `@life/ui` suites green; `npm run typecheck -w @life/ui` clean; Contract 1 mechanical
  greps green; `MAP-ui-primitives.md` already lists every added component

### Phase 2 — Backend `todo-importance` (parallel with Phase 1)

- [ ] T6: importance data model + request DTOs + query-filter contract (entities, todo/list
  request DTOs, `ListTodosQuery`)
- [ ] T7: shared read contract + effective computation + list default + list input
  (`@life/shared` `Todo`/`List`, `todos.service.ts`, `lists.service.ts`,
  `lists.controller.ts`, `lists/dto/create-list.dto.ts`, `lists/dto/update-list.dto.ts`)
- [ ] T8: cache ciphertext suite (`test/todo-cache.e2e-spec.ts`) — the `## Cache Rules`
  assertion task

### Checkpoint: Backend

- [ ] `todo:all`/`todo:trash` cached values carry `important` and `todo:lists` carries
  `importantDefault`; content fields stay `enc.v1.`-only; `effectiveImportant` computed
  post-decrypt; `npm run typecheck -w @life/todo-service` clean

### Phase 3 — `app-kit-settings`

- [ ] T9: preference cookie name/parse/read (`preferences.ts`, `types.ts`, `package.json`
  `next/headers` mapper, `test/stubs/next-headers.ts`, `test/pref-cookie.test.ts`,
  `test/read-pref.test.ts`)
- [ ] T10: server action write (`preference-action.ts`, `package.json` `next/cache` mapper,
  `test/stubs/next-cache.ts`, `test/set-pref.test.ts`)
- [ ] T11: settings-route helper + barrel (`settings-route.ts`, `index.ts`,
  `test/settings-route.test.ts`)

### Checkpoint: app-kit

- [ ] `npm run typecheck -w @life/app-kit` clean and its suites green; `readPref` never
  throws; `grep -rnE "matrix|/todos|/notes|<IconLink|Switch" packages/app-kit/src` finds no
  concrete key, route literal, or markup

### Phase 4 — `matrix-ui` integration (`apps/app`)

- [ ] T12: app wire-type conformance (`test/todo-query.test.ts`, `test/todo-groups.test.ts`,
  `test/routes-todos-trash.test.tsx`, `test/routes-todo-edit.test.tsx`,
  `test/routes-todos-list.test.tsx`)
- [ ] T13: app matrix domain logic (`lib/matrix.ts`, `test/matrix.test.ts`)
- [ ] T14: settings pages + preference glue (`lib/preferences.ts`,
  `app/settings/matrix-switch.tsx`, `app/todos/settings/page.tsx`,
  `app/notes/settings/page.tsx`, `test/routes-settings.test.tsx`) — `MatrixSwitch` imports
  the server action `setPref` from `@life/app-kit`'s action module directly, never through
  `@/lib/preferences` (whose barrel also re-exports server-only `readPref`/`next/headers`)
- [ ] T15: nav gear in both apps + `/todos` tabs slot (`app/todos/page.tsx`,
  `app/notes/page.tsx`, `test/routes-todos-list.test.tsx`)
- [ ] T16: `/todos/matrix` server-gated lens (`app/todos/matrix/page.tsx`,
  `test/routes-matrix.test.tsx`)
- [ ] T17: list importance-default control (`app/list-manager-panel.tsx`, `app/todo-actions.ts`,
  `lib/todo-api.ts`, `test/routes-manager-blocks.test.tsx`) — L6 consumer path; renders the
  per-list `Switch` through T5's `ListManager` `rowExtra` slot (upstream host, Contract 1)
- [ ] T18: per-todo importance toggle (`app/todo-editor.tsx`,
  `test/routes-todo-edit.test.tsx`) — L6 consumer path

### Checkpoint: UI integration

- [ ] `/todos/settings`, `/notes/settings`, `/todos` tabs and `/todos/matrix` render from
  `@life/ui` / `@life/app-kit` only; opt-in off ⇒ `/todos` renders no tabs node and
  `/todos/matrix` is a 404; the two L6 importance inputs (`Important` / `Default important`)
  are wired; Contract 1 mechanical greps green; `cd
  /home/night/WebstormProjects/personal-life/apps/app && npm run typecheck` clean

### Phase 5 — Close

- [ ] T19: frozen-surface/e2e record close-out + Contract 1 mechanical checks (chapter-scoped
  `note|trash|tag-chip` grep over the files this chapter adds/changes — the whole-repo hits in
  `packages/ui/src/components/trash-block.tsx` are a pre-existing, out-of-scope condition; the
  raw-HTML, `next/link`, and raw-hex greps stay green, with the raw-hex grep scoped
  `--exclude-dir=.next` so generated `apps/app/.next/**` CSS is not matched)
- [ ] T20: five-lane verification gate → `tasks/five-lane-settings-and-matrix.md` → report

### Checkpoint: Complete

- [ ] All acceptance criteria met; five-lane gate N/N PASS (T20); merge awaits the user's
  explicit request

## Parallelization

`T6 ∥ T1 ∥ T2 ∥ T3 ∥ T4 ∥ T5` is dependency-safe by construction. In practice run
sequentially: T2/T3/T4/T5 all edit `packages/ui/src/index.ts` (and T2/T3/T4 `blocks.css`), so
serializing them keeps those files conflict-free; Phase 3 follows Phase 1 because
`app-kit-settings` depends on `ui-settings` (build order, no code import). Phase 4 is
strictly serial (T12 → T13 → T14 → T15 → T16) because it composes every earlier surface;
the two L6 importance inputs (T17, T18) both depend on T12 and are parallelizable with each
other (`T17 ∥ T18`) — T17 additionally needs T5 (the `ListManager` `rowExtra` upstream host) —
so they may be run alongside the serial chain once T12 (and, for T17, T5) is green.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `packages/ui/src/index.ts` / `blocks.css` conflict across T2/T3/T4/T5 | Med | Serialize the four tasks under single-agent review; each re-reads the file before editing |
| `@life/shared` read types gain always-present fields (`effectiveImportant: boolean` required, `important`/`importantDefault` required-but-nullable) so `apps/app` fixtures no longer typecheck | Med | T7 lands the shared change with its service population; T12 owns the five app fixture updates (`todo-query`, `todo-groups`, `routes-todos-trash`, `routes-todo-edit`, `routes-todos-list`) — adding `effectiveImportant`/`important`/`importantDefault` to every `Todo`/`List` fixture — and runs first in Phase 4 |
| Red typecheck window between the shared type change and its consumers | Med | The shared read change lands with its service population in T7; Phase 4 builds `@life/shared` before typecheck |
| `Switch`/`TabBar` styling drifts into raw values | Med | Contract 1 mechanical greps at each UI review; CSS lives in `atoms.css`/`blocks.css` with tokens only |
| Frozen e2e surface churn (theme toggle → gear) | Med | Record-only update in `SPEC-ui-list-shell.md`/`SPEC-todo-ui.md`; grep proves no e2e assertion queried the toggle or a tab; no e2e run |
| Preference cookie read fails outside a request scope | Low | `readPref` is fail-safe to `false` and never throws (T9 suite pins it) |
| Adding a second settings-page template | Low | Compose `ManagerBlock` per the `SPEC-ui-settings.md` fit test; no new page block |

## Open Questions

None — the interview closed the forks (L1–L7) and the map fixed the cross-cutting decisions
(D1–D7); anything new goes through §8 decision + artifact recording.
