import { join } from 'node:path';
import { resolveDbPath as resolveSharedDbPath } from '@life/shared';

/**
 * Single source of truth for the note-service DB path, shared by the
 * `backfill-encrypt` and `rotate-master-key` CLIs (`scripts/*.ts`).
 *
 * The resolution rule now lives in `@life/shared`'s generic
 * `resolveDbPath(envName, defaultPath, env?)` (AGENTS.md Contract 2 no-fork
 * rule; rule of three met by note, tags, todo). This module keeps its existing
 * public signature (`resolveDbPath(env)` + `DEFAULT_NOTE_DB_PATH`) as a thin
 * shim so the two CLIs and `test/backfill-db-path.test.ts` stay unchanged.
 *
 * The default is anchored at this package's own directory — `__dirname` is
 * `apps/note-service/src/keys` both under `ts-node scripts/*.ts` and under
 * jest, so `join(__dirname, '..', '..', 'data', 'life.db')` is
 * `apps/note-service/data/life.db` regardless of the process cwd. That matters
 * because npm runs workspace scripts from the repo root (`INIT_CWD`), where a
 * cwd-relative default would silently resolve to `<repo>/data/life.db`.
 */
export const DEFAULT_NOTE_DB_PATH = join(__dirname, '..', '..', 'data', 'life.db');

/**
 * Resolve the note-service DB path.
 *
 * Precedence:
 *   1. `NOTE_DB_PATH` env override, resolved against `INIT_CWD ?? cwd` so a
 *      relative override behaves exactly like the `backfill-owner` convention
 *      (npm sets a workspace script's cwd to the workspace; anchoring at
 *      `INIT_CWD` makes the documented repo-root command work).
 *   2. The package-anchored default {@link DEFAULT_NOTE_DB_PATH}, independent of
 *      cwd.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveSharedDbPath('NOTE_DB_PATH', DEFAULT_NOTE_DB_PATH, env);
}
