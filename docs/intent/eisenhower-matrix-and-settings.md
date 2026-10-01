# Confirmed Intent: eisenhower-matrix-and-settings

Confirmed by the user 2026-10-01 via interview-me (explicit "yes").

## Statement of intent

- Outcome: a shared Settings surface (atom → block → shared page → per-app wiring). In
  the Todos app it hosts (a) the Theme control, relocated out of the nav bar, and (b) an
  Eisenhower matrix opt-in (off by default). Enabling it adds a TabBar under the "Todos"
  title — List (default) and Matrix — with the Matrix tab present ONLY when enabled. The
  matrix places each todo in one of four quadrants from a locked model: **importance is
  manual**, defaulted by the todo's list (`todo.important ?? list.importantDefault ??
  false`) and overridable per todo; **urgency is derived** from `dueDate` (overdue / due
  today / due tomorrow = urgent; later or none = not urgent); quadrant labels are plain
  ("Urgent & Important", "Urgent & Not Important", "Not Urgent & Important", "Not Urgent
  & Not Important") — never "Do First / Delegate / Drop". No per-item triage.
- User: the single user, on the phone, via the `/todos` iPhone PWA.
- Why now: no priority lens and no settings home exist; the matrix needs an opt-in; the
  opt-in needs a settings page worth building once; theme no longer belongs in the nav bar.
- Success: the nav bar's former theme-toggle slot now opens Settings; Theme behaves
  exactly as before (System / Light / Dark); toggling "Eisenhower matrix" on shows the
  Matrix tab; off → no tab and no route (`/todos/matrix` server-gated). No per-item triage.
- Constraint: spec-first per AGENTS.md Contract 1 — `TabBar`, the boolean control, and the
  settings composition are added upstream in `@life/ui` / `@life/app-kit`, never
  hand-rolled in `apps/*`; Contract 2 for the new importance metadata (BE → `redis-todo` →
  DB, with a `## Cache Rules` section); the app's per-route PWA identity is preserved
  (`/todos/matrix` stays inside the Todos manifest scope — NOT a new app).
- Frozen surface (explicitly approved by the user): the theme toggle leaves `navTrailing`
  and is replaced in-place by the Settings `IconLink`; the frozen e2e selector surface and
  `SPEC-ui-list-shell.md` must be updated in the same change.
- Out of scope: drag-and-drop reclassification; manual urgency; configurable urgency
  windows; a Matrix PWA of its own; cross-device preference sync (preferences are
  per-device). NOT out of scope: a Notes settings page — both `notes/page.tsx` and
  `todos/page.tsx` carry the theme toggle today, so relocating it requires a
  `/notes/settings` page too; Notes hosts the Theme row only (no matrix switch).

## Locked decisions (spec-time, fleshed out in the map `D1…D8`)

| # | Decision |
|---|---|
| L1 | `TabBar`/`Tab` is a genuinely NEW `@life/ui` atom — NOT `PillGroup` restyled. The user requested this explicitly. |
| L2 | Tabs are server-rendered LINKs to `/todos` (List, default) and `/todos/matrix` (Matrix); the Matrix route is server-gated. |
| L3 | Preference storage is a server-readable cookie — the matrix setting gates a route, so it cannot be localStorage. Theme stays on its existing localStorage mechanism (client-only visual): record this split, no theme migration. |
| L4 | The Settings entry point is a new gear `IconLink` occupying the theme toggle's exact former position in `navTrailing` — in BOTH apps, which both carry the toggle today. Each app therefore gets a settings page: `/todos/settings` (Theme + matrix switch) and `/notes/settings` (Theme only). |
| L5 | The matrix renders as a 2×2 grid of muted panels at every width, unconditionally (smallest phones included): equal-height rows, empty quadrants show a muted centered empty state; separation from the grid gap, no hairline dividers — no media query, no phone stack. **Revised, user-approved** (the earlier "2×2 on wide / stacked on a narrow phone" was reversed; see `docs/specs/SPEC-matrix-ui.md` :480-483). |
| L6 | Importance (`todo.important` nullable) defaults from the list (`list.importantDefault`), overridable per todo; urgency derived from `dueDate`; plain quadrant labels; no per-item triage. |
| L7 | The settings surface is reusable across apps by construction (Contract 1 layering); Todos is the first consumer only. |
| L8 | The matrix lens renders a minimal TickTick-style row — a borderless done toggle LEADING the row (left), task name + due-date label only (no list name, no note snippet, no delete action) in dense type — and its quadrant headings stay on one line, truncating with `…`. The default `/todos` List row is unchanged (bordered trailing tick, delete, list name, snippet). **User-requested** (the matrix should read like the TickTick reference on the phone). Upstream `ListItem` gains `leading?`/`dense?`; see `docs/specs/SPEC-matrix-ui.md` and map D8. |

## Capability map

Phase-0 module decomposition, build order, and the cross-cutting design decisions
(`D1…D8`) live in `docs/specs/MAP-settings-and-matrix.md`.
