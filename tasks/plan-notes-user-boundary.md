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
  service, no cross-DB reads at runtime (intent decision 2026-09-26). A verified token
  whose `sub` is missing or not a non-empty string is **rejected 401** — claims without
  identity are unauthenticated here.
- **`ownerSub` nullable, service-enforced.** `NULL` = legacy row (matched by no query,
  visible to nobody); every `create` stamps the sub. Column adds are done by the
  backfill script with native `ALTER TABLE ADD COLUMN` (no rebuild); TypeORM's SQLite
  driver rebuilds a table for *any* column or unique-index change (verified against
  0.3.31 — `addColumns` → `recreateTable`), so the one remaining schema reconcile (the
  tag unique change) is a single data-preserving table rebuild at first boot of the new
  code, happening **after** the script's verified backup exists and the data is stamped.
- **404s are explicit.** The service throws `NotFoundException` itself. TypeORM's
  `EntityNotFoundError` is not mapped to 404 by default Nest and would surface as a 500;
  foreign id and missing id must be byte-identical 404s. No 403 anywhere.
- **Tags are per-user too.** Tag names are user content; a global tag list would leak
  one user's vocabulary to the next. `UNIQUE(name, ownerSub)`.
- **Dev principal is the constant `dev-user`**, produced only by the
  `NODE_ENV=development` guard bypass (real tokens carry uuid subs — no collision). The
  bypass must be unreachable in the deployed container (`NODE_ENV=production`).
- **Cache: per-user keys and per-user generation** (`note:gen:<sub>`); all ordering
  semantics of `SPEC-note-cache.md` unchanged.
- **The migration runs before the new code boots** (stop → script → boot): the script
  does the idempotent column `ALTER`s itself, so legacy rows are never invisible to the
  new scoped queries. The script owns its backup (`VACUUM INTO` + verification) and is
  the one sanctioned writer of `life.db` outside the service. Script paths resolve
  against `process.env.INIT_CWD ?? process.cwd()` so the repo-root `npm run -w` command
  works as written.

## Task List

### Phase 1: Foundation
- [ ] Task 1: principal seam (guard → `request.principal` → `@Principal()`, dev subject, sub-less-token 401)
- [ ] Task 2: notes ownership (column, stamping, scoped queries, explicit 404, isolation suite)

### Checkpoint: Foundation
- [ ] Note suite green (existing + ownership suite); lint clean; two-subject isolation proven

### Phase 2: Periphery
- [ ] Task 3: tags ownership (column, per-owner uniqueness, scoped resolution/list, schema-compat suite)
- [ ] Task 4: cache scoping (per-user keys + generation) — **after Task 3** (both thread `sub` through `notes.service.ts`)

### Checkpoint: Periphery
- [ ] Full note-service suite green incl. cache key-shape + isolation cases

### Phase 3: Migration + close-out
- [ ] Task 5: `owner-backfill` script + script suite + script typecheck
- [ ] Task 6: close-out (spec drift closure, ledger, rehearsal on a DB copy, prod-env check, final sweep)

### Checkpoint: Complete
- [ ] All acceptance criteria met; human deploy checklist ready

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| First-boot schema reconcile rebuilds the `tag` table (TypeORM `recreateTable` on the unique-constraint change) | Med | Data is stamped before boot under a verified backup; Task 3's `schema-compat` suite proves rows survive the rebuild on a legacy-schema fixture with real rows; Task 6 rehearses on a temp copy of the real DB |
| Deploy-order empty window (NULL rows invisible to new queries) | Med | Script does the column `ALTER`s and runs before boot; deploy checklist mandates stop → script → boot |
| Backfill mis-selection of owner | High | Deterministic `ORDER BY createdAt, id LIMIT 1`; abort on zero users; tie-break tested; never re-stamps owned rows |
| Verified token without `sub` could match NULL-owner rows | High | Guard rejects (401) any verified token lacking a non-empty string `sub`; suite case in Task 1 |
| Dev bypass reachable if the container runs `NODE_ENV≠production` | Med | Compose sets `NODE_ENV=production`; Task 6 verifies as a read-only check; `dev-user` only ever exists locally |
| e2e regression (human-owned suite) | Low | No UI/DTO change; e2e subject is single-user; rows get stamped with that subject |
| Sub in cache keys lengthens keys | Low | uuid ≤ 36 chars; key shape tests updated |

## Open Questions

None — intent was confirmed via interview (explicit yes).
