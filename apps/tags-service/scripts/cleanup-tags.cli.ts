import { pathToFileURL } from 'node:url';
import { main } from './cleanup-tags.js';
import { DEFAULT_CLEANUP_PATHS } from '../src/tags/paths.js';

/**
 * `cleanup-tags` process entry. Kept out of `cleanup-tags.ts` because that file
 * is imported by `test/cleanup-tags.test.ts` (CommonJS transform, where
 * `import.meta` is TS1343) and by the ESM build (where `require.main` is not
 * defined). ESM has no `require.main`, and Node 22 has no `import.meta.main`,
 * so "was I run directly?" is answered by comparing the entry path.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), { defaultPaths: DEFAULT_CLEANUP_PATHS });
}
