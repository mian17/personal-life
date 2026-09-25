# Spec: `owner-backfill` — one-time owner backfill that owns its backup

Traces to: `docs/specs/MAP-notes-user-boundary.md`, `docs/intent/notes-user-boundary.md`.

## Objective

Assign every legacy row (`ownerSub IS NULL`) to the **oldest user in the identity
database** — after taking a verified, consistent backup of `life.db`. Explicit,
idempotent, human-run at deploy time. The backup is the rollback path.

## Contract (the seam)

- CLI: `npm run backfill-owner -w apps/note-service` →
  `apps/note-service/scripts/backfill-owner.ts`. Env: `NOTE_DB_PATH` (default
  `apps/note-service/data/life.db`), `IDP_DB_PATH` (**required, no default** — explicit
  is safe). Both resolve against `process.env.INIT_CWD ?? process.cwd()`, so the
  documented repo-root command works as written despite `npm -w` setting the script's
  cwd to the workspace.
- **Step 0 — ensure schema (idempotent, no rebuild).** Add `ownerSub TEXT` to `note`
  and `tag` when missing (`PRAGMA table_info` guard + native `ALTER TABLE ADD COLUMN`),
  so the script runs on the *old* schema. This is what makes the prescribed deploy
  order possible: stop services → run script → boot new code — zero window in which
  legacy rows are invisible. (The tag unique-constraint change is intentionally left to
  TypeORM's first-boot reconcile — one data-preserving table rebuild, covered by the
  backup Step 1 already took.)
- **Step 1 — backup (before any write).** `VACUUM INTO '<life.db>.bak-<UTC
  timestamp>'` — a SQLite-consistent snapshot even with readers live. Verification
  before anything else: the copy exists, opens, `PRAGMA quick_check` passes, and its
  `note` row count equals the source's. Any backup/verification failure → abort with
  exit ≠ 0 and **zero writes**. Existing backup files are never overwritten (unique
  timestamps).
- **Step 2 — resolve owner.** Open `IDP_DB_PATH` **read-only**;
  `SELECT id FROM user ORDER BY createdAt ASC, id ASC LIMIT 1`. Missing table, zero
  users, or unreadable DB → abort loudly with the remediation (seed the user first).
  Never invent a user, never stamp NULL, never write the IdP DB.
- **Step 3 — backfill.** `UPDATE note SET ownerSub = ? WHERE ownerSub IS NULL` and the
  same for `tag`. Idempotent: a re-run reports 0 rows and performs no writes. Owned
  rows are never re-stamped.
- **Output:** backup path + verification result, rows stamped (note/tag counts), rows
  already owned, exit code 0 only when all steps succeeded.

## Security posture

This script is the **one sanctioned writer of `life.db` outside the service** (and the
one sanctioned *reader* of `idp.db` — read-only). It is run by the human during the
deploy window, never by tests, never by agents against real data. It writes only the
two `ownerSub` columns and its own backup file.

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
const backup = await snapshotAndVerify(dbPath); // aborts on any failure
const sub = await resolveOldestUser(idpDbPath); // aborts when none
const stamped = await backfillNullOwners(dbPath, sub); // UPDATE ... WHERE ownerSub IS NULL
```

## Testing Strategy

Script suite against **temp fixture DBs** (own temp `life.db` + own temp `idp.db` —
never anything under `apps/*/data/`):

- Backup created and verified **before** any write (ordering asserted), and the backup
  is usable as a rollback (restores the pre-run row state).
- Existing backups never overwritten (two runs → two distinct backup files).
- Zero users → abort, zero writes. Missing/unreadable `IDP_DB_PATH` → abort.
- Oldest-of-many: two users with different `createdAt` → oldest wins; equal timestamps
  → deterministic (`id` ASC).
- Idempotent re-run: second run stamps 0 rows and performs no writes.
- Owned rows untouched; `tag` backfilled too.
- Path resolution works under `npm -w` (relative env values resolve against
  `INIT_CWD`, verified in-suite).
- Regression: note suite green.

## Boundaries

- **Always:** backup + verification first; read-only on the IdP DB; stamp only NULLs;
  deterministic owner selection; non-zero exit on any failure.
- **Ask first:** running it anywhere outside the deploy window; changing the selection
  rule; adding any write beyond the two `UPDATE`s and the backup file.
- **Never:** run against real data from tests/agents; write or read `apps/idp/data/**`
  outside the human-run deploy; let the script run automatically at startup; overwrite
  an existing backup.

## Success Criteria

1. On a temp copy of the real DB (human/tech-lead rehearsal): backup created + verified,
   all NULL rows stamped to the oldest user, re-run is a no-op.
2. Script suite green (all cases above).
3. Note suite green; `life.db` checksum outside the human-run script unchanged.

## Open Questions

None.
