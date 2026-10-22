# Operational Cases — Parallel `agents-hard-gates` Run (2026-10-16)

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

Retrospective of the operational problems hit while four `agents-hard-gates`
workflows ran in parallel against one monorepo, one git worktree each. This is a
process/incident report, not a code review. For the per-feature outcomes see the
report each run wrote into its own worktree.

## Scope

| Feature | Run ID | Worktree | Verdict |
|---|---|---|---|
| todo today-manual-order | `mvaw1k8u-i99eph` | `.pi/worktrees/todo-today-manual-order` | **PASS** (5-lane 5/5, 2 rounds) |
| ops shared-package | `mvayzbhk-uhs47i` | `.pi/worktrees/ops-shared-package` | **PASS** (64/64 tests, security clean) |
| feedback status | `mvavtm10-1u8qif` | `.pi/worktrees/feedback-status` | **BLOCKED** — QA lane, 3 rounds |
| meal-food management | `mvb5v5ps-jku22h` | `.pi/worktrees/meal-food-management` | **BLOCKED** — task 8 e2e, 3 repair rounds |

Each run: spec gate → plan gate → implementation (per task, verify/repair) →
review lifecycle → five-lane gate → report. Runs launched with
`agentRetries: 5`, `agentTimeoutMs: 1800000` (30 min).

---

## Case 1 — 9router hangs a mid-implementation agent call

**Symptom.** An agent call freezes silently: `tokens` flat, no journal/state
update, no worktree writes, no `jest`/`tsc`/`node` process. Distinct from a slow
call (which keeps ticking `tokens` and writing files).

**Root cause.** 9router intermittently hangs a call at the transport/model layer
— no error, no timeout, no completion. Runs configured `agentRetries=0,
agentTimeoutMs=null` wait forever.

**Remedy.** `workflow_control pause` → `resume`. The hung in-flight call is
dropped (`skipped` increments) and the task is re-dispatched from its task
boundary. Completed, verified work in the worktree is untouched. Verified on
`mvaw1k8u` (1×), `mvayzbhk` (4×), and the meal-food runs.

**Policy.** Stand the pause→resume recovery up as the standard hang remedy.
Prefer launching with `agentRetries ≥ 1` + a bounded `agentTimeoutMs` so hangs
and timeouts self-heal without babysitting.

## Case 2 — Model unavailability returns `400`

**Symptom.** `agent ... attempt N failed: 400 {"error": ...}` — e.g.
`lite-claude-code` went "Model is unavailable" upstream mid-run; task-repair on
meal-food hit a `400 {"model":"muse..."}` (transient).

**Root cause.** Upstream model flakiness/unavailability on the 9router tier in
use, not the workflow.

**Remedy.** `agentRetries` makes transient `400`s self-heal (retry). Probe
before blaming the workflow:

```bash
curl http://host.docker.internal:20128/v1/chat/completions -H "Authorization: Bearer $PI_SBX_API_KEY" ...
```

**Policy.** Always launch with `agentRetries: 5`. Model tiers:
`small=9router/lite-claude-code`, `medium=9router/flash-claude-code`,
`big=9router/reasoning-claude-code` (`~/.pi/workflows/model-tiers.json`).

## Case 3 — Unachievable-contract repair loop (meal-food task 5)

**Symptom.** Implementation oscillated repair rounds without converging; plan
gate churned 6 rounds with findings swinging 3→4→3→2→5 (non-converging).

