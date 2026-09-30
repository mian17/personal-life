# Implementation Plan: shared-page-blocks — whole-page blocks + app-kit for the notes/todos segments

Branch: `refactor/notes-todos-shared-ui` (`master` stays untouched until the user asks to
merge). Intent: `docs/intent/shared-page-blocks.md`. Map: `docs/specs/MAP-shared-page-blocks.md`.
Specs (contract owners): `docs/specs/SPEC-ui-trash-block.md`,
`docs/specs/SPEC-ui-manager-block.md`, `docs/specs/SPEC-ui-list-shell.md`,
`docs/specs/SPEC-ui-editor-chrome.md`, `docs/specs/SPEC-app-kit.md`. Base contracts:
`docs/specs/SPEC-ui-blocks.md`, `docs/specs/SPEC-ui-atoms.md`.

Process: global protocol §3 (testing), §5 (mandatory task template), §6 (plan validation
gate), §7 (review + five-lane gate). Every task below is in §5 template form. Test runs
are targeted, named files only, max 2 executions; no full suite. Every task is reviewed
under §7 (blast radius, contract, project contracts) before the next dependent task starts.
The five-lane gate is executed by five parallel subagent lanes, not a shell command.

## Objective

Move every page-shaped and page-behavior duplication between the two route segments into
shared packages, so both segments render the same structure and the same spacing from one
owner:

1. **Whole-page visual blocks → `@life/ui`** — `TrashBlock`, `ManagerBlock`, `ListShell`,
   `EditorChrome`. Each owns a page's element tree, its order and its spacing, and takes
   data + copy + slots as props. Spec-first per Contract 1 Rule 3.
2. **Non-visual page/route glue → `@life/app-kit`** (new workspace) — `filterHref`,
   `parseTagId`, `PreservingSearchBox`, `loadOrNotFound`, `routeLayoutMetadata` /
   `RouteLayout`, and the `RoutePath` / `QueryParams` types.
3. **The port** — `apps/app/app/notes/**` and `apps/app/app/todos/**` shrink to data + copy
   + slots: zero duplicate page templates and zero duplicate page behavior left.

Success = the intent doc's Success list: zero duplicated page templates/behavior in either
segment, identical structure and spacing wherever the same UI appears, a third segment
lands by composing blocks, and the frozen surfaces (e2e selector surface, token values) are
unchanged.

## User requirement (verbatim)

The confirmed intent (`docs/intent/shared-page-blocks.md`) records the interview. The user's
words, verbatim:

> i mean everything that is the same in the UI, refactor them to shared packges

> whole page with props, margin and padding, spacing even, the main idea is consistency
> and reusability with DRY principle across the whole applications ecosystem

The intent's own confirmed outcome sentence, verbatim:

> Every piece of UI and page-level behavior that `apps/app/app/notes/**` and
> `apps/app/app/todos/**` share moves into shared packages as **whole-page blocks** that own
> a page's structure *and* its spacing (margin/padding), parameterized by data + copy.

## Scope

- **In — UI templates + page behavior:** trash page, manager page (tags/lists), list-page
  shell, param-aware search box, filter-href / tag-id helpers, editor chrome, route layout
  metadata + load-or-`notFound()` glue.
- **Out — data layer (stays in `apps/app`):** the three `call<T>` API clients
  (`apps/app/lib/api.ts`, `lib/todo-api.ts`, `lib/tags-api.ts`) and the
  `delete` / `restore` / `deleteForever` / `emptyTrash` server-action quartet
  (`app/actions.ts`, `app/todo-actions.ts`).
- **Out — genuinely app-specific behavior:** the note autosave/flush engine, `splitBody`,
  inline `#tag` parsing, note tag composition, todo grouping/cursor walk, the lists concept.
- **Out — packages:** `@life/ui` gets no routing/`next/navigation`, no fetch, no domain
  types; `@life/app-kit` gets no visual language beyond composing `@life/ui`'s `SearchField`.
- **Not engaged — Contract 2 (backend data layer).** No backend service is touched and no
  data flow changes; **Cache plan: not applicable.** No `## Cache Rules` work exists for this
  change.

## Ground truth (verified by reading, current tree)

- **Duplication is page-shaped, not primitive-shaped.** `apps/app` already has zero bare
  `<button>/<input>/…`, zero inline styles, zero raw colors (intent doc). What repeats:
  - `apps/app/app/notes/trash/page.tsx:24-91` ≡ `apps/app/app/todos/trash/page.tsx:27-91`
    (~95% identical JSX; only the fetch, bound actions and copy differ).
  - `apps/app/app/notes/tags/page.tsx:8-22` ≡ `apps/app/app/todos/tags/page.tsx:8-22` ≡
    `apps/app/app/todos/lists/page.tsx:7-22` (same shell, one `href` differs).
  - `apps/app/app/notes/page.tsx:42-73` vs `apps/app/app/todos/page.tsx:82-144` (same page
    shape) and their local `filterHref` (`notes/page.tsx:11-17`) / `todoHref`
    (`todos/page.tsx:25-37`).
  - `apps/app/app/notes/page.tsx:25` ≡ `apps/app/app/todos/page.tsx:45` (`/^\d+$/` tag-id
    parsing).
  - `apps/app/app/search-box.tsx` ≡ `apps/app/app/todo-search-box.tsx` (same router glue).
  - `apps/app/app/note-editor.tsx:365-374` ≡ `apps/app/app/todo-editor.tsx:74-83` (editor
    frame); the note editor places its `Textarea` directly in `EditorScreen`.
  - `apps/app/app/notes/[id]/page.tsx:11-19` ≡ `apps/app/app/todos/[id]/edit/page.tsx:16-21`
    (inline `instanceof ApiError && status === 404 → notFound()` loader).
- **Frozen e2e surface is already audited** and reproduced verbatim by each spec's
  *Frozen e2e surface* section (`apps/app/test/e2e/suites/journey.suite.ts`; helpers in
  `apps/app/test/e2e/journey.ts`; `startLogin(page, path = '/notes')` is already widened).
- **Existing segment layouts** `apps/app/app/notes/layout.tsx` and `todos/layout.tsx` are
  already `RouteLayout`-shaped (metadata + `{children}` fragment) — the port replaces the
  body with `routeLayoutMetadata` / `RouteLayout` from `app-kit`.
- **`@life/ui` package facts:** `packages/ui/package.json` is a private TS-source package
  (`"main": "src/index.ts"`, `"exports"`, no `build`), `typecheck`/`lint` = `tsc --noEmit`,
  `test`/`test:unit` = `jest` (ts-jest, jsdom, `testRegex: "\\.test\\.tsx?$"`). Barrel:
  `packages/ui/src/index.ts`. No block files exist yet.
- **`packages/app-kit` does not exist.**
- **Root workspaces** (`package.json:5-15`) list `apps/note-service`, `apps/tags-service`,
  `apps/todo-service`, `apps/app`, `apps/idp`, `packages/shared`, `packages/ui`,
  `packages/crypto`, `packages/cache` — no `packages/app-kit` yet.
