# Spec: todo-ui (route move, /todos UI, shared tag UX)

Module id: `todo-ui` (see `MAP-todo-ecosystem.md`). All work in `apps/app` +
upstream `packages/ui` per AGENTS.md Contract 1 (Shared UI Contract). No new visual
language; every visual concept comes from `@life/ui`.

## Objective

Move the notes UI to `/notes`, build `/todos` against `SPEC-todo-service`'s
contracts, and wire one shared tag UX (picker + manager) to `tags-service` from
both apps — so tags feel identical everywhere (I3).

## Behavior

- **Route move (I5):** the existing notes UI moves from `/` to `/notes`; `/`
  permanently redirects to `/notes` (old links keep working). Playwright navigation
  URLs update to `/notes` — the explicitly approved change; no selector/text/role in
  the frozen e2e surface changes.
- **`/todos`:** grouped `Overdue` / `Today` / `Later` / `No date`; done toggle;
  create (composer/FAB); inline edit title, note, due date, list; permanent delete;
  filters by list, tag, and done state. Data via the todo-service API (server
  actions compose registry + todo calls — BFF composition, MAP M4).
- **Shared tag UX:** tag picker (attach/detach by `tagId`) and tag manager (create,
  rename, delete) usable from both `/notes` and `/todos`, backed by `tags-service`
  exclusively. Rename/delete in either app reflect everywhere immediately (single
  source). The note composer **keeps inline `#tag` parsing** (frozen e2e behavior: typing
  `#errand` still creates the filter link) — the parsed name goes through the
  registry's create-or-get and the note write carries `tagIds`. The picker is an
  addition to this flow, not a replacement (`SPEC-tags-extraction`).
- **Transport config (per kernel contract):** the app's API client gains
  `TAGS_API_URL`/`TODO_API_URL` base URLs; auth uses the kernel's single shared
  `life-api` audience — no per-service audience names appear in the client. Env
  wiring is T9's, client config is T8's.
- **`/notes` tag rework:** tag filter nav renders `[{tagId, count}]` resolved to
  names via the registry batch call. The BFF omits unresolvable ids when rendering
  **and excludes them from subsequent writes** (kernel detach semantics).

## UI contract (AGENTS.md Contract 1)

- Composed from `@life/ui` atoms/blocks. The named upstream additions required by
  this module (T7, spec-first in `packages/ui` + `SPEC-ui-*`): **`TagPicker`**
  (attach/detach by id), **`TagManager`** (create/rename/delete against the
  registry), **`DueDatePill`** (due-date display/grouping). Never raw HTML for
  interactive elements, never app-side CSS recreating primitives, tokens only.
- `@life/ui/styles.css` stays imported exactly once in the root layout.

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/ui            (upstream primitives first)
           npm run test:unit -w @life/app           (app logic: actions/lib)
Build:     npm run build -w @life/app
```

## Testing Strategy

1. jest suites for app logic (server actions composition: registry create-or-get →
   todo create with `tagIds`; name resolution batching).
2. `@life/ui` primitive tests for any upstream additions (spec-first).
3. Playwright: human-owned, frozen — only the I5 navigation URL updates land in
   this chapter; agents write no new e2e specs and run no e2e (AGENTS.md testing policy —
  global protocol §3).
4. Manual verification checklist (human, at deploy): `/` redirects; `/notes` shows
   pre-migration tags; `/todos` flows work; tag rename from one app shows in the
   other.

## Boundaries

- Always: compose from `@life/ui`; spec-first for new primitives; tokens only.
- Ask first: any frozen e2e surface change beyond the I5 URLs.
- Never: raw interactive HTML; app CSS recreating primitives; `next/link` in
  `apps/*` (anchors are `IconLink`/`FabLink`/`ListItem`/`Pill as="a"`); new visual
  language in apps.

## Success Criteria

1. `/notes` and `/todos` both live; `/` redirects.
2. Mechanical checks (Contract 1) green; zero raw-HTML/next/link/raw-value hits.
3. Tags behave as one vocabulary across both apps (create/rename/delete from either).
4. The frozen e2e surface diff contains the I5 URLs and nothing else.
