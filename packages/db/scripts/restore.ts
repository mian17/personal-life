import { main } from '../src/restore';

/**
 * `db:restore` entry (`SPEC-db-backup-restore` `## Commands`). Thin CLI over the
 * tested core in `src/restore.ts`; run via the workspace convention:
 *
 *   npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
 *   npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only idp
 *
 * Hard line: the human runs this against the real DBs with the stack stopped; agents
 * and tests only ever touch temp fixtures. It refuses unless the stack probes down.
 */

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
