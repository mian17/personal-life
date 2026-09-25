# Todo: note-service per-user boundary chapter

Traces to: `tasks/plan-notes-user-boundary.md`, `docs/specs/MAP-notes-user-boundary.md`.
Status: **planning complete 2026-09-26** — plan validated by the pre-IMPLEMENT gate
(12 discrepancies found and patched 2026-09-26); next is gate re-validation, then
subagent-built tasks on `feature/user-boundary`.

Standing rules (AGENTS.md): implementation goes to subagents with the mandatory task
template; verification ladder lint → targeted jest (note-service suite runs
sequentially, one at a time); **no Playwright/e2e** (human-owned);
`apps/note-service/data/**` and `apps/idp/data/idp.db` are never opened/written by
agents/tests (the human-run deploy script is the sanctioned reader of `idp.db`);
never stage `AGENTS.md`; commit by explicit paths.

## Task 1: principal seam

Guard stops discarding claims: `request.principal = { sub }` after verification,
`{ sub: 'dev-user' }` on the dev bypass, `@Principal()` decorator for handlers.

- Acceptance: verified token → `principal.sub` equals the token's `sub`; a verified
  token with a missing/empty/non-string `sub` → **401** (claims without identity are
  unauthenticated); dev bypass → `dev-user`; unauthenticated request still 401s (no
  principal ever reaches a handler); `AuthenticatedRequest` type exported.
- Verify: `npm run test -w apps/note-service -- auth.e2e-spec`, `npm run lint`.
- Blast radius: `apps/note-service/src/auth/auth.guard.ts`,
  `apps/note-service/src/auth/principal.ts` (new), `apps/note-service/test/auth.e2e-spec.ts`.
- Depends on: none. Scope: S.

## Task 2: notes ownership

`note.ownerSub` + index; `create` stamps sub; all eight note methods filter
`ownerSub = :sub`; foreign id = missing id = 404 via explicit `NotFoundException`;
two-subject isolation suite.

- Acceptance: A sees only A's rows; B's list/trash empty; B get/patch/delete/restore/
  permanent on A's id → 404 byte-identical to a nonexistent id (produced by explicit
  `NotFoundException` — `EntityNotFoundError` passthrough would 500); `emptyTrash`
  empties only the caller's trash; `create` stamps the caller's sub and a **dev-mode
  boot's `create` stamps `dev-user`** (ownership suite case); `NoteDto` has no owner
  field; existing suite green.
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

`tag.ownerSub`; `UNIQUE(name, ownerSub)`; `listTags` scoped via `tags.controller.ts`
(`@Principal()`); tag resolution attaches or creates the caller's own tags; A's tag
names never appear to B. Adds `test/schema-compat.e2e-spec.ts`: boot the app against a
**legacy-schema fixture DB** (old `UNIQUE(name)`, real rows, `ownerSub` added via the
script's `ALTER` path) and assert rows survive the first-boot schema reconcile
(TypeORM's one data-preserving `tag` table rebuild) and composite uniqueness holds
(same name allowed for different owners; duplicate within one owner rejected).

- Acceptance: tags list and resolution isolated per user; creating a tag name another
  user owns succeeds (no global collision); schema-compat suite green (rows intact
  after reconcile — the "no table rebuild" premise was disproven; the rebuild is
  expected exactly once, under backup); ownership suite extended; existing suite green.
- Verify: `npm run test -w apps/note-service -- ownership.e2e-spec`,
  `npm run test -w apps/note-service -- schema-compat.e2e-spec`,
  `npm run test -w apps/note-service -- notes.e2e-spec`, `npm run lint`.
- Blast radius: `apps/note-service/src/notes/tag.entity.ts`,
  `apps/note-service/src/notes/notes.service.ts`,
  `apps/note-service/src/notes/tags.controller.ts`,
  `apps/note-service/test/ownership.e2e-spec.ts`,
  `apps/note-service/test/schema-compat.e2e-spec.ts` (new).
- Depends on: Task 2. Scope: M.

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

`scripts/backfill-owner.ts`: Step 0 idempotent raw `ALTER TABLE ADD COLUMN`
(`note.ownerSub`, `tag.ownerSub` — no rebuild) → Step 1 `VACUUM INTO` backup +
verification → Step 2 oldest user (read-only IdP DB) → Step 3 stamp NULL rows. Plus the
npm script entry, `tsconfig.scripts.json` (so the script is actually typechecked), and
the temp-fixture script suite.

- Acceptance: env contract — `NOTE_DB_PATH` default `apps/note-service/data/life.db`,
  `IDP_DB_PATH` **required (no default)**, both resolved against
  `process.env.INIT_CWD ?? process.cwd()` so the repo-root `npm run -w` command is
  runnable as written; backup verified **before** any write (ordering asserted) and a
  backup restores pre-run row state (rollback proof); existing backups never
  overwritten (unique timestamps); zero users → abort with zero writes; missing or
  unreadable `IDP_DB_PATH` → abort; oldest-of-many with `createdAt, id` tie-break
  deterministic; re-run stamps 0 rows / no writes; owned rows untouched; `tag`
  backfilled; non-zero exit on any failure.
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
note-service — the dev bypass must be unreachable), rehearsal of the backfill against a
**temp copy of the real `life.db`** (read-only source; the identity DB is never opened
by agents — a fixture IdP DB stands in, and the human-run deploy executes the real
pairing), final sequential sweep.

- Acceptance: specs match the shipped contract; rehearsal shows backup + full stamp +
  no-op re-run on the copy:
  `cp apps/note-service/data/life.db /tmp/rehearsal-life.db` (read-only source), then
  `IDP_DB_PATH=<fixture idp.db> NOTE_DB_PATH=/tmp/rehearsal-life.db npm run backfill-owner -w apps/note-service`;
  sweep green.
- Verify: `npm run test -w apps/note-service`, `npm run lint`.
- Blast radius: `docs/specs/SPEC-notes.md`, `docs/specs/SPEC-note-cache.md`,
  `tasks/todo-notes-user-boundary.md`, `tasks/plan-notes-user-boundary.md`.
- Depends on: Tasks 1–5. Scope: S.

### Checkpoint: Complete
- [ ] All acceptance criteria met; five-lane gate run; human deploy checklist below ready

## Human deploy checklist (human-owned)

- [ ] Stop/quiet the stack (deploy window)
- [ ] Run the backfill **before booting the new code** (from the repo root):
      `IDP_DB_PATH=apps/idp/data/idp.db npm run backfill-owner -w apps/note-service`
      (it creates + verifies its own backup first; expect stamped counts = current note/tag counts)
- [ ] `docker compose up -d --build` (note-service image carries the boundary code)
- [ ] Phone check: login → list/edit a note → trash/restore (experience unchanged)
- [ ] Rollback path: restore the printed `.bak-<timestamp>` file and boot the old image
