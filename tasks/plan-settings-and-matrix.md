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
`TabBar`/`Tab` atom plus a `tabs?` slot on `ListShell`, and the presentational
`MatrixBlock`. `@life/app-kit` gains the preference-cookie + settings-href behavior glue.
`apps/todo-service` carries the manual importance signal through `redis-todo` (Contract 2).
`apps/app` then wires the pages: `/todos/settings` (Theme + matrix switch),
`/notes/settings` (Theme only), the `/todos` List/Matrix tab row, the server-gated
`/todos/matrix` lens, and the gear `IconLink` that replaces the theme toggle in both apps'
`navTrailing`. No new backend service, no new Redis instance, no theme migration.

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
- P2: Build order follows the map: (`todo-importance` ∥ `ui-settings` ∥ `ui-tabs`) →
  `app-kit-settings` → `matrix-ui`. The parallelism is a dependency fact; execution stays
  sequential under tech-lead review/commit discipline (global protocol §1).
- P3: No E2E (global protocol §3). Typecheck first, then targeted unit suites. No existing
  e2e assertion queries the theme toggle or any tab, and no e2e spec is modified by this
  chapter, so the frozen-surface change is a documentation record; E2E is not run. The human
  runs the Playwright pass if and when they ask.
- P4: Every task is delegated under the §5 mandatory subagent template (single
  responsibility, exact blast radius, prescribed targeted tests, `max-test-runs: 2`).
  `apps/app` tasks that consume `@life/shared` build it first (tsc resolves its types from
  `dist/`).
- P5: Tasks are S–M and ≤ ~5 files (a 6-file task is allowed only where one coherent change
  spans a DTO + its service + its controller/test).

## Task List

### Phase 1 — Upstream UI (`@life/ui`; parallelizable, executed sequentially under review)

- [ ] T1: `ui-settings` — `Switch` atom (`switch.tsx`, `atoms.css`, `index.ts`,
  `test/switch.test.tsx`)
- [ ] T2: `ui-settings` — `SettingsRow` + `SettingsBlock` blocks (`settings-row.tsx`,
  `settings-block.tsx`, `blocks.css`, `index.ts`, `test/settings-{row,block}.test.tsx`)
- [ ] T3: `ui-tabs` — `TabBar`/`Tab` + `ListShell` `tabs?` slot (`tab-bar.tsx`,
  `list-shell.tsx`, `blocks.css`, `index.ts`, `test/tab-bar.test.tsx`,
  `test/list-shell.test.tsx`)
- [ ] T4: `matrix-ui` — `MatrixBlock` upstream block (`matrix-block.tsx`, `blocks.css`,
  `index.ts`, `test/matrix-block.test.tsx`)

### Checkpoint: Upstream UI

- [ ] `@life/ui` suites green; `npm run typecheck -w @life/ui` clean; Contract 1 mechanical
  greps green; `MAP-ui-primitives.md` already lists every added component

### Phase 2 — Backend `todo-importance` (parallel with Phase 1)

- [ ] T5: importance data model + request DTOs + query-filter contract (entities, todo/list
  request DTOs, `ListTodosQuery`)
- [ ] T6: shared read contract + effective computation + list default + list input
  (`@life/shared` `Todo`/`List`, `todos.service.ts`, `lists.service.ts`,
  `lists.controller.ts`)
- [ ] T7: cache ciphertext suite (`test/todo-cache.e2e-spec.ts`) — the `## Cache Rules`
  assertion task

### Checkpoint: Backend

- [ ] `todo:all`/`todo:trash` cached values carry `important` and `todo:lists` carries
  `importantDefault`; content fields stay `enc.v1.`-only; `effectiveImportant` computed
  post-decrypt; `npm run typecheck -w @life/todo-service` clean

### Phase 3 — `app-kit-settings`

- [ ] T8: preference cookie name/parse/read (`preferences.ts`, `types.ts`, `package.json`
  `next/headers` mapper, `test/stubs/next-headers.ts`, `test/pref-cookie.test.ts`,
  `test/read-pref.test.ts`)
- [ ] T9: server action write (`preference-action.ts`, `package.json` `next/cache` mapper,
  `test/stubs/next-cache.ts`, `test/set-pref.test.ts`)
