import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import { pruneRoutineSnapshots, runBackup, selectPaths } from '../src/index.js';
import type { DatabaseName } from '../src/index.js';
import { main } from '../src/backup.js';
import { defaultDatabasePaths, resolvePaths } from '../src/paths.js';

/**
 * Path-resolution contract for the backup/restore CLIs (plan T2): the six
 * repo-anchored defaults, `resolvePaths` delegation to `@life/shared`'s
 * `resolveDbPath`, and `selectPaths`' `--only` subset. Every assertion is a
 * string comparison; no database under `apps/*\/data/**` is opened.
 */

/**
 * The repository root this test file sits three levels below. The defaults themselves are now a
 * parameter (`src/paths.ts` takes the root; `src/repo-paths.ts` is where the CLI entries get it
 * from `import.meta.dirname`), so the assertion names the same root the entries compute.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DEFAULTS = defaultDatabasePaths(REPO_ROOT);

const DEFAULT_NOTE_DB_PATH = DEFAULTS.life;
const DEFAULT_TAGS_DB_PATH = DEFAULTS.tags;
const DEFAULT_TODO_DB_PATH = DEFAULTS.todo;
const DEFAULT_IDP_DB_PATH = DEFAULTS.idp;
const DEFAULT_MEAL_DB_PATH = DEFAULTS.meal;
const DEFAULT_FOCUS_DB_PATH = DEFAULTS.focus;

describe('resolvePaths / selectPaths', () => {
  it('returns the six databases in order with their env names', () => {
    const paths = resolvePaths({}, DEFAULTS);
    expect(paths.map((p) => p.name)).toEqual(['life', 'tags', 'todo', 'idp', 'meal', 'focus']);
    expect(paths.map((p) => p.envName)).toEqual([
      'NOTE_DB_PATH',
      'TAGS_DB_PATH',
      'TODO_DB_PATH',
      'IDP_DB_PATH',
      'MEAL_DB_PATH',
      'FOCUS_DB_PATH',
    ]);
  });

  it('anchors each default at the repo root', () => {
    const paths = resolvePaths({}, DEFAULTS);
    expect(paths[0].source).toBe(DEFAULT_NOTE_DB_PATH);
    expect(paths[1].source).toBe(DEFAULT_TAGS_DB_PATH);
    expect(paths[2].source).toBe(DEFAULT_TODO_DB_PATH);
    expect(paths[3].source).toBe(DEFAULT_IDP_DB_PATH);
    expect(paths[4].source).toBe(DEFAULT_MEAL_DB_PATH);
    expect(paths[5].source).toBe(DEFAULT_FOCUS_DB_PATH);
    expect(DEFAULT_NOTE_DB_PATH.endsWith(join('apps', 'note-service', 'data', 'life.db'))).toBe(
      true,
    );
    expect(DEFAULT_TAGS_DB_PATH.endsWith(join('apps', 'tags-service', 'data', 'tags.db'))).toBe(
      true,
    );
    expect(DEFAULT_TODO_DB_PATH.endsWith(join('apps', 'todo-service', 'data', 'todo.db'))).toBe(
      true,
    );
    expect(DEFAULT_IDP_DB_PATH.endsWith(join('apps', 'idp', 'data', 'idp.db'))).toBe(true);
    expect(DEFAULT_MEAL_DB_PATH.endsWith(join('apps', 'meal-service', 'data', 'meal.db'))).toBe(
      true,
    );
    expect(DEFAULT_FOCUS_DB_PATH.endsWith(join('apps', 'focus-service', 'data', 'focus.db'))).toBe(
      true,
    );
  });

  it('honours a MEAL_DB_PATH override', () => {
    const paths = resolvePaths({ INIT_CWD: '/repo/root', MEAL_DB_PATH: 'rel/meal.db' }, DEFAULTS);
    expect(paths[4].name).toBe('meal');
    expect(paths[4].envName).toBe('MEAL_DB_PATH');
    expect(paths[4].source).toBe(join('/repo/root', 'rel', 'meal.db'));
  });

  it('yields the default unchanged when the env override is absent', () => {
    expect(resolvePaths({}, DEFAULTS)[0].source).toBe(DEFAULT_NOTE_DB_PATH);
  });

  it('resolves a relative override against INIT_CWD', () => {
    const paths = resolvePaths({ INIT_CWD: '/repo/root', NOTE_DB_PATH: 'rel/life.db' }, DEFAULTS);
    expect(paths[0].source).toBe(join('/repo/root', 'rel', 'life.db'));
  });

  it('falls back to cwd when INIT_CWD is absent', () => {
    const paths = resolvePaths({ TAGS_DB_PATH: 'rel/tags.db' }, DEFAULTS);
    expect(paths[1].source).toBe(join(process.cwd(), 'rel', 'tags.db'));
  });

  it('returns the full list from selectPaths when only is undefined', () => {
    const paths = resolvePaths({}, DEFAULTS);
    expect(selectPaths(paths)).toEqual(paths);
  });

  it('returns the named subset from selectPaths', () => {
    const paths = resolvePaths({}, DEFAULTS);
    expect(selectPaths(paths, ['idp', 'life'])).toEqual([paths[3], paths[0]]);
  });

  it('throws on an unknown --only database name', () => {
    const paths = resolvePaths({}, DEFAULTS);
    expect(() => selectPaths(paths, ['nope' as DatabaseName])).toThrow(/unknown database name/);
  });
});

/**
 * `db:backup` contract (`SPEC-db-backup-restore` `## Backup behavior`, `## Retention`,
 * `## Modes and naming`). Every fixture is a throwaway DB under the OS temp dir; no
 * `apps/*\/data/**` path is opened.
 */

