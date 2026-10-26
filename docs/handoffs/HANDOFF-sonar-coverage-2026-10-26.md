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
