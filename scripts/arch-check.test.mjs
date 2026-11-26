/**
 * Guards the five mechanical architecture rules in `scripts/arch-check.mjs`.
 *
 * Rule 3 (one database per service) and rule 4 (the designated engine) judge the
 * topology on disk, so each is fed a throwaway worktree holding only the files
 * the assertion needs — plus the real checkout, to prove today's tree is clean.
 * Rule 5 (no cross-service reach) is judged on new lines only, so its cases differ
 * by the base content, by whether the line is code or comment, and by whether git
 * lists the file at all (a new directory). Rule 6 (a required variable is
 * forwarded) is fed fixtures too, one per read shape: dot access, bracket access
 * through a constant (declared in the same app and in a workspace package), and a
 * read that has a fallback and must stay silent. Rule 7 (no self-hosted runner) is
 * planted a workflow to fail on — under `pull_request` and under
 * `workflow_dispatch`, because it bans the runner whatever the trigger — and
 * checked against the real checkout, which carries the phrase in two doc comments
 * and must stay clean. The usage cases drive the script as a child process,
 * because exit code and stderr are what they assert.
 *
 * Run: npm run test:arch
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkCrossServiceAccess,
  checkDatabasePerService,
  checkEngineIsDesignated,
  checkEnvForwarding,
  checkNoSelfHostedRunners,
  findCrossServiceFindings,
} from './arch-check.mjs';

/** The checkout this test runs in: `scripts/`'s parent. */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** The `git` a fixture commit needs; fixed paths, never a `PATH` search. */
const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((candidate) => {
  try {
    execFileSync(candidate, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

/** A throwaway worktree holding exactly `files`, keyed by repo-relative path. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'arch-check-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

/** The `TypeOrmModule.forRoot` block one service boots, as the checker reads it. */
function moduleSource(engine, filename = 'service.db') {
  return [
    'TypeOrmModule.forRoot({',
    `  type: '${engine}',`,
    `  database: process.env.DB_PATH ?? join(process.cwd(), 'data', '${filename}'),`,
    '})',
    '',
  ].join('\n');
}

/** One compose service: a build, a `DB_PATH`, and one host bind mount. */
function composeService(name, dbPath, hostDirectory) {
  return [
    `  ${name}:`,
    '    image: node:24',
    '    environment:',
    `      DB_PATH: ${dbPath}`,
    '    volumes:',
    `      - ${hostDirectory}:/data`,
    '',
  ].join('\n');
}

/** A real git repo in a temp directory, so rule 5's diff scoping has a base ref. */
function gitFixture(files) {
  const root = fixture(files);
  const git = (...args) => execFileSync(GIT, ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'dev');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return { root, git };
}

test('rule 3: two services bound to one host directory are one store', () => {
  const root = fixture({
    'compose.yaml': [
      'services:',
      composeService('note-service', '/data/life.db', './apps/shared'),
      composeService('todo-service', '/data/todo.db', './apps/shared'),
    ].join('\n'),
    'apps/note-service/src/app.module.ts': moduleSource('better-sqlite3', 'life.db'),
    'apps/todo-service/src/app.module.ts': moduleSource('better-sqlite3', 'todo.db'),
  });

  try {
    const findings = checkDatabasePerService(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 3);
    assert.match(findings[0].message, /share the mount apps\/shared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 3: today’s tree gives every service its own store', () => {
  assert.deepEqual(checkDatabasePerService(REPO), []);
});

test("rule 3: the database's own mount decides the store, not the first mount", () => {
  const root = fixture({
    'compose.yaml': [
      'services:',
      // A shared cache directory first, the per-service data directory second:
      // reading the first mount would call these distinct stores shared.
      composeService('note-service', '/data/life.db', './apps/shared-cache').replace(
        '      - ./apps/shared-cache:/data',
        '      - ./apps/shared-cache:/cache\n      - ./apps/note-service/data:/data',
      ),
      composeService('todo-service', '/data/todo.db', './apps/shared-cache').replace(
        '      - ./apps/shared-cache:/data',
        '      - ./apps/shared-cache:/cache\n      - ./apps/todo-service/data:/data',
      ),
    ].join('\n'),
    'apps/note-service/src/app.module.ts': moduleSource('better-sqlite3', 'life.db'),
    'apps/todo-service/src/app.module.ts': moduleSource('better-sqlite3', 'todo.db'),
  });

  try {
    assert.deepEqual(checkDatabasePerService(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 3: a named volume two services share is a shared store', () => {
  const root = fixture({
    'compose.yaml': [
      'services:',
      composeService('note-service', '/data/life.db', 'note-data'),
      composeService('todo-service', '/data/todo.db', 'note-data'),
    ].join('\n'),
    'apps/note-service/src/app.module.ts': moduleSource('better-sqlite3', 'life.db'),
    'apps/todo-service/src/app.module.ts': moduleSource('better-sqlite3', 'todo.db'),
  });

  try {
    const findings = checkDatabasePerService(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].message, /share the mount note-data/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 3: postgres with no postgres server names the missing server', () => {
  const root = fixture({
    'compose.yaml': ['services:', '  feedback-service:', '    image: node:24', ''].join('\n'),
    'apps/feedback-service/src/app.module.ts': moduleSource('postgres', 'feedback.db'),
  });

  try {
    const findings = checkDatabasePerService(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].message, /names no postgres server for it/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 3: a compose.yaml that is a directory is a finding, not a crash', () => {
  const root = fixture({ 'apps/note-service/src/app.module.ts': moduleSource('better-sqlite3') });
  mkdirSync(join(root, 'compose.yaml'));

  try {
    const findings = checkDatabasePerService(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].message, /compose\.yaml is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 5: a comment naming another service’s path is prose, not access', () => {
  const line = '// Mirrors ../../todo-service/src/todos/todos.service.ts.\n';
  const file = join('apps', 'note-service', 'src', 'borrowed.ts');

  assert.deepEqual(findCrossServiceFindings({ file, content: line, baseContent: '' }), []);
});

test('rule 5: a file inside a new untracked directory is still judged', () => {
  const { root } = gitFixture({
    'apps/note-service/src/app.module.ts': moduleSource('better-sqlite3', 'life.db'),
    'apps/todo-service/src/app.module.ts': moduleSource('better-sqlite3', 'todo.db'),
  });
  const nested = join(root, 'apps', 'note-service', 'src', 'borrowed');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'peek.ts'), "import x from '../../todo-service/src/todos/x.js';\n");

  try {
    // Plain `status` reports `borrowed/` as one entry and would miss the file.
    const findings = checkCrossServiceAccess(root, 'dev');
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 4: a service declaring no engine is reported once, by rule 4', () => {
  const root = fixture({
    'compose.yaml': ['services:', '  note-service:', '    image: node:24', ''].join('\n'),
    'apps/note-service/src/app.module.ts': 'export const note = 1;\n',
  });

  try {
    assert.deepEqual(
      checkDatabasePerService(root).length,
      1,
      'rule 3 still owns the missing store',
    );
    assert.equal(checkEngineIsDesignated(root).length, 1, 'rule 4 owns the missing engine');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('usage: a bad argument, a missing worktree and a file worktree each exit 2 on one line', () => {
  const script = join(REPO, 'scripts', 'arch-check.mjs');
  const cases = [
    { args: ['--nope'], message: /^unknown argument: --nope$/ },
    { args: ['--worktree', '/tmp/arch-check-no-such-worktree'], message: /does not exist/ },
    { args: ['--worktree', join(REPO, 'package.json')], message: /is not a directory/ },
  ];

  for (const { args, message } of cases) {
    let failure;
    try {
      execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `expected a non-zero exit for ${args.join(' ')}`);
    assert.equal(failure.status, 2, args.join(' '));
    assert.equal(failure.stdout, '', args.join(' '));
    assert.equal(failure.stderr.trimEnd().split('\n').length, 1, failure.stderr);
    assert.match(failure.stderr.trimEnd(), message);
  }
});

test('rule 4: postgres outside the allowlist is a violation', () => {
  const root = fixture({
    'compose.yaml': ['services:', '  rogue-service:', '    image: node:24', ''].join('\n'),
    'apps/rogue-service/src/app.module.ts': moduleSource('postgres', 'rogue.db'),
  });

  try {
    const findings = checkEngineIsDesignated(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 4);
    assert.match(findings[0].message, /rogue-service declares 'postgres'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 4: feedback-service is the allowlisted postgres service', () => {
  const source = readFileSync(
    join(REPO, 'apps', 'feedback-service', 'src', 'app.module.ts'),
    'utf8',
  );
  assert.ok(source.includes("type: 'postgres'"), 'the fixture drifted: feedback-service is sqlite');

  const feedback = checkEngineIsDesignated(REPO).filter((finding) =>
    finding.file.includes('feedback-service'),
  );
  assert.deepEqual(feedback, []);
});

test('rule 5: a new import of another service’s source is a violation', () => {
  const findings = findCrossServiceFindings({
    file: join('apps', 'note-service', 'src', 'borrowed.ts'),
    content: "import { todoById } from '../todo-service/src/todos/x.js';\n",
    baseContent: '',
  });

  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, 5);
  assert.match(findings[0].message, /note-service reaches into todo-service/);
});

test('rule 5: an import the base ref already carries is not this branch’s doing', () => {
  const line = "import { applySurgery } from '../../tags-service/src/tags/import.js';\n";
  const file = join('apps', 'note-service', 'test', 'tag-refs.test.ts');

  assert.equal(findCrossServiceFindings({ file, content: line, baseContent: '' }).length, 1);
  assert.deepEqual(findCrossServiceFindings({ file, content: line, baseContent: line }), []);
});

/** One compose service with an `environment:` block holding exactly `keys`. */
function composeWithEnvironment(name, keys, image = 'node:24') {
  const block = keys.map((key) => `      ${key}: from-env`).join('\n');
  return ['services:', `  ${name}:`, `    image: ${image}`, '    environment:', block, ''].join(
    '\n',
  );
}

test('rule 6: a variable read with no fallback and never forwarded is a violation', () => {
  const root = fixture({
    'compose.yaml': composeWithEnvironment('meal-service', ['DB_PATH']),
    'apps/meal-service/src/meal-todo.controller.ts': [
      'export function baseUrl() {',
      '  const configured = process.env.MEAL_TODOS_API_URL?.trim();',
      '  return configured;',
      '}',
      '',
    ].join('\n'),
  });

  try {
    const findings = checkEnvForwarding(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 6);
    assert.equal(findings[0].file, join('apps', 'meal-service', 'src', 'meal-todo.controller.ts'));
    assert.equal(findings[0].line, 2);
    assert.match(findings[0].message, /meal-service reads MEAL_TODOS_API_URL with no fallback/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 6: the same variable is fine once compose forwards it', () => {
  const root = fixture({
    'compose.yaml': composeWithEnvironment('meal-service', ['MEAL_TODOS_API_URL']),
    'apps/meal-service/src/main.ts': 'const url = process.env.MEAL_TODOS_API_URL;\n',
  });

  try {
    assert.deepEqual(checkEnvForwarding(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 6: a bracket read resolves through a constant declared in a package', () => {
  const root = fixture({
    // Forwarding the constant's own name (`TODOS_API_URL_ENV`) must not count:
    // the container needs the variable it names.
    'compose.yaml': composeWithEnvironment('meal-service', ['TODOS_API_URL_ENV']),
    'packages/service-kit/src/outbox/outbox-delivery.ts': [
      "export const TODOS_API_URL_ENV = 'MEAL_TODOS_API_URL';",
      '',
    ].join('\n'),
    'apps/meal-service/src/meal-todo.controller.ts': [
      "import { TODOS_API_URL_ENV } from '@life/service-kit';",
      '',
      'export function baseUrl() {',
      '  return process.env[TODOS_API_URL_ENV]?.trim();',
      '}',
      '',
    ].join('\n'),
  });

  try {
    const findings = checkEnvForwarding(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].line, 4);
    assert.match(findings[0].message, /reads MEAL_TODOS_API_URL with no fallback/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 6: a read that carries a fallback is the code having an answer', () => {
  const root = fixture({
    'compose.yaml': composeWithEnvironment('todo-service', ['DB_PATH']),
    'apps/todo-service/src/todos/todos.service.ts': [
      "const tz = process.env.TODO_TIMEZONE ?? 'Asia/Ho_Chi_Minh';",
      "const host = process.env.HOST || '127.0.0.1';",
      'const port = Number(process.env.PORT ?? 3005);',
      '',
    ].join('\n'),
  });

  try {
    assert.deepEqual(checkEnvForwarding(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 6: a dev-only switch and NODE_ENV are not compose’s to forward', () => {
  const root = fixture({
    'compose.yaml': composeWithEnvironment('app', ['DB_PATH']),
    'apps/app/src/gate.ts': [
      "const devStack = process.env.APP_DEV_SKIP_ACCESS_GATE === '1';",
      "const production = process.env.NODE_ENV === 'production';",
      '',
    ].join('\n'),
  });

  try {
    assert.deepEqual(checkEnvForwarding(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 6: today’s tree forwards every variable the code cannot boot without', () => {
  assert.deepEqual(checkEnvForwarding(REPO), []);
});

/** One workflow file: a job under the given `on:` lines, on the runner it names. */
function workflowSource(triggerLines, runner) {
  return ['on:', ...triggerLines, 'jobs:', '  scan:', `    runs-on: ${runner}`, ''].join('\n');
}

test('rule 7: a pull_request job naming a self-hosted runner is a violation', () => {
  const root = fixture({
    '.github/workflows/scan.yml': workflowSource(
      ['  pull_request:', '    branches: [dev]'],
      '[self-hosted, sonarqube]',
    ),
  });

  try {
    const findings = checkNoSelfHostedRunners(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 7);
    assert.equal(findings[0].file, join('.github', 'workflows', 'scan.yml'));
    assert.equal(findings[0].line, 6);
    assert.match(findings[0].message, /names a self-hosted runner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 7: the runner is banned under workflow_dispatch too, not just on PRs', () => {
  const root = fixture({
    // The tempting exemption: "it can only be started by hand". A job reachable by
    // hand is still reachable, so the trigger is not consulted.
    '.github/workflows/scan.yml': workflowSource(['  workflow_dispatch:'], 'self-hosted'),
  });

  try {
    const findings = checkNoSelfHostedRunners(root);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].rule, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 7: the phrase in a comment is the rule being obeyed, not broken', () => {
  const root = fixture({
    '.github/workflows/scan.yml': [
      '# No self-hosted state and no host-mounted service: this job needs neither.',
      'on:',
      '  pull_request:',
      '  workflow_dispatch:',
      'jobs:',
      '  scan:',
      '    runs-on: ubuntu-latest  # never self-hosted',
      '',
    ].join('\n'),
  });

  try {
    assert.deepEqual(checkNoSelfHostedRunners(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 7: today’s tree runs every workflow on a GitHub-hosted runner', () => {
  assert.deepEqual(checkNoSelfHostedRunners(REPO), []);
});

