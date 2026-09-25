# Todo: note-service per-user boundary chapter

Traces to: `tasks/plan-notes-user-boundary.md`, `docs/specs/MAP-notes-user-boundary.md`.
Status: **planning complete 2026-09-26** — plan validated by the pre-IMPLEMENT gate;
round-2 findings (12) patched 2026-09-26, round-3 findings (6: synchronize never drops
the legacy `UNIQUE(name)` — script-owned `tag` rebuild adopted; backup-first ordering;
Task 6 placeholder/hard-line conflicts removed; NODE_ENV suite hygiene; rehearsal scope
corrected) patched 2026-09-26. Next: gate re-validation, then subagent-built tasks on
`feature/user-boundary`.

Standing rules (AGENTS.md): implementation goes to subagents with the mandatory task
template; verification ladder lint → targeted jest (note-service suite runs
sequentially, one at a time); **no Playwright/e2e** (human-owned); agents/tests never
**write** `apps/note-service/data/**` and never open `apps/idp/data/**` (read-only
forensic access to `life.db` attested via checksum); the human-run deploy script is the
sanctioned writer; never stage `AGENTS.md`; commit by explicit paths.

## Task 1: principal seam

Guard stops discarding claims: `request.principal = { sub }` after verification,
`{ sub: 'dev-user' }` on the dev bypass, `@Principal()` decorator for handlers.

- Acceptance: verified token → `principal.sub` equals the token's `sub`; a verified
  token with a missing/empty/non-string `sub` → **401** (claims without identity are
  unauthenticated); dev bypass → `dev-user`; unauthenticated request still 401s (no
  principal ever reaches a handler); `AuthenticatedRequest` type exported; the
  dev-mode suite case **saves and restores `NODE_ENV`** (`afterEach`/`finally`) so the
  bypass cannot leak into later specs in the same jest worker.
- Verify: `npm run test -w apps/note-service -- auth.e2e-spec`, `npm run lint`.
- Blast radius: `apps/note-service/src/auth/auth.guard.ts`,
  `apps/note-service/src/auth/principal.ts` (new), `apps/note-service/test/auth.e2e-spec.ts`.
- Depends on: none. Scope: S.

## Task 2: notes ownership

`note.ownerSub` + `@Index('IDX_note_owner_sub')`; `create` stamps sub; all eight note
methods filter `ownerSub = :sub`; foreign id = missing id = 404 via explicit
`NotFoundException`; two-subject isolation suite.

- Acceptance: A sees only A's rows; B's list/trash empty; B get/patch/delete/restore/
  permanent on A's id → 404 byte-identical to a nonexistent id (produced by explicit
  `NotFoundException` — `EntityNotFoundError` passthrough would 500); `emptyTrash`
  empties only the caller's trash; `create` stamps the caller's sub and a **dev-mode
  boot's `create` stamps `dev-user`** (ownership suite case, NODE_ENV restored);
  `NoteDto` has no owner field; existing suite green.
- Verify: `npm run test -w apps/note-service -- notes.e2e-spec`,
  `npm run test -w apps/note-service -- ownership.e2e-spec`, `npm run lint`.
- Blast radius: `apps/note-service/src/notes/note.entity.ts`,
  `apps/note-service/src/notes/notes.service.ts`,
  `apps/note-service/src/notes/notes.controller.ts`,
  `apps/note-service/test/ownership.e2e-spec.ts` (new).
- Depends on: Task 1. Scope: M.

### Checkpoint: Foundation
- [ ] Note suite green (existing + ownership); lint clean

## Task 3: tags ownership

`tag.ownerSub`; `@Index('UQ_tag_name_owner', ['name','ownerSub'], { unique: true })` on
the entity (the **explicit name** the backfill script emits — see Task 5); the legacy
inline `unique: true` removed from `name`. `listTags` scoped via `tags.controller.ts`
(`@Principal()`); tag resolution attaches or creates the caller's own tags; A's tag
names never appear to B. Fresh-schema behavior only — the legacy conversion is Task 5's
job.

- Acceptance: tags list and resolution isolated per user; creating a tag name another
  user owns succeeds (per-owner uniqueness — same name for two owners OK, duplicate
  within one owner rejected); ownership suite extended; existing suite green.
- Verify: `npm run test -w apps/note-service -- ownership.e2e-spec`,
  `npm run test -w apps/note-service -- notes.e2e-spec`, `npm run lint`.
- Blast radius: `apps/note-service/src/notes/tag.entity.ts`,
  `apps/note-service/src/notes/notes.service.ts`,
  `apps/note-service/src/notes/tags.controller.ts`,
  `apps/note-service/test/ownership.e2e-spec.ts`.
- Depends on: Task 2. Scope: S.

## Task 4: cache scoping

Per-user keys (`note:<sub>:v<gen>:…`) and per-user generation (`note:gen:<sub>`); all
other cache semantics unchanged.

