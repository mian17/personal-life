# Implementation Plan: e2e stack slots — fair cross-worktree e2e isolation

Source: planning-and-task-breakdown planning over `docs/specs/SPEC-e2e-stack-slots.md` (frozen, validated) + `docs/intent/e2e-stack-slots.md`.
Plan is written from the spec by that skill; it does not widen scope.

## Overview

Concurrent worktrees booting the e2e harness today claim one fixed port set (31xx/32xx/33xx) and one fixed throwaway Postgres container name, and each run builds Next *before* binding anything — so contention surfaces as port collisions and rebuild-guessing, which the QA lane reports as a code-test FAIL. This plan adds a machine-scoped slot pool (`E2E_CONCURRENCY`, default 1, max 9) inside the existing e2e entry points. A holder claims a slot *before any build or port bind*, derives every harness port and the throwaway Postgres container name from the slot index, and releases the claim at teardown. Attempts that are not their turn exit in milliseconds with a machine-parseable `E2E_QUEUE_BUSY` / `E2E_QUEUE_TIMEOUT` line plus a human line naming the holder and its ports, using exit code 75 — never a rebuild signal, never a test run. Stale claims (holder pid dead, or claim file past the run ceiling) are reclaimed on sight.

No new dependency: `node:fs`, `node:os`, `node:path`, `node:process` only.

## Architecture Decisions

- **Queue module is one file** (`apps/app/test/e2e/slot-queue.ts`) exposing claim/release/report. Both Playwright global-setup entry points call it; nothing else in the harness knows about queueing. Rationale: one place to test, no second source of truth for slot state.
- **Claim before build, release at teardown.** The claim is taken at the top of `global-setup.ts` / `global-setup.dev.ts` (before `startStack`, which does the `next build`), and released from the matching `global-teardown*.ts` plus a best-effort `finally` in `test/e2e/teardown.ts` so an aborted setup still frees the slot.
- **Per-slot derivation, not per-slot config.** `testPorts(slot)`, `devPorts(slot)`, `hopPorts(slot)` and the degraded-app port shift by `10 * slot`; the Postgres container becomes `feedback-pg-e2e-<slot>`. Existing `E2E_*_PORT` / `E2E_DEV_*_PORT` / `E2E_HOP_*_PORT` / `E2E_FEEDBACK_PG_CONTAINER` overrides keep winning, so single-run workflows are unchanged. Slot 0 reproduces today's numbers except the degraded app, which moves from the hardcoded `3199` to the spec's `3108 + 10s` band (spec §4 table; §6 exempts degraded from slot-0 equivalence).
- **Machine-scoped state dir** `${os.tmpdir()}/life-e2e-slots`, override `E2E_QUEUE_DIR`. Worktree-local state cannot arbitrate between worktrees. Contents: `<slot>.hold.json` (pid, worktree, ports, claimedAt) and FIFO tickets `<createdAt>-<pid>.json` (worktree, requestedAt), exactly as spec §4 names them.
- **Tickets are created `wx` (exclusive) and stale tickets are pruned** in the same pass that reclaims dead claims, so an abandoned attempt cannot park the head of the queue forever.
- **ETA is measured, not guessed:** rolling median of the last 5 completed holds recorded in the queue dir; cold start falls back to a documented constant. `retryAfter` = `position * eta`.
- **Exit 75 (`EX_TEMPFAIL`) for both marker exits.** That code is what makes "busy" distinguishable from "failed" for the lane; no test failure path uses it.
- **`E2E_CONCURRENCY` is validated before any claim** (integer 1-9, clear error otherwise), so a bad value can never half-claim a slot.

## Task List

- [ ] Task 1: Slot-derived ports and feedback container name
- [ ] Task 2: Slot queue core — claim, release, FIFO tickets, stale reclaim
- [ ] Task 3: Queue reporting — measured ETA, busy/timeout markers, exit 75
- [ ] Task 4: Production harness claims a slot before build, releases at teardown
- [ ] Task 5: Dev harness claims its own slot
- [ ] Task 6: Loopback login hop (in scope — the harness made the bug reachable)

Checkpoint after Tasks 1-3: derivation and queue unit suites green, `npm run typecheck` green, no harness entry point wired yet — queue logic provable without booting a stack.

