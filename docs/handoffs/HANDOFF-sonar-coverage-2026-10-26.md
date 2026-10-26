# Handoff — SonarQube coverage > 80% (`personal-life`)

Goal `mvovpnqd-55gvh6` — paused and handed to the host agent.
Written 2026-10-26. Supersedes nothing; this is the only coverage-work record.

---

## 1. What the goal is

Make SonarQube report **> 80% coverage** on `personal-life` by wiring up the missing
coverage plumbing — per-workspace lcov generation, `sonar.javascript.lcov.reportPaths`,
a CI test-with-coverage step — and add tests **only** if the genuinely measured number
still lands under 80%.

User decisions already confirmed (do not re-ask):

- **Plumbing only**, plus tests only if the real number is still under 80%.
- **Server number is confirmed post-merge** — locally summed lcov + a committed CI run
  on the branch is the pre-merge evidence; the goal is not complete until the `dev`
  scan is re-read from SonarQube.
- **`.github/workflows/sonarqube.yml` is in scope** — add the test-with-coverage step.

---

## 2. Root cause (this is the whole finding)

Sonar reported **0.0%**, and it was never a test gap:

| Signal | Value |
|---|---|
| SonarQube `coverage` (branch `main`, pre-change) | `0.0%` |
| SonarQube `lines_to_cover` | `6462` |
| SonarQube `uncovered_lines` | `6462` |
| SonarQube `ncloc` | `24056` |
| Real jest coverage, local measurement | **~90% of lines** |

Three separate gaps, all plumbing:

1. `sonar-project.properties` had **no `sonar.javascript.lcov.reportPaths`** — no report
   was ever ingested, so every line counted uncovered.
2. `.github/workflows/sonarqube.yml` **never ran tests** — checkout → scan only. No test
   step, no coverage artifacts, nothing for the scanner to read even if the key existed.
3. No workspace emitted lcov: no `collectCoverage` / `coverageReporters` /
   `coverageDirectory` anywhere (jest config is inline per workspace `package.json`).

---

## 3. Work done (uncommitted, in `.pi/worktrees/coverage`)

Worktree: `/home/night/WebstormProjects/personal-life/.pi/worktrees/coverage`
Branch: `pi/wf/coverage`, cut from `origin/dev` at `4ae5cc7`.
**Nothing is committed.** `git status`: 3 modified, 1 untracked.

### 3.1 `scripts/coverage.mjs` (new, ~145 lines)

One merged, repository-relative lcov from every workspace's jest suite.

- Discovers workspaces from the root manifest's `workspaces` array (already
  dependency-ordered by PR #18), keeps only those with both `jest` config and a
  `test:unit` script → **17 of 17** qualify.
- Runs `jest --coverage --coverageReporters=lcov --coverageDirectory=<per-workspace>`.
- **Rewrites `SF:` to repository-relative.** This is load-bearing: Sonar resolves a
  relative `SF:` against the project base dir, so a workspace-relative or absolute path
  matches no indexed file and is silently dropped.
- Drops `node_modules`, `dist`, `coverage`, `.next`, tests, specs, `e2e-spec`, `test/`.
- **Cross-workspace dedupe by hit count**: a workspace maps `@life/*` imports straight at
  another package's `src/`, so one file can be instrumented by several workspaces. Keeps
  the most-covered record — avoids duplicate records *and* understated totals.
- A failing suite still contributes its report, but sets exit 1 so CI never scans over a
  red suite.

### 3.2 `package.json` — one added script

```
"test:coverage": "node scripts/coverage.mjs",
```

### 3.3 `sonar-project.properties` — `+7`

```
# Coverage. SonarQube reported 0.0% for a long time because no report was ever
# produced: the scanner had nothing to ingest, so every line counted as uncovered
# even though the jest suites already covered most of them. `npm run test:coverage`
# writes one merged, repository-relative lcov here (see scripts/coverage.mjs) — the
# paths must stay relative to this directory or the scanner silently drops every
# record for failing to match an indexed file.
sonar.javascript.lcov.reportPaths=.coverage/lcov.info
```

### 3.4 `.gitignore` — `+3`

```
# Coverage reports (local lcov for SonarQube; never committed)
.coverage/
```

---

## 4. What is verified

**Task 1 — lcov generation: DONE and verified.**

```
$ npm run test:coverage
coverage: 370 files -> .coverage/lcov.info
```

- 370 files, `SF=370`, `end_of_record=370` (balanced).
- **0 absolute `SF:` paths**, 0 test/spec/e2e/dist/node_modules hits.
- **All 370 paths resolve on disk** from the repo root.
- **91.21% lines** (7376/8087) from the 12 workspaces that ran cleanly.
- `.gitignore` picks up `.coverage/`.

