# Implementation Plan: note-service per-user boundary

Traces to: `docs/intent/notes-user-boundary.md`, `docs/specs/MAP-notes-user-boundary.md`.
Tasks tracked in `tasks/todo-notes-user-boundary.md`. Branch: `feature/user-boundary`.

## Overview

Every note and tag carries an `ownerSub` (the IdP `sub`), every query is scoped by it,
the cache is namespaced per user, and a human-run script backfills legacy rows to the
oldest user in the identity database — after verifying a consistent backup. The single
user notices nothing; a second identity would see an empty world.

## Architecture Decisions

- **`sub` is a foreign key, never a join.** The verified token's `sub` (= IdP
  `User.id` uuid) flows guard → `request.principal` → `@Principal()` → service. No user
  service, no cross-DB reads at runtime (intent decision 2026-09-26).
- **`ownerSub` nullable, service-enforced.** `synchronize: true` can only add nullable
  columns to the live SQLite DB without a table rebuild. `NULL` = legacy row (invisible
  to all queries); every `create` stamps the sub.
- **404, never 403.** Foreign and missing ids are indistinguishable — no existence leak.
- **Tags are per-user too.** Tag names are user content; a global tag list would leak
  one user's vocabulary to the next. `UNIQUE(name, ownerSub)`.
- **Dev principal is the constant `dev-user`**, produced only by the
  `NODE_ENV=development` guard bypass (real tokens carry uuid subs — no collision).
- **Cache: per-user keys and per-user generation** (`note:gen:<sub>`); all ordering
  semantics of `SPEC-note-cache.md` unchanged.
- **The migration runs before the new code boots** (stop → script → boot): the script
  does the idempotent column `ALTER`s itself, so legacy rows are never invisible to the
  new queries. The script owns its backup (`VACUUM INTO` + verification) and is the one
  sanctioned writer of `life.db` outside the service.

## Task List

### Phase 1: Foundation
- [ ] Task 1: principal seam (guard → `request.principal` → `@Principal()`, dev subject)
- [ ] Task 2: notes ownership (column, stamping, scoped queries, 404, isolation suite)

### Checkpoint: Foundation
- [ ] Note suite green (existing + ownership suite); lint clean; two-subject isolation proven

### Phase 2: Periphery
- [ ] Task 3: tags ownership (column, per-owner uniqueness, scoped resolution/list)
- [ ] Task 4: cache scoping (per-user keys + generation)

### Checkpoint: Periphery
- [ ] Full note-service suite green incl. cache key-shape + isolation cases

### Phase 3: Migration + close-out
- [ ] Task 5: `owner-backfill` script + script suite (temp fixtures only)
- [ ] Task 6: close-out (spec drift closure, ledger, rehearsal on a DB copy, final sweep)

### Checkpoint: Complete
- [ ] All acceptance criteria met; human deploy checklist ready

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite unique-index surgery (`name` unique → `UNIQUE(name, ownerSub)`) via `synchronize` | Med | Task 3 verifies against a **copy** of the real DB early; fallback (ask-first): script creates the composite index, `DROP INDEX` the old one |
| Deploy-order empty window (NULL rows invisible to new queries) | Med | Script does column `ALTER`s and runs before boot; deploy checklist mandates stop → script → boot |
| Backfill mis-selection of owner | High | Deterministic `ORDER BY createdAt, id LIMIT 1`; abort on zero users; tests for tie-break; never re-stamps owned rows |
| e2e regression (human-owned suite) | Low | No UI/DTO change; e2e subject is single-user; rows get stamped with that subject |
| Sub in cache keys lengthens keys | Low | uuid ≤ 36 chars; key shape tests updated |

## Open Questions

None — intent was confirmed via interview (explicit yes).
