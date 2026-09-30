# Capability Map: shared page blocks

Topic: `shared-page-blocks`. Intent: `docs/intent/shared-page-blocks.md`. Confirmed 2026-10-01.

Domain-agnostic page templates and non-visual page glue extracted from the notes/todos
segments — three layers, one-way dependencies.

| Module id | Responsibility | Depends on |
|---|---|---|
| `ui-trash-block` | `@life/ui` whole-page trash block: `PageShell` + back `NavBar` + `PageTitle` + empty `EmptyState` + `List`/`ListItem` restore/delete slots + `PageActions` empty-trash slot; data, copy and action slots arrive as props — no domain types | `ui-blocks` |
| `ui-manager-block` | `@life/ui` manager-page template: back `NavBar` + `PageTitle` + a manager-section slot (the app composes `TagManager`/`ListManager`); back href and copy are props | `ui-blocks` |
| `ui-list-shell` | `@life/ui` list-page shell: `NavBar` trailing slot + `PageTitle` + search slot + filter slots (`TagFilterNav`/`PillGroup`) + empty-state/list render-prop slot + `FabLink`; slots only, zero data fetching | `ui-blocks` |
| `ui-editor-chrome` | `@life/ui` editor chrome: `EditorScreen` + `EditorToolbar` (back/save/status slots) + `EditorStack` body slot + `TagPicker` wiring; no autosave/flush, no routing | `ui-blocks` |
| `app-kit` | NEW `@life/app-kit` workspace — non-visual page/route glue: filter-href builder, tag-id parsing, param-preserving search-box component, create/edit load-or-`notFound()` helper, route layout-metadata helper, shared param/route types | `ui-blocks` |
| `segment-port` | `apps/app` — port both route segments (`notes/**`, `todos/**`) onto the blocks + kit: every route file shrinks to data + copy; zero duplicated page templates or page behavior; frozen e2e surface unchanged | `ui-trash-block`, `ui-manager-block`, `ui-list-shell`, `ui-editor-chrome`, `app-kit` |

Build order: (`ui-trash-block` ∥ `ui-manager-block` ∥ `ui-list-shell` ∥ `ui-editor-chrome` ∥ `app-kit`) → `segment-port`.

- Interfaces live at the boundary: each block's prop contract is owned by its own spec
  (`SPEC-ui-<module-id>.md`); `app-kit`'s exported signatures are owned by `SPEC-app-kit.md`.
  The map fixes direction only, never signatures.
- Base modules: `ui-blocks`/`ui-atoms` are the existing modules in `MAP-ui-primitives.md`;
  the page blocks compose them and land in `@life/ui` spec-first (Contract 1 Rule 3). The
  four page blocks share that base and are independently testable page shapes, so they can
  be built and verified in parallel.
- Domain-agnostic: no `Note`/`Todo`/`List` types or app copy in a shared contract — the
  `SPEC-ui-blocks.md` "never `Note[]`" rule applies; data and copy arrive as props and
  render slots.
- Frozen surfaces constrain every module: the e2e selector surface (roles, visible text,
  aria-labels, `button.trash-delete`) and the token values. The port is structure-only —
  same rendered roles/text/labels and the same tokens (`var(--token)`).
- Excluded, intent "Out" — stay in `apps/app`, never enter a shared package: the three
  `call<T>` API clients (`apps/app/lib/api.ts`, `lib/todo-api.ts`, `lib/tags-api.ts`) and
  the `delete`/`restore`/`deleteForever`/`emptyTrash` server-action quartet
  (`app/actions.ts`, `app/todo-actions.ts`).
- Excluded, carried from `MAP-ui-primitives.md` and still applying: `lib/api`,
  `lib/auth/**`, the note autosave engine, routing/debounce logic in `@life/ui`
  (`SearchField` stays visual + debounce; `next/navigation` never enters `packages/ui` —
  URL-preserving routing glue is `app-kit`'s, not the visual package's), tag composition,
  route handlers, middleware.
- Excluded, genuinely app-specific behavior that is never absorbed: the note
  autosave/flush engine, `splitBody` (`app/note-title.ts`), inline `#tag` parsing
  (`lib/inline-tags.ts`), note tag composition (`lib/note-compose.ts`), todo
  grouping/cursor walk (`lib/todo-groups.ts`, `lib/todo-query.ts`), the lists concept, and
  `resolveTagUsage` (`lib/tags-compose.ts`, already shared correctly).
