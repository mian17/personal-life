# 0020 — The quadrant colour-code is a rendered contract on the list rows

**Summary:** The checkbox tint that mirrors a task's matrix quadrant must show on the `/todos` Overdue/Today row checkboxes (colour = urgent & important → danger, urgent → amber, important → accent, neither → none); a visual rule is only verified at the rendered level (class emitted + cascade winner), never by a prop assertion.

- **Date:** 2026-10-03
- **Source:** user feedback on the `/todos` grouped list after the Done-reshape work

## Feedback

> "bug, checkbox not color coded by box its belong in matrix, this was bug fix many commits ago, write regression tests"

> "mean this only affected task rows in today lists overdue"

## What it corrected

The phrase "by box its belong in matrix" is **the task's Eisenhower quadrant**, and the
correction pins the surface: the tint belongs on the **`/todos` Overdue + Today rows**, not on
the matrix view. Reading it as "the matrix page's checkboxes" pointed the fix at the wrong
surface.

The reason it could regress unnoticed: the only coverage was a **prop assertion** — the matrix
route test checked `TodoItem`'s `tone` prop per quadrant
(`apps/app/test/routes-matrix.test.tsx`). A prop reaching the component is not the same as a
colour reaching the pixels; if the class stops being emitted, or the cascade stops letting the
tint win, every test still passes and the checkbox renders plain.

(History: the colour-coded lens shipped as a matrix feature (`e6b3d43`); the `/todos` list
rows never carried the tone. The user's memory of "a bug fix many commits ago" is the matrix
lens — the list-row tint is the missing half.)

## The lesson

- **Colour/tone is a rendered contract, not a prop shape.** Assert that the rendered row
  carries the tone class *and* that the effective CSS tints the control — the winner of the
  cascade, not merely that some declaration exists somewhere. A prop-only test cannot catch a
  visual regression.
- **A quadrant cue belongs on the open list rows.** The `/todos` Overdue/Today rows are the
  working list; their leading checkbox shows the task's matrix box at a glance. Do not scope
  the cue to the matrix lens only.
- **One owner for the quadrant→tone mapping** (`apps/app/lib/matrix.ts`: `quadrantOf` +
  `QUADRANTS[].rowTone`). The list reuses it (lesson 0016); no second table.
- **"Fixes many commits ago" is a provenance claim — check it.** `git log -S` on the surface in
  question before building; here it showed the tint was only ever matrix, so the list behaviour
  had to be built, not merely restored.

## Applies to

Every tone/colour rule on a shared row (`ListItem`/`TodoItem`) and every "the colour is wrong"
report in the todo surfaces: pin the exact surface the user names, then prove the fix with a
rendered/test-level assertion and a fallback case (quadrant IV, done rows) that must stay
untinted/muted.
