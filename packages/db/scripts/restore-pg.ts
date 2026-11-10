import { pathToFileURL } from 'node:url';
import { main } from '../src/restore-pg.js';

/**
 * `db:restore:pg` entry (`SPEC-feedback-infra.md` `## PostgreSQL-only backup/restore
 * tooling`). Thin CLI over the tested core in `src/restore-pg.ts`; run via the workspace
 * convention (stack stopped except `postgres`):
 *
 *   npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
 *   npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only feedback
 *
 * Kept out of `src/restore-pg.ts` because that file is imported by `test/restore-pg.test.ts`
 * (CommonJS transform, where `import.meta` is TS1343). ESM has no `require.main`, and Node 22
 * has no `import.meta.main`, so "was I run directly?" is answered by comparing the entry path.
 *
 * Hard line: the human runs this against the real DB; agents and tests only ever touch
 * temp fixtures with a fake runner, and the integration suite only its throwaway
 * container. It refuses unless the stack probes stopped.
 */
if (import.meta.url === pathToFileURL(process.argv[1] as string).href) {
  const code = await main();
  process.exitCode = code;
}
