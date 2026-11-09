import { join } from 'node:path';
import { defaultDatabasePaths } from './paths.js';

/**
 * The four `db:*` CLIs' package-anchored DB defaults, computed from this module's real location
 * (`packages/db/src`) so the documented repo-root command opens the right files regardless of cwd.
 *
 * ESM only. `import.meta.dirname` is a syntax error under the CommonJS ts-jest transform (TS1343),
 * so this module must never enter a test's import graph — the four `scripts/*.ts` entries are its
 * only importers. `paths.ts` stays CJS-safe by taking the repo root as a parameter; this file is
 * where the root comes from at runtime.
 */
export const DEFAULT_DATABASE_PATHS = defaultDatabasePaths(
  join(import.meta.dirname, '..', '..', '..'),
);
