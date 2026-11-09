import { join } from 'node:path';
import { resolveDbPath } from '@life/shared/node';

export type DatabaseName = 'life' | 'tags' | 'todo' | 'idp' | 'meal' | 'focus';

export interface ResolvedPath {
  name: DatabaseName;
  envName: string;
  source: string;
}

/** The six databases' env var names, in the order every CLI reports them. */
const ENV_NAMES: Readonly<Record<DatabaseName, string>> = {
  life: 'NOTE_DB_PATH',
  tags: 'TAGS_DB_PATH',
  todo: 'TODO_DB_PATH',
  idp: 'IDP_DB_PATH',
  meal: 'MEAL_DB_PATH',
  focus: 'FOCUS_DB_PATH',
};

const DATABASE_NAMES = Object.keys(ENV_NAMES) as DatabaseName[];

/** Each database's file, relative to the repository root. */
const DATABASE_FILES: Readonly<Record<DatabaseName, string>> = {
  life: join('apps', 'note-service', 'data', 'life.db'),
  tags: join('apps', 'tags-service', 'data', 'tags.db'),
  todo: join('apps', 'todo-service', 'data', 'todo.db'),
  idp: join('apps', 'idp', 'data', 'idp.db'),
  meal: join('apps', 'meal-service', 'data', 'meal.db'),
  focus: join('apps', 'focus-service', 'data', 'focus.db'),
};

/** The six repo-anchored defaults, as `resolvePaths` wants them. */
export type DatabasePaths = Readonly<Record<DatabaseName, string>>;

/**
 * The six package-anchored defaults for one repository root, so the documented repo-root command
 * opens the right files regardless of cwd.
 *
 * The anchor is a parameter, not `__dirname`: this module is imported by tests, which ts-jest
 * compiles to CommonJS, where `import.meta` is illegal (TS1343) — and `__dirname` is illegal in
 * the ESM build. `src/repo-paths.ts` owns the `import.meta.dirname` hop and is imported only by
 * the CLI entries.
 */
export function defaultDatabasePaths(repoRoot: string): DatabasePaths {
  const paths = {} as Record<DatabaseName, string>;
  for (const name of DATABASE_NAMES) paths[name] = join(repoRoot, DATABASE_FILES[name]);
  return paths;
}

/** No anchor at all: every database then needs its own env override, which fails loudly if absent. */
const NO_DEFAULTS: Partial<Record<DatabaseName, string>> = {};

/**
 * Resolve each database's path: its env override against `INIT_CWD ?? cwd`, else `defaults[name]`.
 * `defaults` is supplied by the caller — the CLI entries pass the package-anchored
 * {@link defaultDatabasePaths} result, a test passes its own fixture root.
 */
export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
  defaults: Partial<Record<DatabaseName, string>> = NO_DEFAULTS,
): ResolvedPath[] {
  return DATABASE_NAMES.map((name) => {
    const envName = ENV_NAMES[name];
    const fallback = defaults[name];
    const source = resolveDbPath(envName, fallback ?? '', env);
    if (source === '') {
      throw new Error(`${envName} is unset and no default DB path was supplied`);
    }
    return { name, envName, source };
  });
}

export function selectPaths(
  paths: readonly ResolvedPath[],
  only?: readonly DatabaseName[],
): ResolvedPath[] {
  if (!only) return [...paths];
  return only.map((name) => {
    const match = paths.find((entry) => entry.name === name);
    if (!match) throw new Error(`unknown database name: ${name}`);
    return match;
  });
}