- Acceptance: key-shape tests updated and green with the sub component; A's write bumps
  only A's generation and B's cached entries survive; ordering/stale-guard/fail-open
  cases unchanged; note suite green with `REDIS_URL` unset.
- Verify: `npm run test -w apps/note-service -- notes-cache.e2e-spec`,
  `npm run test -w apps/note-service`, `npm run lint`.
- Blast radius: `apps/note-service/src/notes/notes-cache.ts`,
  `apps/note-service/src/notes/notes.service.ts`,
  `apps/note-service/test/notes-cache.e2e-spec.ts`.
- Depends on: Task 2, **Task 3** (both edit `notes.service.ts` — serialize Phase 2).
- Scope: S.

### Checkpoint: Periphery
- [ ] Full note-service suite green incl. cache cases

## Task 5: owner-backfill script

`scripts/backfill-owner.ts`: Step 1 `VACUUM INTO` backup + verification (**no write of
any kind precedes it**) → Step 2 schema surgery (`note` column `ALTER`; `tag` table
rebuild removing the legacy `UNIQUE(name)`, emitting `UQ_tag_name_owner`) → Step 3
oldest user (read-only IdP DB) → Step 4 stamp NULL rows. Plus the npm script entry,
`tsconfig.scripts.json` (so the script is actually typechecked), and the temp-fixture
script suite.

- Acceptance: env contract — `NOTE_DB_PATH` default `apps/note-service/data/life.db`,
  `IDP_DB_PATH` **required (no default)**, both resolved against
  `process.env.INIT_CWD ?? process.cwd()` so the repo-root `npm run -w` command is
  runnable as written; backup verified before any write including Step 2 DDL
  (ordering asserted) and a backup restores pre-run row state (rollback proof);
  existing backups never overwritten (unique timestamps); **legacy `tag` conversion
  proven** — rows survive the rebuild (ids preserved, incl. `note_tag`-referencing
  rows; zero FK violations under `PRAGMA foreign_keys = OFF` + clean
  `foreign_key_check` before re-enabling), the old global unique is gone (same name
  insertable for a second owner), `UQ_tag_name_owner` + `IDX_note_owner_sub` present,
  and a following app boot's `synchronize` performs **zero schema-mutating statements**
  (the rebuilt DDL is byte-equivalent to TypeORM's expectation — `AUTOINCREMENT`
  included); zero users → abort
  with zero writes; missing or unreadable `IDP_DB_PATH` → abort; oldest-of-many with
  `createdAt, id` tie-break deterministic; re-run stamps 0 rows / no writes (schema
  step skipped by its guard); owned rows untouched; `tag` backfilled; non-zero exit on
  any failure.
- Verify: `npm run test -w apps/note-service -- owner-backfill.e2e-spec`,
  `npx tsc -p apps/note-service/tsconfig.scripts.json --noEmit`, `npm run lint`.
- Blast radius: `apps/note-service/scripts/backfill-owner.ts` (new),
  `apps/note-service/tsconfig.scripts.json` (new),
  `apps/note-service/package.json` (script entry only),
  `apps/note-service/test/owner-backfill.e2e-spec.ts` (new).
- Depends on: Task 2, Task 3. Scope: M.
- Hard line: the suite uses its own temp DBs — never anything under `apps/*/data/`.

## Task 6: close-out

Drift closure (`SPEC-notes.md` authorization paragraph, `SPEC-note-cache.md` key
shapes), ledger status, prod-env read-only check (compose sets `NODE_ENV=production` on
note-service — the dev bypass must be unreachable), final sequential sweep. No
real-data rehearsal lives here: the real-DB pass is the human-run deploy (backup- and
rollback-covered); agents and tests only ever touch fixture DBs.

- Acceptance: specs match the shipped contract; compose env check clean; sweep green.
- Verify: `npm run test -w apps/note-service`, `npm run lint`.
- Blast radius: `docs/specs/SPEC-notes.md`, `docs/specs/SPEC-note-cache.md`,
  `tasks/todo-notes-user-boundary.md`, `tasks/plan-notes-user-boundary.md`.
- Depends on: Tasks 1–5. Scope: S.

### Checkpoint: Complete
- [ ] All acceptance criteria met; five-lane gate run; human deploy checklist below ready

## Human deploy checklist (human-owned)

- [ ] Stop/quiet the stack (deploy window) — **never boot the new code before the
      script has run** (legacy `tag` uniques never converge otherwise)
- [ ] Run the backfill **before booting the new code** (from the repo root):
      `IDP_DB_PATH=apps/idp/data/idp.db npm run backfill-owner -w apps/note-service`
      (Step 1 creates + verifies its own backup first; expect stamped counts = current
      note/tag counts, and the `tag` rebuild reported)
- [ ] `docker compose up -d --build` (note-service image carries the boundary code)
- [ ] Phone check: login → list/edit a note → trash/restore (experience unchanged)
- [ ] Rollback path: restore the printed `.bak-<timestamp>` file and boot the old image