- **`apps/app` workspace name is `@life/app`** with `typecheck: tsc --noEmit` and
  `test:unit: jest`.
- **No unit test imports** `SearchBox` / `TodoSearchBox` / `filterHref` / `todoHref`; the
  only consumers are the two list pages (grep over `apps/app/app` + `apps/app/test`).

## Design

### Layering (one-way dependencies, no cycles)

```
@life/app-kit  ──composes──▶ @life/ui (SearchField only)     non-visual glue owns next/navigation
@life/ui       ──composes──▶ ui-blocks / ui-atoms            visual page blocks own structure + spacing
apps/app       ──composes──▶ @life/ui + @life/app-kit        route files = data + copy + slots
```

- The four page blocks are `@life/ui` components composing existing `ui-blocks` / `ui-atoms`
  (Contract 1 Rule 3, spec-first): `trash-block.tsx`, `manager-block.tsx`, `list-shell.tsx`,
  `editor-chrome.tsx`, each re-exported from `packages/ui/src/index.ts`.
- `@life/app-kit` is a new private TS-source workspace mirroring `@life/ui`'s package
  shape. It is the **only** place `next/navigation` (`useRouter`, `notFound`) enters shared
  code; `packages/ui` stays free of it.
- `apps/app` keeps data fetching and server actions. Every route file after the port is
  data + copy + slot props only.

### Contract-first, no signature invention

Each block's prop contract is owned verbatim by its spec (quoted in the tasks below); each
`app-kit` export is owned by `SPEC-app-kit.md`'s Public API block. A gap (a prop/shape the
implementation needs that a spec does not declare) goes **upstream** — the spec's "Ask first"
boundary applies; it is never patched around in the app and never invented silently.

### The port rule

A route file after T6 contains: its own data fetch, its own copy, and the block/slot props.
No page shell JSX, no local `URLSearchParams` builder, no local `/^\d+$/`, no inline
load-or-`notFound()` try/catch. The rendered roles, headings, visible text, aria-labels,
`button.trash-delete` and every token value are byte-for-byte what they were.

### Five build units, one integration unit