const STAMP = '2026-10-01T12-34-56-789Z';

interface BackupFixture {
  root: string;
  backupRoot: string;
  sources: Record<DatabaseName, string>;
}

const dirs: string[] = [];

function seedDatabase(path: string, rows: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE t (x INTEGER)');
    const insert = db.prepare('INSERT INTO t (x) VALUES (?)');
    for (let i = 0; i < rows; i += 1) insert.run(i);
  } finally {
    db.close();
  }
}

/** A repo-root stand-in: `backup/` plus six seeded `apps/<svc>/data/<name>.db` sources. */
function makeBackupFixture(): BackupFixture {
  const root = mkdtempSync(join(tmpdir(), 'life-db-backup-'));
  dirs.push(root);
  const sources: Record<DatabaseName, string> = {
    life: join(root, 'apps', 'note-service', 'data', 'life.db'),
    tags: join(root, 'apps', 'tags-service', 'data', 'tags.db'),
    todo: join(root, 'apps', 'todo-service', 'data', 'todo.db'),
    idp: join(root, 'apps', 'idp', 'data', 'idp.db'),
    meal: join(root, 'apps', 'meal-service', 'data', 'meal.db'),
    focus: join(root, 'apps', 'focus-service', 'data', 'focus.db'),
  };
  for (const name of Object.keys(sources) as DatabaseName[]) {
    seedDatabase(sources[name], 2);
  }
  return { root, backupRoot: join(root, 'backup'), sources };
}

/** The env seam: `INIT_CWD` anchors `backup/` and every override resolves against it. */
function envFor(
  fixture: BackupFixture,
  only: DatabaseName[] = ['life', 'tags', 'todo', 'idp', 'meal', 'focus'],
) {
  const env: NodeJS.ProcessEnv = { INIT_CWD: fixture.root };
  const vars: Record<DatabaseName, string> = {
    life: 'NOTE_DB_PATH',
    tags: 'TAGS_DB_PATH',
    todo: 'TODO_DB_PATH',
    idp: 'IDP_DB_PATH',
    meal: 'MEAL_DB_PATH',
    focus: 'FOCUS_DB_PATH',
  };
  for (const name of only) env[vars[name]] = fixture.sources[name];
  return env;
}

