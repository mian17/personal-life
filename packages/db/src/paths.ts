import { join } from 'path';
import { resolveDbPath } from '@life/shared';

export type DatabaseName = 'life' | 'tags' | 'todo' | 'idp' | 'meal';

export interface ResolvedPath {
  name: DatabaseName;
  envName: string;
  source: string;
}

const REPO_ROOT = join(__dirname, '..', '..', '..');

export const DEFAULT_NOTE_DB_PATH = join(REPO_ROOT, 'apps', 'note-service', 'data', 'life.db');
export const DEFAULT_TAGS_DB_PATH = join(REPO_ROOT, 'apps', 'tags-service', 'data', 'tags.db');
export const DEFAULT_TODO_DB_PATH = join(REPO_ROOT, 'apps', 'todo-service', 'data', 'todo.db');
export const DEFAULT_IDP_DB_PATH = join(REPO_ROOT, 'apps', 'idp', 'data', 'idp.db');
export const DEFAULT_MEAL_DB_PATH = join(REPO_ROOT, 'apps', 'meal-service', 'data', 'meal.db');

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ResolvedPath[] {
  return [
    { name: 'life', envName: 'NOTE_DB_PATH', source: resolveDbPath('NOTE_DB_PATH', DEFAULT_NOTE_DB_PATH, env) },
    { name: 'tags', envName: 'TAGS_DB_PATH', source: resolveDbPath('TAGS_DB_PATH', DEFAULT_TAGS_DB_PATH, env) },
    { name: 'todo', envName: 'TODO_DB_PATH', source: resolveDbPath('TODO_DB_PATH', DEFAULT_TODO_DB_PATH, env) },
    { name: 'idp', envName: 'IDP_DB_PATH', source: resolveDbPath('IDP_DB_PATH', DEFAULT_IDP_DB_PATH, env) },
    { name: 'meal', envName: 'MEAL_DB_PATH', source: resolveDbPath('MEAL_DB_PATH', DEFAULT_MEAL_DB_PATH, env) },
  ];
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