T1–T5 are independent (four blocks share only `ui-blocks`; `app-kit` depends only on
`@life/ui`'s `SearchField`), so they are built and verified in parallel on their own files.
The single shared file, `packages/ui/src/index.ts`, is written once after T1–T4 by one
writer (the Blocks checkpoint) so four concurrent tasks cannot drop each other's export.
T6 depends on all five, is the only task that ports `apps/app`, and is the only task that
runs E2E.

## File structure

Create:

- `packages/ui/src/components/trash-block.tsx` (T1)
- `packages/ui/test/trash-block.test.tsx` (T1)
- `packages/ui/src/components/manager-block.tsx` (T2)
- `packages/ui/test/manager-block.test.tsx` (T2)
- `packages/ui/src/components/list-shell.tsx` (T3)
- `packages/ui/test/list-shell.test.tsx` (T3)
- `packages/ui/src/components/editor-chrome.tsx` (T4)
- `packages/ui/test/editor-chrome.test.tsx` (T4)
- `packages/app-kit/package.json` (T5)
- `packages/app-kit/tsconfig.json` (T5)
- `packages/app-kit/tsconfig.test.json` (T5)
- `packages/app-kit/src/index.ts` (T5)
- `packages/app-kit/src/types.ts` (T5)
- `packages/app-kit/src/filter-href.ts` (T5)
- `packages/app-kit/src/parse-tag-id.ts` (T5)
- `packages/app-kit/src/preserving-search-box.tsx` (T5)
- `packages/app-kit/src/load-or-not-found.ts` (T5)
- `packages/app-kit/src/route-layout.tsx` (T5)
- `packages/app-kit/test/filter-href.test.ts` (T5)
- `packages/app-kit/test/parse-tag-id.test.ts` (T5)
- `packages/app-kit/test/preserving-search-box.test.tsx` (T5)
- `packages/app-kit/test/load-or-not-found.test.ts` (T5)
- `packages/app-kit/test/route-layout.test.tsx` (T5)
- `packages/app-kit/test/stubs/next-navigation.tsx` (T5)

Modify:

- `packages/ui/src/index.ts` (Blocks checkpoint — all four block exports, appended in one
  edit after T1–T4 so this shared barrel has a single writer)
- `docs/specs/MAP-ui-primitives.md` (Blocks checkpoint — register the four new blocks in
  the `ui-blocks` row; same single-writer rule, Contract 1 Rule 3)
- `package.json` (T5: add `packages/app-kit` to `workspaces`)
- `apps/app/package.json` (T5: declare the `@life/app-kit` dependency)
- `package-lock.json` (T5: written by the workspace install)
- `apps/app/app/notes/page.tsx` (T6)
- `apps/app/app/todos/page.tsx` (T6)
- `apps/app/app/notes/trash/page.tsx` (T6)
- `apps/app/app/todos/trash/page.tsx` (T6)
- `apps/app/app/notes/tags/page.tsx` (T6)
- `apps/app/app/todos/tags/page.tsx` (T6)
- `apps/app/app/todos/lists/page.tsx` (T6)
- `apps/app/app/notes/[id]/page.tsx` (T6)
- `apps/app/app/todos/[id]/edit/page.tsx` (T6)
- `apps/app/app/notes/layout.tsx` (T6)
- `apps/app/app/todos/layout.tsx` (T6)
- `apps/app/app/note-editor.tsx` (T6)
- `apps/app/app/todo-editor.tsx` (T6)

Delete:

- `apps/app/app/search-box.tsx` (T6 — superseded by `PreservingSearchBox`)
- `apps/app/app/todo-search-box.tsx` (T6 — superseded by `PreservingSearchBox`)

Not modified: `apps/*/data/**`; token files (`packages/ui/src/styles/tokens.css`,
`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`); `public/manifest*.json` and the
`viewport.themeColor`; the e2e selector surface (roles, visible text, aria-labels,
`button.trash-delete`) and the e2e specs; `apps/app/lib/api.ts`, `lib/todo-api.ts`,
`lib/tags-api.ts`, `app/actions.ts`, `app/todo-actions.ts`, `middleware.ts`,
`lib/auth/**`; `packages/ui/src/lib/**` existing helpers; `packages/ui/src/styles/*.css`
(no new class, tokens only).

## Task List

### Phase 1 — `@life/ui` page blocks (parallel: T1 ∥ T2 ∥ T3 ∥ T4)
- [ ] T1: `ui-trash-block` — `trash-block.tsx` + suite
- [ ] T2: `ui-manager-block` — `manager-block.tsx` + suite
- [ ] T3: `ui-list-shell` — `list-shell.tsx` + suite
- [ ] T4: `ui-editor-chrome` — `editor-chrome.tsx` + suite

The four tasks run in parallel on their own files only. `packages/ui/src/index.ts` is a
shared barrel: its four export lines are applied once, serialized, by the Tech Lead at the
Blocks checkpoint below — never by the parallel tasks (four concurrent writers to one file
would drop exports).

### Checkpoint: Blocks (single writer: the Tech Lead)
- [ ] Append all four exports to `packages/ui/src/index.ts` in one edit: `TrashBlock`,
      `ManagerBlock`, `ListShell`, `EditorChrome` and their exported prop types.
- [ ] Register the four blocks in `docs/specs/MAP-ui-primitives.md`'s `ui-blocks` row
      (Contract 1 Rule 3: a new `@life/ui` component lands in the map in the same change).
- [ ] `npm run typecheck -w packages/ui` exits 0.
- [ ] `npm run test:unit -w packages/ui -- test/trash-block.test.tsx test/manager-block.test.tsx test/list-shell.test.tsx test/editor-chrome.test.tsx` green.
- [ ] `grep -riE "note|trash|tag-chip" packages/ui/src/components/{trash-block,manager-block,list-shell,editor-chrome}.tsx`
      returns only the frozen e2e hook classes/attribute strings (see Deviations 1). Real
      paths — a `*-block.tsx` brace expansion would miss two of them, and a `list` term
      would match the composed `List`/`ListItem` imports.

### Phase 2 — `@life/app-kit` (parallel with Phase 1: T5)
- [ ] T5: create `packages/app-kit` workspace + exports + suites + root workspaces entry +
      `apps/app` dependency + the `npm install` workspace link

### Checkpoint: Kit
- [ ] `npm install` ran once at the root; `node_modules/@life/app-kit` resolves and
      `apps/app/package.json` declares `"@life/app-kit": "*"`.
- [ ] `npm run typecheck -w packages/app-kit` exits 0.
- [ ] `npm run test:unit -w packages/app-kit -- test/filter-href.test.ts test/parse-tag-id.test.ts test/preserving-search-box.test.tsx test/load-or-not-found.test.ts test/route-layout.test.tsx` green.
- [ ] `grep -rnE "Note|Todo|List\b" packages/app-kit/src` finds no domain identifiers.

### Phase 3 — Segment port (T6)
- [ ] T6: port `apps/app/app/notes/**` and `apps/app/app/todos/**` onto blocks + kit

### Checkpoint: Port
- [ ] `npm run typecheck -w @life/app` exits 0.
- [ ] Each route file contains no page-shell JSX, no local href builder, no inline
      load-or-`notFound()`.
- [ ] The single targeted journey E2E passes.

### Phase 4 — Verification gate
- [ ] Contract 1 / Contract 2 mechanical greps + the targeted journey E2E (see
      *Verification gate*).
- [ ] Five-lane verification (`five-lane-verification`) returns N/N PASS.

### Checkpoint: Complete
- [ ] All acceptance criteria met; `master` untouched; merge awaits the user's explicit request.

## Tasks in §5 template form

### T1 — `ui-trash-block` (module `ui-trash-block`)

[TASK OBJECTIVE]
  Add the `TrashBlock` whole-page block to `@life/ui` exactly as
  `docs/specs/SPEC-ui-trash-block.md` declares, with its prop types and a unit suite.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/components/trash-block.tsx` (new),
    `packages/ui/test/trash-block.test.tsx` (new).
  - **`packages/ui/src/index.ts` is NOT this task's to edit.** This task runs in parallel
    with T2–T4; the four block exports are appended once, serialized, by the Tech Lead at
    the Blocks checkpoint. The test imports the block directly from
    `../src/components/trash-block`.
  - Reference files (read-only): `docs/specs/SPEC-ui-trash-block.md`,
    `docs/specs/SPEC-ui-blocks.md`, `packages/ui/src/components/page-shell.tsx`,
    `nav-bar.tsx`, `page-title.tsx`, `empty-state.tsx`, `list.tsx`, `list-item.tsx`,
    `page-actions.tsx`, `packages/ui/src/components/button.tsx`,
    `confirm-button.tsx`, `icon-link.tsx`, `packages/ui/test/list-item.test.tsx`
    (harness pattern), `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above; `packages/ui/src/styles/*.css`;
    any token file; the e2e selector surface files; `apps/**` (except reads).

[IMPLEMENTATION REQUIREMENTS]
  - Export, verbatim from the spec: `interface TrashBlockItem { id: string; title: string;
    meta?: ReactNode; snippet?: string }`, `type TrashFormAction = (formData: FormData) =>
    void | Promise<void>`, the full `interface TrashBlockProps { title: string;
    backHref: string; backLabel?: string; items: readonly TrashBlockItem[];
    emptyMessage: string; restoreAction: (id: string) => TrashFormAction;
    deleteForeverAction: (id: string) => TrashFormAction;
    deleteForeverMessage: (item: TrashBlockItem) => string;
    emptyTrashAction: TrashFormAction; emptyTrashMessage: string; restoreLabel?: string;
    emptyTrashLabel?: string }` and `function TrashBlock(props: TrashBlockProps):
    JSX.Element`.
  - Render the spec's structure top-to-bottom: `PageShell` → `NavBar leading` (back
    `IconLink` + `ArrowLeft`) → `PageTitle` → `items.length === 0 ? EmptyState : (List of
    ListItem + PageActions)`.
  - `Back` default label `"Back"`; `restoreLabel` default `"Restore"`; `emptyTrashLabel`
    default `"Empty Trash"`; restore `Button type="submit" variant="quiet"
    className="trash-restore" aria-label={`${restoreLabel} ${item.title}`}`; delete
    `ConfirmButton variant="danger" className="trash-delete"`; empty-trash `ConfirmButton
    variant="danger" size="bare" className="trash-empty"`. `deleteForeverMessage` and
    `emptyTrashMessage` are props (no baked domain copy).
  - Edge cases: empty `items` renders `EmptyState` **and no** `PageActions`; `meta`/`snippet`
    omitted from the DOM when `undefined`; `restoreAction(id)` / `deleteForeverAction(id)`
    called once per row at render, never invoked by the block.
  - No `'use client'` on the block; no `Note`/`Todo`/`List` types, no `next/navigation`,
    no fetch, no domain copy defaults. Spacing only via composed blocks (no new CSS class,
    no raw hex/px/rem).
  - Primitive reuse plan (Contract 1), element → owner:

    | Rendered element | Composed from |
    |---|---|
    | page container | `PageShell` block (`.ui-page`) |
    | back nav bar | `NavBar` block (`.ui-nav-bar`), `leading` slot |
    | back control | `IconLink` atom + lucide `ArrowLeft size={20} aria-hidden` |
    | page heading | `PageTitle` block (`.ui-page-title`) |
    | empty state | `EmptyState` block (`.ui-empty`) |
    | row list | `List` block (`.ui-list`) |
    | each row | `ListItem` block (`.ui-list-item`), `title`/`meta`/`snippet`/`trailing`/`deleteAction` slots |
    | restore control | `form` + `Button` atom (`variant="quiet"`, `className="trash-restore"`) |
    | permanent-delete control | `form` + `ConfirmButton` atom (`variant="danger"`, `className="trash-delete"`) + lucide `Trash2 size={18} aria-hidden` |
    | empty-trash control | `form` + `ConfirmButton` atom (`variant="danger" size="bare"`, `className="trash-empty"`) |
    | action container | `PageActions` block (`.ui-page-actions`) |
    | row date | app-supplied `meta` node (`<LocalTime dateTime={…} />`) — not owned by the block |

  - `form` is the Contract 1 structural exemption (behavior glue, no `className`/`style`).

