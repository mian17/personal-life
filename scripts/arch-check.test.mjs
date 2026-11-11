/**
 * Guards the three mechanical architecture rules in `scripts/arch-check.mjs`.
 *
 * Rule 3 (one database per service) and rule 4 (the designated engine) judge the
 * topology on disk, so each is fed a throwaway worktree holding only the files
 * the assertion needs — plus the real checkout, to prove today's tree is clean.
 * Rule 5 (no cross-service reach) is judged on new lines only, so its two cases
 * differ by nothing except the base content.
 *
 * Run: npm run test:arch
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkDatabasePerService,
  checkEngineIsDesignated,
  findCrossServiceFindings,
} from './arch-check.mjs';

/** The checkout this test runs in: `scripts/`'s parent. */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

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
function moduleSource(engine, filename) {
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
    assert.match(findings[0].message, /share the host bind path apps\/shared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rule 3: today’s tree gives every service its own store', () => {
  assert.deepEqual(checkDatabasePerService(REPO), []);
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
