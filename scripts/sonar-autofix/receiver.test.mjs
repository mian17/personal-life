import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { isActionable, signatureMatches } from './receiver.mjs';

const SECRET = 'test-secret';
const signed = (body) => createHmac('sha256', SECRET).update(body).digest('hex');

test('accepts a body signed with the configured secret', () => {
  const body = Buffer.from('{"taskId":"abc"}');
  assert.equal(signatureMatches(SECRET, body, signed(body)), true);
});

test('rejects a body signed with a different secret', () => {
  const body = Buffer.from('{"taskId":"abc"}');
  const wrong = createHmac('sha256', 'other').update(body).digest('hex');
  assert.equal(signatureMatches(SECRET, body, wrong), false);
});

test('rejects a missing or malformed signature header', () => {
  const body = Buffer.from('{}');
  assert.equal(signatureMatches(SECRET, body, undefined), false);
  assert.equal(signatureMatches(SECRET, body, ''), false);
  assert.equal(signatureMatches(SECRET, body, 'not-hex'), false);
});

test('rejects a tampered body carrying a valid older signature', () => {
  const original = Buffer.from('{"taskId":"abc"}');
  const tampered = Buffer.from('{"taskId":"xyz"}');
  assert.equal(signatureMatches(SECRET, tampered, signed(original)), false);
});

const gateFailure = {
  taskId: 'task-1',
  status: 'SUCCESS',
  project: { key: 'personal-life' },
  qualityGate: { status: 'ERROR', conditions: [] },
  branch: { isMain: true },
};

test('actionable: gate failure on main', () => {
  assert.equal(isActionable(gateFailure, 'personal-life'), true);
});

test('not actionable: gate passed', () => {
  const payload = { ...gateFailure, qualityGate: { status: 'OK', conditions: [] } };
  assert.equal(isActionable(payload, 'personal-life'), false);
});

test('not actionable: other project', () => {
  assert.equal(isActionable(gateFailure, 'another-project'), false);
});

test('not actionable: failed background task', () => {
  assert.equal(isActionable({ ...gateFailure, status: 'FAILED' }, 'personal-life'), false);
});

test('not actionable: feature branch, which would loop after a fix push', () => {
  assert.equal(isActionable({ ...gateFailure, branch: { isMain: false } }, 'personal-life'), false);
});

test('actionable when branch info is absent, as on instance-wide webhooks', () => {
  const { branch, ...withoutBranch } = gateFailure;
  assert.equal(isActionable(withoutBranch, 'personal-life'), true);
});
