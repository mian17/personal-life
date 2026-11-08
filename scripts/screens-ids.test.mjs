/**
 * Pins the two pieces of `screens-ids.mjs` that can go wrong without a stack: which
 * seeded feedback row the `/feedback/{feedback}` screen is captured from, and the
 * missing-id check that must fail the run rather than let a partial
 * `screens.ids.json` capture a wrong screen. Neither test contacts a service.
 *
 * Run: node --test scripts/screens-ids.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSeededFeedback, missingIds } from './screens-ids.mjs';

test('the seeded feedback row is the long-description one, matched by title', () => {
  assert.equal(
    isSeededFeedback({ title: 'Seed: note editor returns to the top after switching apps' }),
    true,
  );
});

test('the other two seeded reports are not the capture target', () => {
  assert.equal(isSeededFeedback({ title: 'Seed: note list scrolls to the top after saving' }), false);
  assert.equal(isSeededFeedback({ title: 'Seed: remember the last meal group' }), false);
});

test('a row carrying no title is not the capture target', () => {
  assert.equal(isSeededFeedback({}), false);
  assert.equal(isSeededFeedback(undefined), false);
});

test('every resolved id passes, an unresolved or empty one is named', () => {
  const ids = [
    ['note', 'n1'],
    ['todo', 't1'],
    ['feedback', undefined],
    ['savedMeal', ''],
  ];
  assert.deepEqual(missingIds(ids), ['feedback', 'savedMeal']);
});

test('a complete set reports nothing missing', () => {
  assert.deepEqual(missingIds([['note', 'n1'], ['feedback', 'f1']]), []);
});
