import { join } from 'path';
import {
  DEFAULT_IDP_DB_PATH,
  DEFAULT_NOTE_DB_PATH,
  DEFAULT_TAGS_DB_PATH,
  DEFAULT_TODO_DB_PATH,
  resolvePaths,
  selectPaths,
} from '../src/index';
import type { DatabaseName } from '../src/index';

/**
 * Path-resolution contract for the backup/restore CLIs (plan T2): the four
 * repo-anchored defaults, `resolvePaths` delegation to `@life/shared`'s
 * `resolveDbPath`, and `selectPaths`' `--only` subset. Every assertion is a
 * string comparison; no database under `apps/*\/data/**` is opened.
 */

describe('resolvePaths / selectPaths', () => {
  it('returns the four databases in order with their env names', () => {
    const paths = resolvePaths({});
    expect(paths.map((p) => p.name)).toEqual(['life', 'tags', 'todo', 'idp']);
    expect(paths.map((p) => p.envName)).toEqual([
      'NOTE_DB_PATH',
      'TAGS_DB_PATH',
      'TODO_DB_PATH',
      'IDP_DB_PATH',
    ]);
  });

  it('anchors each default at the repo root', () => {
    const paths = resolvePaths({});
    expect(paths[0].source).toBe(DEFAULT_NOTE_DB_PATH);
    expect(paths[1].source).toBe(DEFAULT_TAGS_DB_PATH);
    expect(paths[2].source).toBe(DEFAULT_TODO_DB_PATH);
    expect(paths[3].source).toBe(DEFAULT_IDP_DB_PATH);
    expect(DEFAULT_NOTE_DB_PATH.endsWith(join('apps', 'note-service', 'data', 'life.db'))).toBe(true);
    expect(DEFAULT_TAGS_DB_PATH.endsWith(join('apps', 'tags-service', 'data', 'tags.db'))).toBe(true);
    expect(DEFAULT_TODO_DB_PATH.endsWith(join('apps', 'todo-service', 'data', 'todo.db'))).toBe(true);
    expect(DEFAULT_IDP_DB_PATH.endsWith(join('apps', 'idp', 'data', 'idp.db'))).toBe(true);
  });

  it('yields the default unchanged when the env override is absent', () => {
    expect(resolvePaths({})[0].source).toBe(DEFAULT_NOTE_DB_PATH);
  });

  it('resolves a relative override against INIT_CWD', () => {
    const paths = resolvePaths({ INIT_CWD: '/repo/root', NOTE_DB_PATH: 'rel/life.db' });
    expect(paths[0].source).toBe(join('/repo/root', 'rel', 'life.db'));
  });

  it('falls back to cwd when INIT_CWD is absent', () => {
    const paths = resolvePaths({ TAGS_DB_PATH: 'rel/tags.db' });
    expect(paths[1].source).toBe(join(process.cwd(), 'rel', 'tags.db'));
  });

  it('returns the full list from selectPaths when only is undefined', () => {
    const paths = resolvePaths({});
    expect(selectPaths(paths)).toEqual(paths);
  });

  it('returns the named subset from selectPaths', () => {
    const paths = resolvePaths({});
    expect(selectPaths(paths, ['idp', 'life'])).toEqual([paths[3], paths[0]]);
  });

  it('throws on an unknown --only database name', () => {
    const paths = resolvePaths({});
    expect(() => selectPaths(paths, ['nope' as DatabaseName])).toThrow(/unknown database name/);
  });
});
