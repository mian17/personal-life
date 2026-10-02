# 0018 — One row type per list: reuse the shared component and its variant/mode

**Summary:** When a list already renders one row through a shared component/variant (e.g. `ListItem variant="todo"` + its `done` mode), every row in that list reuses it — never add a sibling component or a second row style; a "done" mode must be one treatment at every scale.

- **Date:** 2026-10-03
- **Source:** user feedback while reviewing the `/todos` Done section for repeating tasks

## Feedback

> "why don't you reuse todo variant"

> "done tasks, should still show tickbox, so user can undo"

> "what the actual fuck, we agreed to muted the done tasks in the done list, and now you keep on creating new COMPOENENTS. WHAT THE ACTUAL FUCK IS THIS."

> "notice the fucking done tasks: [screenshot] , they have the fucking 2 types, why the fuck does this happen, list and matrix supposed to reuse the same fucking component"

> "notice the fucking variant of list item, list item has todo and plan variant. todo variant has mode, normal or dense, right fucking now style and reuse the new mode, which is done, done for normal and done for dense."

> "Done size default, done size dense, must same styling" / "I misspoke; ignore plan"

## What it corrected

For a repeating todo's completed occurrence in the Done section I built a bespoke
`CompletionItem` — a plain `ListItem` with no strike and no toggle. The result was exactly
what the screenshot showed: **two row types in one list**, plain white rows next to the
muted/struck `TodoItem` rows that every other Done row uses. I had also misread an earlier
"not reusing strike" note as approving the plain row, when it was pointing out the missing
strike.

The fix was not a new component at all: `groupTodos` now derives a done `Todo` (the live row
spread with `done: true` and the satisfied `occurrence`) and every Done row renders through
the same `TodoItem` / `ListItem variant="todo"`. Two further corrections rode along:

1. A new presentation is an **upstream variant/mode change**, not an app-level sibling
   component (Contract 1: a fit problem is fixed in `packages/ui`, never worked around).
2. The `done` mode must be **one shared treatment at every scale**. The signal due date was
   still red on a dense done row, so I muted it in the shared `--done` rule
   (`.ui-list-item--done .ui-due-date`), keyed off `--done` and never a size.

## The lesson

- **A list has one row type.** Every row in a list is the same shared component in the same
  variant; when an item needs an existing state (done/undone), pass that state — never add a
  second component or a second visual style beside it. Two row types in one list is the bug,
  visible at a glance.
- **Reuse before you build.** Check the shared component's variants/modes first. If the
  presentation is missing, extend the variant **upstream** (new mode/prop + tests + spec) and
  consume it; a per-app `CompletionItem`-style sibling is a fork.
- **A state must look the same at every scale.** A `done` mode keys off the state class, not
  the size class, so default and dense share one treatment (including secondary text like the
  signal date). Same state, one style.
- **Muted means the whole row.** "Done is muted" covers the title, the leading control, and
  the meta/date — not just the title.

## Applies to

Any list rendering in `apps/*` (the todo List, the matrix quadrants), and any future shared
row/block: pick the existing variant/mode, extend it upstream when it is missing, and keep one
row type per surface.
