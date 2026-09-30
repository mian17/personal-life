# Capability Map: shared UI primitives

Topic: `ui-primitives`. Intent: `docs/intent/ui-primitives.md`. Confirmed 2026-09-27.

One deliverable, four independently testable capabilities with one-way dependencies.

| Module id | Responsibility | Depends on |
|---|---|---|
| `ui-tokens` | `@life/ui` package skeleton + the visual language: design tokens (CSS custom properties), theme contract (data-theme + prefers-color-scheme + pre-hydration snippet) | — |
| `ui-atoms` | Fixed-API visual primitives: Button, IconButton, IconLink, Input, Textarea, Pill, Card, StatusText, LocalTime, ConfirmButton, ThemeToggle, DueDatePill | `ui-tokens` |
| `ui-blocks` | App-level composition blocks: PageShell, NavBar, PageTitle, EmptyState, List/ListItem, TagFilterNav, FabLink, EditorToolbar, EditorScreen, AlertBanner, SearchField, PillGroup, PageActions, TagPicker, TagManager, ListManager, Stack, Section, Row, EditorStack, TrashBlock, ManagerBlock, ListShell, EditorChrome | `ui-atoms` |
| `notes-port` | `apps/app` rewritten onto `@life/ui`, pixel-identical, frozen e2e selector surface, `globals.css` absorbed into the package | `ui-blocks` |

Build order: `ui-tokens` → `ui-atoms` → `ui-blocks` → `notes-port`.

- Interfaces live at the boundary: component prop contracts are owned by the module
  that provides them (`ui-atoms` / `ui-blocks` specs).
- The port is the proving ground: a primitive that only fits the notes app is a spec
  defect discovered in `notes-port` and fixed upstream in `ui-atoms`/`ui-blocks`.
- Excluded by the map (app-only, never enters `@life/ui`): `lib/api`, `lib/auth/**`,
  server actions, the autosave engine, routing/debounce logic, tag parsing,
  route handlers, middleware.
