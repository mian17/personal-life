import { join } from 'node:path';
import { defaultNoteDbPath } from './db.js';

/**
 * The package-anchored default note DB, `apps/note-service/data/life.db`.
 *
 * ESM only. `import.meta.dirname` is a syntax error under the CommonJS ts-jest
 * transform (TS1343), so this module must never enter a test's import graph —
 * the four CLI entries under `scripts/*.cli.ts` are its only importers.
 * `src/keys/db.ts` stays CJS-safe by taking the package directory as a
 * parameter; this file is where the directory comes from at runtime.
 */
export const DEFAULT_NOTE_DB_PATH = defaultNoteDbPath(join(import.meta.dirname, '..', '..'));
