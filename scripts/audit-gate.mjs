#!/usr/bin/env node
/**
 * Fail CI on a high/critical advisory that nobody has signed off on.
 *
 * `npm audit` can only report: it cannot tell "known debt, time-boxed" apart from
 * "a new advisory landed today", so a plain `npm audit --audit-level=high` step is
 * either ignored (green on a known-bad tree) or permanently red (there is always
 * one advisory pending an upgrade). This gate is the missing distinction: the
 * checked-in allowlist `.github/audit-allowlist.json` is the sign-off, and this
 * script fails when the audit and the allowlist disagree.
 *
 * The audit covers the whole dependency tree, devDependencies included. A dev
 * advisory does not ship, but it still executes — jest, ts-jest and the build
 * tooling run with the developer's own credentials on the developer's own machine —
 * so a critical one is a real risk that deserves the same sign-off, and excluding
 * dev is how a critical advisory can sit invisible while the gate reports that
 * everything is accounted for.
 *
 * Fails when:
 *   - a high/critical advisory is reported but not allowlisted at that severity;
 *   - an allowlisted advisory is no longer reported (delete the exception, it rots);
 *   - a critical allowlist entry is past its own `reviewBy` date (a time bomb, so a
 *     critical cannot sit forever behind a doc comment).
 * Moderate/low advisories are printed for information and never fail the run.
 *
 * Run: node scripts/audit-gate.mjs   (`npm run audit:gate`)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_FILE = fileURLToPath(new URL('../.github/audit-allowlist.json', import.meta.url));
const FAILING_SEVERITIES = new Set(['high', 'critical']);
const SEVERITY_RANK = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
]);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `npm audit --json` over the full tree, parsed. A non-zero exit is expected and ignored.
 *
 * One whole-tree run rather than `--omit=dev` plus a dev run: the full report is a
 * superset of the production-only one, so merging two reports would only add a way
 * for the two to disagree.
 */
function readAuditReport() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout, stderr, error } = spawnSync(npm, ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (error) fail(`could not run \`npm audit\`: ${error.message}`);

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail(`\`npm audit\` did not return JSON:\n${stderr.trim() || stdout.trim()}`);
  }
  // `npm audit` reports its own failures (missing lockfile, registry unreachable) as
  // `{ error: … }` with no vulnerabilities map — fail closed rather than reading zero.
  if (!report.vulnerabilities) {
    fail(`\`npm audit\` failed:\n${report.error?.summary ?? stderr.trim()}`);
  }
  return report;
}

/** Every advisory in the report, keyed by its id so one advisory is counted once. */
function advisoriesOf(auditReport) {
  const advisories = new Map();
  for (const [packageName, finding] of Object.entries(auditReport.vulnerabilities)) {
    for (const entry of finding.via) {
      // A bare string names the package this one is vulnerable *through* — the
      // advisory itself is recorded against that other package. Skip, don't invent.
      if (typeof entry !== 'object' || entry === null) continue;
      const advisory = advisoryOf(entry, packageName);
      advisories.set(advisory.id, advisory);
    }
  }
  return advisories;
}

function advisoryOf(viaEntry, packageName) {
  return {
    id: advisoryIdOf(viaEntry),
    package: viaEntry.name ?? packageName,
    severity: viaEntry.severity,
    title: viaEntry.title,
    url: viaEntry.url,
  };
}

/** The GHSA id the advisory's own url carries; npm's numeric source id otherwise. */
function advisoryIdOf(viaEntry) {
  return viaEntry.url?.match(/GHSA-[\da-z-]+/i)?.[0] ?? `npm:${viaEntry.source}`;
}

function allowlistOf() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_FILE, 'utf8');
  } catch {
    fail(`no allowlist at ${ALLOWLIST_FILE} — it is the sign-off this gate compares against`);
  }
  const entries = JSON.parse(raw).advisories ?? [];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/** The gate: three ways for the audit and the allowlist to disagree. */
function violationsOf({ advisories, allowlist }) {
  const reported = new Set(advisories.keys());
  return {
    unaccounted: [...advisories.values()].filter(
      (advisory) =>
        FAILING_SEVERITIES.has(advisory.severity) &&
        !allowlistCovers(allowlist.get(advisory.id), advisory.severity),
    ),
    stale: [...allowlist.values()].filter((entry) => !reported.has(entry.id)),
    overdue: [...allowlist.values()]
      .filter((entry) => entry.severity === 'critical' && daysOverdue(entry.reviewBy) > 0)
      .map((entry) => ({ entry, days: daysOverdue(entry.reviewBy) })),
  };
}

/** An allowlisted severity covers the reported one unless it has escalated past it. */
function allowlistCovers(allowlistEntry, reportedSeverity) {
  if (!allowlistEntry) return false;
  const [allowed, reported] = [allowlistEntry.severity, reportedSeverity].map(
    (severity) => SEVERITY_RANK.get(severity) ?? 0,
  );
  return allowed >= reported;
}

function daysOverdue(reviewBy) {
  if (!reviewBy) return 0;
  // The deadline is inclusive: on the review date the entry is 0 days overdue.
  return Math.floor((Date.now() - Date.parse(reviewBy)) / DAY_MS);
}

function reportViolations({ unaccounted, stale, overdue }) {
  console.error('audit: FAILED');

  for (const advisory of unaccounted) {
    console.error(`  not allowlisted  ${advisory.id}  ${advisory.package}  ${advisory.severity}`);
    console.error(`    ${advisory.title}`);
    console.error(`    ${advisory.url}`);
  }
  for (const entry of stale) {
    console.error(
      `  stale entry      ${entry.id}  ${entry.package}  ${entry.severity} — npm audit no longer reports it; delete the exception`,
    );
  }
  for (const { entry, days } of overdue) {
    console.error(
      `  past reviewBy    ${entry.id}  ${entry.package}  critical — ${days} day${days === 1 ? '' : 's'} overdue (reviewBy ${entry.reviewBy})`,
    );
  }

  console.error(
    'audit: upgrade the dependency, or add/refresh its entry in .github/audit-allowlist.json with a reason and a reviewBy date',
  );
}

function reportInformational(advisories) {
  const informational = [...advisories.values()].filter(
    (advisory) => !FAILING_SEVERITIES.has(advisory.severity),
  );
  if (informational.length === 0) return;
  console.log(`audit: ${informational.length} moderate/low advisories (information only):`);
  for (const advisory of informational) {
    console.log(`  ${advisory.severity.padEnd(8)}  ${advisory.package}  ${advisory.id}`);
    console.log(`    ${advisory.title}`);
  }
}

function reportPass(advisories, packageCount) {
  const counts = new Map();
  for (const advisory of advisories.values()) {
    counts.set(advisory.severity, (counts.get(advisory.severity) ?? 0) + 1);
  }
  const breakdown = ['critical', 'high', 'moderate', 'low', 'info']
    .filter((severity) => counts.has(severity))
    .map((severity) => `${counts.get(severity)} ${severity}`)
    .join(', ');
  console.log(
    `audit: ${advisories.size} advisories in ${packageCount} packages (${breakdown}), all accounted for`,
  );
}

function fail(message) {
  console.error(`audit: ${message}`);
  process.exit(1);
}

const auditReport = readAuditReport();
const advisories = advisoriesOf(auditReport);
const allowlist = allowlistOf();
const violations = violationsOf({ advisories, allowlist });

reportInformational(advisories);

if (violations.unaccounted.length || violations.stale.length || violations.overdue.length) {
  reportViolations(violations);
  process.exitCode = 1;
} else {
  reportPass(advisories, Object.keys(auditReport.vulnerabilities).length);
}
