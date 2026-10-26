import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createReceiver, isActionable, sanitizeLogText, signatureMatches } from './receiver.mjs';

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

test('control characters are replaced before text reaches a log sink', () => {
  assert.equal(sanitizeLogText('a\nb'), 'a b', 'a newline would forge a second line');
  assert.equal(sanitizeLogText('a\r\nb'), 'a  b', 'CRLF too');
  assert.equal(sanitizeLogText('\u001b[31mred'), ' [31mred', 'an ESC would drive the reader');
  assert.equal(sanitizeLogText('a\u0007b\u009bc'), 'a b c', 'bell and C1 are not text');
  assert.equal(sanitizeLogText('x'.repeat(5000)).length, 4000, 'one record stays bounded');
});

test('a hostile webhook string cannot forge a log record', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sonar-autofix-log-'));
  const receiver = createReceiver({ stateDir });

  await receiver.log('rejected-signature', {
    remote: '1.2.3.4\n{"event":"pull-request","url":"https://evil"}',
    error: '\u001b[31mboom',
  });

  const lines = readFileSync(join(stateDir, 'runs.log'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'exactly one record, so nothing was forged');
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, 'rejected-signature', 'the real event is the one recorded');
  assert.doesNotMatch(lines[0], /\u001b/, 'no raw escape reaches the reader');
  // The payload survives only as data inside the field, never as its own record.
  assert.ok(record.remote.startsWith('1.2.3.4'), 'the remote is still quoted');
  assert.ok(record.remote.includes('{"event":"pull-request"'));
});
