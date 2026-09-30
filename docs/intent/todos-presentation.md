# Confirmed Intent: todos-presentation (upstream layout primitives)

Confirmed by the user 2026-09-30 via interview-me (explicit "yes").

## Statement of intent

- Outcome: `/todos` presentation rebuilt as a true sibling of `/notes` by **adding
  the missing upstream primitives** to `@life/ui` — a vertical-rhythm **stack**
  container (the "no margin/spacing" fix) and a **section** primitive with a real
  heading (replacing the current `PillGroup`-as-heading misuse). Grouped todos, the
  inline composer, and the two manager panels all get the section treatment.
- User: the single user, on the phone, via `npm run dev`.
- Why now: the todo slice is feature-complete and gate-approved but shipped with a
  presentation defect rooted in a primitive the package never had; caught in the
  user's local pass before deploy. `/todos` looked "horrendous, no margin at all."
- Success: `/todos` breathes like `/notes` — real vertical rhythm, consistent
  list/section shapes, headings that read as headings — with zero app-side CSS.
- Constraint: upstream-first per AGENTS.md Contract 1 Rule 3 (spec + MAP + tests,
  then consume); tokens only; no raw HTML/`next/link`; frozen e2e selector surface
  untouched (no navigation change); work stays on `feature/todo-ecosystem`; the
  protocol's plan-validation gate runs before code and the feature closes through
  the five-lane gate on the final state.
- Out of scope: capture-model change (no FAB, no `/todos/new`); collapsing or
  relocating the manager panels; any `/notes` redesign; new token *values*; adding
  or changing e2e assertions.

## Root cause (recorded for the fix's rationale)

`@life/ui` has **no vertical-rhythm/"stack" container** and its field primitives
(`Input`, `Textarea`, `Button`, `IconButton`) deliberately do not self-space. The
notes page never needed one — every section there is a self-spacing block
(`PageShell`, `PageTitle`, `SearchField`, `TagFilterNav`, `List`, `Card`). `/todos`
is the first page that stacks bare primitives directly (the composer) and the first
that needs group headings (the todo groups), so it exposed the gap:

- `apps/app/app/todo-composer.tsx` — a bare `<div role="group">` stacks
  Input/Textarea/Input/IconButton/PillGroup/TagPicker/Button with no container gap
  → controls touch (the visible "no margin").
- `apps/app/app/todo-list.tsx` — each group's `<List>` is wrapped in `PillGroup`
  (a filter-pill flex row: `display:flex; flex-wrap:wrap` + `border-top`) to get a
  label → the heading never renders as a heading and the grid list layout is wrong.

The fix belongs upstream (Contract 1 Rule 3) — a stack container and a section
primitive — not in app CSS.