[VERIFICATION & TESTING RULES]
  - Permitted test commands:
    `npm run typecheck -w packages/ui` and
    `npm run test:unit -w packages/ui -- test/trash-block.test.tsx`.
  - Required cases in `test/trash-block.test.tsx` (per the spec's Testing Strategy):
    non-empty render (rows render `title`; `Restore ${title}` accessible label; the
    `.trash-delete` control; `Empty Trash` visible text); empty render (`Trash is empty.`
    visible and **no** `Empty Trash` control); `meta`/`snippet` omitted when `undefined`;
    per-row bound action identity (`restoreAction(id)` receives each id); `restoreLabel` /
    `emptyTrashLabel` / `backLabel` overrides win over defaults.
  - Strict constraints: NO full suites; NO E2E; only this named file; max test executions: 2.
    Never touch `apps/*/data/**`; no raw HTML/inline style/raw colors; no `next/navigation`
    in `packages/ui`; frozen surfaces unchanged.

[DEFINITION OF DONE]
  - [ ] `TrashBlock` and its exported types exist with the exact spec signatures.
  - [ ] The frozen surface contract in `SPEC-ui-trash-block.md` is reproduced: the test-asserted selectors verbatim, the preserved-but-not-asserted labels unchanged.
  - [ ] No files outside the allowed scope were modified; no new CSS class or raw value.
  - [ ] `npm run typecheck -w packages/ui` passes with zero errors.
  - [ ] `npm run test:unit -w packages/ui -- test/trash-block.test.tsx` passes.

---

### T2 — `ui-manager-block` (module `ui-manager-block`)

[TASK OBJECTIVE]
  Add the `ManagerBlock` whole-page manager template to `@life/ui` exactly as
  `docs/specs/SPEC-ui-manager-block.md` declares, with its prop type and a unit suite.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/components/manager-block.tsx` (new),
    `packages/ui/test/manager-block.test.tsx` (new).
  - **`packages/ui/src/index.ts` is NOT this task's to edit.** This task runs in parallel
    with T1/T3/T4; the four block exports are appended once, serialized, by the Tech Lead at
    the Blocks checkpoint. The test imports the block directly from
    `../src/components/manager-block`.
  - Reference files (read-only): `docs/specs/SPEC-ui-manager-block.md`,
    `docs/specs/SPEC-ui-blocks.md`, `packages/ui/src/components/page-shell.tsx`,
    `nav-bar.tsx`, `page-title.tsx`, `icon-link.tsx`,
    `packages/ui/test/page-title.test.tsx` (harness pattern), `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above; `packages/ui/src/styles/*.css`;
    any token file; the e2e selector surface files; `apps/**` (except reads).

[IMPLEMENTATION REQUIREMENTS]
  - Export, verbatim from the spec: `interface ManagerBlockProps { title: string;
    backHref: string; backLabel?: string; children: ReactNode }` and
    `function ManagerBlock(props: ManagerBlockProps): JSX.Element`.
  - Render the spec's structure: `PageShell` → `NavBar leading` (back `IconLink` +
    `ArrowLeft size={20} aria-hidden`) → `PageTitle` → `{children}`.
  - `backLabel` defaults to `"Back"`. `children` is a single render slot; the block imposes
    no layout beyond the page flow and bakes no `Card` surface (the app passes a
    `Card`-wrapped node).
  - Server component by default; no `'use client'`; no domain types/callbacks, no
    `next/navigation`, no fetch; no new CSS class; no raw values.
  - Primitive reuse plan (Contract 1), element → owner:

    | Rendered element | Composed from |
    |---|---|
    | page container | `PageShell` block (`.ui-page`) |
    | back nav bar | `NavBar` block (`.ui-nav-bar`), `leading` slot |
    | back control | `IconLink` atom + lucide `ArrowLeft size={20} aria-hidden` |
    | page heading | `PageTitle` block (`.ui-page-title`) |
    | manager surface | app-supplied `children` slot (app composes `Card` + `TagManager`/`ListManager`) — not owned by the block |

