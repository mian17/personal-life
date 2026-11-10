import { pathToFileURL } from 'node:url';
import { main } from './encrypt-backfill.js';
import { DEFAULT_NOTE_DB_PATH } from '../src/keys/db-path.js';

/**
 * `backfill-encrypt` process entry. Kept out of `encrypt-backfill.ts` because
 * that file is imported by `test/backfill-db-path.test.ts` (CommonJS transform,
 * where `import.meta` is TS1343) and by the ESM build (where `require.main` is
 * not defined). ESM has no `require.main`, and Node 22 has no
 * `import.meta.main`, so "was I run directly?" is answered by comparing the
 * entry path.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    defaultNoteDbPath: DEFAULT_NOTE_DB_PATH,
  });
}
