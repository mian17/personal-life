# Intent — production SQLite backup & restore

- **Date:** 2026-10-01
- **Branch:** `feat/production-db-backup`
- **Source:** `interview-me` (confirmed by explicit "yes")
- **Status:** CONFIRMED — downstream spec/plan consume this; do not re-litigate locked decisions.

## Statement of intent

- **Outcome:** two operator commands — one snapshots the five production SQLite databases
  (`life.db`, `tags.db`, `todo.db`, `idp.db`, `meal.db`)
  into `backup/<stamp>/` with verification; one restores a chosen snapshot over the live
  files. A daily cron entry runs the backup.
- **User:** the operator (repo owner) on the compose host — before migrations/cleanups, and
  once a day unattended.
- **Why now:** the runbook's Step 2 is a manual `cp apps/note-service/data/life.db
  backup/<stamp>/life.db` — one database, no verification, ad-hoc naming.
- **Success:** `db:backup` produces snapshots that each pass `PRAGMA quick_check`; a routine
  run is distinguishable from a deliberate pre-operation one; restoring the wrong snapshot
  is itself undoable.
- **Constraint:** backup is read-only → safe to run with the stack up (cron requires that);
  restore requires the stack stopped and always snapshots the database it is about to
  overwrite first.
- **Out of scope:** Redis (Contract 2: cache, never source of truth), copies off this
  machine, the crontab install itself (hard line — the human runs it), scheduled restore.

## Locked decisions

| # | Decision |
|---|---|
| D1 | Destination is `backup/<UTC stamp>/` — the directory `.gitignore:12` already reserves and the runbook already writes to. Not `backups/`. |
| D2 | Scope is the four databases: note `life.db`, tags `tags.db`, todo `todo.db`, idp `idp.db`. Restore of the idp DB can revert user accounts — included, but the riskiest. **Amendment 2026-10-15:** the meal-nutrition chapter introduced `meal-service` with its own `apps/meal-service/data/meal.db`; scope extended to five databases. Records scope only — no other decision is re-opened. |
| D3 | Snapshots use the verified mechanism already in the repo (`VACUUM INTO` + `PRAGMA quick_check` on source and copy, unique non-overwriting names). This is the third caller of that logic — no third copy of it (no-fork, cf. Contract 2 Rule 4 / lesson 0006). |
| D4 | Backup never writes to a source database; it must run correctly against a live, in-use database (cron runs with the stack up). |
| D5 | Restore refuses to run unless the stack is stopped, and snapshots the target database to `backup/pre-restore-<stamp>/` before replacing it. No interactive Y/N prompt — the pre-snapshot is the safety. |
| D6 | Retention: routine snapshots keep the newest 10 and prune the rest; a snapshot taken deliberately (pinned) is never auto-pruned. |
| D7 | A routine run and a deliberate run are distinguishable from the snapshot name/metadata alone. |
| D8 | A daily cron entry runs the backup; the crontab line is documented for the human to install (machine-level config is a hard line). |
| D9 | Per-service `*_DB_PATH` env overrides are honoured (`NOTE_DB_PATH`, `TAGS_DB_PATH`, `TODO_DB_PATH`, `IDP_DB_PATH`, `MEAL_DB_PATH`); defaults are repo-anchored paths. |
| D10 | Fail closed: a missing input database aborts before any snapshot is written. |
| D11 | The command is cron-clean: non-interactive, deterministic exit codes, no prompt. |

## Open details (for the spec, not for re-litigation)

- Where the shared snapshot helper lives (a shared workspace package, per the no-fork rule).
- Exact command names / npm script names and which workspace owns them.
- How "pinned" is expressed (flag at creation vs. a marker file in the snapshot directory).
- Whether restore verifies the chosen snapshot with `PRAGMA quick_check` before replacing.
- Whether the runbook's Step 2 `cp` line is replaced by the command in the same change.
