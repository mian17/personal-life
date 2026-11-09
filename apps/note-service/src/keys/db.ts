import { join } from 'node:path';
import { resolveDbPath as resolveSharedDbPath } from '@life/shared/node';

/**
 * Single source of truth for the note-service DB path, shared by the
 * `backfill-encrypt` and `rotate-master-key` CLIs (`scripts/*.ts`).
 *
 * The resolution rule now lives in `@life/shared`'s generic
 * `resolveDbPath(envName, defaultPath, env?)` (AGENTS.md Contract 2 no-fork
 * rule; rule of three met by note, tags, todo). This module keeps the
 * resolution rule as a thin shim over it.
 *
 * The package anchor is a *parameter*, not `__dirname`: this module is imported
 * by tests, which ts-jest compiles to CommonJS, where both `__dirname` and
 * `import.meta` cannot coexist with the ESM build. `src/keys/db-path.ts` owns
 * the `import.meta.dirname` hop and is imported by the CLI entries alone.
 */
export function defaultNoteDbPath(packageDir: string): string {
  return join(packageDir, 'data', 'life.db');
}

/**
 * Resolve the note-service DB path.
 *
 * Precedence:
 *   1. `NOTE_DB_PATH` env override, resolved against `INIT_CWD ?? cwd` so a
 *      relative override behaves exactly like the `backfill-owner` convention
 *      (npm sets a workspace script's cwd to the workspace; anchoring at
 *      `INIT_CWD` makes the documented repo-root command work).
 *   2. `defaultPath`, supplied by the caller from {@link defaultNoteDbPath} —
 *      package-anchored, independent of cwd. `''` means "the caller has no
 *      anchor", which fails loudly unless an override is set.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv, defaultPath = ''): string {
  // `resolve()` would quietly return the bare root for an empty default and
  // open a directory, so an unset override with no anchor fails loudly instead.
  if (!defaultPath && !env.NOTE_DB_PATH) {
    throw new Error('NOTE_DB_PATH is unset and no default DB path was supplied');
  }
  return resolveSharedDbPath('NOTE_DB_PATH', defaultPath, env);
}
