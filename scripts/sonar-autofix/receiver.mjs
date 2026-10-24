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
  stateDir: process.env.SONAR_AUTOFIX_STATE ?? join(homedir(), '.local/state/sonar-autofix'),
  // Deliberately not the worktree this feature is developed in: the run starts by
  // force-removing its worktree, so sharing a path would delete the checkout.
  worktree: process.env.SONAR_AUTOFIX_WORKTREE ?? join(homedir(), '.cache/sonar-autofix/worktree'),
  timeoutMs: Number(process.env.SONAR_AUTOFIX_TIMEOUT_MS ?? 30 * 60 * 1000),
  maxIssues: Number(process.env.SONAR_AUTOFIX_MAX_ISSUES ?? 25),
  dryRun: process.env.SONAR_AUTOFIX_DRY_RUN === '1',
};

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
 * projects — would loop or chase the whole backlog.
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
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail });
    console.log(line);
    await appendFile(join(config.stateDir, 'runs.log'), `${line}\n`).catch(() => {});
  }

  async function fetchIssues() {
    const query = new URLSearchParams({
      componentKeys: config.projectKey,
      resolved: 'false',
      inNewCodePeriod: 'true',
      severities: 'BLOCKER,CRITICAL,MAJOR',
      types: 'BUG,VULNERABILITY,CODE_SMELL',
      ps: String(config.maxIssues),
      s: 'SEVERITY',
      asc: 'false',
    });
    const response = await fetch(`${config.sonarUrl}/api/issues/search?${query}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${config.sonarToken}:`).toString('base64')}` },
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

  function git(args, { cwd = config.repo, env = process.env } = {}) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

  function run(command, args, options = {}) {
    return new Promise((resolvePromise) => {
      const child = spawn(command, args, { env: process.env, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
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
    });
  }

  async function prepareWorktree(taskId) {
    const worktree = config.worktree;
    const branch = `fix/sonar-${taskId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
    await mkdir(dirname(worktree), { recursive: true });
    // Prune rather than remove: a leftover worktree from a killed run must go, but
    // `remove --force` on a path that is not a worktree would fail the run.
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
    await git(['worktree', 'prune']).catch(() => {});
    await git(['branch', '-D', branch]).catch(() => {});
    await git(['fetch', 'origin', 'main']);
    await git(['worktree', 'add', worktree, '-b', branch, 'origin/main']);
    return { worktree, branch };
  }

  async function openPullRequest(worktree, branch, taskId, summary) {
    await git(['add', '--all'], { cwd: worktree });
    const staged = await git(['diff', '--cached', '--name-only'], { cwd: worktree });
    if (staged.length === 0) return { changed: false };

    const message = [
      `fix(sonar): address ${summary.issues.length} new-code issue(s)`,
      '',
      `Analysis ${taskId}. Failed gate conditions: ${summary.conditions.join(', ') || 'none reported'}.`,
      '',
      summary.issues.map((issue) => `- ${issue.rule} ${issue.file}:${issue.line}`).join('\n'),
    ].join('\n');
    await git(['commit', '-m', message], { cwd: worktree });

    const push = await run('git', ['-C', worktree, 'push', '--set-upstream', 'origin', branch]);
    if (push.code !== 0) throw new Error(`push failed: ${push.output}`);

    const pr = await run('gh', [
      'pr', 'create',
      '--draft',
      '--base', 'main',
      '--head', branch,
      '--title', `fix(sonar): ${summary.issues.length} new-code issue(s)`,
      '--body', [
        `SonarQube reported a quality gate failure on \`main\` (analysis ${taskId}).`,
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
        'Opened by the local sonar-autofix receiver. Review before merging.',
      ].join('\n'),
    ], { cwd: worktree });
    if (pr.code !== 0) throw new Error(`gh pr create failed: ${pr.output}`);
    return { changed: true, url: pr.output.match(/https:\/\/\S+/)?.[0] ?? '' };
  }

  async function fixIssues(payload) {
    const taskId = payload.taskId ?? 'unknown';
    const { total, issues } = await fetchIssues();
    if (issues.length === 0) {
      await log('no-issues', { taskId });
      return;
    }

    const issuesPath = join(config.stateDir, `issues-${taskId}.json`);
    await writeFile(issuesPath, JSON.stringify(issues, null, 2));
    const summary = { total, issues, conditions: describeIssues(payload) };

    if (config.dryRun) {
      await log('dry-run', { taskId, issues: issues.length, ofTotal: total, issuesPath });
      return;
    }

    const { worktree, branch } = await prepareWorktree(taskId);
    await log('agent-start', { taskId, branch, issues: issues.length, ofTotal: total });

    const brief = join(worktree, 'scripts/sonar-autofix/brief.md');
    const agent = await run('pi-sbx', [
      '--no-session', '-p',
      '--append-system-prompt', brief,
      `Fix the SonarQube issues listed in ${issuesPath}.`,
    ], { cwd: worktree });
    await log('agent-done', { taskId, code: agent.code, tail: agent.output.slice(-1500) });
    if (agent.code !== 0) throw new Error(`pi-sbx exited ${agent.code}`);

    const result = await openPullRequest(worktree, branch, taskId, summary);
    await log(result.changed ? 'pull-request' : 'no-changes', { taskId, branch, url: result.url });
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
      await log('ignored', {
        project: payload.project?.key,
        status: payload.status,
        gate: payload.qualityGate?.status,
      });
      response.writeHead(202).end('ignored');
      return;
    }

    if (busy) {
      await log('busy', { taskId: payload.taskId });
      response.writeHead(409).end('a fix run is already in progress');
      return;
    }

    busy = true;
    response.writeHead(202).end('accepted');
    fixIssues(payload)
      .catch((error) => log('failed', { taskId: payload.taskId, error: String(error.message ?? error) }))
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
  start().catch((error) => {
    console.error(`sonar-autofix: ${error.message}`);
    process.exit(1);
  });
}
