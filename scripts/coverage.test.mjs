/**
 * Checks the two rules that make the merged lcov usable — both fail silently in
 * production if they regress: Sonar drops records whose `SF:` path matches no
 * indexed file, and duplicated hit counts understate the number.
 *
 * Run: npm run test:coverage-report
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePath, parseLcov } from './coverage.mjs';

const WORKSPACE = 'apps/note-service';

test('a workspace-relative SF: becomes repository-relative', () => {
  assert.equal(normalizePath('src/notes/notes.service.ts', WORKSPACE), 'apps/note-service/src/notes/notes.service.ts');
});

test('the @life/* src mapping outside the workspace is kept', () => {
  assert.equal(
    normalizePath('../../packages/crypto/src/index.ts', WORKSPACE),
    'packages/crypto/src/index.ts',
  );
});

test('paths Sonar cannot index are dropped', () => {
  assert.equal(normalizePath('/elsewhere/repo/apps/note-service/src/a.ts', WORKSPACE), null, 'outside the repo');
  assert.equal(normalizePath('../../node_modules/x/index.js', WORKSPACE), null, 'node_modules');
  assert.equal(normalizePath('dist/notes.service.js', WORKSPACE), null, 'build output');
  assert.equal(normalizePath('test/notes.e2e-spec.ts', WORKSPACE), null, 'test file');
  assert.equal(normalizePath('src/notes/notes.test.ts', WORKSPACE), null, 'test file in src');
});

test('a file instrumented twice keeps the most-covered record', () => {
  const report = [
    'SF:src/a.ts',
    'DA:1,0',
    'DA:2,0',
    'end_of_record',
    'SF:src/a.ts',
    'DA:1,5',
    'DA:2,3',
    'end_of_record',
  ].join('\n');

  const records = parseLcov(report, WORKSPACE);
  assert.equal(records.size, 1);
  assert.equal(records.get('apps/note-service/src/a.ts').hits, 8);
});

test('the least-covered duplicate never wins', () => {
  const report = ['SF:src/a.ts', 'DA:1,9', 'end_of_record', 'SF:src/a.ts', 'DA:1,1', 'end_of_record'].join('\n');
  assert.equal(parseLcov(report, WORKSPACE).get('apps/note-service/src/a.ts').hits, 9);
});