const at = () => new Date('2026-10-01T12:34:56.789Z');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function makeRoutineSnapshot(
  backupRoot: string,
  name: string,
  options: { mode?: string; pinned?: boolean; marker?: boolean; manifest?: boolean } = {},
): string {
  const dir = join(backupRoot, name);
  mkdirSync(dir, { recursive: true });
  if (options.manifest !== false) {
    const manifest = { mode: options.mode ?? 'routine', pinned: options.pinned ?? false };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  if (options.marker) writeFileSync(join(dir, 'PINNED'), '');
  return dir;
}

describe('db:backup run', () => {
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('routine run writes one verified file per database plus manifest.json', () => {
    const fx = makeBackupFixture();
    const result = runBackup({
      argv: [],
      env: envFor(fx),
      defaults: defaultDatabasePaths(fx.root),
      now: at,
    });

    expect(result.mode).toBe('routine');
    expect(result.destination).toBe(join(fx.backupRoot, STAMP));
    expect(result.snapshots.map((s) => s.name)).toEqual([
      'life',
      'tags',
      'todo',
      'idp',
      'meal',
      'focus',
    ]);

    for (const snapshot of result.snapshots) {
      const target = join(result.destination, snapshot.file);
      expect(existsSync(target)).toBe(true);
      expect(snapshot.quickCheck).toBe('ok');
      expect(snapshot.bytes).toBeGreaterThan(0);
      const db = new Database(target, { readonly: true });
      try {
        expect(
          (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check,
        ).toBe('ok');
        expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(2);
      } finally {
        db.close();
      }
    }

    const manifest = JSON.parse(readFileSync(join(result.destination, 'manifest.json'), 'utf8'));
    expect(manifest.mode).toBe('routine');
    expect(manifest.pinned).toBe(false);
    expect(manifest.createdAt).toBe('2026-10-01T12:34:56.789Z');
    expect(manifest.databases.map((d: { name: string }) => d.name)).toEqual([
      'life',
      'tags',
      'todo',
      'idp',
      'meal',
      'focus',
    ]);
    expect(existsSync(join(result.destination, 'PINNED'))).toBe(false);
  });

  it('a run reads its sources only — bytes and mtime are unchanged', () => {
    const fx = makeBackupFixture();
    const before = Object.fromEntries(
      (Object.keys(fx.sources) as DatabaseName[]).map((name) => [name, sha256(fx.sources[name])]),
    );

    runBackup({ argv: [], env: envFor(fx), defaults: defaultDatabasePaths(fx.root), now: at });

    for (const name of Object.keys(fx.sources) as DatabaseName[]) {
      expect(sha256(fx.sources[name])).toBe(before[name]);
    }
  });

  it('--pin is deliberate and distinguishable by name and manifest', () => {
    const fx = makeBackupFixture();
    const result = runBackup({
      argv: ['--pin'],
      env: envFor(fx),
      defaults: defaultDatabasePaths(fx.root),
      now: at,
    });

    expect(result.mode).toBe('deliberate');
    expect(result.destination).toBe(join(fx.backupRoot, `${STAMP}-pinned`));
    expect(existsSync(join(result.destination, 'PINNED'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(result.destination, 'manifest.json'), 'utf8'));
    expect(manifest.mode).toBe('deliberate');
    expect(manifest.pinned).toBe(true);
  });

  it('--only meal snapshots exactly meal.db and requires none of the others', () => {
    const fx = makeBackupFixture();
    rmSync(fx.sources.life);
    rmSync(fx.sources.tags);
    rmSync(fx.sources.todo);
    rmSync(fx.sources.idp);

    const result = runBackup({
      argv: ['--only', 'meal'],
      env: envFor(fx, ['meal']),
      defaults: defaultDatabasePaths(fx.root),
      now: at,
    });

    expect(result.snapshots.map((s) => s.name)).toEqual(['meal']);
    expect(existsSync(join(result.destination, basename(fx.sources.meal)))).toBe(true);
    expect(readdirSync(result.destination).sort()).toEqual(['manifest.json', 'meal.db']);
  });

  it('--only selects and requires only the named databases', () => {
    const fx = makeBackupFixture();
    rmSync(fx.sources.tags);
    rmSync(fx.sources.todo);

    const result = runBackup({
      argv: ['--only', 'life,idp'],
      env: envFor(fx),
      defaults: defaultDatabasePaths(fx.root),
      now: at,
    });

    expect(result.snapshots.map((s) => s.name)).toEqual(['life', 'idp']);
    expect(existsSync(join(result.destination, basename(fx.sources.life)))).toBe(true);
    expect(existsSync(join(result.destination, basename(fx.sources.idp)))).toBe(true);
  });

  it('rejects an unknown --only name before anything is written', () => {
    const fx = makeBackupFixture();
    expect(() =>
      runBackup({
        argv: ['--only', 'life,nope'],
        env: envFor(fx),
        defaults: defaultDatabasePaths(fx.root),
        now: at,
      }),
    ).toThrow(/unknown database name/);
    expect(existsSync(fx.backupRoot)).toBe(false);
  });

  it('D10: a missing selected database aborts before the destination directory exists', () => {
    const fx = makeBackupFixture();
    rmSync(fx.sources.todo);

    const printError = jest.fn();
    const original = console.error;
    console.error = ((line: string) => printError(line)) as typeof console.error;
    try {
      expect(main([], envFor(fx), defaultDatabasePaths(fx.root))).toBe(1);
    } finally {
      console.error = original;
    }

    expect(existsSync(fx.backupRoot)).toBe(false);
    const printed = printError.mock.calls.map((call) => call[0] as string).join('\n');
    expect(printed).toContain(fx.sources.todo);
  });

  it('D10: a missing meal fixture aborts the selected run before anything is written', () => {
    const fx = makeBackupFixture();
    rmSync(fx.sources.meal);

    const printError = jest.fn();
    const original = console.error;
    console.error = ((line: string) => printError(line)) as typeof console.error;
    try {
      expect(main([], envFor(fx), defaultDatabasePaths(fx.root))).toBe(1);
    } finally {
      console.error = original;
    }

    expect(existsSync(fx.backupRoot)).toBe(false);
    const printed = printError.mock.calls.map((call) => call[0] as string).join('\n');
    expect(printed).toContain(fx.sources.meal);
  });

  it('CLI success prints one line per snapshot and exits 0', () => {
    const fx = makeBackupFixture();
    const print = jest.fn();
    const original = console.log;
    console.log = ((line: string) => print(line)) as typeof console.log;
    try {
      expect(main([], envFor(fx), defaultDatabasePaths(fx.root))).toBe(0);
    } finally {
      console.log = original;
    }
    expect(print).toHaveBeenCalledTimes(6);
    expect(print.mock.calls[0][0]).toContain('db:backup [routine] life.db -> ');
    expect(print.mock.calls[0][0]).toContain('quick_check=ok');
  });
});

describe('pruneRoutineSnapshots', () => {
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the newest 10 routine snapshots and prunes the older ones by name', () => {
    const fx = makeBackupFixture();
    const names = Array.from({ length: 11 }, (_, i) => `2026-10-01T00-00-00-00${i}Z`);
    for (const name of names) makeRoutineSnapshot(fx.backupRoot, name);
    const pinned = makeRoutineSnapshot(fx.backupRoot, '2026-09-30T00-00-00-000Z-pinned', {
      mode: 'deliberate',
      pinned: true,
      marker: true,
    });
    const manifestless = makeRoutineSnapshot(fx.backupRoot, '2026-09-30T00-00-00-001Z', {
      manifest: false,
    });
    const preRestore = makeRoutineSnapshot(fx.backupRoot, 'pre-restore-2026-09-30T00-00-00-002Z', {
      mode: 'pre-restore',
      pinned: true,
      marker: true,
    });

    const { pruned, failed } = pruneRoutineSnapshots(fx.backupRoot);

    expect(failed).toEqual([]);
    expect(pruned.map((p) => basename(p))).toEqual([names[0]]);
    expect(existsSync(join(fx.backupRoot, names[0]))).toBe(false);
    for (const name of names.slice(1)) expect(existsSync(join(fx.backupRoot, name))).toBe(true);
    expect(existsSync(pinned)).toBe(true);
    expect(existsSync(manifestless)).toBe(true);
    expect(existsSync(preRestore)).toBe(true);
  });

  it('honours a custom keep count', () => {
    const fx = makeBackupFixture();
    for (let i = 0; i < 5; i += 1)
      makeRoutineSnapshot(fx.backupRoot, `2026-10-01T00-00-00-00${i}Z`);
    const { pruned } = pruneRoutineSnapshots(fx.backupRoot, 2);
    expect(pruned).toHaveLength(3);
    expect(readdirSync(fx.backupRoot)).toHaveLength(2);
  });
});
