import { main } from '../src/backup';

/**
 * `db:backup` entry (`SPEC-db-backup-restore` `## Commands`). Thin CLI over the
 * tested core in `src/backup.ts`; run via the workspace convention:
 *
 *   npm run db:backup -w @life/db            # routine (the cron form)
 *   npm run db:backup -w @life/db -- --pin   # deliberate + pinned
 *   npm run db:backup -w @life/db -- --only life,idp
 *
 * Hard line: the human runs this against the real DBs; agents and tests only ever
 * touch temp fixtures. It opens every source read-only.
 */

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  process.exitCode = main();
}

export { main };
