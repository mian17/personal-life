#!/usr/bin/env node
/**
 * SonarQube webhook → sandbox agent → draft pull request.
 *
 * SonarQube's webhook payload carries no issues, so the receiver fetches the
 * new-code issues itself and hands the agent a JSON file. That keeps the agent's
 * scope bounded regardless of how much backlog the project has.
 *
 * The agent runs inside the pi-sbx sandbox, which has the repository mounted and
 * the SonarQube MCP server available for rule descriptions. This process owns git
 * and GitHub, so the sandbox needs no repository credentials.
 *
 * Runbook: docs/runbooks/sonar-autofix.md
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = {
  port: Number(process.env.SONAR_AUTOFIX_PORT ?? 9100),
  projectKey: process.env.SONAR_PROJECT_KEY ?? 'personal-life',
  sonarUrl: process.env.SONAR_HOST_URL ?? 'http://127.0.0.1:9000',
  sonarToken: process.env.SONAR_TOKEN ?? '',
  webhookSecret: process.env.SONAR_WEBHOOK_SECRET ?? '',
  repo: process.env.SONAR_AUTOFIX_REPO ?? resolve(import.meta.dirname, '../..'),
  // Fixes branch from and target the integration branch, never main.
  baseBranch: process.env.SONAR_AUTOFIX_BASE_BRANCH ?? 'dev',
  stateDir: process.env.SONAR_AUTOFIX_STATE ?? join(homedir(), '.local/state/sonar-autofix'),
  // Must sit inside the repository: the sandbox mounts the repo and nothing else,
  // so a worktree in ~/.cache or ~/.local/state is invisible to the agent.
  // `.pi/worktrees/` is gitignored, and the path differs from the feature's own
  // checkout because a run force-removes its worktree before creating it.
  worktree:
    process.env.SONAR_AUTOFIX_WORKTREE ??
    join(process.env.SONAR_AUTOFIX_REPO ?? resolve(import.meta.dirname, '../..'), '.pi/worktrees/sonar-autofix-run'),
  // The agent reads the issue list and the PR body from files rather than from
  // prose in the prompt: retyping them drops backticks and words. This directory
  // is ignored by git and visible inside the sandbox.
  handoffDir:
    process.env.SONAR_AUTOFIX_HANDOFF ??
    join(process.env.SONAR_AUTOFIX_REPO ?? resolve(import.meta.dirname, '../..'), '.pi/worktrees/sonar-autofix-handoff'),
  timeoutMs: Number(process.env.SONAR_AUTOFIX_TIMEOUT_MS ?? 30 * 60 * 1000),
  maxIssues: Number(process.env.SONAR_AUTOFIX_MAX_ISSUES ?? 25),
  dryRun: process.env.SONAR_AUTOFIX_DRY_RUN === '1',
};

/**
 * The `PATH` every child gets. Never the caller's `PATH`: that carries
 * world-writable directories, so a `PATH` lookup could run an attacker's
 * binary (Sonar S4036). Override where `pi-sbx` lives when it is not `~/.local/bin`.
 * `/opt/homebrew/bin` is there for `git`/`gh` on Apple Silicon.
 */
