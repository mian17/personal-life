# Spec: `owner-backfill` — one-time owner backfill that owns its backup

Traces to: `docs/specs/MAP-notes-user-boundary.md`, `docs/intent/notes-user-boundary.md`.

## Objective

Assign every legacy row (`ownerSub IS NULL`) to the **oldest user in the identity
database** — after taking a verified, consistent backup of `life.db`. Explicit,
idempotent, human-run at deploy time. The backup is the rollback path, and it is taken
before any write of any kind.

## Contract (the seam)

- CLI: `npm run backfill-owner -w apps/note-service` →
  `apps/note-service/scripts/backfill-owner.ts`. Env: `NOTE_DB_PATH` (default
  `apps/note-service/data/life.db`), `IDP_DB_PATH` (**required, no default** — explicit
  is safe). Both resolve against `process.env.INIT_CWD ?? process.cwd()`, so the
  documented repo-root command works as written despite `npm -w` setting the script's
  cwd to the workspace.
- **Step 1 — backup (the script's first action; no write of any kind precedes it).**
  `VACUUM INTO '<life.db>.bak-<UTC timestamp>'` — a SQLite-consistent snapshot of the
  *pre-migration* state even with readers live. Verification: the copy exists, opens,
  `PRAGMA quick_check` passes, and its `note` row count equals the source's. Any
  backup/verification failure → exit ≠ 0 and **zero writes**. Existing backup files are
  never overwritten (unique timestamps).
- **Step 2 — schema surgery (idempotent; every DDL byte-equivalent to what TypeORM's
  `synchronize` expects, so the first boot performs zero schema-mutating statements).**
  a. `note`: add `ownerSub TEXT` when missing (`PRAGMA table_info` guard + native
     `ALTER TABLE ADD COLUMN` — no rebuild), and create
     `INDEX "IDX_note_owner_sub" ON "note"(ownerSub)` when missing — the entity's
     explicit index name, created here so the boot has nothing left to do.
  b. `tag`: **rebuild the table** — with `PRAGMA foreign_keys = OFF` around the
     drop-and-rename (`note_tag` references `tag`; better-sqlite3 defaults FK
     enforcement ON and the real DB has referencing rows — `DROP TABLE "tag"` aborts
     with `SQLITE_CONSTRAINT_FOREIGNKEY` otherwise). Create `tag` with the exact DDL
     TypeORM expects for the entity — including `"id" integer PRIMARY KEY
     AUTOINCREMENT NOT NULL` with ids preserved — plus
     `UNIQUE INDEX "UQ_tag_name_owner"(name, ownerSub)`; copy rows; drop the old table
     (the legacy inline `UNIQUE(name)` dies with it); rename. Then
     `PRAGMA foreign_key_check` must report **zero violations** before FK enforcement
     is re-enabled. Idempotence guard: skip when `tag` already has `ownerSub` and no
     single-column unique on `name`.
  The entity declares the composite unique with the **same explicit index name**
  (`@Index('UQ_tag_name_owner', …)`), so first-boot `synchronize` finds exactly its
  expectation and mutates nothing.
- **Step 3 — resolve owner.** Open `IDP_DB_PATH` **read-only**;
  `SELECT id FROM user ORDER BY createdAt ASC, id ASC LIMIT 1`. Missing table, zero
  users, or unreadable DB → abort loudly with the remediation (seed the user first).
  Never invent a user, never stamp NULL, never write the IdP DB.
- **Step 4 — backfill.** `UPDATE note SET ownerSub = ? WHERE ownerSub IS NULL` and the
  same for `tag`. Idempotent: a re-run reports 0 rows and performs no writes. Owned
  rows are never re-stamped.
- **Output:** backup path + verification result, schema actions taken, rows stamped
  (note/tag counts), rows already owned, exit code 0 only when all steps succeeded.

## Security posture

This script is the **one sanctioned writer of `life.db` outside the service** (and the
one sanctioned *reader* of `idp.db` — read-only). It is run by the human during the
deploy window, never by tests, never by agents against real data. It writes only the
two `ownerSub` columns, the `tag` table rebuild, the two indexes, and its own backup
file.

## Tech Stack

Node + better-sqlite3 (already the service's driver), plain script — no Nest context.
Typechecked via `tsconfig.scripts.json` (the main tsconfig's `include` covers `src/`
only, so `npm run lint` alone would not see the script).

## Commands

```
Run (deploy, from repo root):  IDP_DB_PATH=apps/idp/data/idp.db npm run backfill-owner -w apps/note-service
Unit:                          npm run test -w apps/note-service -- owner-backfill.e2e-spec
Typecheck:                     npx tsc -p apps/note-service/tsconfig.scripts.json --noEmit
```

## Project Structure

```
apps/note-service/scripts/backfill-owner.ts        → the migration
apps/note-service/tsconfig.scripts.json            → typecheck config for scripts/
apps/note-service/test/owner-backfill.e2e-spec.ts  → script suite (temp fixtures only)
```

## Code Style

Plain sequential async steps with explicit aborts — no framework, no cleverness:

```ts
const backup = await snapshotAndVerify(dbPath);      // Step 1 — aborts on any failure
await applySchema(dbPath);                           // Step 2 — note ALTER + indexes + tag rebuild
const sub = await resolveOldestUser(idpDbPath);      // Step 3 — aborts when none
const stamped = await backfillNullOwners(dbPath, sub); // Step 4 — UPDATE ... WHERE ownerSub IS NULL
```

## Testing Strategy

Script suite against **temp fixture DBs** (own temp `life.db` + own temp `idp.db` —
never anything under `apps/*/data/`):

- Backup created and verified **before any write** (ordering asserted — including
  before the Step 2 DDL), and the backup restores the pre-run row state (rollback
  proof).
- Existing backups never overwritten (two runs → two distinct backup files).
- **Legacy `tag` conversion + convergence:** a fixture with the old `UNIQUE(name)`,
  real rows **and `note_tag` referencing rows** → after the script: rows intact (ids
  preserved), the rebuild completes with zero FK violations (FK-off + `foreign_key_check`
  exercised), the old global unique is gone (same name insertable for a second owner),
  `UQ_tag_name_owner` and `IDX_note_owner_sub` present, and a subsequent app boot's
  `synchronize` performs **zero schema-mutating statements**.
- Zero users → abort, zero writes. Missing/unreadable `IDP_DB_PATH` → abort.
- Oldest-of-many: two users with different `createdAt` → oldest wins; equal timestamps
  → deterministic (`id` ASC).
- Idempotent re-run: second run stamps 0 rows and performs no writes (schema step
  skipped by its guard).
- Owned rows untouched; `tag` backfilled too.
- Path resolution works under `npm -w` (relative env values resolve against
  `INIT_CWD`, verified in-suite).
- Regression: note suite green.

## Boundaries

- **Always:** backup + verification before any write; read-only on the IdP DB; stamp
  only NULLs; deterministic owner selection; non-zero exit on any failure; FK
  enforcement restored and `foreign_key_check` clean after the rebuild.
- **Ask first:** running it anywhere outside the deploy window; changing the selection
  rule; adding any write beyond Step 2's surgery, the two `UPDATE`s, and the backup.
- **Never:** run against real data from tests/agents; write `apps/idp/data/**` or read
  it outside the human-run deploy; let the script run automatically at startup;
  overwrite an existing backup; leave FK enforcement disabled.

## Success Criteria

1. The human-run deploy against the real DBs prints: backup path + verification OK,
   all NULL rows stamped to the oldest user; a re-run is a no-op. (The real-DB pass is
   human-owned — agents and tests only ever touch fixture DBs.)
2. Script suite green (all cases above, including legacy `tag` conversion + the
   zero-schema-mutation convergence proof).
3. Note suite green; `life.db` checksum outside the human-run script unchanged.

## Open Questions

None.
