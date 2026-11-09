#!/usr/bin/env node
/**
 * Produce one lcov report for SonarQube from every suite that can report one:
 * each workspace's jest suite, plus the `node --test` suites under `scripts/`.
 *
 * Why this exists: SonarQube reported 0.0% coverage because no lcov report was
 * ever generated, so the scanner had nothing to ingest. Every workspace already
 * had a jest suite; only the reporting step was missing. The `scripts/` suites
 * were missed by the first version for the same reason one level down — they
 * run under `node --test`, not jest, so Sonar saw their product files (the
 * autofix receiver, this reporter) as entirely uncovered.
 *
 * Two things make the merge correct rather than merely present:
 *  - `SF:` paths are rewritten to repository-relative. SonarQube resolves a
 *    relative `SF:` against the project base directory, so a workspace-relative
 *    or absolute path would silently match no indexed file and be dropped.
 *  - A source file can be instrumented by more than one workspace (a workspace
 *    maps `@life/*` imports straight at another package's `src/`). Keeping the
 *    hit counts from the most-covered run avoids both duplicated records and
 *    understated totals.
 *
 * Reports land in `.coverage/`, which is gitignored and excluded from scanning.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '.coverage');
const JEST = join(ROOT, 'node_modules', '.bin', 'jest');

/** Workspace paths in the root manifest's order (already dependency-ordered). */
function workspaceDirs() {
  const { workspaces } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return (Array.isArray(workspaces) ? workspaces : []).flatMap((pattern) => {
    if (!pattern.includes('*')) return [pattern];
    const [parent] = pattern.split('/');
    return readdirSync(join(ROOT, parent))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `${parent}/${name}`)
      .filter((dir) => existsSync(join(ROOT, dir, 'package.json')));
  });
}

/** Only workspaces that actually declare a jest suite. */
function testableWorkspaces() {
  return workspaceDirs().filter((dir) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    return Boolean(manifest.jest) && Boolean(manifest.scripts?.['test:unit']);
  });
}

function runWorkspace(dir) {
  const coverageDir = join(OUT_DIR, 'raw', dir.replaceAll('/', '__'));
  rmSync(coverageDir, { recursive: true, force: true });
  console.log(`\n=== coverage: ${dir}`);
  try {
    // `--testTimeout` overrides jest's 5s default for hooks too. Instrumentation
    // roughly doubles ts-jest compile cost, and on a cold cache (every CI run)
    // an e2e `beforeAll` that boots Nest + sqlite crosses 5s and fails the suite
    // spuriously — measured 2/13 note-service suites red cold vs green warm.
    //
    // `NODE_OPTIONS` carries the vm-modules flag because a workspace's `.mts`
    // suites need it, and this runner spawns jest directly instead of through
    // `npm run test:unit`, so it does not inherit the flag from the script. Jest
    // cannot load an ESM-only package without it: its CommonJS registry rejects
    // the import with ERR_REQUIRE_ESM.
    execFileSync(
      JEST,
      [
        '--coverage',
        '--coverageReporters=lcov',
        `--coverageDirectory=${coverageDir}`,
        '--silent',
        '--testTimeout=30000',
      ],
      {
        cwd: join(ROOT, dir),
        env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
  } catch {
    // A suite that fails still emits its report; the failure is reported by
    // `npm test`, and CI must not scan a stale report over a red suite.
    console.error(`=== coverage: ${dir} FAILED`);
    process.exitCode = 1;
  }
  return join(coverageDir, 'lcov.info');
}

/**
 * `node --test` suites that live outside any workspace (the dev tooling under
 * `scripts/`). Jest never sees them, so their coverage has to be collected by
 * the runner itself.
 */
function nodeTestSuites() {
  return readdirSync(join(ROOT, 'scripts'), { recursive: true })
    .map((entry) => `scripts/${entry.split(sep).join('/')}`)
    .filter((entry) => entry.endsWith('.test.mjs'))
    .sort((a, b) => a.localeCompare(b));
}

/** Run one `node --test` suite and return the lcov it prints on stdout. */
function runNodeSuite(file) {
  console.log(`\n=== coverage: ${file}`);
  try {
    return execFileSync(
      process.execPath,
      ['--test', '--experimental-test-coverage', '--test-reporter=lcov', file],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
  } catch (error) {
    // Same rule as jest: keep the report the suite managed to print, but fail.
    console.error(`=== coverage: ${file} FAILED`);
    process.exitCode = 1;
    return typeof error.stdout === 'string' ? error.stdout : '';
  }
}

/** `SF:` -> repository-relative, dropping anything SonarQube cannot index. */
export function normalizePath(sf, workspace) {
  const absolute = sf.startsWith('/') ? sf : resolve(ROOT, workspace, sf);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || rel.includes('node_modules')) return null;
  if (/(^|\/)(dist|coverage|\.next)\//.test(rel)) return null;
  if (/\.(test|spec|e2e-spec)\.(?:ts|tsx|mjs|cjs|js)$|(^|\/)test\//.test(rel)) return null;
  return rel.split(sep).join('/');
}

/** Parse an lcov report into records keyed by repository-relative source path. */
export function parseLcov(text, workspace) {
  const records = new Map();
  for (const block of text.split('end_of_record')) {
    const lines = block.split('\n').map((line) => line.trim());
    const sf = lines.find((line) => line.startsWith('SF:'));
    if (!sf) continue;
    const path = normalizePath(sf.slice(3), workspace);
    if (!path) continue;
    const kept = lines.filter((line) => line && !line.startsWith('SF:'));
    const hits = kept.reduce((total, line) => {
      const match = /^DA:\d+,(\d+)/.exec(line);
      return total + (match ? Number(match[1]) : 0);
    }, 0);
    const existing = records.get(path);
    if (!existing || hits > existing.hits) records.set(path, { path, kept, hits });
  }
  return records;
}

/** Keep the most-covered record per source path (see the header for why). */
function mergeRecord(merged, record) {
  const existing = merged.get(record.path);
  if (!existing || record.hits > existing.hits) merged.set(record.path, record);
}

function main() {
  const merged = new Map();
  for (const dir of testableWorkspaces()) {
    const report = runWorkspace(dir);
    if (!existsSync(report)) continue;
    for (const record of parseLcov(readFileSync(report, 'utf8'), dir).values()) {
      mergeRecord(merged, record);
    }
  }
  for (const file of nodeTestSuites()) {
    for (const record of parseLcov(runNodeSuite(file), '.').values()) {
      mergeRecord(merged, record);
    }
  }

  if (merged.size === 0) {
    console.error('coverage: no lcov records produced');
    process.exitCode = 1;
    return;
  }

  const body = [...merged.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, kept }) => [`SF:${path}`, ...kept, 'end_of_record'].join('\n'))
    .join('\n');

  const out = join(OUT_DIR, 'lcov.info');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(out, `${body}\n`);
  console.log(`\ncoverage: ${merged.size} files -> ${relative(ROOT, out)}`);
}

// Importable for `scripts/coverage.test.mjs`; only the CLI invocation runs a scan.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
