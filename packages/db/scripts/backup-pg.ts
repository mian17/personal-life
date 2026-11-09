import { pathToFileURL } from 'node:url';
import { main } from '../src/backup-pg.js';

/**
 * `db:backup:pg` entry (`SPEC-feedback-infra.md` `## PostgreSQL-only backup/restore
 * tooling`). Thin CLI over the tested core in `src/backup-pg.ts`; run via the workspace
 * convention:
 *
 *   npm run db:backup:pg -w @life/db            # routine (the cron form)
 *   npm run db:backup:pg -w @life/db -- --pin   # deliberate + pinned
 *   npm run db:backup:pg -w @life/db -- --only feedback
 *
 * Kept out of `src/backup-pg.ts` because that file is imported by `test/backup-pg.test.ts`
 * (CommonJS transform, where `import.meta` is TS1343). ESM has no `require.main`, and Node 22
 * has no `import.meta.main`, so "was I run directly?" is answered by comparing the entry path.
 *
 * Hard line: the human runs this against the real DB; agents and tests only ever touch temp
 * fixtures with a fake runner. No `pg_dump`/`pg_restore` from the host.
 */
if (import.meta.url === pathToFileURL(process.argv[1] as string).href) {
  process.exitCode = main();
}
