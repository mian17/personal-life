# Capability Map: settings-and-matrix

Intent: `docs/intent/eisenhower-matrix-and-settings.md`. Spec-first per AGENTS.md; each
module gets its own spec (`SPEC-<module-id>.md`) in this directory. Plan/tasks live in
`tasks/plan-settings-and-matrix.md` / `tasks/todo-settings-and-matrix.md`.

One deliverable — a shared Settings surface that also carries the Eisenhower matrix
opt-in — decomposed into independently testable capabilities with one-way dependencies.
The new upstream surfaces are declared against `docs/specs/MAP-ui-primitives.md`.

| Module id | Responsibility | Depends on |
|---|---|---|
| `ui-settings` | Upstream `@life/ui`: a `Switch` atom + `SettingsRow`/`SettingsBlock` blocks + the settings-page composition (reuse an existing page-template block if it fits). Spec-first; MAP-ui-primitives. | ui-atoms, ui-blocks |
| `ui-tabs` | Upstream `@life/ui`: `TabBar`/`Tab` atom + a `tabs?` slot on `ListShell` under `PageTitle` (omit ⇒ no change). | ui-atoms |
| `app-kit-settings` | `@life/app-kit`: preference cookie read/write + Settings link/route helpers — behavior only, no markup. | ui-settings |
| `todo-importance` | Backend `apps/todo-service`: `todo.important` (nullable) + `list.importantDefault` + DTOs + the `redis-todo` read-through cache update + `## Cache Rules`. | — |
| `matrix-ui` | `@life/ui` `MatrixBlock`; `apps/app` `/todos` TabBar wiring, `/todos/matrix` (server-gated), `/todos/settings` (Theme + matrix switch) and `/notes/settings` (Theme only), nav gear replacing the theme toggle in BOTH apps' `navTrailing`. | ui-settings, ui-tabs, app-kit-settings, todo-importance |

Build order: (`todo-importance` ∥ `ui-settings` ∥ `ui-tabs`) → `app-kit-settings` → `matrix-ui`.

## Cross-cutting design decisions (recorded per global protocol §8)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Preference storage is split by reach.** The matrix opt-in is a server-readable cookie; theme stays on its existing localStorage mechanism (client-only visual). No theme migration. | The matrix setting gates a route, so it must be readable on the server before render — localStorage is invisible to the route gate. Theme only changes appearance after hydration, so its existing client-only storage is unchanged. |
| D2 | **`TabBar`/`Tab` is a genuinely NEW `@life/ui` atom** — NOT a restyled `PillGroup`. | The user requested it explicitly; tabs are navigation, not filters, and `PillGroup`'s filter semantics/visuals would be a mis-fork. Upstream-first per Contract 1 Rule 3. |
| D3 | **Tabs are server-rendered LINKs to `/todos` (List, default) and `/todos/matrix`; the Matrix route is server-gated.** | Links keep the default tab working without client JS and keep `/todos/matrix` inside the Todos manifest scope — the per-route PWA identity (lesson 0005) is preserved; it is not a new app. When the opt-in is off, the tab is absent and the route is server-gated (no dead route). |
| D4 | **Importance is defaulted by the list (`todo.important ?? list.importantDefault ?? false`), overridable per todo; urgency is derived from `dueDate` (overdue / due today / due tomorrow = urgent; later or none = not urgent). No per-item triage.** | A design-principles argument, explicitly NOT a clinical claim: forcing the user to triage every item on every pass adds a recurring decision cost to a daily-driver list. A per-list default makes the common case zero-work and keeps the override available for the exception. Deriving urgency from a date the user already sets means the matrix introduces no new input. |
| D5 | **The settings surface is reusable across apps by construction** — the atom/block/page layering of Contract 1, with per-app wiring only; Todos is the first consumer. | Consistency is scoped by structure, not byte-similarity (lesson 0006): the settings page shape and spacing are owned in one place so a second app (Notes, when it has a setting) consumes it instead of re-assembling fragments that can drift. |
| D6 | **The matrix is responsive in the block:** a 2×2 grid on wide viewports, four stacked labelled sections on a narrow phone. No horizontal scroll. | The target is an iPhone PWA; a 2×2 grid at phone width would force either unreadable cells or horizontal scroll. `MatrixBlock` decides from available width (CSS, not JS) and keeps the quadrant labels. |
| D7 | **The Settings entry point is a gear `IconLink` occupying the theme toggle's exact former position in `navTrailing` — in both apps.** | The user approved the frozen-surface change: the theme toggle leaves the nav bar and Settings takes its slot in place, so the nav's visual rhythm is unchanged and the toggle gains a permanent home on the new page. Both `notes/page.tsx` and `todos/page.tsx` carry the toggle today, so **both** swap it (relocating only Todos' would regress Notes' theme control): `/todos/settings` (Theme + matrix) and `/notes/settings` (Theme). `SPEC-ui-list-shell.md` and the frozen e2e selector surface are updated in the same change. |
