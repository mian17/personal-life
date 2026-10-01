# 0014 — A lens keeps its page's chrome; a toggle needs a visible label

- **Date:** 2026-10-01
- **Source:** user feedback on the shipped Eisenhower matrix lens

## Feedback

> "ok i'm thinking of improving it now, i expect there should be a divider between the
> boxes, just inner divider. Also i wouldn't know if a task is important, in the add todo,
> there is only a toggle, can you make it clear like the other button that this is an
> important toggle? Also when switching to Matrix, the toolbar at the top must be still
> there. I think you should save as lesson learned, the missing toolbar, and missing
> information toggle"

## What it corrected

Two surfaces shipped from a validated chapter and still got the experience wrong, from the
same root cause — a new surface was built as its own minimal composition instead of as a
*view of the existing page*:

1. **The matrix lens dropped the page's chrome.** `apps/app/app/todos/matrix/page.tsx` passed
   no `navTrailing` (and no search/filters), so switching to Matrix removed the top toolbar —
   the persistent identity and navigation of the app (`/todos/tags`, `/todos/lists`,
   `/todos/trash`, Settings gear). It was not an accident: `SPEC-matrix-ui.md` *recorded* the
   omission as "`navTrailing` is omitted here (the List tab is the way back to the full
   shell) — a recorded decision, not an oversight", and `routes-matrix.test.tsx` asserted
   `navTrailing` was `undefined`. That is the lesson-0012 failure shape again: a self-consistent
   local rationalization that passes its own validation while breaking the cross-surface
   invariant (the toolbar is there, always).
2. **The importance control had an accessible name but no visible label.** The editor's
   `Switch` was rendered aria-only (`<Switch label="Important" …>`); a sighted user saw a bare
   toggle beside `Due` and `List`, which *do* carry visible labels through `PillGroup`. The
   field says nothing about what it toggles unless you already know.

## The lesson

- **A new view/lens of an existing page inherits that page's chrome by default.** Nav,
  title, tabs, search, filters are the *shell*; a lens omits one only when the design
  deliberately says so — and "deliberately" means the human asked, not that a spec wrote a
  local justification. A spec sentence that explains why a standing invariant is fine to
  bend is a flag (0012), not a decision. Removing the top toolbar makes a route stop reading
  as the same app, which directly undercuts the per-route PWA identity (0005) and the
  consistency goal of the shared-UI contract (0006).
- **An accessible name is not a visible label.** `aria-label` makes a control *announceable*;
  it does not make it *understandable* to a sighted user. When sibling fields carry visible
  copy (`Due`, `List`), a new control must match that affordance — the toggle needs visible
  text ("like the other button"), not just `aria-label`.
- **Test the chrome, not just the body.** The matrix route's tests pinned quadrants and the
  server gate but also *pinned the absence* of `navTrailing` — a test can freeze a defect in
  place. When a page-shaped surface is added, assert the shell it must carry, not only its
  unique content.

## Applies to

Every new view/lens, tab, or variant of an existing page (`ListShell` consumers), and every
new control added to an existing form — visible-label parity with sibling fields, and
shell-chrome parity with the parent route. Also: when a spec rationalizes dropping a shared
surface, stop and confirm with the human before shipping (0012's governing-decisions check).
