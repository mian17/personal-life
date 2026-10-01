# Confirmed Intent: todo-row-block (one ListItem todo flavor)

Confirmed by the user 2026-10-02 via interview-me (explicit "yes").

## Statement of intent

- Outcome: `ListItem` gains a **todo flavor** — `variant="todo"` plus
  `size?: 'default' | 'dense'` (the current `dense` boolean becomes this `size`).
  The todo row is a leading square checkbox + title + due date, rendered from the
  same primitive in both views: `size="default"` for the List tab, `size="dense"`
  for the Eisenhower matrix.
- User: me, moving between the List tab and the Matrix lens of the same todos.
- Why now: the dense matrix row was built as a one-off shape while the List row
  kept the old trailing-circle layout — two views of the same todo that do not
  match. `dense` belongs to the **todo** row, not to the shared `ListItem`.
- Success: List and Matrix render the same todo row; the List row keeps its extras
  (list name, note snippet, trash delete); the Matrix keeps today's exact dense
  look. The notes row and every other `ListItem` consumer are untouched.
- Constraint: upstream in `@life/ui` (Contract 1) — primitive + tokens only, no raw
  markup in `apps/*`; `size` is meaningful on `variant="todo"` only; opt-in, so a
  `ListItem` that passes neither renders exactly as today; the frozen e2e selector
  surface (roles, visible labels, `button.trash-delete`) stays intact.
- Out of scope: the notes row and every other `ListItem` consumer; any matrix layout
  change beyond the dense size; backend/data changes.

## Locked decisions (recorded here per the autonomy rule)

| # | Decision | Rationale |
|---|---|---|
| T1 | One `variant="todo"`; `size` replaces the `dense` boolean. | `dense` is a property of the todo row, not the generic list row; the variant carries the todo anatomy. |
| T2 | Both sizes use a **leading, borderless (ghost) square `Checkbox`**, top-aligned with the title. | It is a glyph, not a button; a bordered box around a leading checkbox reads wrong. Matches the shipped matrix row. |
| T3 | `size="default"` (List): base type, ~20px checkbox, base padding, **2-line** title clamp. `size="dense"` (Matrix): today's 0.7rem type, 12px checkbox, compact padding, 2-line clamp. | "Same row, just bigger" — the matrix look is the dense scale, not a separate anatomy. |
| T4 | The List todo row adopts the matrix **signal** due-date colouring (overdue `--danger`, future `--danger-soft`). | Revises lesson 0003's "list dates stay muted" **for todos only**; the two views of one todo should agree. |
| T5 | `Checkbox` is sized by a `--checkbox-size` custom property (atom default 0.75rem; todo row 1.25rem; dense 0.75rem). | The atom's own recorded upgrade path ("promote to a --checkbox-size var if a second size is ever needed"). |

The old `TodoItem mode="default" | "matrix"` prop becomes `size?: 'default' | 'dense'`
(matrix → dense). Extras (list name, note snippet, trash delete) render on the
`default` size only.
