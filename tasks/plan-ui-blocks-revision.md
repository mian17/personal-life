# Implementation Plan: Stack + Section (ui-blocks revision → /todos parity)

Note: the revision spec / this plan / the ledger use `-ui-blocks-revision` filenames.
The module id is `ui-blocks` (existing) — no `ui-layout` module exists.

Branch: `feature/todo-ecosystem` (follow-up to the unmerged chapter; `master` stays
untouched). Intent: `docs/intent/todos-presentation.md`. Revision spec:
`docs/specs/SPEC-ui-blocks-revision.md` (prop contracts owned by `docs/specs/SPEC-ui-blocks.md`).
Ledger: `tasks/todo-ui-blocks-revision.md`.

## Overview

Two upstream primitives added to `ui-blocks` (`Stack`, `Section`), then consumed from
`/todos` — the presentation-parity fix that started from "`/todos` has no margin at
all." Module id is the existing `ui-blocks`; no new module is invented.

## Architecture Decisions

- L1: `Stack` is `display: grid; gap: var(--space-*)` — stacks children regardless of
  their own `display`, which is what the composer needed and no page previously
  required.
- L2: `Section` owns a real heading (h2/h3) + a `Stack` body; it replaces the
  `PillGroup`-as-heading misuse rather than adding app CSS (Contract 1 Rule 3).
- L3: No new tokens; gaps map onto the existing spacing scale. Token values frozen.
- L4: `/notes` untouched, including the shared `tag-manager-section.tsx` (excluded
  from the blast radius). Frozen e2e surface untouched; presentation only.
- L5: `Stack` and `Section` are separate tasks (each a bounded concern per §5).

## Task List

### Phase 1 — Upstream primitives (two bounded tasks)
- [ ] T1: `Stack` primitive (+ `StackGap` type, tests, spec/map)
- [ ] T2: `Section` primitive (tests, spec/map)

### Checkpoint: Primitives
- [ ] `@life/ui` named suites green; Contract 1 mechanical checks clean

### Phase 2 — Consume from /todos
- [ ] T3: rewire the four todo components onto `Stack`/`Section`

### Checkpoint: Consumption
- [ ] app suite + typecheck + build green; no bare stacking divs; PillGroup-as-heading gone

### Phase 3 — Close
- [ ] T4: five-lane gate re-run on the final state; user eyeballs `/todos` in dev

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| New primitives change `/notes` rendering | Med | `/notes` untouched; `tag-manager-section.tsx` (shared) excluded from scope |
| `Section` headings collide with frozen e2e `getByRole` queries | Low | group labels ("Overdue"…) do not collide with the page headings (`Notes`/`Todos`); the added heading roles are recorded in the revision spec; user runs e2e |
| Scope creep into composer redesign | Low | inline composer stays; no actions row invented |
| Token values drift | Low | no token changes; `tokens.test.ts` untouched |

## Open Questions

None — the interview closed capture model, manager-panel placement, and scope. The
plan-validation gate (§6) is in progress; round 1 closed module id, the shared-file
handling, and command scoping, and this revision is being re-validated.
