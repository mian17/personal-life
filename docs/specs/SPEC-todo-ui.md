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
  permanently redirects to `/notes` (old links keep working). Trash belongs to the
  notes app and moves under it too — `/notes/trash`, with `/trash` permanently
  redirecting (user-approved 2026-09-28; the same URL-only frozen-surface exception
  covers its `waitForURL` updates). Playwright navigation URLs update to the new
  paths — the explicitly approved changes; no selector/text/role in the frozen e2e
  surface changes.
- **`/todos`:** grouped `Overdue` / `Today` / `Later` / `No date`; done toggle;
  create (composer/FAB); inline edit title, note, due date + optional **time**, optional
  **repeat**, list; **soft delete to
  trash**; a `/todos/trash` page (restore / delete-forever / empty) reached from a
  Trash entry in the toolbar; filters by list, tag, and done state. Data via the
  todo-service API (server actions compose registry + todo calls — BFF composition,
  MAP M4). The list page also carries the shared `TabBar` (List / Matrix) added by
  `ui-tabs`, present through `ListShell`'s `tabs` slot only when the matrix opt-in is
  enabled (`SPEC-matrix-ui.md`). Each List row is one `ListItem variant="todo"`
  (`size="default"`): a leading borderless square `Checkbox`, a title clamped to two
  lines, and the signal due date, keeping its List extras (list name, note snippet,
  trash delete). `TodoItem`'s scale prop is `size?: 'default' | 'dense'`
  (`'default'` = the List row, `'dense'` = the matrix lens); the two views share one
  row anatomy at two scales (`SPEC-ui-blocks.md`).
- **`/todos/matrix` + `/todos/settings` (matrix-ui):** the Eisenhower matrix lens
  (server-gated on the `pref_matrix` cookie; groups todos into four quadrants from
  `effectiveImportant` + a derived urgency) and the Todos settings page (Theme +
  "Eisenhower matrix" switch). `/todos/settings` is reached from the Settings gear that
  replaces the theme toggle in `navTrailing`; `/notes/settings` is the Notes counterpart
  (Theme only). Full contracts live in `SPEC-matrix-ui.md`; this module only records the
  surface changes those routes make to `/todos` and the nav.
- **Editor save awaits the write (stale-list fix):** `todo-editor.tsx`'s `save()` awaits
  its Server Action (`createTodoAction` / `updateTodoAction`, which run
  `revalidateTodos()`) **before** `router.back()`, so the action's `revalidatePath` lands
  before the List/Matrix render and they show the new/edited row rather than the stale RSC
  cache. A failed write does not navigate — the editor stays open for retry — and a
  `saving` guard blocks a second submission while the first is in flight.
- **Shared tag UX:** tag picker (attach/detach by `tagId`) and tag manager (create,
  rename, delete) usable from both `/notes` and `/todos`, backed by `tags-service`
  exclusively. Rename/delete in either app reflect everywhere immediately (single
  source). The note composer **keeps inline `#tag` parsing** (frozen e2e behavior: typing
  `#errand` still creates the filter link) — the parsed name goes through the
  registry's create-or-get and the note write carries `tagIds`. The picker is an
  addition to this flow, not a replacement (`SPEC-tags-extraction`).