- [ ] T10: settings-route helper + barrel (`settings-route.ts`, `index.ts`,
  `test/settings-route.test.ts`)

### Checkpoint: app-kit

- [ ] `npm run typecheck -w @life/app-kit` clean and its suites green; `readPref` never
  throws; `grep -rnE "matrix|/todos|/notes|<IconLink|Switch" packages/app-kit/src` finds no
  concrete key, route literal, or markup

### Phase 4 — `matrix-ui` integration (`apps/app`)

- [ ] T11: app wire-type conformance (`test/todo-query.test.ts`, `test/todo-groups.test.ts`,
  `test/routes-todos-trash.test.tsx`, `test/routes-todo-edit.test.tsx`)
- [ ] T12: app matrix domain logic (`lib/matrix.ts`, `test/matrix.test.ts`)
- [ ] T13: settings pages + preference glue (`lib/preferences.ts`,
  `app/settings/matrix-switch.tsx`, `app/todos/settings/page.tsx`,
  `app/notes/settings/page.tsx`, `test/routes-settings.test.tsx`)
- [ ] T14: nav gear in both apps + `/todos` tabs slot (`app/todos/page.tsx`,
  `app/notes/page.tsx`, `test/routes-todos-list.test.tsx`)
- [ ] T15: `/todos/matrix` server-gated lens (`app/todos/matrix/page.tsx`,
  `test/routes-matrix.test.tsx`)

### Checkpoint: UI integration

- [ ] `/todos/settings`, `/notes/settings`, `/todos` tabs and `/todos/matrix` render from
  `@life/ui` / `@life/app-kit` only; opt-in off ⇒ `/todos` renders no tabs node and
  `/todos/matrix` is a 404; Contract 1 mechanical greps green; `npm run typecheck` (in
  `apps/app`) clean

### Phase 5 — Close

- [ ] T16: frozen-surface/e2e record close-out + Contract 1 mechanical checks
- [ ] T17: five-lane verification gate → `tasks/five-lane-settings-and-matrix.md` → report

### Checkpoint: Complete

- [ ] All acceptance criteria met; five-lane gate N/N PASS; merge awaits the user's explicit
  request

## Parallelization

`T5 ∥ T1 ∥ T2 ∥ T3 ∥ T4` is dependency-safe by construction. In practice run
sequentially: T2/T3/T4 all edit `packages/ui/src/index.ts` and `blocks.css`, so serializing
them keeps those two files conflict-free; Phase 3 follows Phase 1 because
`app-kit-settings` depends on `ui-settings` (build order, no code import). Phase 4 is
strictly serial (T11 → T12 → T13 → T14 → T15) because it composes every earlier surface.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `packages/ui/src/index.ts` / `blocks.css` conflict across T2/T3/T4 | Med | Serialize the three tasks under single-agent review; each re-reads the file before editing |
| `@life/shared` read types (`important`, `effectiveImportant`, `importantDefault`) break `apps/app` fixtures | Med | T6 lands the shared change with its service population; T11 owns the four app fixture updates and runs first in Phase 4 |
| Red typecheck window between the shared type change and its consumers | Med | The shared read change lands with its service population in T6; Phase 4 builds `@life/shared` before typecheck |
| `Switch`/`TabBar` styling drifts into raw values | Med | Contract 1 mechanical greps at each UI review; CSS lives in `atoms.css`/`blocks.css` with tokens only |
| Frozen e2e surface churn (theme toggle → gear) | Med | Record-only update in `SPEC-ui-list-shell.md`/`SPEC-todo-ui.md`; grep proves no e2e assertion queried the toggle or a tab; no e2e run |
| Preference cookie read fails outside a request scope | Low | `readPref` is fail-safe to `false` and never throws (T8 suite pins it) |
| Adding a second settings-page template | Low | Compose `ManagerBlock` per the `SPEC-ui-settings.md` fit test; no new page block |

## Open Questions

None — the interview closed the forks (L1–L7) and the map fixed the cross-cutting decisions
(D1–D7); anything new goes through §8 decision + artifact recording.
