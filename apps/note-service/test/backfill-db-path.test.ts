import { join } from 'path';
import { defaultNoteDbPath, resolveDbPath } from '../src/keys/db.js';
import { resolveDbPath as backfillCliResolveDbPath } from '../scripts/encrypt-backfill.js';
import { resolveDbPath as rotateCliResolveDbPath } from '../scripts/rotate-master-key.js';

/**
 * `notes-backfill` T6 follow-up — DB path resolution for the two ops CLIs.
 *
 * Regression guard: the default must resolve to this package's own
 * `data/life.db` from *any* cwd, because npm runs the documented workspace
 * command from the repo root (`INIT_CWD=repo root`). A cwd-relative default
 * silently opened `<repo>/data/life.db` instead.
 *
 * No fixture DB is opened; these are pure path assertions (the `data/**` hard
 * line is untouched).
 */

const PACKAGE_DB = join(import.meta.dirname, '..', 'data', 'life.db');
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
/** The CLI entries pass this same value in (`src/keys/db-path.ts`). */
const PACKAGE_DIR = join(import.meta.dirname, '..');

describe('note-service ops CLI DB path resolution', () => {
  it('defaults to apps/note-service/data/life.db regardless of cwd / INIT_CWD', () => {
    // The documented command, run from the repo root: npm sets INIT_CWD=repo
    // root while the process cwd stays the workspace.
    expect(resolveDbPath({ INIT_CWD: REPO_ROOT }, PACKAGE_DB)).toBe(PACKAGE_DB);
    // An unrelated INIT_CWD, no env at all, or a bare cwd must all agree.
    expect(resolveDbPath({ INIT_CWD: '/somewhere/else' }, PACKAGE_DB)).toBe(PACKAGE_DB);
    expect(resolveDbPath({}, PACKAGE_DB)).toBe(PACKAGE_DB);
    // The package-anchored default itself: two hops above src/keys.
    expect(defaultNoteDbPath(PACKAGE_DIR)).toBe(PACKAGE_DB);
  });

  it('an explicit NOTE_DB_PATH override wins, anchored at INIT_CWD ?? cwd', () => {
    const root = join(import.meta.dirname, '..', 'tmp-root');
    expect(resolveDbPath({ INIT_CWD: root, NOTE_DB_PATH: 'rel/other.db' }, PACKAGE_DB)).toBe(
      join(root, 'rel', 'other.db'),
    );
    // Absolute overrides are taken as-is, not re-rooted.
    expect(resolveDbPath({ INIT_CWD: root, NOTE_DB_PATH: '/abs/other.db' }, PACKAGE_DB)).toBe(
      '/abs/other.db',
    );
    // An unset override with no default fails loudly rather than opening a
    // directory — the CLI always passes one, so this is a misuse guard.
    expect(() => resolveDbPath({})).toThrow(/NOTE_DB_PATH is unset/);
  });

  it('both CLIs import the same helper (identity, not a duplicated copy)', () => {
    expect(backfillCliResolveDbPath).toBe(resolveDbPath);
    expect(rotateCliResolveDbPath).toBe(resolveDbPath);
  });
});