- **Done declutter (user-requested):** a done row renders struck + muted
  (`ListItem done`). Ticking an **open** todo to done on `/todos` or `/todos/matrix`
  lets the row linger ~1s, then it collapses (`.ui-list-item--collapsing`) and
  unmounts; an emptied group section then hides via
  `.ui-section:has(.ui-list):not(:has(.ui-list-item))`. Auto-hide arms **only on a
  genuine `false→true` tick transition** (`DoneToggle`'s `wasDone` ref): a row that is
  already done on page load (List **All** filter, Matrix) is **not** auto-hidden — it
  only shows struck/dimmed. The List **Done** status
  filter (`?done=true`) disables auto-hide entirely (`TodoList hideDone={false}`), so
  done rows there stay put — and because auto-hide is off there, **no snackbar appears**
  in the Done filter. `revalidateTodos()` now also revalidates `/todos/matrix`,
  so a write from either view refreshes both (stale-matrix fix).
- **Undo snackbar (user-requested):** the same ~1s hide is paired with a bottom-left
  `Snackbar` — `Task completed` with an `Undo` action. Pressing Undo clears the local
  `removed`/`collapsing` state immediately (un-hiding the row and cancelling the pending
  unmount), then PATCHes `done:false` with **no** `expectedVersion` (the done write bumped
  the row's version, so a version-checked PATCH would 409 — the undo is unconditional). A
  `todo.done` reset effect reconciles server state, so when the revalidated row arrives as
  open it is already restored. The snackbar
  auto-dismisses after its default 5s. `SnackbarProvider` is mounted for the whole
  `/todos` segment (`apps/app/app/todos/layout.tsx`) so the List and Matrix views share
  one provider; `useSnackbar()` has a safe no-op default outside a provider.
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
  registry), **`DueDatePill`** (due-date display/grouping), **`ListManager`** (create/rename/delete todo lists).
  Never raw HTML for
  interactive elements, never app-side CSS recreating primitives, tokens only.
- The due-time / repeat / reminder chapter adds **no** new upstream primitive: it reuses
  `PillGroup`, `Pill`, `Switch`, `SettingsBlock`, `SettingsRow`, and the existing `Input`
  via the editor's `Time`/`Repeat` pills (`SPEC-todo-due-repeat-notify.md`).
- `@life/ui/styles.css` stays imported exactly once in the root layout.

## Importance input surfaces (matrix-ui, L6)

The locked model (intent L6) is *manual* importance, defaulted by the list and overridable
per todo — so the `/todos` UI needs two input surfaces, both composing the `Switch` atom
(`SPEC-ui-settings.md`) with the app owning the copy. Field contracts live in
`SPEC-todo-importance.md` (`## Consumer surfaces`); this section records where the user
sets them.

- **List importance-default** — a `Switch` on the list manager
  (`apps/app/app/list-manager-panel.tsx`), writing `list.importantDefault` through the
  existing list action (`apps/app/app/todo-actions.ts`). Accessible name (frozen app text):
  `Default important`.
- **Per-todo importance** — a `Switch` in the todo editor
  (`apps/app/app/todo-editor.tsx`, wired through `apps/app/app/todo-actions.ts`) wrapped in a
  visible `PillGroup` labelled `Important` (field parity with `Due`/`List`), displayed
  from the user's explicit override when one exists, otherwise seeded from
  `todo.important ?? todo.effectiveImportant` (edit) / the selected list's
  `importantDefault ?? false` (create). `todo.important` is written **only when the user
  overrides it** (the patch/input omits the key otherwise), so `null` (inherit the list
  default) remains the value for a todo the user has never overridden; an override writes an
  explicit `true`/`false`. Accessible name (frozen app text): `Important`.

No raw HTML: both controls are the upstream `Switch` atom; the app supplies label, checked
value and handler. `/todos` otherwise stays a normal list page (map `matrix-ui`).

## Due time / repeat / push-reminder surfaces (todo-due-repeat-notify)

All composition is from `@life/ui` (no raw HTML, tokens only); new visible labels match
sibling fields (lesson 0014). Field contracts live in `SPEC-todo-due-repeat-notify.md`.

- **Editor (`apps/app/app/todo-editor.tsx`):** `PillGroup label="Due"` keeps the frozen
  `Input type="date"` (`aria-label="Due date"`). New `PillGroup label="Time"` wraps an
  `Input type="time"` (`aria-label="Due time"`) — empty ⇒ date-only, present ⇒ timed; its
  `dueTime` state is seeded from a timed due via the single `@life/ui` owner
  `localTimePart(todo.dueDate)` (empty otherwise — no app-side `new Date(...)`). The Time field
  is shown only once a due date exists (a time without a day is meaningless). New
  `PillGroup label="Repeat"` of `Pill as="button" size="chip"` options
  (`None`/`Daily`/`Every Weekday (Mon - Fri)`/`Weekly (<Weekday>)`/
  `Monthly (The <nth> day)`/`Yearly (<day> <Mon>)`), reusing the existing
  `Pill`/`PillGroup` primitives; `None` ⇒ `repeat: null`. Labels come from the app-owned
  `repeatLabel(repeat, dueDate)` helper (`apps/app/lib/todo-repeat-label.ts` — `@life/ui` has no
  `@life/shared` dependency), composing the shared `@life/ui` `formatWeekday`/`formatDayMonth`
  helpers (day number via `dueDay`), never `toLocale*`. The Repeat field is hidden until a due
  date is set, and the Time field is hidden until a due date is set too — both are children of the
  due date and share its clear cascade (clearing the date resets Time → `''` and Repeat → `None`),
  so a repeat-with-no-due can't be submitted (no implicit due date is inserted and
  the service's 400 is unreachable from the UI).
  **User-approved visible-text change (self-describing repeat labels):** the parenthetical is
  derived from the todo's due date so the user sees what a repeat means at a glance, and the
  pills update live as the due date changes; a missing/malformed due falls back to the bare base
  label.
- **Row (`apps/app/app/todo-item.tsx`):** the due read-out renders the time when timed
  (via the shared formatter), and a repeat todo shows `repeatLabel(todo.repeat, todo.dueDate)`
  in the row meta (the same self-describing label as the editor). Ticking a `repeat` todo
  **does not** hide/collapse the row (it advances) — the `DoneToggle` `hide`/`collapsing`
  behavior is gated on `!todo.repeat`.
- **`@life/ui` formatter (lesson 0003 — one helper owns date formatting):**
  `dueDateLabel(value, today?)` renders `Today`/`Tomorrow`/`dd/mm/yyyy` for date-only and
  `Today HH:mm` / `Tomorrow HH:mm` / `dd/mm/yyyy HH:mm` for a timed value; a
  missing/malformed value renders `No date`. Day-granular row state (`dueDateState`) keeps a
  timed todo due earlier today as `Today` — the reminder is the time-precise signal.
- **Settings (`apps/app/app/todos/settings/page.tsx`):** a new `SettingsBlock
  title="Reminders"` with `SettingsRow label="Push reminders"` and a client `PushToggle`:
  renders client defaults and reads `navigator`/`Notification.permission` in a `useEffect`
  (no server-seeded browser values); unsupported browser → explanatory text, no control;
  iPhone not installed to Home Screen (`!navigator.standalone`) → guidance to add it; else a
  `Switch` that requests permission, registers `apps/app/public/sw.js`, subscribes via
  `pushManager.subscribe`, and calls a server action to upsert the subscription (disabling
  unsubscribes and calls the delete action). The VAPID public key comes through the
  `getPushKeyAction` server action (the client never imports the server-only
  `lib/todo-api.ts`).
- **Service worker:** new static `apps/app/public/sw.js` handles `push` (→
  `showNotification` with title/body, `data.url`, icon/badge `icon-todos.png`) and
  `notificationclick` (focus an existing `/todos` window, else `openWindow(data.url)` with
  `data.url = '/todos/<id>/edit'`). No bundler, no `next-pwa`.

## Frozen e2e surface updates (matrix-ui, user-approved)

The theme-toggle relocation approved in the matrix intent (L4 / map D7) changes the
recorded surface this spec froze:

- `navTrailing` on `/todos` (and `/notes`) no longer ends with `ThemeToggle`; its former
  slot is the Settings gear — `getByLabel('Settings')` → `IconLink href={settingsHref('/todos')}`
  (Notes: `/notes/settings`). The dynamic `Theme: …` label is no longer in the nav; Theme
  itself is unchanged and now lives on `/todos/settings` and `/notes/settings`.
- The `/todos` toolbar still renders `Manage tags` / `Manage lists` / `Trash` (unchanged),
  so the existing `getByLabel('Trash')` assertion is unaffected.
- New recorded selectors: `/todos` tabs `getByRole('link', { name: 'List' | 'Matrix' })`
  (Matrix only when the opt-in is on); the settings switch
  `getByRole('switch', { name: 'Eisenhower matrix' })` on `/todos/settings`; the importance
  controls `getByRole('switch', { name: 'Important' })` on the todo editor and
  `getByRole('switch', { name: 'Default important' })` on the list manager.
- **Due time / repeat / reminders additions (todo-due-repeat-notify):** new accessible
  names `Due time`, `Time`, `Repeat`, `Reminders`, `Push reminders`; new roles
  (`getByRole('button', { name: 'Weekly (<Weekday>)' })` — the repeat option's accessible name
  is the due-derived self-describing label, so a suite should match the `Weekly` prefix — the
  push `switch`). **No existing name/role/aria-label changes** (`Due`, `Due date`, `List`,
  `Important`, `Save todo`, `Add todo`, `Mark … done`, `Delete …`, `Trash`, `Manage tags`,
  `Manage lists` all stay) — the one exception is the user-approved change to the `Weekly`
  repeat option's **visible text** (and thus its accessible name), recorded above. Recorded as
  surface additions only; the human-owned suite changes only if the user asks.

No current Playwright assertion queried the theme toggle or a tab, so the frozen suite is
not rewritten by this chapter — the surface *record* is what updates (here, in
`SPEC-ui-list-shell.md` and `SPEC-matrix-ui.md`). The human-owned suite changes only if and
when the user asks for it.

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
2. `@life/ui` primitive tests for any upstream additions (spec-first); app tests cover
   the repeat label, the editor date+time+repeat payload, the recurring no-hide rule, and
   the push toggle's unsupported / not-installed / subscribe branches
   (`SPEC-todo-due-repeat-notify.md`).
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