Checkpoint after Tasks 4-5: one policy-allowed e2e run proves the derived stack boots; two concurrent invocations with `E2E_CONCURRENCY=1` show the second one exiting in milliseconds with `E2E_QUEUE_BUSY` (manual check, see Task 4).

## Task 1: Slot-derived ports and feedback container name

**Description:** Turn the harness port constants into per-slot derivation. `testPorts`, `devPorts`, `hopPorts` gain a `slot = 0` parameter and shift every port by `10 * slot` inside its own band (prod 31xx, dev 32xx, hop 33xx), the degraded app port derives from its band instead of the hardcoded `3199`, and the throwaway feedback Postgres name becomes a function of the slot (`feedback-pg-e2e-<slot>`). Explicit env overrides keep winning over derived values, so an operator pinning a port still gets that port.

**Acceptance criteria:**
- [ ] `testPorts(s)` / `devPorts(s)` / `hopPorts(s)` return ports shifted by `10 * s`; slot 0 returns today's 3100/3101/3103/3104/3105/3106/3107 and 3200/3201/3203/3204/3205/3206/3207 and 3310/3311.
- [ ] Port sets for any two distinct slots in 0-8 are disjoint, and every port stays inside its documented band (31xx, 32xx, 33xx).
- [ ] Degraded app port derives as `3108 + 10 * slot`; the hardcoded `3199` is gone from `degraded-app.ts`.
- [ ] Feedback Postgres container name is `feedback-pg-e2e-<slot>`, i.e. distinct across slots; `E2E_FEEDBACK_PG_CONTAINER` still overrides it.
- [ ] Each `E2E_*_PORT` / `E2E_DEV_*_PORT` / `E2E_HOP_*_PORT` env override wins over the derived value for any slot.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts
- [ ] Manual check: `node -e` printing `testPorts(0)` and `testPorts(1)` (or the slot-ports suite output) shows slot 1 exactly 10 above slot 0 per band

**Dependencies:** None
**Files likely touched:**
- `apps/app/test/e2e/config.ts`
- `apps/app/test/slot-ports.test.ts`
**Estimated scope:** Small: 1-2 files

## Task 2: Slot queue core — claim, release, FIFO tickets, stale reclaim

**Description:** Add `apps/app/test/e2e/slot-queue.ts`: the machine-scoped state dir, FIFO ticket files, per-slot claim files, and the acquire/release API the harness entry points will call. Acquire writes a ticket, then walks slots in index order claiming the first free one with an exclusive `wx` write of `<slot>.hold.json` (pid, absolute worktree, derived ports, claimedAt); an attempt holding the queue head wins before later tickets. Before deciding "free", the queue reclaims a slot whose holder pid is gone (`process.kill(pid, 0)` → ESRCH) or whose claim file is older than the run ceiling (`E2E_SLOT_MAX_AGE_MS`, default 1_800_000). Release removes the caller's claim and ticket. `E2E_CONCURRENCY` is parsed and range-checked (1-9, default 1) here, before any claim.

**Acceptance criteria:**
- [ ] With `E2E_CONCURRENCY=1` and a slot already claimed by a live pid, acquire does not return a slot and the existing claim file is untouched.
- [ ] FIFO: two waiters with ascending ticket timestamps are served in ticket order; a later ticket never wins a slot a live earlier ticket can take.
- [ ] Claim file content carries pid, absolute worktree path, derived ports and `claimedAt`; release deletes exactly the caller's claim and ticket.
- [ ] A claim whose pid is dead is reclaimed and the next attempt acquires that slot without manual cleanup; a claim file backdated past `E2E_SLOT_MAX_AGE_MS` is reclaimed the same way.
- [ ] `E2E_CONCURRENCY=10` (and `0`, non-numeric) fails fast with a clear error before any file is created in the queue dir.
- [ ] `E2E_QUEUE_DIR` overrides the state dir; default is under `os.tmpdir()`, never inside the worktree.
- [ ] No new dependency appears in any `package.json`; queue code imports only `node:*` modules.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-queue.test.ts
- [ ] Manual check: with a temp `E2E_QUEUE_DIR`, a held claim from a live pid blocks a second acquire while a claim with a bogus pid is reclaimed on sight

**Dependencies:** None
**Files likely touched:**
- `apps/app/test/e2e/slot-queue.ts`
- `apps/app/test/slot-queue.test.ts`
**Estimated scope:** Small: 1-2 files