const CHILD_PATH =
  process.env.SONAR_AUTOFIX_PATH ??
  `${join(homedir(), '.local/bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;

/**
 * Absolute path to a command. `spawn` by bare name would search `PATH`, so a
 * writable directory anywhere in it could substitute the binary (Sonar S4036).
 */
/** Commands this receiver may run. The allowlist means `bin()` cannot be talked
 * into resolving something else if a name ever comes from outside. */
const ALLOWED_COMMANDS = new Set(['git', 'gh', 'pi-sbx']);

const BIN_CACHE = new Map();
function bin(name) {
  if (!ALLOWED_COMMANDS.has(name)) throw new Error(`command not allowed: ${name}`);
  const cached = BIN_CACHE.get(name);
  if (cached !== undefined) return cached;
  const found = CHILD_PATH.split(':')
    .map((dir) => join(dir, name))
    .find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`cannot find ${name} in ${CHILD_PATH}`);
  BIN_CACHE.set(name, found);
  return found;
}

/** The environment every child gets: the app's own, minus its `PATH`. */
function childEnv(overrides = {}) {
  return { ...process.env, PATH: CHILD_PATH, ...overrides };
}

/**
 * The id this run is filed under: minted here from a counter and the clock, so
 * it cannot contain anything a webhook sent. Every path, branch name, and
 * command argument is built from it, which is why no payload value needs to be
 * filtered, escaped, or trusted on the way to a sink.
 */
let runCounter = 0;
function nextRunId() {
  runCounter += 1;
  return `${Date.now().toString(36)}-${runCounter}`;
}

/**
 * A webhook string, reduced to what is safe to show a human. Used for the PR
 * body only: it is never logged and never becomes part of a command.
 */
function displayable(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, 64) : 'unknown';
}

/**
 * Log-injection guard. Webhook strings and child-process output end up in this
 * log, and a control character there is not text: a newline forges a second log
 * line, and an ESC drives whatever terminal reads the line. Every control
 * character is replaced before the text leaves for stdout or the run file, and
 * the result is bounded so one record cannot flood the log.
 */
export function sanitizeLogText(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 4000);
}

/** HMAC-SHA256 over the raw body, as SonarQube signs it. */
export function signatureMatches(secret, body, header) {
  if (typeof header !== 'string' || header.length === 0) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(header, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * A run is worth starting only when the gate failed on the main branch of this
 * project. Anything else — feature-branch analyses, passing gates, other
 * projects — would loop or chase the whole backlog. An absent `branch` means the
 * payload came from an instance-level webhook, which only reports main.
 */
export function isActionable(payload, projectKey) {
  return (
    payload?.project?.key === projectKey &&
    payload?.status === 'SUCCESS' &&
    payload?.qualityGate?.status === 'ERROR' &&
    (payload?.branch?.isMain ?? true)
  );
}

function describeIssues(payload) {
  const conditions = payload?.qualityGate?.conditions ?? [];
  const failed = conditions.filter((condition) => condition.status === 'ERROR');
  return failed.map((condition) => `${condition.metric} = ${condition.value} (threshold ${condition.errorThreshold})`);
}

export function createReceiver(config) {
  let busy = false;

  async function log(event, detail = {}) {
    const line = sanitizeLogText(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));
    console.log(line);
    await appendFile(join(config.stateDir, 'runs.log'), `${line}\n`).catch(() => {});
  }

  async function fetchIssues() {
    const query = new URLSearchParams({
      componentKeys: config.projectKey,
      resolved: 'false',
      inNewCodePeriod: 'true',
      // MINOR included: the gate counts every new violation, so a MINOR-only
      // new-code set still fails `new_violations > 0`. Filtering MINOR out left
      // the loop reporting `no-issues` against a red gate.
      severities: 'BLOCKER,CRITICAL,MAJOR,MINOR',
      types: 'BUG,VULNERABILITY,CODE_SMELL',
      ps: String(config.maxIssues),
      s: 'SEVERITY',
      asc: 'false',
    });
    const credentials = Buffer.from(`${config.sonarToken}:`).toString('base64');
    const response = await fetch(`${config.sonarUrl}/api/issues/search?${query}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (!response.ok) throw new Error(`issues search failed: ${response.status} ${await response.text()}`);
    const { issues = [], total = 0 } = await response.json();
    return {
      total,
      issues: issues.map((issue) => ({
        rule: issue.rule,
        severity: issue.severity,
        message: issue.message,
        file: issue.component.replace(`${config.projectKey}:`, ''),
        line: issue.line ?? 0,
      })),
    };
  }

  function git(args, { cwd = config.repo, env = childEnv() } = {}) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(bin('git'), ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolvePromise(stdout.trim())
          : reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`)),
      );
    });
  }

  /**
   * Wait for a child, collecting its output. Takes the spawned process, not a
   * command name: the binary is a literal at each call site, so no caller value
   * can pick it (Sonar S6350). Only `args` carry data, and they are handed to
   * `spawn` as an argv array, never a shell string, so they stay arguments.
   */
  function drain(child, resolvePromise) {
    let output = '';
    const collect = (chunk) => {
      output = (output + chunk).slice(-8000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGTERM'), config.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, output: String(error.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, output });
    });
  }

  /** `gh`, at a path resolved once. The binary is a literal, never caller data. */
  function gh(args, options = {}) {
    return new Promise((resolvePromise) => {
      const child = spawn(bin('gh'), args, { env: childEnv(), ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      drain(child, resolvePromise);
    });
  }

  /** The sandbox agent entrypoint, at a path resolved once. */
  function agent(args, options = {}) {
    return new Promise((resolvePromise) => {
      const child = spawn(bin('pi-sbx'), args, { env: childEnv(), ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      drain(child, resolvePromise);
    });
  }

  /**
   * Fast-forward the base checkout so the next branch starts from the real head.
   * Only a checkout already on the base branch is moved: `git pull` elsewhere
   * would merge the base into whatever happens to be checked out, which is a
   * silent way to contaminate someone's working branch. A non-fast-forward is
   * reported, not swallowed — branching from a diverged base is worse than not
   * branching.
   */
  async function refreshBaseCheckout() {
    const current = await git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
    if (current !== config.baseBranch) return { skipped: current };
    await git(['pull', '--ff-only', 'origin', config.baseBranch]);
    return { pulled: config.baseBranch };
  }

  async function prepareWorktree(taskId) {
    const worktree = config.worktree;
    const branch = `fix/sonar-${taskId}`;
    await mkdir(dirname(worktree), { recursive: true });
    // Prune rather than remove: a leftover worktree from a killed run must go, but
    // `remove --force` on a path that is not a worktree would fail the run.
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
    await git(['worktree', 'prune']).catch(() => {});
    await git(['branch', '-D', branch]).catch(() => {});
    // Refresh before branching: a stale base is how a fix branch silently starts
    // behind and produces a diff full of files already deleted upstream.
    await git(['fetch', 'origin', '--prune']);
    await refreshBaseCheckout();
    await git(['worktree', 'add', worktree, '-b', branch, `origin/${config.baseBranch}`]);
    return { worktree, branch };
  }

  /**
   * The agent owns delivery: it commits, pushes, and opens the draft PR. The
   * receiver only verifies what happened, because a run that silently produced
   * commits but no PR is worse than one that failed loudly.
   */
  async function inspectDelivery(worktree, branch) {
    const commits = await git(['rev-list', '--count', `origin/${config.baseBranch}..${branch}`], { cwd: worktree }).catch(() => '0');
    const pushed = await git(['ls-remote', '--heads', 'origin', branch], { cwd: worktree }).then((output) => ({ code: 0, output }), (error) => ({ code: 1, output: String(error.message) }));
    const pr = await gh(['pr', 'list', '--head', branch, '--json', 'url,isDraft', '--jq', '.[0].url // ""'], {
      cwd: worktree,
    });
    return {
      commits: Number(commits) || 0,
      pushed: pushed.code === 0 && pushed.output.includes(branch),
      url: pr.code === 0 ? pr.output.trim() : '',
    };
  }

  /**
   * Only used when the agent left work behind without opening the PR itself.
   * The body goes through `--body-file`: it quotes issue text from the SonarQube
   * API, so passing it as an argument would put server-supplied strings into
   * `gh`'s argv (Sonar S6350).
   */
  async function createPullRequest(worktree, branch, prBodyPath, summary) {
    const push = await git(['push', '--set-upstream', 'origin', branch], { cwd: worktree }).then((output) => ({ code: 0, output }), (error) => ({ code: 1, output: String(error.message) }));
    if (push.code !== 0) throw new Error(`push failed: ${push.output}`);

    const pr = await gh([
      'pr', 'create',
      '--draft',
      '--base', config.baseBranch,
      '--head', branch,
      '--title', `fix(sonar): ${summary.issues.length} new-code issue(s)`,
      '--body-file', prBodyPath,
    ], { cwd: worktree });
    if (pr.code !== 0) throw new Error(`gh pr create failed: ${pr.output}`);
    return pr.output.match(/https:\/\/\S+/)?.[0] ?? '';
  }

  function pullRequestBody(analysisId, summary) {
    return [
      `SonarQube reported a quality gate failure (analysis ${analysisId}).`,
      '',
      `This branch starts from \`${config.baseBranch}\` and targets it, not \`main\`.`,
      '',
      'Failed conditions:',
      ...(summary.conditions.length > 0
        ? summary.conditions.map((condition) => `- ${condition}`)
        : ['- none reported']),
      '',
      `Targets ${summary.issues.length} of ${summary.total} new-code issues:`,
      '',
      ...summary.issues.map((issue) => `- \`${issue.rule}\` ${issue.file}:${issue.line} — ${issue.message}`),
      '',
      'Opened by the local sonar-autofix run. Review before merging.',
    ].join('\n');
  }

  async function fixIssues(payload) {
    const taskId = nextRunId();
    // Only for the PR body's prose; never logged, never an argument.
    const analysisId = displayable(payload?.taskId);
    const { total, issues } = await fetchIssues();
    if (issues.length === 0) {
      await log('no-issues', { taskId });
      return;
    }

    const statePath = join(config.stateDir, `issues-${taskId}.json`);
    await writeFile(statePath, JSON.stringify(issues, null, 2));
    const summary = { total, issues, conditions: describeIssues(payload) };

    if (config.dryRun) {
      await log('dry-run', { taskId, issues: issues.length, ofTotal: total, issuesPath: statePath });
      return;
    }

    const { worktree, branch } = await prepareWorktree(taskId);
    await mkdir(config.handoffDir, { recursive: true });
    const issuesPath = join(config.handoffDir, `issues-${taskId}.json`);
    const prBodyPath = join(config.handoffDir, `pr-body-${taskId}.md`);
    await writeFile(issuesPath, JSON.stringify(issues, null, 2));
    // Prose only: the analysis id is bounded and whitespace-collapsed, and it
    // reaches a file, never a command line.
    await writeFile(prBodyPath, pullRequestBody(analysisId, summary));

    await log('agent-start', { taskId, branch, issues: issues.length, ofTotal: total });
    const brief = join(worktree, 'scripts/sonar-autofix/brief.md');
    // pi-sbx keys its sandbox to its working directory. Run it from the repo root
    // and name the worktree in the prompt so the agent lands in the existing
    // pi-personal-life sandbox, which is the one that mounts the repo and holds
    // the push credential.
    const agentResult = await agent([
      '--no-session', '-p',
      '--append-system-prompt', brief,
      [
        `Worktree: ${worktree}`,
        `Branch: ${branch} (from ${config.baseBranch}, target ${config.baseBranch}).`,
        `Issues file: ${issuesPath}`,
        `PR body file: ${prBodyPath}`,
        '',
        'Fix the issues, then commit, push, and open the draft PR as the brief describes.',
      ].join('\n'),
    ], { cwd: config.repo });
    await log('agent-done', { taskId, code: agentResult.code, tail: agentResult.output.slice(-1500) });

    const delivery = await inspectDelivery(worktree, branch);
    if (delivery.url) {
      await log('pull-request', { taskId, branch, url: delivery.url, by: 'agent' });
      return;
    }

    if (delivery.commits === 0) {
      await log('no-changes', { taskId, branch });
      return;
    }

    // The agent fixed and committed but did not open the PR; finish the delivery
    // rather than dropping the work on the floor.
    await log('delivery-fallback', { taskId, branch, commits: delivery.commits });
    const url = await createPullRequest(worktree, branch, prBodyPath, summary);
    await log('pull-request', { taskId, branch, url, by: 'receiver' });
  }

  async function handleWebhook(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    if (!signatureMatches(config.webhookSecret, body, request.headers['x-sonar-webhook-hmac-sha256'])) {
      await log('rejected-signature', { remote: request.socket.remoteAddress });
      response.writeHead(401).end('bad signature');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      response.writeHead(400).end('bad json');
      return;
    }

    if (!isActionable(payload, config.projectKey)) {
      await log('ignored');
      response.writeHead(202).end('ignored');
      return;
    }

    if (busy) {
      await log('busy');
      response.writeHead(409).end('a fix run is already in progress');
      return;
    }

    busy = true;
    response.writeHead(202).end('accepted');
    fixIssues(payload)
      .catch((error) => log('failed', { error: String(error.message ?? error) }))
      .finally(() => {
        busy = false;
      });
  }

  return { handleWebhook, fixIssues, log };
}

export async function start(config = DEFAULT_CONFIG) {
  if (!config.webhookSecret || !config.sonarToken) {
    throw new Error('SONAR_WEBHOOK_SECRET and SONAR_TOKEN are required');
  }
  await mkdir(config.stateDir, { recursive: true });
  const receiver = createReceiver(config);
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/sonar') {
      response.writeHead(404).end();
      return;
    }
    receiver.handleWebhook(request, response).catch(async (error) => {
      await receiver.log('handler-error', { error: String(error.message ?? error) });
      response.writeHead(500).end();
    });
  });
  server.listen(config.port, '0.0.0.0', () =>
    receiver.log('listening', { port: config.port, project: config.projectKey, dryRun: config.dryRun }),
  );
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await start();
  } catch (error) {
    console.error(sanitizeLogText(`sonar-autofix: ${error.message}`));
    process.exit(1);
  }
}
