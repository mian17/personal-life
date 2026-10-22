# Intent — e2e stack slots

Parallel worktrees each boot the e2e harness. Today the harness takes one fixed
port set (3100-3107 prod, 3200-3207 dev, 3310-3311 hop) and one fixed throwaway
Postgres container name, so a second concurrent run collides. Worse, each run
builds Next first; five concurrent builds exhausted the box, which is why an
agent saw a build it did not trust, tried to make its own stack, and could not.

- Outcome: e2e serializes fairly through N slots (`E2E_CONCURRENCY`, default 1)
  across concurrent worktrees — per-slot ports and a per-slot throwaway
  Postgres — so no port or container collision and no rebuild-guessing.
- User: the dynamic `agents-hard-gates` runs whose QA lane currently turns
  contention into a false FAIL or a stalled agent call.
- Why now: five concurrent workflows each hit e2e, distrusted the build, tried
  to make their own stack, and the box could not build them.
- Success: five worktrees each reach a green e2e unattended; a not-my-turn
  attempt costs milliseconds and reports queue position plus a measured ETA;
  no lane reports FAIL for being busy.
- Constraint: e2e entry points only (host `npm run dev:build` untouched); no new
  dependency; no wrapper command an agent must remember; nothing sleeps long
  enough to look like a hang; a queued-out attempt is not a test run.
- Out of scope: parallel execution beyond the configured slots, queueing plain
  builds or `dev:build`, cross-machine locking, and Playwright retrying itself.

## Confirmation

Confirmed: yes — the user explicitly answered "yes" to the six-line restate
above (2026-10-22). Approved to proceed.