**Root cause.** The task verifier judged task 5 against the *spec's* browser-level
Success Criteria (SC1/SC2/SC4: "create Milk Brand X → delete → day totals
intact", as executed e2e) rather than the task's own Definition of Done. But task
5's blast radius excluded `apps/app/test/e2e/meals.spec.ts` ("the brief did not
grant e2e"), so the demanded proof was impossible to produce within scope. The
max-2-test-run budget collided with the prove-everything verifier standard, and
the tests mocked the BFF boundary anyway (delete proven only on a local array).

**Remedy.** Fix the *proof-level boundary* in the plan file (`tasks/plan.md`) —
the split's `scope`/`done` fields are the only task text the verifier sees, so the
boundary was made explicit there: Tasks 4/5/7 prove at unit/fixture level (mocked
BFF boundary acceptable), never write/run/demand Playwright — browser proof is
Task 8's Run 2. Relaunched with `planPath: tasks/plan.md`; the validator reads the
file and repairs edit it in place (self-healing loop). Spec left frozen via
`specPath` (validated spec on disk) to avoid re-draft churn.

**Policy.** When a task verifier demands proof the task's scope is built to never
produce, the defect is in the plan's task briefs (proof-level boundary), not the
implementation. Scope `apps/app/test/e2e/**` to the e2e-owning task and state the
proof level per task. Do not let a verifier import spec-level Success Criteria
into a task that owns only a slice.

## Case 4 — Shared hardcoded e2e port across parallel worktrees (feedback QA)

**Symptom.** feedback Five-Lane QA lane failed all 3 rounds:
`apps/app/test/e2e/feedback.spec.ts:62` — "run 1 hit EADDRINUSE 127.0.0.1:3100
from a stale server, runs 2-3 timed out on `locator.click` (60s)". Round-1
correctness corroborated: "`_next/static` asset (CSS + all JS) 400" — the browser
reached a foreign/half-started server.

**Root cause.** Every worktree's `apps/app/playwright.config.ts` hardcodes
`baseURL: http://localhost:3100` (`?? 'http://localhost:3100'`). With several
worktrees running e2e concurrently they fight over the one port. Compounded by
orphans: a stale `next-server` (PID 65751) from the aborted meal-food run was
still alive serving a `(deleted)` standalone build on `:3110`. The QA demand
(browser proof of SPEC-feedback-status SC7) was legitimate — unlike Case 3 — the
harness just couldn't observe it.

**Remedy.** Killed the orphaned `next-server`. Left the config fix open.

**Policy.** Parallel worktrees must not share one e2e port. Either give each
worktree a distinct `APP_URL` + matching `webServer.port` (the config already
reads `APP_URL`), or serialize e2e across worktrees. Kill stale `next-server`
leftovers before an e2e run. Track server leftovers as run garbage.

## Case 5 — `agentTimeoutMs` cap too tight for the largest task

**Symptom.** meal-food task 7 and task 8 looped `AGENT_TIMEOUT`:

```text
19:53  implement:8/8      attempt 1/4  timed out (1800000ms)
20:28  task-repair:8/8:1  attempt 1/4  timed out
20:58  task-repair:8/8:1  attempt 2/4  timed out
21:21  task-repair:8/8:1  attempt 3/4  400 model error
```

**Root cause.** `agentTimeoutMs: 1800000` (30 min) is under the real wall time of
the biggest tasks (task 7: FAB menu + food-picker + editor seeding + new suite;
task 8: two e2e journeys + frozen-surface gates + Playwright runs). Each attempt
made real progress (files written, tokens climbing) but couldn't finish before the
cap, so it timed out and retried — the 30-min cap is baked in at launch, so
pause→resume re-runs the same capped call.

**Remedy.** None applied within the run (see Open items). File writes persist
across retries, so attempts accumulate work in the tree and a later attempt can
finish — but a task that reliably exceeds the cap needs a larger `agentTimeoutMs`
from the start.

**Policy.** Size `agentTimeoutMs` to the largest task, not the median (~60 min for
e2e-heavy tasks). Keep `agentRetries` so a capped attempt can retry from the
accumulated tree.

## Case 6 — Stall detection must use live status, not the run file

**Symptom.** A run's `index.json`/`.log` `updatedAt` looked 10+ min stale →
appeared stalled. False positive.

**Root cause.** The run file is written lazily. For `mvayzbhk` the on-disk index
showed `tokens=19314532, updated 10.7 min ago`, but pausing revealed live
`tokens=20496670` — real progress.

**Policy.** Detect a stall by polling `workflow_control status` (its `tokens` is
the live counter) and treat a stall as **live tokens unchanged across two
consecutive checks**, corroborated by no worktree writes (`find -mmin`) and no
`jest`/`tsc`/`node` in `ps aux`. Only then pause→resume. (The user's standing
rule: intervene on any workflow hung > 10 minutes.)

## Case 7 — `resumeFromRunId` cannot pair with `name`

**Symptom.** Wanted to relaunch meal-food with a higher `agentTimeoutMs` via
`resumeFromRunId`; the tool rejects `name` + `resumeFromRunId` together.

**Root cause.** A named (saved) workflow's `name` and a raw `script` are
alternative execution surfaces. To resume a name-launched run you must re-supply
the raw script (`~/.pi/workflows/saved/agents-hard-gates.js`, ~72 KB) as `script`
alongside `resumeFromRunId`. Completed agent() calls replay from the journal
cache; only the first changed/new/never-completed call onward re-runs.

**Policy.** For simple edits, a fresh run that reuses artifacts (on-disk frozen
spec via `specPath`, amended plan via `planPath`, done worktree) is cheaper and
less fragile than a 72 KB script resume. Reserve the script resume for when you
must change a run-level parameter mid-flight.

## Case 8 — Flaky e2e + fixed test-run budget blocks the e2e task (meal-food task 8)

**Symptom.** meal-food task 8 blocked after 3 repair rounds. Run 1 batch: 4/5 —
`meals day view › day total sum confirmed entries` failed. A single-test retry
passed in isolation, but the *specified* Run-1 invocation (all 5 in one run) was
never green. **Run 2 never executed** — zero browser evidence for the foods CRUD
journey, manual-log journey, history-immutability, or delete-dialog flow.

**Root cause.** Two constraints collide:
1. A **flaky test / cross-test interference** — `day total sum` passes alone but
   fails in the full batch (test-ordering pollution).
2. `max-test-runs=2` — the task DoD needs **two green batches** (Run 1 + Run 2),
   but the budget is 2 runs total. Run-1 batch (1) + single-test retry (2) = budget
   exhausted → Run 2 had no room. Any flake that consumes the retry starves Run 2.

Compounding: the first-run failure artifacts were cleaned (`test-results` held only
the retry's passed `last-run.json`), so the flake's root cause (cross-test
interference vs. transient) is undiagnosable.

**Root cause category.** Task-DoD-vs-test-budget mismatch — the same disease as
Case 3, one layer up: the DoD demands two green runs but the run budget makes that
unreliable the moment a flake appears.

**Policy (open).** Options: (a) grant an e2e task a budget that accounts for one
diagnostic retry *plus* both batches; (b) require the e2e suite to be
order-independent before budgeting fixed batches; (c) never clean first-run failure
artifacts — a flake's evidence is the deliverable; (d) run the flaky test to green
in isolation as a *diagnostic*, but gate only on the specified batches.

---

## Cross-cutting lessons

1. **Launch policy for every `agents-hard-gates` run:** `agentRetries: 5`,
   `agentTimeoutMs` sized to the largest task (~60 min for e2e-heavy). This alone
   removes most babysitting (Cases 1, 2, 5).
2. **Parallel worktrees + e2e = port contention.** Distinct `APP_URL`/port per
   worktree or serialized e2e (Case 4). Kill stale `next-server` leftovers.
3. **Fix verifier overreach in the plan's task briefs** (`scope`/`done`), not in
   code — the verifier only sees those fields (Cases 3, 8).
4. **Diagnose with live state** (`workflow_control status`), not lazy run files
   (Case 6).
5. **Preserve failure artifacts.** Cleaned e2e evidence turns a diagnosable flake
   into an unverifiable blocker (Case 8).

## Open items (need a decision)

- **meal-food task 8** is blocked at the e2e task. Options: (1) relaunch with
  `agentTimeoutMs: 60min` + a test-run budget that covers Run 1 + a flake retry +
  Run 2 (and stop cleaning failure artifacts); (2) fix the flaky
  `day total sum` test's cross-test interference first, then re-run; (3) accept
  partial delivery and land tasks 1–7 (all verified) separately. Recommend (2):
  the flake is the true root cause and re-running with a bigger budget just spends
  more tokens to rediscover it.
- **feedback QA** needs the e2e-port fix (per-worktree `APP_URL`/port or
  serialized e2e) before its QA lane can observe SC7. The feature code is fine
  (correctness + plan-conformance both reached `PASS_WITH_NITS`).
