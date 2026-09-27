# Implementation Plan: todo-ecosystem

Branch: `feature/todo-ecosystem` (chapter work never touches `master` until the
user's explicit merge request). Intent: `docs/intent/todo-ecosystem.md`. Map +
specs: `docs/specs/MAP-todo-ecosystem.md`, `SPEC-{service-kernel,tags-service,
tags-extraction,todo-service,todo-ui}.md`. Ledger: `tasks/todo-todo-ecosystem.md`.

## Overview

Extract tags into an ecosystem registry (Approach 2 — global taxonomy + local
references), build the standalone todo service and `/todos` UI, move `/` → `/notes`,
and give every service one health dialect. Contracts first (the orchestrator seam).

## Architecture Decisions

- MAP M1–M5 and intent I1–I6 are the binding decisions (esp. M1 = Approach 2,
  per-service key custody M3, BFF composition M4).
- P1: Extract `@life/cache` + `likeMatch` into shared packages **first** and refactor
  note-service onto them (AGENTS.md §9 no-fork rule) — note-service's green suites
  are the regression baseline for everything after.
- P2: Health retrofit lands early (T2) so both new services copy a working pattern
  instead of inventing one.
- P3: Build order follows the map: kernel → registry → consumers → UI. The map's
  `tags-extraction ∥ todo-service` is a dependency fact; execution stays sequential
  under tech-lead review/commit discipline (AGENTS.md §1).
- P4: The tag migration ships with tests but is **human-run** at deploy (hard line);
  its checklist lives in SPEC-tags-extraction + the script header.
- P5: UI is spec-first upstream: any new `@life/ui` primitive (TagPicker/TagManager,
  due-date pill) lands in `packages/ui` + `SPEC-ui-*` **before** apps consume it.
- P6: Vertically sliced per the planning skill where it fits (e.g. T3 is one
  service's full path: schema → API → cache → health → tests), tasks S–M sized.

## Task List

### Phase 1 — Foundation (service-kernel)
- [ ] T1: `@life/cache` extraction + `likeMatch` shared + note-service refactor
- [ ] T2: health dialect retrofit (note-service, idp, compose healthchecks)

### Checkpoint: Foundation
- [ ] note-service suites unchanged-green; health tests green; `npm run typecheck` clean

### Phase 2 — Registry (tags-service)
- [ ] T3: `apps/tags-service` — registry API + key custody + cache + health
- [ ] T4: `import-tags` migration script + tests (human-run later)

### Checkpoint: Registry
- [ ] Registry suites green incl. the seven migration cases

### Phase 3 — Consumers
- [ ] T5: note-service TagRef conversion (association-only, prune, `{tagId,count}`)
- [ ] T6: `apps/todo-service` — todo/list domain + cache + health

### Checkpoint: Consumers
- [ ] Both domains speak TagRef; encryption at rest proven for todo content

### Phase 4 — UI
- [ ] T7: `@life/ui` upstream additions (TagPicker/TagManager, due-date pill) + spec updates
- [ ] T8: `apps/app` — `/notes` move + redirect, `/todos`, shared tag UX

### Checkpoint: UI
- [ ] §3 mechanical checks green; frozen e2e diff = I5 URLs only

### Phase 5 — Wiring & close
- [ ] T9: compose/env/Docker wiring + integration pass
- [ ] Five-lane gate → `tasks/five-lane-todo-ecosystem.md` → report

### Checkpoint: Complete
- [ ] All acceptance criteria met; merge awaits the user's explicit request

## Parallelization

T5 ∥ T6 and T7 ∥ T5 are dependency-safe; run sequentially under single-agent
review discipline unless a time constraint forces parallel subagents.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@life/cache` extraction regresses note-service | High | Port suites verbatim first; note-service suites run green at every task |
| Contract drift across four services | High | SPEC-service-kernel is the single source; five-lane lane 5 checks references, not re-inventions |
| Tag migration data loss | High | Id-preserving idempotent script, dry-run + backups in checklist, fixtures incl. `_legacy_` |
| Frozen e2e surface churn | Med | I5 URL updates only; diff asserted in T8 acceptance |
| Scope creep (v2 fields) | Med | I2 MVP frozen; new fields need their own intent |

## Open Questions

None — the interview closed the forks; anything new goes through §8 decision +
artifact recording.
