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
  visible to nobody); every `create` stamps the sub.
- **The script owns ALL legacy schema surgery; synchronize never fights it** (validated
  against typeorm 0.3.31: `synchronize` will not drop a single-column inline UNIQUE —
  `sqlite_autoindex` is un-droppable — and `recreateTable` clones it forward, so a
  legacy `tag` table **never converges** and per-owner tag names stay blocked). The
  script therefore: adds `note.ownerSub` via native `ALTER TABLE ADD COLUMN` and
  creates `IDX_note_owner_sub`; and rebuilds `tag` once (new table → copy rows with
  ids preserved → drop old → rename) which removes the old `UNIQUE(name)` with the
  table, then creates `UNIQUE INDEX "UQ_tag_name_owner"(name, ownerSub)` — the
  **explicit name** the entity declares (`@Index('UQ_tag_name_owner', ['name','ownerSub'], { unique: true })`).
  The rebuild runs under `PRAGMA foreign_keys = OFF` (`note_tag` references `tag`;
  better-sqlite3 defaults FK enforcement ON and `DROP TABLE "tag"` aborts with
  `SQLITE_CONSTRAINT_FOREIGNKEY` on referencing rows) followed by a zero-result
  `PRAGMA foreign_key_check`, and its DDL is byte-equivalent to TypeORM's expectation
  (`"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`, ids preserved) — so first-boot
  `synchronize` provably performs **zero schema-mutating statements**. Booting the
  new code **without** running the script leaves the old global tag unique in place —
  the deploy order is mandatory.
- **Backup first, everything else after.** The script's first step is the verified
  `VACUUM INTO` backup (the intent's hard line: no write of any kind — DDL included —
  before the verified copy exists). Then schema surgery, then the owner lookup, then
  the NULL-only stamps.
- **404s are explicit.** The service throws `NotFoundException` itself. TypeORM's
  `EntityNotFoundError` is not mapped to 404 by default Nest and would surface as a
  500; foreign id and missing id must be byte-identical 404s. No 403 anywhere.
- **Tags are per-user too.** Tag names are user content; a global tag list would leak
  one user's vocabulary to the next. Uniqueness is per `(name, ownerSub)`.
- **Dev principal is the constant `dev-user`**, produced only by the
  `NODE_ENV=development` guard bypass (real tokens carry uuid subs — no collision). The
  bypass must be unreachable in the deployed container (`NODE_ENV=production`), and the
  dev-mode suite case must save/restore `NODE_ENV` (jest workers share `process.env`).
- **Cache: per-user keys and per-user generation** (`note:gen:<sub>`); all ordering
  semantics of `SPEC-note-cache.md` unchanged.
- **Script paths resolve against `process.env.INIT_CWD ?? process.cwd()`** so the
  repo-root `npm run -w` command works as written.

## Task List

### Phase 1: Foundation
- [ ] Task 1: principal seam (guard → `request.principal` → `@Principal()`, dev subject, sub-less-token 401, NODE_ENV hygiene)
- [ ] Task 2: notes ownership (column, stamping, scoped queries, explicit 404, isolation suite)

### Checkpoint: Foundation
- [ ] Note suite green (existing + ownership suite); lint clean; two-subject isolation proven

### Phase 2: Periphery
- [ ] Task 3: tags ownership (entity declares the composite unique index; scoped resolution/list) — fresh-schema behavior
- [ ] Task 4: cache scoping (per-user keys + generation) — **after Task 3** (both thread `sub` through `notes.service.ts`)

### Checkpoint: Periphery
- [ ] Full note-service suite green incl. cache key-shape + isolation cases

### Phase 3: Migration + close-out
- [ ] Task 5: `owner-backfill` script (backup first → note ALTER → tag rebuild → resolve → stamp) + script suite incl. legacy-tag conversion + script typecheck
- [ ] Task 6: close-out (spec drift closure, ledger, prod-env check, final sweep)

### Checkpoint: Complete
- [ ] All acceptance criteria met; human deploy checklist ready

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Legacy `tag` schema cannot be migrated by `synchronize` (old UNIQUE never dropped; rebuild repeats every boot) | High | The script's own `tag` rebuild (backup-covered, before boot; FK-off + `foreign_key_check`, AUTOINCREMENT-equivalent DDL); Task 5's suite proves rows survive, the old unique is gone, and the boot performs zero schema-mutating statements |
| New code booted without running the script first | High | Deploy checklist mandates stop → script → boot; the script suite documents the divergence symptom; stamped rows invisible otherwise (empty window) |
| Backfill mis-selection of owner | High | Deterministic `ORDER BY createdAt, id LIMIT 1`; abort on zero users; tie-break tested; never re-stamps owned rows |
| Verified token without `sub` could match NULL-owner rows | High | Guard rejects (401) any verified token lacking a non-empty string `sub`; suite case in Task 1 |
| Dev-mode suite case leaks `NODE_ENV=development` into later specs (shared jest env) | Med | The case saves/restores `NODE_ENV` in `afterEach`/`finally`; Task 1 acceptance requires it |
| Dev bypass reachable if the container runs `NODE_ENV≠production` | Med | Compose sets `NODE_ENV=production`; Task 6 verifies as a read-only check; `dev-user` only ever exists locally |
| e2e regression (human-owned suite) | Low | No UI/DTO change; e2e subject is single-user; rows get stamped with that subject |
| Sub in cache keys lengthens keys | Low | uuid ≤ 36 chars; key shape tests updated |

## Open Questions

None — intent was confirmed via interview (explicit yes).
