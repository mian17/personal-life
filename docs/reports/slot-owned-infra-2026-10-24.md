# Report — slot-owned e2e infrastructure (2026-10-24)

Branch `pi/wf/slot-owned-infra`, worktree
`/home/night/WebstormProjects/personal-life/.pi/worktrees/slot-owned-infra`, based on
`340963b` (this repo already had a HEAD — no `git init`, no seed commit needed).

Intent: `docs/intent/slot-owned-infra.md` (confirmed 2026-10-24).
Spec: `docs/specs/SPEC-slot-owned-infra.md`. Plan: `tasks/plan-slot-owned-infra.md`.

## What shipped

Every e2e run boots its own Postgres, RabbitMQ and Redis for the slot it holds:
`feedback-pg-e2e-<slot>`, `feedback-mq-e2e-<slot>`, `redis-e2e-<slot>`, each on a
Docker-assigned `127.0.0.1` ephemeral port read back with `docker port`. Teardown
force-removes the held slot's three. `TEST_REDIS_URL` demoted to an endpoint override
(and boot suppressor); the two-replica hop proof moves behind its own `E2E_HOP=1`.
RabbitMQ boots unused by design — no consumer, no `RABBITMQ_URL` wiring.
`MAX_SLOT_COUNT` unchanged at 9. No new dependency.

## Gates

| Gate | Result |
|---|---|
| Spec | VALIDATED, 1 validator round |
| Plan | VALIDATED, 3 validator rounds |
| Implementation | 4 tasks implemented and verified |
| Review lifecycle | PASS (5 steps) |
| Five-lane verification | 5/5 PASS, 2 rounds |

Lanes ran blind: identical shared context block, no lane saw another's verdict,
only failed lanes re-ran, the fix pass never closed its own blockers. Evidence:

1. **Correctness** — spec §8 criteria 1-8 evidenced; `slot-ports.test.ts` covers
   slots 0-8 for all three names, per-slot disjointness, and the three overrides.
2. **Code quality** — one `docker run`/readiness/`docker port` helper, three thin
   callers; no fixed host port anywhere in the harness.
3. **Security** — `vbsec-reports/scan-2026-10-24-062340.md`, raw verdict `PASS`
   ("No critical issues found"), 7 changed `.ts` files; three MEDIUM hardening items
   recorded, zero blockers.
4. **QA** — typecheck green; `npm run test:unit -- test/slot-ports.test.ts` green;
   one policy-allowed e2e run boots and tears down all three containers.
5. **Plan conformance** — tasks 1-4 match the frozen spec; `publisher.service.ts`
   and `dispatcher.service.ts` untouched, `feedbackEnv` still passes
   `RABBITMQ_URL: undefined`.

## Residual risk (stated once)

Three MEDIUM items from the security scan remain open, all harness-local: an
env-derived container name reaching `docker rm`/`run`/`port` argv unvalidated (a
leading `--` would read as a flag; operator env only, no shell), and fixed throwaway
broker credentials `harness`/`test-only` on a loopback-only `--rm` container with no
consumer wired. Suggested follow-up: validate names against
`/^[a-z0-9][a-z0-9_.-]*$/`, generate the broker password per run.

## State

Uncommitted in the working tree on `pi/wf/slot-owned-infra`; base checkout untouched.

Modified:

- `apps/app/test/e2e/config.ts`
- `apps/app/test/e2e/stack.ts`
- `apps/app/test/e2e/hop.spec.ts`
- `apps/app/test/e2e/hop-app.ts`
- `apps/app/test/e2e/global-teardown.ts`
- `apps/app/test/e2e/global-teardown.dev.ts`
- `apps/app/test/slot-ports.test.ts`

Untracked (run artifacts, this phase included):

- `docs/intent/slot-owned-infra.md`
- `docs/specs/SPEC-slot-owned-infra.md`
- `tasks/plan-slot-owned-infra.md`
- `docs/reports/slot-owned-infra-2026-10-24.md`
- `vbsec-reports/scan-2026-10-24-062340.md`

Nothing was committed or pushed.
