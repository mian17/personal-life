/**
 * The delivery run, end to end, with a real git repository and stand-ins for the
 * two binaries the receiver cannot assume: `pi-sbx` (the agent) and `gh`.
 *
 * This is the half of the receiver the unit tests could not reach — branch
 * preparation, the agent invocation, delivery inspection, and the fallback PR —
 * so it runs against a temp clone rather than a mock of `spawn`. `git` is real:
 * a mocked git would assert the arguments, not that the branch actually works.
 *
 * `SONAR_AUTOFIX_PATH` is set before the import because the receiver resolves
 * its child `PATH` once, at module load.
 */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { after, test } from 'node:test';

const ROOT = mkdtempSync(join(tmpdir(), 'sonar-autofix-'));
const BIN = join(ROOT, 'bin');
const REPO = join(ROOT, 'repo');
const ORIGIN = join(ROOT, 'origin.git');
const SECRET = 'test-secret';

mkdirSync(BIN, { recursive: true });
process.env.SONAR_AUTOFIX_PATH = `${BIN}:/usr/bin:/bin`;

const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fakeBin(name, script) {
  const path = join(BIN, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

// `gh`: no existing PR, then a create that reports a url.
fakeBin(
  'gh',
  `case "$1 $2" in
  "pr list") exit 0 ;;
  "pr create") echo "https://github.com/example/personal-life/pull/999" ;;
esac`,
);
// `pi-sbx`: the agent commits in the worktree it is told about and opens nothing.
fakeBin(
  'pi-sbx',
  `dir=$(printf '%s' "$*" | sed -n 's/.*Worktree: \\([^ ]*\\).*/\\1/p')
cd "$dir" || exit 1
echo fix > fake-fix.txt
git add -A
git -c user.name=fake -c user.email=fake@example.com commit -qm "fix: fake agent commit"`,
);

mkdirSync(REPO, { recursive: true });
git(['init', '-q', '--bare', ORIGIN], ROOT);
git(['init', '-q', '-b', 'dev']);
git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'baseline']);
git(['remote', 'add', 'origin', ORIGIN]);
git(['push', '-q', '-u', 'origin', 'dev']);

const { createReceiver, start } = await import('./receiver.mjs');

function config(overrides = {}) {
  const cfg = {
    port: 0,
    projectKey: 'personal-life',
    sonarUrl: 'http://sonar.invalid',
    sonarToken: 'token',
    webhookSecret: SECRET,
    repo: REPO,
    baseBranch: 'dev',
    stateDir: join(ROOT, 'state'),
    worktree: join(ROOT, 'worktree'),
    handoffDir: join(ROOT, 'handoff'),
    timeoutMs: 30_000,
    maxIssues: 5,
    dryRun: false,
    ...overrides,
  };
  // `start()` creates the state directory in production; a direct `fixIssues`
  // call assumes it, so the harness stands in for that.
  mkdirSync(cfg.stateDir, { recursive: true });
  return cfg;
}

const gateFailure = {
  taskId: 'task-<script>alert(1)</script>',
  status: 'SUCCESS',
  project: { key: 'personal-life' },
  qualityGate: {
    status: 'ERROR',
    conditions: [
      { metric: 'new_coverage', status: 'ERROR', value: '69.4', errorThreshold: '80' },
      { metric: 'duplicated_lines_density', status: 'OK', value: '0.0', errorThreshold: '3' },
    ],
  },
  branch: { isMain: true },
};

const ISSUES = {
  total: 2,
  issues: [
    { rule: 'typescript:S2871', severity: 'CRITICAL', message: 'bad sort', component: 'personal-life:scripts/a.mjs', line: 1 },
    { rule: 'typescript:S7727', severity: 'MINOR', message: 'no line', component: 'personal-life:apps/b.ts' },
  ],
};

function stubFetch(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), calls.length);
  };
  return calls;
}

function issueReply(body = ISSUES) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

after(() => {
  execFileSync('rm', ['-rf', ROOT]);
});

test('fetches the new-code issues itself and files them under a run id', async () => {
  const calls = stubFetch(() => issueReply());
  const receiver = createReceiver(config({ dryRun: true }));

  await receiver.fixIssues(gateFailure);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/issues/search');
  assert.equal(url.searchParams.get('inNewCodePeriod'), 'true');
  assert.equal(url.searchParams.get('ps'), '5');
  // MINOR stays in the set: a MINOR-only new-code issue still fails the gate.
  assert.match(url.searchParams.get('severities'), /MINOR/);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);

  const log = readFileSync(join(ROOT, 'state', 'runs.log'), 'utf8');
  assert.match(log, /"event":"dry-run"/);
});

test('a clean new-code set ends the run without touching git', async () => {
  stubFetch(() => issueReply({ total: 0, issues: [] }));
  const receiver = createReceiver(config());

  await receiver.fixIssues(gateFailure);

  const log = readFileSync(join(ROOT, 'state', 'runs.log'), 'utf8');
  assert.match(log, /"event":"no-issues"/);
});

