import { pathToFileURL } from 'node:url';
import { main } from './backfill-owner.js';

/**
 * `backfill-owner` process entry. Kept out of `backfill-owner.ts` because that
 * file is imported by `test/owner-backfill.e2e-spec.ts` (CommonJS transform,
 * where `import.meta` is TS1343) and by the ESM build (where `require.main` is
 * not defined). ESM has no `require.main`, and Node 22 has no
 * `import.meta.main`, so "was I run directly?" is answered by comparing the
 * entry path.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