## Task 3: Queue reporting — measured ETA, busy/timeout markers, exit 75

**Description:** Finish the queue's attempt path: when a slot cannot be acquired within `E2E_QUEUE_ACQUIRE_GRACE_MS` (default 30_000) the attempt emits `E2E_QUEUE_BUSY holder=<pid> worktree=<abs path> position=<n> retryAfter=<seconds>` (or `E2E_QUEUE_TIMEOUT` with the same field set when its grace expired) followed by one human line naming the holder and its ports, and exits with code 75 instead of waiting further. `retryAfter` derives from the measured ETA: rolling median of the last 5 completed hold durations recorded in the queue dir, falling back to a documented constant when there is no history. Waiting between polls is short and bounded so a not-my-turn attempt returns in milliseconds when its turn is not near.

**Acceptance criteria:**
- [ ] Busy path prints exactly one `E2E_QUEUE_BUSY` line with the four fields `holder`, `worktree`, `position`, `retryAfter`, then exactly one human line naming the holder and its derived ports.
- [ ] Grace expiry prints one `E2E_QUEUE_TIMEOUT` line with the same four fields plus the human line, and exits.
- [ ] Both marker paths exit with code 75; no other path in the queue module exits non-zero for a busy/timeout condition.
- [ ] A not-my-turn attempt with a live holder and a near-term turn returns in well under a second (asserted in the suite), never sleeping for the whole grace.
- [ ] `retryAfter` equals `position * eta`, where eta is the median of the last 5 recorded hold durations; with no history it equals the documented constant × position.
- [ ] Release records the completed hold duration so the next attempt's ETA reflects it.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-queue.test.ts
- [ ] Manual check: a second attempt against a live claim prints the `E2E_QUEUE_BUSY` marker line and human line and `echo $?` shows 75

**Dependencies:** Task 2
**Files likely touched:**
- `apps/app/test/e2e/slot-queue.ts`
- `apps/app/test/slot-queue.test.ts`
**Estimated scope:** Small: 1-2 files

## Task 4: Production harness claims a slot before build, releases at teardown

**Description:** Wire the queue into the production e2e entry point so the claim happens before any build or port bind and is released on every exit path. `global-setup.ts` acquires a slot first, then derives ports and the feedback container name from that slot and starts the stack; it records the slot for teardown. `global-teardown.ts` releases the claim after stopping services and the throwaway Postgres. `test/e2e/teardown.ts` gets a best-effort release in a `finally` so an aborted setup does not leak the slot. `stack.ts` consumes the derived feedback container name instead of the module constant, and `degraded-app.ts` consumes the derived degraded port.

**Acceptance criteria:**
- [ ] The slot is claimed before `startStack` runs, i.e. before any `next build` or port bind, and the claim file exists for the whole run.
- [ ] Teardown (normal, and aborted-setup via the `finally`) removes the claim; no claim file survives a completed run.
- [ ] `stack.ts` starts the throwaway Postgres with the slot-derived container name and stops that same name, so two slots never share a container.
- [ ] `degraded-app.ts` boots on the slot-derived degraded port and registers its redirect URI on that port.
- [ ] A busy or timed-out acquire propagates the queue's marker output and exit code 75 rather than a stack/build error.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-queue.test.ts
- [ ] E2E passes: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/login-degraded.spec.ts -g "IdP unreachable at /auth/login \\(degraded\\)" (the parens are escaped because `--grep` is a regular expression; the real test title `IdP unreachable at /auth/login (degraded) renders the 503 "identity service unavailable" page, not a stack trace` contains literal parens that an unescaped group would not match)
- [ ] Manual check: start the prod harness, then run a second invocation with `E2E_CONCURRENCY=1`; the second exits in milliseconds printing `E2E_QUEUE_BUSY holder=… worktree=… position=… retryAfter=…`, and the first run finishes green

**Dependencies:** Task 1, Task 3
**Files likely touched:**
- `apps/app/test/e2e/global-setup.ts`
- `apps/app/test/e2e/global-teardown.ts`
- `apps/app/test/e2e/teardown.ts`
- `apps/app/test/e2e/stack.ts`
- `apps/app/test/e2e/degraded-app.ts`
**Estimated scope:** Medium: 3-5 files

## Task 5: Dev harness claims its own slot