test('a failed issues search fails the run instead of retrying a red gate', async () => {
  stubFetch(() => ({ ok: false, status: 503, text: async () => 'down' }));
  const receiver = createReceiver(config({ dryRun: true }));

  await assert.rejects(receiver.fixIssues(gateFailure), /issues search failed: 503 down/);
});

test('a full run branches, drives the agent, and files the fallback PR', async () => {
  stubFetch(() => issueReply());
  const cfg = config();
  const receiver = createReceiver(cfg);

  await receiver.fixIssues(gateFailure);

  const log = readFileSync(join(cfg.stateDir, 'runs.log'), 'utf8');
  assert.match(log, /"event":"agent-start"/);
  assert.match(log, /"event":"agent-done"/);
  assert.match(log, /"event":"delivery-fallback"/);
  assert.match(log, /"event":"pull-request".*"by":"receiver"/);

  // The worktree is a real one, on the fix branch cut from origin/dev.
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cfg.worktree);
  assert.match(branch, /^fix\/sonar-/);
  assert.equal(git(['log', '-1', '--format=%s'], cfg.worktree), 'fix: fake agent commit');

  // The PR body is a file, never an argv, and quotes the failed condition only.
  const bodies = readdirSync(cfg.handoffDir).filter((name) => name.endsWith('.md'));
  assert.equal(bodies.length, 1);
  const body = readFileSync(join(cfg.handoffDir, bodies[0]), 'utf8');
  assert.match(body, /new_coverage = 69\.4 \(threshold 80\)/);
  assert.doesNotMatch(body, /duplicated_lines_density/);
  assert.match(body, /not `main`/);
});

test('a base checkout on another branch is reported, not force-pulled', async () => {
  stubFetch(() => issueReply({ total: 0, issues: [] }));
  const cfg = config({ stateDir: join(ROOT, 'state-skip') });
  git(['checkout', '-q', '-b', 'someone-else'], REPO);
  const receiver = createReceiver(cfg);

  await receiver.fixIssues(gateFailure);

  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), 'someone-else');
  git(['checkout', '-q', 'dev']);
});

/** A request-shaped async iterable, as `for await (const chunk of request)` reads it. */
function fakeRequest(body, { signature, method = 'POST', url = '/sonar' } = {}) {
  const headers = { 'x-sonar-webhook-hmac-sha256': signature ?? createHmac('sha256', SECRET).update(body).digest('hex') };
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  };
}

function fakeResponse() {
  const state = { status: 0, body: '' };
  return {
    state,
    writeHead(status) {
      state.status = status;
      return this;
    },
    end(chunk = '') {
      state.body = String(chunk);
      return this;
    },
  };
}

test('webhook: a signed failure is accepted, an unsigned one is not', async () => {
  stubFetch(() => issueReply({ total: 0, issues: [] }));
  const receiver = createReceiver(config({ stateDir: join(ROOT, 'state-hook') }));

  const unsigned = fakeResponse();
  await receiver.handleWebhook(fakeRequest('{"status":"SUCCESS"}', { signature: 'nope' }), unsigned);
  assert.equal(unsigned.state.status, 401);

  const signed = fakeResponse();
  await receiver.handleWebhook(fakeRequest(JSON.stringify(gateFailure)), signed);
  assert.equal(signed.state.status, 202);
});

test('webhook: malformed json, a passing gate, and an in-flight run are each answered', async () => {
  let release;
  stubFetch(() => issueReply({ total: 0, issues: [] }));
  const receiver = createReceiver(config({ stateDir: join(ROOT, 'state-hook2') }));

  const badJson = fakeResponse();
  await receiver.handleWebhook(fakeRequest('{not json'), badJson);
  assert.equal(badJson.state.status, 400);

  const passing = fakeResponse();
  await receiver.handleWebhook(
    fakeRequest(JSON.stringify({ ...gateFailure, qualityGate: { status: 'OK', conditions: [] } })),
    passing,
  );
  assert.equal(passing.state.status, 202);
  assert.equal(passing.state.body, 'ignored');

  // Hold the first run open so the second request lands while it is busy.
  global.fetch = async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return issueReply({ total: 0, issues: [] });
  };
  const first = fakeResponse();
  await receiver.handleWebhook(fakeRequest(JSON.stringify(gateFailure)), first);
  const second = fakeResponse();
  await receiver.handleWebhook(fakeRequest(JSON.stringify(gateFailure)), second);
  assert.equal(second.state.status, 409);
  release();
});

test('start refuses to run without a secret and serves only signed posts', async () => {
  await assert.rejects(start(config({ webhookSecret: '' })), /SONAR_WEBHOOK_SECRET and SONAR_TOKEN are required/);
  await assert.rejects(start(config({ sonarToken: '' })), /SONAR_WEBHOOK_SECRET and SONAR_TOKEN are required/);

  stubFetch(() => issueReply({ total: 0, issues: [] }));
  const server = await start(config({ stateDir: join(ROOT, 'state-start') }));
  await once(server, 'listening');
  const { port } = server.address();
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest({ port, method: 'POST', path: '/sonar' }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end('{}');
  });
  assert.equal(status, 401, 'an unsigned post is refused at the door');
  await new Promise((resolve) => server.close(resolve));
});
