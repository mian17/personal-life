import { pathToFileURL } from 'node:url';
import { main } from './grant-origin.js';

/**
 * `grant-origin` process entry. Kept out of `grant-origin.ts` because that file is
 * imported by `test/grant-cli.e2e-spec.ts` (CommonJS transform, where `import.meta`
 * is TS1343) and by the ESM build (where `require.main` is not defined). ESM has no
 * `require.main`, and Node 22 has no `import.meta.main`, so "was I run directly?"
 * is answered by comparing the entry path — the `backfill-owner.cli.ts` shape.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
