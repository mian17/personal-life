import { main } from '../src/restore-pg';

/**
 * `db:restore:pg` entry (`SPEC-feedback-infra.md` `## PostgreSQL-only backup/restore
 * tooling`). Thin CLI over the tested core in `src/restore-pg.ts`; run via the workspace
 * convention (stack stopped except `postgres`):
 *
 *   npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
 *   npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only feedback
 *
 * Hard line: the human runs this against the real DB; agents and tests only ever touch
 * temp fixtures with a fake runner, and the integration suite only its throwaway
 * container. It refuses unless the stack probes stopped.
 */

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