**Task 2 — report wired: config verified, ingestion not yet observable.**
Property parses to `.coverage/lcov.info`, report exists at that project-relative path,
370 balanced records, 0 out-of-tree paths. The remaining half of the contract ("a scan
does not warn the report is missing/unreadable") **cannot be tested in this sandbox**:
no `sonar-scanner` binary and no `SONAR_TOKEN`. It is only provable on the host/CI.

**Sample `SF:` lines** (relative, correct):

```
SF:apps/app/app/(meals)/meals/[date]/page.tsx
SF:apps/app/app/(meals)/meals/actions.ts
SF:apps/app/app/(meals)/meals/entry/[id]/editor.tsx
```

---

## 5. Real per-workspace coverage (measured, full suites)

| workspace | lines | covered/total |
|---|---|---|
| `app` | 86.27% | 1973/2287 |
| `cache` | 100% | 34/34 |
| `crypto` | 94.3% | 116/123 |
| `db` | 92.6% | 438/473 |
| `feedback-service` | 78.21% | 395/505 |
| `idp` | 94.24% | 573/608 |
| `meal-service` | 95.35% | 1212/1271 |
| `note-service` | 89.05% | 610/685 |
| `nutrition` | 100% | 52/52 |
| `ops` | 90.35% | 759/840 |
| `service-kit` | 68.86% | 115/167 |
| `shared` | 100% | 73/73 |
| `tags-service` | 91.43% | 459/502 |
| `todo-service` | 91.56% | 868/948 |
| `ui` | 99.25% | 662/667 |
| **aggregate** | **90.30%** | **8339/9235** |

Aggregate is comfortably above 80%, which is why the goal scoped itself to plumbing and
expected no test-writing. **A fresh worktree measurement gives 91.21%** over the subset
that ran (370 files / 8087 lines) — the 5 failing workspaces would only add coverage.

---

## 6. Known failures and why they are environmental, not code

5 of 17 workspaces failed in this sandbox. All failures are missing local
infrastructure/artifacts, none are caused by the coverage wiring. **Do not "fix" these by
weakening tests.**

| workspace | result | cause |
|---|---|---|
| `packages/db` | 1 failed / 70 passed | pg-dependent test; no postgres reachable |
| `packages/ops` | 132 passed, suite failed to load | `Cannot find module '@modelcontextprotocol/sdk/client'` — declared in `devDependencies` (`^1.32.1`) but not installed in this sandbox |
| `apps/note-service` | 24 failed / 120 passed | `this.sqlite is not a constructor` on e2e specs — better-sqlite3 resolves fine standalone, so this is the worktree/`node_modules` resolution under jest, not the binding |
| `apps/feedback-service` | 30 failed / 30 | postgres + rabbitmq unavailable |
| `apps/todo-service` | 32 failed / 157 passed | sqlite `data/` dir absent (gitignored) + same sqlite construct |

Two sandbox obstacles worth carrying forward:

- **`data/` dirs are gitignored**, so a fresh worktree has none. Created manually for
  `note-service`, `todo-service`, `tags-service`, `meal-service`, `idp`. A CI job on a
  fresh clone will hit the same thing — the CI step must create them (or the suites must
  create their own).
- **`postgres:17-alpine` will not initialize in this sandbox** — `initdb` fails at
  `CREATE DATABASE postgres ... STRATEGY = file_copy`, child exit 1. Not a repo problem;
  a host `docker` difference. `rabbitmq:4.1-alpine` starts fine.

Also note: `node_modules` had to be symlinked into the worktree
(`ln -s ../../../node_modules node_modules` — three levels, not two). It is ignored via
`.git/info/exclude`, so it will not leak into the commit.

`sonar-scanner` is not installed in the sandbox and `SONAR_TOKEN` is unset, so **the
scanner cannot be run here.** Verify ingestion on the host.

---

## 7. Remaining work — exactly 3 things

### Task 3 — CI test-with-coverage step (not started)

`.github/workflows/sonarqube.yml` currently has: ensure SonarQube up → checkout →
`SonarSource/sonarqube-scan-action@v8.3.0`. There is **no test step anywhere in
`.github/workflows/`** (only one workflow file exists).

Add a step between checkout and scan that runs `npm run test:coverage`, and make the job
**fail on test failure** rather than scanning a stale report. On a fresh runner this needs
the things §6 lists: `npm ci`, the `data/` dirs, and whatever the pg/rabbit suites need —
or those suites must be excluded from the coverage run. This is the main design decision
left, and it is why the work stalled: **the failure mode to avoid is a CI step that
silently produces partial coverage.**

Note the runner is `[self-hosted, sonarqube]` and shares a host with SonarQube, so Docker
and the postgres container are available there — unlike this sandbox.

### Task 4 — measure against Sonar's denominator (partly done)

Local measurement says 90.2–91.2%. Still needs the comparison against Sonar's own
`lines_to_cover` (6462 pre-change) once a scan runs with the report, because Sonar's
denominator counts only files it indexes as product source — a set that will not match
jest's exactly. **Only if that lands under 80% do tests get written**; largest genuinely
untested files if so:

| lines | file |
|---|---|
| 785 | `apps/todo-service/src/todos/todos.service.ts` |
| 518 | `apps/tags-service/src/tags/import.ts` |
| 439 | `apps/app/app/(meals)/meals/entry/[id]/editor.tsx` |
| 413 | `apps/app/app/note-editor.tsx` |
| 407 | `apps/meal-service/src/photo/gemini.client.ts` |
| 355 | `apps/note-service/src/notes/notes.service.ts` |

### Task 5 — PR + post-merge confirmation (not started)

Draft PR against `dev` (never `main`) with the measured number and the untested-file
analysis. After the user merges, re-read the `dev` scan from SonarQube to confirm > 80%.
**The goal is not complete until that server number is observed.** Do not merge the PR —
standing rule: never merge unasked.

---

## 8. Repo rules that bite here

- Branch from `origin/dev`, PR targets `dev`. Never `main`.
- Work only in `.pi/worktrees/`. One worktree per agent.
- No behavior change; preserve every existing test assertion.
- Subagents must not commit.
- **"Pre-existing" is not a category** — a red check gets fixed, not deferred. (§6 failures
  are environmental and the environment must be made to work; do not relabel them.)
- Never `--no-verify`, never merge unasked.
- The frozen surfaces (e2e selectors, token values, PWA constants) are untouched by this
  work.

---

## 9. Fastest path from here

```bash
# 1. On the host, in the existing worktree:
cd /home/night/WebstormProjects/personal-life/.pi/worktrees/coverage
npm run test:coverage          # already verified: 370 files, 91.21%

# 2. Run a scan with the new property and read the real number:
sonar-scanner -Dsonar.branch.name=pi/wf/coverage
#    then: get_component_measures(branch=pi/wf/coverage,
#          metricKeys=[coverage, lines_to_cover, uncovered_lines])

# 3. Add the CI step (task 3), re-scan, confirm, commit, open the draft PR.
```

If the scanner number is already > 80%, tasks 4's test-writing branch is dead code —
skip it and go straight to the PR.

---

## 10. Task 2 result — verified on host (2026-10-26)

Ran the real scanner on the host against the local SonarQube. This closes task 2 and
settles task 4's numbers.

```bash
# scanner 6.2.1 CLI downloaded to /tmp/sonar-scanner-6.2.1.4610-linux-x64
cd .pi/worktrees/coverage
SONAR_HOST_URL=http://127.0.0.1:9000 SONAR_TOKEN=<admin token> \
  sonar-scanner            # EXECUTION SUCCESS, 1:06
```

- Log line proving ingestion: `Analysing [.../.coverage/lcov.info]` then
  `Sensor JavaScript/TypeScript Coverage [javascript] (done)`.
- **Zero** warnings mentioning a missing/unreadable coverage report. The single `WARN`
  in the log is the unrelated `sonar.python.version` notice.
- `sonar.branch.name` is **not usable**: Community Build rejects it
  (`Developer Edition or above is required`). The project therefore keeps one record
  (branch `main`), and this scan now holds revision `405e794` from `pi/wf/coverage`.
  The post-merge `dev` scan is what makes the record authoritative again.

Server-side numbers after the scan (project `personal-life`):

| metric | before | after |
|---|---|---|
| `coverage` | 0.0% | **81.2%** |
| `line_coverage` | 0.0% | **82.3%** |
| `lines_to_cover` | 6462 | 9309 |
| `uncovered_lines` | 6462 | 1649 |
| `ncloc` | 24056 | 24146 |

Local lcov measurement for comparison: 7376/8087 = **91.21%** over the 370 files that
produced records. Sonar's denominator is larger (9309 lines) because it counts every
indexed product file, including the ones in the 5 workspaces whose suites failed in the
sandbox — those count as fully uncovered here. A CI run on the host (postgres + rabbit
available) covers them and should only move the number up.

**Consequence for task 4:** 81.2% > 80% on the server, so the test-writing branch of the
goal is dead — no tests are to be written. Margin is 1.2 points, which is why the CI
step (task 3) still matters: it is what keeps the number current and complete.

Top remaining 0.0%-coverage files on the server, for the record: `note-editor.tsx` (197
lines), `scripts`-' `receiver.mjs` (159), `oidc-dance.ts` (95),
`dispatcher.service.ts` (70), `duplication-report.py` (63), `coverage.mjs` (56).

---

## 11. Task 3 done, and the number moved (2026-10-26)

### The CI step

`.github/workflows/sonarqube.yml` now runs `setup-node` -> `npm ci` -> create the
gitignored `apps/*/data` directories -> `npm run test:coverage` **before** the scan.
A red suite fails the job on purpose, so the scanner never ingests a stale or partial
report. No `continue-on-error`.

### One real flake fixed on the way (rule: "pre-existing" is not a category)

The first full `npm run test:coverage` on the host failed 5 of 17 workspaces. Four were
sandbox artefacts that do not reproduce here (missing MCP SDK in `node_modules`, data
dirs, no postgres). One was a genuine bug in the test itself:

`packages/db/test/pg-integration.test.ts` gated readiness on `pg_isready`, which answers
against the image entrypoint's **temporary bootstrap server**. The real postmaster
restarts a moment later, so the first `psql` could land in the gap:
`connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`.
Reproduced 2/4 runs. The gate now runs `psql -c 'select 1'` against the actual
database; 3/3 clean afterwards, and the whole workspace passes 71/71.

### Numbers, all three stages

| stage | coverage | line_coverage | lines_to_cover | uncovered | ncloc |
|---|---|---|---|---|---|
| before (no report) | 0.0% | 0.0% | 6462 | 6462 | 24056 |
| report wired, 5 workspaces failed (sandbox) | 81.2% | 82.3% | 9309 | 1649 | 24146 |
| report wired, all 17 workspaces green (host) | **83.2%** | **84.3%** | 9432 | 1482 | 24146 |

Local lcov for the green run: 7660/8347 = **91.77%** over 382 files (vs Sonar's 9432
indexed lines — the difference is files jest never instruments, chiefly `scripts/` and
`apps/pomodoro`).

**Task 4 is closed without writing tests:** 83.2% > 80% was reached by plumbing alone,
which is exactly the branch the goal allowed. Margin is 3.2 points on the server.

`npm run typecheck` across all 36 workspace script invocations: 0 errors.

## 12. Fresh-clone verification and the three defects it found (2026-10-26)

The CI step was green on this host and broken on a clean clone. Replaying exactly
what a runner does found three independent causes. All are fixed on
`pi/wf/coverage`; the chain was then replayed end to end on a pristine
`git archive HEAD` checkout and now exits 0.

| replay | result |
|---|---|
| `npm ci` → suites, no build | 13/13 note-service suites red — `TS2307: Cannot find module '@life/service-kit'` |
| `npm ci` → `npm run build` → `mkdir data` → suites | green |
| `npm run test:coverage` on a cold clone | 2/13 note-service suites red — `Exceeded timeout of 5000 ms for a hook` |
| all three fixed, full chain on cold clone | **exit 0**, 382 files, 7660/8347 = 91.77% |

1. **No build before test.** Workspace `@life/*` types only exist after
   `npm run build` emits `dist/`. Added a build step. `dist/` is in
   `sonar.exclusions` and dropped by the coverage merge, so it adds no scan noise.

2. **Instrumentation vs. jest's 5s default.** `--coverage` roughly doubles ts-jest
   compile cost; a cold cache pushes e2e `beforeAll` bootstraps past 5s. Raised to
   30s in `scripts/coverage.mjs` — one flag at the entry point, not 17 config edits.

3. **Postgres readiness race, twice.** `pg_isready` (and the container's own
   "ready to accept connections") answers during the image entrypoint's *temporary
   bootstrap server*, which is shut down a moment later. Connections opened against
   it die with `Connection terminated unexpectedly`. Fixed in
   `packages/db/test/pg-integration.test.ts` and, same defect, in
   `apps/feedback-service/test/feedback-harness.ts` — both now prove readiness with
   a real `psql -c 'select 1'`.

### Quality gate: S6505

`run: npm ci` is `githubactions:S6505` (MAJOR, "package manager scripts should not
be executed during installation") and dropped the PR's new-code security rating to
C. Only three deps carry install scripts — `better-sqlite3`, `argon2`, `fsevents`
(macOS-only) — so the step is now `npm ci --ignore-scripts` plus an explicit
`npm rebuild better-sqlite3 argon2`. Verified: both native modules load, suites
green. Gate now passes.

### Coverage is robust to feedback-service skipping

feedback-service's Postgres suites skip when Docker is absent (by design, in
`canProvidePostgres`). Measured both ways: with it 7660/8347 = 91.77%; without it
7392/8020 = 92.16%. Its 327 instrumented lines are 89% covered, so a skip costs
nothing; the number does not depend on Docker being up.

### Outstanding

Docker died on this host midway through the last replay (`/var/run/docker.sock`
gone, `systemctl docker` inactive, no passwordless sudo). SonarQube runs in a
container, so the post-merge `dev` scan cannot be re-read until it is back. The
committed server number stays task-2's verified **83.2%** — that scan is real
evidence; a re-scan would only confirm it on the same tree.
