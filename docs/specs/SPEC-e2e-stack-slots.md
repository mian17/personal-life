# Spec: e2e stack slots — fair cross-worktree e2e isolation

Scope check (Phase 0): this request is one capability — per-slot isolation and fair
queuing of the e2e harness share one consumer (the e2e entry points) and one concept
(the slot); neither half ships or verifies without the other. One spec, no capability
map.

## 1. Objective

Concurrent worktrees on one machine each boot the e2e harness and collide on the
fixed port set (3100-3107 prod, 3200-3207 dev, 3310-3311 hop, 3199 degraded) and the
fixed throwaway Postgres container name. Each run also builds Next first, so
contention turns into rebuild-guessing and false QA FAILs.

Build an `E2E_CONCURRENCY`-gated slot pool (default 1) inside the existing e2e entry
points. A holder claims a slot **before any build or port bind** and releases it at
teardown. All harness ports and the throwaway feedback Postgres container name are
derived from the slot index. Attempts that are not their turn exit in milliseconds
with a machine-parseable queue report instead of sleeping.

User stories:

- As an agent running the QA lane, when every slot is busy I get `E2E_QUEUE_BUSY
  holder=… worktree=… position=… retryAfter=…` plus a human line naming the holder
  and its ports, and I know not to rebuild and when to retry.
- As an agent whose wait budget expired, I get `E2E_QUEUE_TIMEOUT` in the same
  shape — also never a code-test FAIL, also not a test run.
- As one of several concurrent worktrees, I reach a green e2e unattended: my slot's
  ports and Postgres container name are mine alone, and stale slots are reclaimed
  without manual cleanup.

Acceptance criteria (normative, restated testably in §8):

- AC1: a holder claims a slot before any build or port bind and releases it at teardown.
- AC2: every harness port (prod 31xx, dev 32xx, hop 33xx, degraded app) and the
  throwaway feedback Postgres container name derive from the slot index; env
  overrides keep their current precedence.
- AC3: tickets are persistent FIFO across processes; a not-my-turn attempt exits in
  milliseconds reporting queue position and a measured ETA (`retryAfter`).
- AC4: a stale slot is reclaimed when the holder pid is dead or the claim file is
  older than the run ceiling.
- AC5: queued-out attempts emit `E2E_QUEUE_BUSY` / `E2E_QUEUE_TIMEOUT` machine-parseable
  output followed by a human line, are never reported as code-test FAIL, and never
  count against `max-test-runs`.

## 2. Tech Stack

- Node.js 22 (`@types/node` ^22.13.9), TypeScript ^5.7.3, npm workspaces monorepo.
- `@playwright/test` ^1.55.0 — e2e runner; harness code lives in plain TS under
  `apps/app/test/e2e` and is loaded by Playwright directly.
- Jest 29.7.0 + ts-jest ^29.2.6 — unit tests for the harness logic.
- Docker `postgres:17-alpine` — throwaway feedback-service DB per slot.
- Next.js 16.4.2 (context only: the harness builds/boots the app).
- **No new dependencies** (hard constraint). File system + `node:os`/`node:path`/
  `node:process` only for the queue.

## 3. Commands

Full executable commands from the repo profile, not widened:

- Typecheck: `npm run typecheck`
- Unit test: `npm run test:unit -- <file>` (run from the owning workspace, `apps/app`)
- Max test runs: 2
- E2e (the only policy-allowed e2e command):
  `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"`
- E2e from the repo root (the human-facing entry this spec adds):
  `npm run test:e2e` runs both harnesses in sequence, named for the runtime each
  one boots: `test:e2e:prod-build` (`next build` + `standalone/server.js`, the
  artifact the Docker image ships) then `test:e2e:dev-server` (`next dev`, the
  runtime a human runs). Harness knobs
  (`E2E_CONCURRENCY`, `E2E_*_PORT`, `E2E_QUEUE_ACQUIRE_GRACE_MS`,
  `E2E_SLOT_MAX_AGE_MS`, `TEST_REDIS_URL`) are read from the repo-root
  `.env.development` when the shell leaves them unset — only harness-owned names
  are adopted, so the file's master keys never enter a harness child process.
