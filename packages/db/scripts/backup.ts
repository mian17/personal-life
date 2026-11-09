import { pathToFileURL } from 'node:url';
import { main } from '../src/backup.js';
import { DEFAULT_DATABASE_PATHS } from '../src/repo-paths.js';

/**
 * `db:backup` entry (`SPEC-db-backup-restore` `## Commands`). Thin CLI over the tested core in
 * `src/backup.ts`; run via the workspace convention:
 *
 *   npm run db:backup -w @life/db            # routine (the cron form)
 *   npm run db:backup -w @life/db -- --pin   # deliberate + pinned
 *   npm run db:backup -w @life/db -- --only life,idp
 *
 * Kept out of `src/backup.ts` because that file is imported by `test/backup.test.ts` (CommonJS
 * transform, where `import.meta` is TS1343). ESM has no `require.main`, and Node 22 has no
 * `import.meta.main`, so "was I run directly?" is answered by comparing the entry path. The
 * repo-anchored defaults live in `src/repo-paths.ts` for the same reason.
 *
 * Hard line: the human runs this against the real DBs; agents and tests only ever touch temp
 * fixtures. It opens every source read-only.
 */
if (import.meta.url === pathToFileURL(process.argv[1] as string).href) {
  process.exitCode = main(process.argv.slice(2), process.env, DEFAULT_DATABASE_PATHS);
}
