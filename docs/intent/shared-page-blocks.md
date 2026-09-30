# Intent: shared page blocks for the app ecosystem

Confirmed 2026-10-01 via interview. Vision doc for how the notes and todos route segments
share UI; the spec and plan follow from `docs/specs/`.

## Outcome

Every piece of UI and page-level behavior that `apps/app/app/notes/**` and
`apps/app/app/todos/**` share moves into shared packages as **whole-page blocks** that own
a page's structure *and* its spacing (margin/padding), parameterized by data + copy. Each
route file shrinks to the lines that pass its own data and labels. The blocks become the
standard that every current and future app composes from.

## User

Me — daily, single-user usage. The repo runs the "each route is its own app" direction: the
routes are installed as separate PWAs on my phone, so two segments with the same structure
but different spacing read as two different apps.

## Why now

The two segments grew in parallel and now duplicate the same pages:

| Duplicated pair | Evidence |
|---|---|
| `notes/trash` ≡ `todos/trash` | `page.tsx:1-92` both sides, ~95% identical JSX |
| `notes/tags` ≡ `todos/tags` | byte-identical except one `href` |
| `todos/lists` | same manager template again |
| list-page shell | `notes/page.tsx:42-72` vs `todos/page.tsx:82-143` |
| search boxes | `search-box.tsx` vs `todo-search-box.tsx` — params only |
| tag-id parsing | `notes/page.tsx:25` ≡ `todos/page.tsx:45` |
| filter href | `filterHref` vs `todoHref` — same `URLSearchParams` shape |
| editor chrome | `note-editor.tsx:365-374` ≡ `todo-editor.tsx:74-83` |

The inventory found **no duplicated primitives** — Contract 1 already forced both segments
onto `@life/ui` (zero bare elements, zero inline styles, zero raw colors in `apps/app`).
The duplication that survived is *page-shaped*, a layer the primitive contract does not
reach.

## Success

- Both segments contain zero duplicated page templates and zero duplicated page behavior.
- The same structure and the same spacing appear wherever the same UI appears.
- A third segment lands by composing blocks, not by copying a route file.
- Frozen surfaces unchanged: e2e selector surface (roles, visible text, aria-labels,
  `button.trash-delete`) and token values.
- Typecheck + unit tests green; the existing journey e2e unchanged.

## Scope

- **In — UI templates + page behavior:** trash page, manager page (tags/lists), list-page
  shell, param-aware search box, filter-href/tag-id helpers, editor chrome, route layout
  metadata.
- **Out — data layer:** the three `call<T>` API clients and the
  `delete/restore/deleteForever/emptyTrash` server-action quartet stay in `apps/app`.
  Folding them in widens the blast radius into server actions and every fetch path.

## Target packages

- **Visual + page blocks → `@life/ui`** — spec-first per Contract 1 Rule 3: update
  `docs/specs/SPEC-ui-*.md` (and `MAP-ui-primitives.md` for a new component) in the same
  change as the implementation.
- **Non-visual shared behavior → a new package** (proposed `@life/app-kit`) — filter-href
  builder, tag-id parsing, param-preserving search-box logic, shared types.

## Constraint

`@life/ui` remains the single owner of the visual language. Spacing comes from tokens only
— no raw values, no new app stylesheet, no inline styles; `@life/ui/styles.css` is imported
exactly once in the root layout.
