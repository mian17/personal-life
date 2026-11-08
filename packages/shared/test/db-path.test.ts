import { join } from 'path';
import { resolveDbPath } from '../src/node';

/**
 * Contract for the generic `resolveDbPath(envName, defaultPath, env?)` extracted
 * into `@life/shared` (`SPEC-service-kernel` "Shared primitives"). Per-service
 * defaults and env names are the caller's; this suite pins only the resolution
 * rule.
 */

describe('resolveDbPath (generic)', () => {
  const DEFAULT = '/pkg/data/life.db';

  it('returns the caller default when the env var is unset', () => {
    expect(resolveDbPath('NOTE_DB_PATH', DEFAULT, {})).toBe(DEFAULT);
  });

  it('resolves a relative override against INIT_CWD (repo-root command works)', () => {
    const root = '/repo/root';
    expect(resolveDbPath('NOTE_DB_PATH', DEFAULT, { INIT_CWD: root, NOTE_DB_PATH: 'rel/other.db' })).toBe(
      join(root, 'rel', 'other.db'),
    );
  });

  it('passes an absolute override through unchanged', () => {
    expect(
      resolveDbPath('TAGS_DB_PATH', DEFAULT, { INIT_CWD: '/repo', TAGS_DB_PATH: '/abs/tags.db' }),
    ).toBe('/abs/tags.db');
  });

  it('falls back to process.cwd() when INIT_CWD is absent', () => {
    expect(resolveDbPath('TODO_DB_PATH', DEFAULT, { TODO_DB_PATH: 'rel/todo.db' })).toBe(
      join(process.cwd(), 'rel', 'todo.db'),
    );
  });

  it('is service-agnostic: the env name is a parameter, not a hard-coded constant', () => {
    const env = { TAGS_DB_PATH: '/custom/tags.db', NOTE_DB_PATH: '/should/not/win.db' };
    expect(resolveDbPath('TAGS_DB_PATH', DEFAULT, env)).toBe('/custom/tags.db');
    expect(resolveDbPath('NOTE_DB_PATH', DEFAULT, env)).toBe('/should/not/win.db');
  });

  it('reads process.env by default when no env object is supplied', () => {
    const saved = process.env.LIFE_TEST_DB_PATH;
    try {
      process.env.LIFE_TEST_DB_PATH = '/from/process/env.db';
      expect(resolveDbPath('LIFE_TEST_DB_PATH', DEFAULT)).toBe('/from/process/env.db');
      delete process.env.LIFE_TEST_DB_PATH;
      expect(resolveDbPath('LIFE_TEST_DB_PATH', DEFAULT)).toBe(DEFAULT);
    } finally {
      if (saved === undefined) delete process.env.LIFE_TEST_DB_PATH;
      else process.env.LIFE_TEST_DB_PATH = saved;
    }
  });
});
