import { pathToFileURL } from 'node:url';
import { main } from '../src/restore.js';
import { DEFAULT_DATABASE_PATHS } from '../src/repo-paths.js';

/**
 * `db:restore` entry (`SPEC-db-backup-restore` `## Commands`). Thin CLI over the tested core in
 * `src/restore.ts`; run via the workspace convention:
 *
 *   npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
 *   npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only idp
 *
 * Kept out of `src/restore.ts` because that file is imported by `test/restore.test.ts`
 * (CommonJS transform, where `import.meta` is TS1343). ESM has no `require.main`, and Node 22
 * has no `import.meta.main`, so "was I run directly?" is answered by comparing the entry path.
 * The repo-anchored defaults live in `src/repo-paths.ts` for the same reason.
 *
 * Hard line: the human runs this against the real DBs with the stack stopped; agents and tests
 * only ever touch temp fixtures. It refuses unless the stack probes down.
 */
if (import.meta.url === pathToFileURL(process.argv[1] as string).href) {
  void main(process.argv.slice(2), process.env, undefined, DEFAULT_DATABASE_PATHS).then((code) => {
    process.exitCode = code;
  });
}