- Build: **none** — the repo profile declares no build command, and this spec adds
  none. (The harness itself invokes workspace builds internally at run time; that is
  product behavior, not a spec build step.)

## 4. Project Structure

```
apps/app/test/e2e/config.ts            MODIFIED — slot-derived ports + Postgres name
apps/app/test/e2e/slot-queue.ts        NEW — FIFO tickets, claim/release, stale
                                       reclaim, measured ETA, queue markers
apps/app/test/e2e/global-setup.ts      MODIFIED — acquire slot before any build
apps/app/test/e2e/global-setup.dev.ts  MODIFIED — same for the dev harness
apps/app/test/e2e/global-teardown*.ts  MODIFIED — release the claim (with a
apps/app/test/e2e/teardown.ts          best-effort `finally` release on abort)
apps/app/test/e2e/stack.ts             MODIFIED — consumes derived ports
apps/app/test/e2e/degraded-app.ts      MODIFIED — consumes the derived degraded port
apps/app/test/slot-ports.test.ts       NEW — jest unit tests (derivation)
apps/app/test/slot-queue.test.ts       NEW — jest unit tests (queue/reclaim/markers)
apps/app/test/e2e/env-file.ts          NEW — adopt harness knobs (E2E_*, port
                                       overrides) from the repo-root
                                       `.env.development`; secrets stay in the file
apps/app/test/harness-env.test.ts      NEW — jest unit tests (adoption, isolation)
apps/app/playwright.config.ts          MODIFIED — load harness env before any slot
                                       or port decision
apps/app/playwright.dev.config.ts      MODIFIED — same for the dev harness
package.json (root)                    MODIFIED — `test:e2e` runs the harness
                                       from the repo root
scripts/setup-dev-env.sh               MODIFIED — emits the e2e block
.env.development.example               MODIFIED — documents the e2e knobs
docs/specs/SPEC-e2e-stack-slots.md     THIS SPEC

apps/app/app/auth/login/route.ts       MODIFIED — hop a loopback spelling to
                                       localhost before setting the attempt cookie
apps/app/lib/auth/origin.ts            MODIFIED — `loopbackCanonicalHop()` /
                                       `hostnameOf()` support that hop
apps/app/middleware.ts                 MODIFIED — comment only: Next rewrites the
                                       loopback host in the redirect Location
apps/app/test/origin.test.ts           MODIFIED — 5 tests for the hop
```

The auth four are in scope because this change makes the bug reachable: the dev
harness stops addressing the stack at the hardcoded `localhost` and starts using
`127.0.0.1:<derived port>`. Next's middleware adapter rewrites the loopback host in
every redirect Location to `localhost`, so the attempt cookie lands on
`127.0.0.1` and the callback answers 400 `missing or invalid auth attempt`. The
harness cannot be correct without the hop, and the alternative (spelling every dev
URL `localhost`) leaves the app broken for the operator who types `127.0.0.1`.

Queue state is machine-scoped (worktrees are the unit of contention):
`${os.tmpdir()}/life-e2e-slots` (override `E2E_QUEUE_DIR`), holding per-slot claim
files (`<slot>.hold.json`: pid, worktree, ports, claimedAt) and FIFO ticket files
(`<createdAt>-<pid>.json`: worktree, requestedAt). The state dir is outside every
worktree by design; cross-machine locking is out of scope.

Slot derivation (stride 10, slot `s` = `base + offset + 10*s`):

