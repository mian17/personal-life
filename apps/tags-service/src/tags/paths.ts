import { defaultCleanupPaths } from './cleanup.js';
import { defaultImportPaths } from './import.js';

/**
 * The two CLIs' package-anchored DB defaults, computed from this module's real
 * location (`apps/tags-service/src/tags`) so the documented repo-root command
 * opens the right files regardless of cwd.
 *
 * ESM only. `import.meta.dirname` is a syntax error under the CommonJS ts-jest
 * transform (TS1343), so this module must never enter a test's import graph —
 * the two `scripts/*.cli.ts` entries are its only importers. `cleanup.ts` and
 * `import.ts` stay CJS-safe by taking the module directory as a parameter.
 */
export const DEFAULT_CLEANUP_PATHS = defaultCleanupPaths(import.meta.dirname);

export const DEFAULT_IMPORT_PATHS = defaultImportPaths(import.meta.dirname);
