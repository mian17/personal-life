import { join, resolve } from 'node:path';

/**
 * The single source of truth for the IdP's SQLite file. Both the service
 * (`app.module.ts`) and the seed script use this so they can never disagree.
 *
 * `NODE_ENV` is this repo's environment switch (middleware dev-skip, cookie
 * `Secure`, secret enforcement). It decides the *default* here:
 * - explicit `DB_PATH` always wins (compose sets `/data/idp.db`);
 * - `NODE_ENV=production` → `data/idp.db` (the real identity DB);
 * - anything else (development/test/unset) → `data/scratch.db`, so local work
 *   never touches the produced identity DB.
 *
 * Paths are relative to the process cwd, which for `npm run … -w apps/idp` is
 * `apps/idp`, so the defaults land in `apps/idp/data/`.
 */

/** Filename of the real identity database (only used under NODE_ENV=production). */
export const PROD_DB_FILENAME = 'idp.db';

/** Filename of the throwaway database used outside production. */
export const SCRATCH_DB_FILENAME = 'scratch.db';

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DB_PATH) return env.DB_PATH;
  const filename =
    env.NODE_ENV === 'production' ? PROD_DB_FILENAME : SCRATCH_DB_FILENAME;
  return join(process.cwd(), 'data', filename);
}

/** The production identity DB path this process would use (canonicalized). */
export function productionDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(join(process.cwd(), 'data', PROD_DB_FILENAME));
}

/**
 * True when `candidate` resolves to the production identity DB. Canonicalizes
 * so `data/idp.db`, `./data/idp.db`, and absolute equivalents all match.
 */
export function isProductionDbPath(
  candidate: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolve(candidate) === productionDbPath(env);
}