| Resource | Prod (31xx) | Dev (32xx) | Hop (33xx) |
|---|---|---|---|
| app | 3100 + 10s | 3200 + 10s | 3310 + 10s (A) / 3311 + 10s (B) |
| note | 3101 + 10s | 3201 + 10s | — |
| idp | 3103 + 10s | 3203 + 10s | (shared harness IdP) |
| tags | 3104 + 10s | 3204 + 10s | — |
| todo | 3105 + 10s | 3205 + 10s | — |
| meal | 3106 + 10s | 3206 + 10s | — |
| feedback | 3107 + 10s | 3207 + 10s | — |
| degraded app | 3108 + 10s | (same prod value) | — |

Throwaway feedback Postgres container: `feedback-pg-e2e-<s>`. Explicit env overrides
(`E2E_*_PORT`, `E2E_DEV_*_PORT`, `E2E_HOP_*_PORT`, `E2E_FEEDBACK_PG_CONTAINER`) keep
winning over derived values. `E2E_CONCURRENCY` default 1, maximum 9 (slots 0-8 keep
every port inside its band and clear of 300x dev stacks); higher values are rejected
with a clear error before any claim.

## 5. Code Style

Repo style from `apps/app/test/e2e/config.ts`: named exports, JSDoc one-liners,
env-var escape hatch with `??`, semicolons, no cleverness.

```ts
/**
 * Ports for one harness slot. Slot `s` shifts every port by `10 * s`, so two
 * concurrent worktrees can hold different slots without colliding. An explicit
 * `E2E_*_PORT` env override always wins over the derived value.
 */
export function testPorts(slot = 0) {
  const base = 3100 + 10 * slot;
  return {
    idpPort: Number(process.env.E2E_IDP_PORT ?? base + 3),
    notePort: Number(process.env.E2E_NOTE_PORT ?? base + 1),
    tagsPort: Number(process.env.E2E_TAGS_PORT ?? base + 4),
    todoPort: Number(process.env.E2E_TODO_PORT ?? base + 5),
    mealPort: Number(process.env.E2E_MEAL_PORT ?? base + 6),
    feedbackPort: Number(process.env.E2E_FEEDBACK_PORT ?? base + 7),
    appPort: Number(process.env.E2E_APP_PORT ?? base),
  };
}
```

## 6. Testing Strategy

- Framework: Jest (unit), Playwright (e2e, unchanged suites). Unit tests live in
  `apps/app/test/*.test.ts` next to the existing harness tests
  (`ensure-port-free.test.ts` pattern).
- `slot-ports.test.ts`: derived port sets are disjoint across slots, stay inside
  their bands, match slot 0's current numbers (except the degraded port, see §9),
  and env overrides win.
- `slot-queue.test.ts` (temp dir as `E2E_QUEUE_DIR`): FIFO order across processes,
  claim-before-build ordering, release on teardown, reclaim on dead pid and on
  claim-file age past the run ceiling, exact `E2E_QUEUE_BUSY`/`E2E_QUEUE_TIMEOUT`
  marker field sets, measured `retryAfter` from recorded hold durations, sub-second
  (target: millisecond) exit for not-my-turn attempts.
- Every marker field and every reclaim branch has a test; no behavior ships behind a
  manual check alone.
- Verify with `npm run test:unit -- <file>`; at most 2 test runs per command. The
  e2e-level proof (two concurrent invocations, disjoint ports) runs through the
  policy e2e command in the QA lane.
- A queued-out attempt (marker emitted) is **not a test run** and consumes zero of
  the `max-test-runs: 2` budget.

## 7. Boundaries

- **Always do:** claim a slot before any build or port bind; release at teardown and
  best-effort on abort; derive every harness port and the Postgres container name
  from the slot index; reclaim stale claims (holder pid dead, or claim file older
  than the run ceiling) on sight; emit the machine-parseable marker line before the
  human line; keep the queue state machine-scoped; run typecheck and the targeted
  unit tests before calling the work done.
- **Ask first:** changing slot stride, base ports, or the `E2E_CONCURRENCY` default;
  changing `max-test-runs` or what counts as a test run in QA policy; touching the
  frozen e2e selector surface (roles, visible text, aria-labels,
  `button.trash-delete`) or token values; changing the run-ceiling default.
