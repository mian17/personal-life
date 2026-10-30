/**
 * Pins the two shapes the seeder cannot get wrong silently: the row extraction that
 * lets one loop read every service's listing, and the failure it must raise instead
 * of seeding into an empty view. A wrong extraction makes every run "create" rows it
 * already created, which is exactly the idempotence the script promises.
 *
 * Run: node --test scripts/seed-stack.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idOf, rowsOf } from './seed-stack.mjs';

test('a bare array is the rows', () => {
  const rows = [{ id: 'a' }];
  assert.equal(rowsOf(rows, 'tags tags list'), rows);
});

test('an envelope is read by finding its array, whichever key names it', () => {
  assert.deepEqual(rowsOf({ notes: [{ id: 'n' }], nextCursor: null }, 'notes notes list'), [{ id: 'n' }]);
  assert.deepEqual(rowsOf({ todos: [{ id: 't' }], nextCursor: 'c' }, 'todo todos list'), [{ id: 't' }]);
  assert.deepEqual(rowsOf({ items: [] }, 'foods foods list'), []);
});

test('a body carrying no array fails, naming the resource and the body it got', () => {
  assert.throws(() => rowsOf({ status: 'ok' }, 'feedback feedback list'), {
    message: /feedback feedback list returned neither an array nor an envelope of rows: \{"status":"ok"\}/,
  });
  assert.throws(() => rowsOf('', 'tags tags list'), /tags tags list returned neither an array/);
});

test('a registered id is returned, an unregistered one fails by name', () => {
  const ids = new Map([['tag:garden', '7']]);
  assert.equal(idOf(ids, 'tag:garden'), '7');
  assert.throws(() => idOf(ids, 'food:oats'), /no id registered for "food:oats"/);
});