[VERIFICATION & TESTING RULES]
  - Permitted test commands:
    `npm run typecheck -w packages/ui` and
    `npm run test:unit -w packages/ui -- test/manager-block.test.tsx`.
  - Required cases in `test/manager-block.test.tsx` (per the spec's Testing Strategy):
    heading renders `title`; back `IconLink` uses `backHref` and the default `Back`
    accessible label; a `backLabel` override wins; `children` renders inside the shell
    as-is (including a `Card` wrapper node).
  - Strict constraints: NO full suites; NO E2E; only this named file; max test executions: 2.
    Never touch `apps/*/data/**`; no raw HTML/inline style/raw colors; no `next/navigation`
    in `packages/ui`; frozen surfaces unchanged.

[DEFINITION OF DONE]
  - [ ] `ManagerBlock` and its exported type exist with the exact spec signature.
  - [ ] The frozen surface contract in `SPEC-ui-manager-block.md` is reproduced: the test-asserted selectors verbatim, the preserved-but-not-asserted labels unchanged.
  - [ ] No files outside the allowed scope were modified; no new CSS class or raw value.
  - [ ] `npm run typecheck -w packages/ui` passes with zero errors.
  - [ ] `npm run test:unit -w packages/ui -- test/manager-block.test.tsx` passes.

---

### T3 — `ui-list-shell` (module `ui-list-shell`)

[TASK OBJECTIVE]
  Add the `ListShell` list-page shell to `@life/ui` exactly as
  `docs/specs/SPEC-ui-list-shell.md` declares, with its prop type and a unit suite.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/components/list-shell.tsx` (new),
    `packages/ui/test/list-shell.test.tsx` (new).
  - **`packages/ui/src/index.ts` is NOT this task's to edit.** This task runs in parallel
    with T1/T2/T4; the four block exports are appended once, serialized, by the Tech Lead at
    the Blocks checkpoint. The test imports the shell directly from
    `../src/components/list-shell`.
  - Reference files (read-only): `docs/specs/SPEC-ui-list-shell.md`,
    `docs/specs/SPEC-ui-blocks.md`, `packages/ui/src/components/page-shell.tsx`,
    `nav-bar.tsx`, `page-title.tsx`, `fab-link.tsx`,
    `packages/ui/test/fab-link.test.tsx` (harness pattern), `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above; `packages/ui/src/styles/*.css`;
    any token file; the e2e selector surface files; `apps/**` (except reads).

[IMPLEMENTATION REQUIREMENTS]
  - Export, verbatim from the spec: `interface ListShellProps { title: string;
    navTrailing?: ReactNode; search?: ReactNode; filters?: ReactNode; body: ReactNode;
    fabHref: string; fabLabel: string; fabIcon: ReactNode }` and
    `function ListShell(props: ListShellProps): JSX.Element`.
  - Render the spec's fixed order: `PageShell` → `NavBar trailing` → `PageTitle` →
    `{search}` → `{filters}` → `{body}` → `FabLink`.
  - Optional slots (`navTrailing`, `search`, `filters`) render nothing when omitted. The
    shell renders `body` verbatim and owns no URL logic, no href computation, no emptiness
    decision, no domain copy.
  - No `'use client'`; no `next/navigation`, no `useRouter`/`URLSearchParams`/fetch; no new
    CSS class; no raw values.
  - Primitive reuse plan (Contract 1), element → owner:

    | Rendered element | Composed from |
    |---|---|
    | page container | `PageShell` block (`.ui-page`) |
    | top nav bar | `NavBar` block (`.ui-nav-bar`), `trailing` slot (app passes `IconLink`s + `ThemeToggle`) |
    | page heading | `PageTitle` block (`.ui-page-title`) |
    | search box | app-supplied `search` slot (app passes `PreservingSearchBox` composing `SearchField`) |
    | filter rows | app-supplied `filters` slot (app passes `PillGroup` + `TagFilterNav` blocks, in render order) |
    | list / empty state | app-supplied `body` slot (app passes `NoteList`/`TodoList`) |
    | fixed action button | `FabLink` block (`.ui-fab-link`) + app-supplied `fabIcon` node |

[VERIFICATION & TESTING RULES]
  - Permitted test commands:
    `npm run typecheck -w packages/ui` and
    `npm run test:unit -w packages/ui -- test/list-shell.test.tsx`.
  - Required cases in `test/list-shell.test.tsx` (per the spec's Testing Strategy): slot
    render order (title → search → filters → body → fab); omitted optional slots render
    nothing (no empty wrapper for `navTrailing`/`search`/`filters`); `fabLabel` becomes the
    `FabLink` aria-label and `fabHref` its `href`; `title` becomes the `<h1>`; `body` passes
    through unmodified.
  - Strict constraints: NO full suites; NO E2E; only this named file; max test executions: 2.
    Never touch `apps/*/data/**`; no raw HTML/inline style/raw colors; no `next/navigation`
    in `packages/ui`; frozen surfaces unchanged.

[DEFINITION OF DONE]
  - [ ] `ListShell` and its exported type exist with the exact spec signature.
  - [ ] The frozen surface contract in `SPEC-ui-list-shell.md` is reproduced: the test-asserted selectors verbatim, the preserved-but-not-asserted labels unchanged.
  - [ ] No files outside the allowed scope were modified; no new CSS class or raw value.
  - [ ] `npm run typecheck -w packages/ui` passes with zero errors.
  - [ ] `npm run test:unit -w packages/ui -- test/list-shell.test.tsx` passes.

---

### T4 — `ui-editor-chrome` (module `ui-editor-chrome`)

[TASK OBJECTIVE]
  Add the `EditorChrome` editor-screen chrome to `@life/ui` exactly as
  `docs/specs/SPEC-ui-editor-chrome.md` declares, with its prop types and a unit suite.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/ui/src/components/editor-chrome.tsx` (new),
    `packages/ui/test/editor-chrome.test.tsx` (new).
  - **`packages/ui/src/index.ts` is NOT this task's to edit.** This task runs in parallel
    with T1–T3; the four block exports are appended once, serialized, by the Tech Lead at
    the Blocks checkpoint. The test imports the chrome directly from
    `../src/components/editor-chrome`.
  - Reference files (read-only): `docs/specs/SPEC-ui-editor-chrome.md`,
    `docs/specs/SPEC-ui-blocks.md`, `packages/ui/src/components/editor-screen.tsx`,
    `editor-toolbar.tsx`, `editor-stack.tsx`, `tag-picker.tsx`, `stack.tsx`,
    `packages/ui/test/editor-toolbar.test.tsx` (harness pattern), `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above; `packages/ui/src/styles/*.css`;
    any token file; the e2e selector surface files; `apps/**` (except reads).

[IMPLEMENTATION REQUIREMENTS]
  - Export, verbatim from the spec: `interface EditorChromeTagPicker { tags: readonly
    TagOption[]; selectedIds: readonly number[]; onToggle: (id: number) => void;
    label?: string }`, `interface EditorChromeProps { back: { label: string; onBack: () =>
    void }; title?: ReactNode; status?: ReactNode; actions?: ReactNode; banner?: ReactNode;
    tagPicker?: EditorChromeTagPicker; gap?: StackGap; children: ReactNode }` and
    `function EditorChrome(props: EditorChromeProps): JSX.Element`.
  - Render the spec's structure: `EditorScreen` → `EditorToolbar back title status actions`
    → `{banner}` → `EditorStack gap` → `{children}` → conditional `TagPicker`.
  - `back` is a real button, never a link; `title` wins over `status` inside
    `EditorToolbar`; `tagPicker` renders only when provided (never inspect `tags.length`);
    `gap` defaults to `"lg"`; `banner` renders between toolbar and stack.
  - Presentational only: no autosave/flush/debounce/conflict state, no routing, no
    `next/navigation`, no fetch, no domain types or baked domain copy; no new CSS class; no
    raw values.
  - Primitive reuse plan (Contract 1), element → owner:

    | Rendered element | Composed from |
    |---|---|
    | full-screen frame | `EditorScreen` block (`.ui-editor-screen`) |
    | toolbar | `EditorToolbar` block (`.ui-editor-toolbar`); `back` renders `IconButton` atom + lucide `ChevronLeft`; `title` slot; `status` slot (app supplies `StatusText`); `actions` slot (app supplies `IconButton`) |
    | banner | app-supplied `banner` slot (app supplies `AlertBanner`), placed between toolbar and body |
    | body stack | `EditorStack` block (gap `sm`/`md`/`lg`) |
    | fields | app-supplied `children` (app supplies `Textarea`/`Input`/`PillGroup`) |
    | tag wiring | `TagPicker` block, rendered only when `tagPicker` is provided |

[VERIFICATION & TESTING RULES]
  - Permitted test commands:
    `npm run typecheck -w packages/ui` and
    `npm run test:unit -w packages/ui -- test/editor-chrome.test.tsx`.
  - Required cases in `test/editor-chrome.test.tsx` (per the spec's Testing Strategy):
    toolbar slots render (back label, title as `<h1>`, status, actions); `title` wins over
    `status`; `banner` renders between toolbar and stack; `children` render inside
    `EditorStack`; `tagPicker` renders when provided and is absent when omitted;
    `onToggle` passes through to `TagPicker`; the back control is a button, not a link.
  - Strict constraints: NO full suites; NO E2E; only this named file; max test executions: 2.
    Never touch `apps/*/data/**`; no raw HTML/inline style/raw colors; no `next/navigation`
    in `packages/ui`; frozen surfaces unchanged.

[DEFINITION OF DONE]
  - [ ] `EditorChrome` and its exported types exist with the exact spec signatures.
  - [ ] The frozen surface contract in `SPEC-ui-editor-chrome.md` is reproduced: the test-asserted selectors verbatim, the preserved-but-not-asserted labels unchanged.
  - [ ] No files outside the allowed scope were modified; no new CSS class or raw value.
  - [ ] `npm run typecheck -w packages/ui` passes with zero errors.
  - [ ] `npm run test:unit -w packages/ui -- test/editor-chrome.test.tsx` passes.

---

### T5 — `app-kit` workspace (module `app-kit`)

[TASK OBJECTIVE]
  Create the `@life/app-kit` workspace with exactly the exports and files
  `docs/specs/SPEC-app-kit.md` declares, and register it in the root workspaces array.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `packages/app-kit/package.json` (new),
    `packages/app-kit/tsconfig.json` (new), `packages/app-kit/tsconfig.test.json` (new),
    `packages/app-kit/src/index.ts` (new), `packages/app-kit/src/types.ts` (new),
    `packages/app-kit/src/filter-href.ts` (new),
    `packages/app-kit/src/parse-tag-id.ts` (new),
    `packages/app-kit/src/preserving-search-box.tsx` (new, `'use client'`),
    `packages/app-kit/src/load-or-not-found.ts` (new),
    `packages/app-kit/src/route-layout.tsx` (new),
    `packages/app-kit/test/filter-href.test.ts` (new),
    `packages/app-kit/test/parse-tag-id.test.ts` (new),
    `packages/app-kit/test/preserving-search-box.test.tsx` (new),
    `packages/app-kit/test/load-or-not-found.test.ts` (new),
    `packages/app-kit/test/route-layout.test.tsx` (new),
    `packages/app-kit/test/stubs/next-navigation.tsx` (new),
    `package.json` (root — add `"packages/app-kit"` to `workspaces`),
    `apps/app/package.json` (add `"@life/app-kit": "*"` to `dependencies`),
    `package-lock.json` (root — written by the workspace install).
  - Reference files (read-only): `docs/specs/SPEC-app-kit.md`,
    `packages/ui/package.json`, `packages/ui/tsconfig.json`,
    `packages/ui/tsconfig.test.json`, `packages/ui/jest` config (in
    `packages/ui/package.json`), `packages/ui/test/stubs/next-link.tsx`,
    `apps/app/app/search-box.tsx`, `apps/app/app/todo-search-box.tsx`,
    `apps/app/app/notes/page.tsx:11-17`, `apps/app/app/todos/page.tsx:25-37`,
    `apps/app/app/notes/[id]/page.tsx:11-19`, `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above; `packages/ui/**`; `apps/**`
    except the one `apps/app/package.json` dependency line above; any data directory; token
    files; the e2e selector surface.

[IMPLEMENTATION REQUIREMENTS]
  - Implement exactly the Public API block of `SPEC-app-kit.md` — no extra public surface:
    `RoutePath`, `QueryParams`, `FilterHrefInput`, `filterHref`, `parseTagId`,
    `isNotFoundStatus`, `LoadOrNotFoundOptions`, `loadOrNotFound<T>`, `routeLayoutMetadata`,
    `RouteLayout`, `PreservingSearchBoxProps`, `PreservingSearchBox`, re-exported from
    `src/index.ts` with the exact `type`/value export split.
  - Semantics exactly as the spec: `filterHref` merges `{...current, ...overrides}`, drops
    `undefined`/`''`, emits `path` alone when no params remain; `parseTagId` is
    `/^\d+$/ → Number`, else `undefined`; `loadOrNotFound` is
    `try { return await load() } catch (e) { if (isNotFound(e)) notFound(); throw e }` with
    default predicate `isNotFoundStatus` (duck-typed `status === 404`, no `ApiError`
    import); `routeLayoutMetadata(manifest)` returns `{ manifest }`; `RouteLayout` renders
    `<>{children}</>`; `PreservingSearchBox` renders `SearchField label placeholder value
    onQueryChange` and on change runs
    `router.replace(filterHref({ path, current: { ...params, q }, overrides: { q: value } }),
    { scroll: false })`.
  - Package facts exactly as the spec: name `@life/app-kit`, `"private": true`, version
    `0.1.0`, `"main": "src/index.ts"`, `"types": "src/index.ts"`,
    `"exports": { ".": "./src/index.ts" }`, scripts `lint`/`typecheck` = `tsc --noEmit`,
    `test`/`test:unit` = `jest`; `dependencies: { "@life/ui": "*" }`; devDependencies and
    jest config mirroring `packages/ui` with
    `moduleNameMapper` `"^next/navigation$": "<rootDir>/test/stubs/next-navigation.tsx"`;
    tsconfigs mirroring `packages/ui`'s pair (`../../tsconfig.base.json`, `jsx: react-jsx`,
    `module: esnext`, `moduleResolution: bundler`, `noEmit`, `isolatedModules`,
    `include: ["src/**/*", "test/**/*"]`; test config flips to `commonjs`/`node`,
    `noEmit: false`).
  - `test/stubs/next-navigation.tsx` exports a `useRouter` stub (`replace`/`push`/
    `refresh` jest-function-shaped) and a `notFound` stub; keep it minimal and typed.
  - Hard exclusions: no `Note`/`Todo`/`List`/`TodoFilters` identifiers in `src/**`; no
    fetch, no API clients, no server actions, no CSS/tokens/inline styles, no
    `SearchField` reimplementation. `next/navigation`/`next` enter only here.
  - The root `package.json` edit is one line: insert `"packages/app-kit"` into the
    `workspaces` array after `"packages/ui"`.
  - Declare the consumer: add `"@life/app-kit": "*"` to `apps/app`'s `dependencies`,
    directly under the existing `"@life/ui": "*"` line.
  - **Link the workspace:** run `npm install` at the repo root after the `workspaces` entry
    exists. Without it no `node_modules/@life/app-kit` symlink is created and T6's
    `npm run typecheck -w @life/app` cannot resolve the import. This is the only install
    run in the plan.

[VERIFICATION & TESTING RULES]
  - Permitted commands: `npm install` (repo root, exactly one run — the workspace link),
    `npm run typecheck -w packages/app-kit` and
    `npm run test:unit -w packages/app-kit -- test/filter-href.test.ts test/parse-tag-id.test.ts test/preserving-search-box.test.tsx test/load-or-not-found.test.ts test/route-layout.test.tsx`.
  - Required cases, per the spec's Testing Strategy: `filter-href.test.ts` (preserve across
    an override; drop `undefined` and `''`; unknown keys preserved; no trailing `?`;
    absolute vs relative `path`; notes/todos call shapes); `parse-tag-id.test.ts` (the
    accepted/rejected matrix); `preserving-search-box.test.tsx` (labelled `searchbox`;
    fake-timer debounce; `router.replace` once with merged href + `{ scroll: false }`; `q`
    dropped when empty; sibling params preserved; a source assertion that the component
    carries no `fetch(` and no visual markup beyond `SearchField`); `load-or-not-found.test.ts`
    (pass-through; 404 → `notFound()` mocked; rethrow others; custom `isNotFound`);
    `route-layout.test.tsx` (metadata shape; `RouteLayout` renders children with no wrapper).
  - Strict constraints: NO full suites; NO E2E; only these named files; max test
    executions: 2. Never touch `apps/*/data/**`; no raw HTML/inline style/raw colors in
    `apps`; no `next/navigation` in `packages/ui`; frozen surfaces unchanged.

[DEFINITION OF DONE]
  - [ ] Every `SPEC-app-kit.md` export exists with the declared signature and no extra public surface.
  - [ ] The workspace mirrors `@life/ui`'s package/tsconfig/jest shape; the stub exists.
  - [ ] `packages/app-kit` is in the root `workspaces` array and `apps/app` declares
        `"@life/app-kit": "*"` in `dependencies`.
  - [ ] `npm install` ran once at the root and `node_modules/@life/app-kit` resolves
        (T6's app typecheck depends on this link).
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w packages/app-kit` passes with zero errors.
  - [ ] The prescribed app-kit test command passes.

---

### T6 — Segment port (module `segment-port`)

[TASK OBJECTIVE]
  Port `apps/app/app/notes/**` and `apps/app/app/todos/**` onto the four blocks and
  `@life/app-kit` so every route/editor file is data + copy + slots only, with the frozen
  e2e surface unchanged.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/notes/page.tsx`,
    `apps/app/app/todos/page.tsx`, `apps/app/app/notes/trash/page.tsx`,
    `apps/app/app/todos/trash/page.tsx`, `apps/app/app/notes/tags/page.tsx`,
    `apps/app/app/todos/tags/page.tsx`, `apps/app/app/todos/lists/page.tsx`,
    `apps/app/app/notes/[id]/page.tsx`, `apps/app/app/todos/[id]/edit/page.tsx`,
    `apps/app/app/notes/layout.tsx`, `apps/app/app/todos/layout.tsx`,
    `apps/app/app/note-editor.tsx`, `apps/app/app/todo-editor.tsx`; delete
    `apps/app/app/search-box.tsx` and `apps/app/app/todo-search-box.tsx`.
  - Reference files (read-only): `apps/app/app/notes/new/page.tsx`,
    `apps/app/app/todos/new/page.tsx`, `apps/app/app/note-list.tsx`,
    `apps/app/app/todo-list.tsx`, `apps/app/app/tag-manager-section.tsx`,
    `apps/app/app/list-manager-section.tsx`, `apps/app/app/actions.ts`,
    `apps/app/app/todo-actions.ts`, `apps/app/lib/api.ts`, `lib/todo-api.ts`,
    `lib/tags-api.ts`, `docs/specs/SPEC-app-kit.md`,
    `docs/specs/SPEC-ui-trash-block.md`, `docs/specs/SPEC-ui-manager-block.md`,
    `docs/specs/SPEC-ui-list-shell.md`, `docs/specs/SPEC-ui-editor-chrome.md`,
    `apps/app/test/e2e/suites/journey.suite.ts`,
    `apps/app/test/e2e/journey.ts`, `apps/app/playwright.config.ts`,
    `apps/app/test/manifests.test.ts`, `docs/lessons/` (recall).
  - Strictly prohibited files: `apps/app/app/actions.ts`, `todo-actions.ts`,
    `lib/api.ts`, `lib/todo-api.ts`, `lib/tags-api.ts`, `middleware.ts`, `lib/auth/**`,
    `lib/todo-groups.ts`, `lib/todo-query.ts`, `lib/inline-tags.ts`,
    `lib/note-compose.ts`, `note-title.ts`; `public/manifest*.json`; any token file; any
    e2e spec/selector; `apps/*/data/**`; `packages/ui/**`; `packages/app-kit/**`; every
    other file. If a block/kit prop gap is found, STOP and route it back upstream (T1–T5)
    — never patch around it here.

[IMPLEMENTATION REQUIREMENTS]
  - **List pages** (`notes/page.tsx`, `todos/page.tsx`): render `<ListShell title=… navTrailing=… search={<PreservingSearchBox …/>} filters=… body=… fabHref fabLabel fabIcon />`
    with the existing element order and current roles/labels; replace the local `filterHref`/
    `todoHref` with `filterHref` from `@life/app-kit`; replace the local `/^\d+$/` tag parse
    with `parseTagId`; keep all fetching, grouping, empty-state decision and copy local.
  - **Trash pages**: render `<TrashBlock title="Trash" backHref=… items=… emptyMessage="Trash is empty." restoreAction=… deleteForeverAction=… deleteForeverMessage=… emptyTrashAction=… emptyTrashMessage=…/>`;
    `items` maps each domain row to `{ id, title, meta, snippet }`; `splitBody` stays local
    for notes; the bound server actions stay local.
  - **Manager pages** (`notes/tags`, `todos/tags`, `todos/lists`): render
    `<ManagerBlock title=… backHref=…><TagManagerSection/></ManagerBlock>` (resp.
    `<ListManagerSection/>`); the section components stay app-owned (fetch + `Card` + panel).
  - **Editors** (`note-editor.tsx`, `todo-editor.tsx`): replace the hand-rolled
    `EditorScreen`/`EditorToolbar`/`EditorStack`/`TagPicker` wiring with `<EditorChrome
    back=… title/status=… actions=… banner=… tagPicker=… gap=…>{fields}</EditorChrome>`;
    keep state, autosave/flush/conflict, `parseInlineTags`, `splitBody`, callbacks, copy and
    routing local; the note editor's `Textarea variant="editor"` moves into the chrome's
    body slot.
  - **Edit-loaders** (`notes/[id]/page.tsx`, `todos/[id]/edit/page.tsx`): replace the inline
    `try/catch (instanceof ApiError && status === 404) notFound()` with
    `loadOrNotFound(() => getNote(id))` / `loadOrNotFound(() => getTodo(id))`.
  - **Layouts** (`notes/layout.tsx`, `todos/layout.tsx`): replace the body with
    `export const metadata = routeLayoutMetadata('/manifest-notes.json' | '/manifest-todos.json')`
    and `export default RouteLayout` from `@life/app-kit`.
  - **Search boxes**: delete `search-box.tsx` / `todo-search-box.tsx`; their consumers use
    `PreservingSearchBox` with the required `path` (`/notes` / `/todos`), the controlled
    current value `q` read from `searchParams`, the existing `label` (`Search notes` /
    `Search todos`) and `params` (notes: `{ tag }`; todos: `{ list, tag, done }`).
  - **Route config preserved**: every touched route file keeps its Next route segment
    config exports unchanged — in particular `export const dynamic = 'force-dynamic'`
    (present on the ported page files) and any `revalidate`/`runtime` export. The port
    rewrites the rendered JSX only; dropping `dynamic` would silently move these
    API/session-backed pages to static rendering.
  - Preserve every frozen, test-asserted selector verbatim: the `Notes`/`Todos` headings,
    `New note`, `Search notes`, the nav `Trash` link, `Back`, `Save`, `Note body`,
    `Delete ${title}`, `Restore ${title}`, `button.trash-delete`, the `errand` filter link,
    and the row links `getByRole('link', { name: <title> })`.
  - Additionally keep unchanged the labels the specs list as preserved-but-not-asserted:
    the `Trash`/`Tags`/`Lists` headings, `New todo`, `Search todos`, the
    `Manage tags`/`Manage lists`/`Notes`/`Todos` nav links, `Save todo`/`Add todo`,
    `Empty Trash`, and the `Edit Todo`/`New Todo` headings. No new or changed
    role/text/aria-label/class.
  - No raw HTML, no inline style, no raw colors, no new CSS class in `apps/**`; `form`
    remains the only structural exemption. No `next/navigation` in `packages/ui`.
  - `apps/app/test/manifests.test.ts` imports both route layouts' `metadata`, so it is the
    one unit suite this port affects — it is run (§3's second rung). Proving the port with
    E2E alone would skip the cheapest check on the layout rewrite.

[VERIFICATION & TESTING RULES]
  - Permitted test commands: `npm run typecheck -w @life/app`,
    `npm run test:unit -w @life/app -- test/manifests.test.ts`, and, exactly once, the single
    targeted journey E2E:
    `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "create → edit → tag → search → reload keeps session → trash → restore → permanent delete"`.
    Expected: 1 passed.
  - Strict constraints: NO full suites, NO bare `test:e2e`, no other E2E spec, no second E2E
    run (one targeted run, at most one re-run after a fix; max test executions: 2). Never
    touch `apps/*/data/**`; no raw HTML/inline style/raw colors in `apps`; no
    `next/navigation` in `packages/ui`; frozen surfaces unchanged. The e2e spec files and
    every selector are read-only.
  - The E2E is justified: core end-to-end routes are restructured (shell, editor, trash,
    manager), so the journey must re-prove the rendered surface; it is run once, at the end.

[DEFINITION OF DONE]
  - [ ] Every route/editor file is data + copy + slots only (no page-shell JSX, no local
        href builder, no local tag parse, no inline load-or-`notFound()`).
  - [ ] `search-box.tsx` / `todo-search-box.tsx` are deleted; consumers use `PreservingSearchBox`.
  - [ ] Every frozen e2e selector renders byte-identically; token values unchanged.
  - [ ] Every ported route file still exports its original `dynamic` / `revalidate` route
        config (no route moved to static rendering).
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] `npm run test:unit -w @life/app -- test/manifests.test.ts` passes.
  - [ ] The single targeted journey E2E passes (1/1).

## Dependency order and parallelization

```
T1 (trash-block)   ┐
T2 (manager-block) ├─ all depend only on ui-blocks/ui-atoms; run in parallel
T3 (list-shell)    │
T4 (editor-chrome) │
T5 (app-kit)       ┘  depends only on @life/ui's SearchField
        └──────────────▶ T6 (segment-port) ──▶ Verification gate
```

- T1, T2, T3, T4 and T5 have no dependency on each other and may run in parallel subagents.
- T6 depends on **all** of T1–T5 (it consumes every block and every kit export) and is the
  only task touching `apps/app`; it runs after the Block and Kit checkpoints are green.
- The Verification gate is last, after T6.

## Deviations / risks

1. **Contract 1 domain-grep vs the frozen e2e hook classes.** `SPEC-ui-trash-block.md`
   explicitly requires the frozen hook classes `trash-restore` / `trash-delete` /
   `trash-empty` to ride on the composed atoms, so `trash-block.tsx` will contain the
   string `trash`. The AGENTS.md mechanical grep `grep -riE "note|trash|tag-chip"
   packages/ui/src` currently returns only the documented CSS mapping-table comments
   (`styles/blocks.css`, `styles/atoms.css`) plus `page-actions`' `.trash-actions` comment;
   after T1 it will also match the block's frozen `className` literals and `Empty Trash`
   default. Those are the block's e2e hooks, not styling rules or domain copy — the same
   documented exemption class. The gate in *Verification gate* therefore checks the four
   block files for **domain identifiers** separately from the frozen-hook exception, and
   the exact grep result is recorded in the five-lane report. No AGENTS.md text is changed.
2. **`app-kit` is the first new workspace since `@life/ui`.** Risk: root workspace scripts
   (`--workspaces --if-present`) silently skip it if the array entry is mistyped. Mitigation:
   T5's definition of done includes `npm run typecheck -w packages/app-kit` and the array
   edit is a single line.
3. **`loadOrNotFound` needs `notFound()` at Next's control-flow boundary.** It is server-only;
   a client import is a misuse. Mitigation: documented in the spec and used only from the two
   server page files in T6.
4. **The note editor changes DOM nesting.** The `Textarea variant="editor"` moves from a
   direct `EditorScreen` child into `EditorStack`. Its `flex: 1` preserves full height; the
   frozen selector (`getByLabel('Note body')`) and `EditorStack` gap (`lg`) reproduce the
   current spacing. The targeted E2E re-proves the editor flow.
5. **Route file count.** T6 touches ~13 files; it is a single cohesion unit (one port) and
   cannot be split without leaving a half-ported segment that typechecks but renders two
   different shells. Kept as one T6 but scoped strictly to the listed files.
6. **Contract 2 not engaged.** No backend service or cache layer is touched, so no
   `## Cache Rules` section applies to this change.

## Open Questions

None. The intent, the capability map and the five owning specs fix every boundary; the
prop/export contracts are quoted verbatim in the tasks above.

## Verification gate

Run at the end of T6, before the five-lane gate; every command resolves from the repo
Project Profile. All greps exclude `apps/app/.next/**` build output.

1. **Contract 1 mechanical checks (from `AGENTS.md`):**
   - `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
     → zero hits outside the Contract 1 exemptions (`form`, fragments, non-rendering plumbing).
   - `grep -rn "next/link" apps --include='*.tsx'` → zero hits.
   - `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → hits
     only inside `packages/ui/src/styles/tokens.css`.
   - `grep -riE "note|trash|tag-chip" packages/ui/src` (AGENTS.md's exact pattern — `todo`
     is deliberately NOT added: it matches pre-existing source such as `list-manager.tsx`'s
     `TodoListOption`, `due-date-pill.tsx` and `format-date.ts`) → only the documented CSS
     mapping-table comments and the frozen e2e hook literals/attribute strings recorded in
     Deviations 1; zero domain **identifiers** in the four new block files.
   - `grep -rnE "Note|Todo|List\b" packages/app-kit/src` → zero hits.
   - No `.tsx` in `apps/*` re-implements a `packages/ui` component's markup.
2. **Contract 2 mechanical checks:** not applicable — no backend service is touched (no
   `getThrough` flow, no cache write, no `## Cache Rules` surface changes). Recorded as
   "not engaged" in the five-lane report.
3. **Frozen surfaces:** `git diff` shows zero changes to the e2e selector surface (roles,
   visible text, aria-labels, `button.trash-delete`) and zero changes to token values
   (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`) or PWA constants.
4. **Single targeted journey E2E** (the one E2E run for this change):
   `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "create → edit → tag → search → reload keeps session → trash → restore → permanent delete"`
   → 1 passed.
5. **Five-lane close:** the change closes with the `five-lane-verification` skill: lane 1
   correctness/domain, lane 2 code quality, lane 3 security, lane 4 QA (runs the suite
   gate), lane 5 plan conformance (diff vs this plan and the five specs). The gate must
   return **N/N PASS**; any lane FAIL → fix its blockers → re-run only the failed lanes →
   repeat until N/N PASS. No partial verdict is treated as done, committed, or merged.
   Merge to `master` still requires the user's explicit request.