- **Never do:** add a dependency; change host `npm run dev:build` or queue plain
  builds; add a wrapper command an agent must remember (the queue lives inside the
  existing e2e entry points); sleep long enough to look like a hang (no queue-path
  wait exceeds 1 second); report `E2E_QUEUE_BUSY`/`E2E_QUEUE_TIMEOUT` as a code-test
  FAIL; count a queued-out attempt against `max-test-runs`; implement cross-machine
  locking; make Playwright retry on its own.

## 8. Success Criteria

1. Five concurrent worktrees invoking the e2e entry points on one machine each reach
   a green e2e unattended (each honoring `retryAfter`), with no port or container
   collision and no rebuild-guessing.
2. With `E2E_CONCURRENCY=2`, two simultaneous attempts hold slots with fully
   disjoint port sets and container names (`feedback-pg-e2e-0`, `feedback-pg-e2e-1`);
   a third attempt exits in under 1 second (target: milliseconds) printing
   `E2E_QUEUE_BUSY holder=<pid> worktree=<abs path> position=3 retryAfter=<seconds>`
   followed by one human line naming the holder and its ports.
3. `retryAfter` is measured from recent slot hold durations, not guessed; with no
   history it falls back to a documented constant.
4. Kill a holder mid-run: the next attempt reclaims the slot (pid dead) and proceeds
   without manual cleanup. Backdate a claim file past 30 minutes
   (`E2E_SLOT_MAX_AGE_MS`, default 1_800_000): same reclamation.
5. An attempt whose acquisition grace (`E2E_QUEUE_ACQUIRE_GRACE_MS`, default 30_000)
   expires prints `E2E_QUEUE_TIMEOUT` with the same field shape and exits.
6. Both marker exits use code 75 (EX_TEMPFAIL); no lane reports FAIL for them, and
   neither counts against `max-test-runs: 2`.
7. `E2E_CONCURRENCY=10` fails fast with a clear error before any claim; every slot
   port for 0-8 stays inside its documented band.
8. `npm run typecheck` and `npm run test:unit -- <file>` pass; no new dependency
   appears in any `package.json`.

## 9. Assumptions

1. Queue state is machine-scoped (`${os.tmpdir()}/life-e2e-slots`, override
   `E2E_QUEUE_DIR`): worktree-local storage cannot arbitrate worktrees, and
   cross-machine locking is out of scope.
2. Slot stride is 10; slot 0 keeps today's numbers except the degraded-app port,
   which moves from 3199 into the slot block (3108 + 10s) so every harness port
   derives uniformly. `login-degraded` behavior is unchanged.
3. `E2E_*_PORT`, `E2E_DEV_*_PORT`, `E2E_HOP_*_PORT` and `E2E_FEEDBACK_PG_CONTAINER`
   env overrides keep their current precedence over derived values.
4. "Holder pid is dead" means `process.kill(pid, 0)` reports ESRCH (POSIX, the only
   supported harness platform); run ceiling default 30 minutes, env-overridable.
5. Queued-out exits use code 75 (EX_TEMPFAIL) for both markers; the classification
   key is the marker token (`E2E_QUEUE_BUSY` vs `E2E_QUEUE_TIMEOUT`).
6. `E2E_CONCURRENCY` caps at 9 (rejected above, not clamped) because the 31xx/32xx/
   33xx bands fit nine stride-10 slot blocks.
7. ETA is a rolling median of the last 5 completed slot holds.
8. Each Playwright invocation (prod and dev) acquires its own slot at global-setup
   and releases it at global-teardown; the claim does not span both invocations.

## 10. Open Questions

- Adaptive pressure when one holder repeatedly exceeds its ETA (evict vs. longer
  `retryAfter`): deferred; the measured ETA already grows with observed holds.
- Queue dir default on Linux (`os.tmpdir()` vs `XDG_RUNTIME_DIR`): tmpdir assumed;
  the `E2E_QUEUE_DIR` override covers anyone who needs otherwise.
