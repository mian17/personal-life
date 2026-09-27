import { resolve } from 'path';

/**
 * Shared, service-agnostic DB path resolution (`SPEC-service-kernel` "Shared
 * primitives"; AGENTS.md Contract 2 no-fork rule — rule of three met by note,
 * tags, and todo). Extracted from `apps/note-service/src/keys/db.ts`.
 *
 * Precedence:
 *   1. The named env override (`envName`), resolved against `INIT_CWD ?? cwd` so
 *      a relative override behaves exactly like the `backfill-owner` convention
 *      (npm sets a workspace script's cwd to the workspace; anchoring at
 *      `INIT_CWD` makes the documented repo-root command work). An absolute
 *      override passes through unchanged (`resolve` returns it as-is).
 *   2. The caller-supplied `defaultPath`, independent of cwd.
 *
 * Each service owns its own default (package-anchored, e.g. via `__dirname`) and
 * its own env var name; this helper owns only the resolution rule.
 *
 * `env` is an optional test seam: the shipped call sites pass just
 * `(envName, defaultPath)` and read `process.env`, while callers that must keep a
 * pinned env-object API (note-service's `resolveDbPath(env)`) pass the object
 * through without touching global state.
 */
export function resolveDbPath(
  envName: string,
  defaultPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[envName];
  if (override) {
    const root = env.INIT_CWD ?? process.cwd();
    return resolve(root, override);
  }
  return defaultPath;
}
