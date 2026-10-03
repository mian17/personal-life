import { main } from '../src/backup-pg';

/**
 * `db:backup:pg` entry (`SPEC-feedback-infra.md` `## PostgreSQL-only backup/restore
 * tooling`). Thin CLI over the tested core in `src/backup-pg.ts`; run via the
 * workspace convention:
 *
 *   npm run db:backup:pg -w @life/db            # routine (the cron form)
 *   npm run db:backup:pg -w @life/db -- --pin   # deliberate + pinned
 *   npm run db:backup:pg -w @life/db -- --only feedback
 *
 * Hard line: the human runs this against the real DB; agents and tests only ever
 * touch temp fixtures with a fake runner. No `pg_dump`/`pg_restore` from the host.
 */

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  process.exitCode = main();
}

export { main };
