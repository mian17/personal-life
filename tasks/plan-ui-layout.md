# Implementation Plan: ui-layout (Stack + Section, and /todos parity)

Branch: `feature/todo-ecosystem` (follow-up to the unmerged chapter; `master` stays
untouched). Intent: `docs/intent/todos-presentation.md`. Spec: `docs/specs/SPEC-ui-layout.md`.
Ledger: `tasks/todo-ui-layout.md`.

## Overview

Two upstream primitives (`Stack`, `Section`) plus the `/todos` rewiring that consumes
them — the presentation-parity fix that started from "`/todos` has no margin at all."

## Architecture Decisions

- L1: `Stack` is `display: grid; gap: var(--space-*)` — a single-column stack that
  works regardless of children's own `display`, which is exactly what the composer
  needed and no page previously required.
- L2: `Section` owns a real heading (h2/h3) + a `Stack` body; it replaces the
  `PillGroup`-as-heading misuse rather than adding app CSS (Contract 1 Rule 3).
- L3: No new tokens. Gaps map onto the existing spacing scale (`--space-0-5`,
  `--space-1`, `--space-2`); token *values* are frozen.
- L4: `/notes` untouched; the frozen e2e surface untouched (no navigation change);
  this is presentation only, so no new e2e assertions.

## Task List

### Phase 1 — Upstream primitives
- [ ] T1: `Stack` + `Section` in `packages/ui` (+ spec/map updates + tests)

### Checkpoint: Primitives
- [ ] `@life/ui` suite green; Contract 1 mechanical checks clean

### Phase 2 — Consume from /todos
- [ ] T2: rewire `/todos` components onto `Stack`/`Section`

### Checkpoint: Consumption
- [ ] app suite + typecheck + build green; no bare stacking divs; PillGroup-as-heading gone

### Phase 3 — Close
- [ ] T3: plan-validation + five-lane gate re-run on the final state; user eyeballs `/todos` in dev

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| New primitives change `/notes` rendering | Med | `/notes` untouched; `PageShell`/`List`/`SearchField` reused, not modified |
| `Section` heading breaks frozen e2e text assertions | Med | labels reuse the current group text ("Overdue"…); no assertion changes; user runs e2e |
| Scope creep into composer redesign | Low | inline composer stays (intent out-of-scope line) |
| Token values drift | Low | no token changes; `tokens.test.ts` untouched |

## Open Questions

None — the interview closed capture model, manager-panel placement, and scope.