**Description:** Give the dev entry point the same treatment: `global-setup.dev.ts` acquires a slot before `next dev` boots, derives the dev band ports from it, and records the slot; `global-teardown.dev.ts` releases it after stopping services and clearing state. The dev harness runs in a separate Playwright invocation from the prod harness, so its claim is independent and must not span the prod run — while a concurrent worktree still cannot take the same slot index.

**Acceptance criteria:**
- [ ] The dev slot is claimed before `startStack` and released in `global-teardown.dev.ts`, including after an aborted run.
- [ ] Dev ports come from the claimed slot; a second concurrent worktree with a different slot never collides on 32xx.
- [ ] A dev attempt that cannot acquire within its grace exits 75 with `E2E_QUEUE_BUSY` / `E2E_QUEUE_TIMEOUT`, not a build or port error.
- [ ] The dev claim does not persist while the prod harness is running (separate acquisition per invocation).

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-queue.test.ts
- [ ] E2E passes: npx playwright test --config apps/app/playwright.dev.config.ts apps/app/test/e2e/dev/login.dev.spec.ts -g "callback completes the dance on the 127.0.0.1-driven journey"
- [ ] Manual check: run `E2E_CONCURRENCY=2 npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/login-degraded.spec.ts -g "IdP unreachable at /auth/login \\(degraded\\)"` in one worktree and `E2E_CONCURRENCY=2 npx playwright test --config apps/app/playwright.dev.config.ts apps/app/test/e2e/dev/login.dev.spec.ts -g "callback completes the dance on the 127.0.0.1-driven journey"` in another (one suite per invocation, policy form); each reports a distinct slot's ports and neither fails on a bound port

**Dependencies:** Task 1, Task 3, Task 4
**Files likely touched:**
- `apps/app/test/e2e/global-setup.dev.ts`
- `apps/app/test/e2e/global-teardown.dev.ts`
**Estimated scope:** Small: 1-2 files

## Task 6: Loopback login hop (in scope — the harness made the bug reachable)

**Description:** Addressing the dev stack at `127.0.0.1:<derived port>` instead of the
hardcoded `localhost` exposed a pre-existing cookie split: Next's middleware adapter
rewrites the loopback host in every redirect Location to `localhost`, so the attempt
cookie set on `127.0.0.1` is absent at the callback, which answers 400 `missing or
invalid auth attempt`. `/auth/login` hops a non-localhost loopback spelling to
`localhost` before setting the cookie, carrying `returnTo` through the hop.
Non-loopback hosts (production, Tailscale) are untouched.

**Acceptance criteria:**
- [ ] `loopbackCanonicalHop()` returns a `localhost` URL for `127.0.0.1` and `[::1]`, preserving path and query.
- [ ] It returns null for `localhost` itself and for any non-loopback host.
- [ ] `/auth/login` issues a 307 to the hopped URL before setting `LOGIN_ATTEMPT_COOKIE`.
- [ ] `npm run test:unit -- test/origin.test.ts` green (12 tests).

**Files:** `apps/app/lib/auth/origin.ts`, `apps/app/app/auth/login/route.ts`,
`apps/app/middleware.ts` (comment), `apps/app/test/origin.test.ts`.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Teardown never runs (SIGKILL, CI cancel) leaks a claim | Med | Run ceiling `E2E_SLOT_MAX_AGE_MS` reclaims it on sight; `finally` release covers aborts |
| Ticket file left by an abandoned attempt parks the queue | Med | Stale tickets pruned in the same pass as dead claims |
| Concurrent ticket creation race corrupts FIFO order | Med | Exclusive `wx` create per ticket; order read from filename timestamp+pid |
| ETA with no history misleads (`retryAfter` too short) | Low | Documented constant fallback; median of last 5 holds thereafter |
| Slot 0 numbers change (degraded 3199 → 3108) break an existing assumption | Low | Spec §4/§6 mandate it; slot-ports suite asserts the new mapping |
| Harness wiring regresses the shared `.next` build ordering | Med | Claim is taken before `startStack`; e2e check in Task 4 exercises the real production boot |

## Open Questions

- Adaptive pressure when a holder repeatedly exceeds its ETA (evict vs. longer `retryAfter`): deferred per spec §10; measured ETA already grows with observed holds.
- Queue dir default (`os.tmpdir()` vs `XDG_RUNTIME_DIR`): tmpdir assumed; `E2E_QUEUE_DIR` covers anyone who needs otherwise.
