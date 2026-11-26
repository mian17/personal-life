---
type: "Reference"
title: "Testing strategy"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-68043caafb52d638e9bd63e3
    resource: repo://apps/app/test/e2e/config.ts
  - id: openwiki-source-331b3487bb5d0eee510a4185
    resource: repo://apps/meal-service/test/entries-cache.e2e-spec.ts
  - id: openwiki-source-b2b27d821e6571793ab137f8
    resource: repo://apps/note-service/test/content-match.test.ts
  - id: openwiki-source-412967dce819b8bcba0b858b
    resource: repo://apps/note-service/test/health.e2e-spec.ts
  - id: openwiki-source-4e84162612b175153d97c0a9
    resource: repo://packages/ui/test/tokens.test.ts
  - id: openwiki-source-edf8c435d51372f626c8e513
    resource: repo://scripts/arch-check.test.mjs
  - id: openwiki-source-c5e0fae3563fc9f18c9582d6
    resource: repo://scripts/coverage.mjs
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Testing strategy

Three layers: jest suites per workspace (unit + service e2e specs), a
Playwright harness that boots the real stack on slot-owned infrastructure, and
guard tests that enforce the repo's contracts so they cannot rot. CI runs the
first and third continuously ([CI gates](../operations/ci-gates.md)); the
e2e harness runs on demand and in its own workflow.

## Per-workspace suites

Every workspace exposes `typecheck` and `test:unit` (jest). Service test
directories follow one shape — `apps/note-service/test/` is representative:
`*.test.ts` unit files (content matching, backfills, crypto round-trip) and
`*.e2e-spec.ts` suites that boot the service against a throwaway store
(`fake-redis.ts` and friends stand in for infra). Every service has a
`health.e2e-spec.ts` proving the shared kernel health dialect — three routes,
`{"status":"ok"}` shape, garbage bearer ignored — which is identical across
services **by design**: it is a conformance suite, and the duplication is
exempted from duplication metrics for exactly that reason.

The repo policy bounds test runs per task (max 2 executions, targeted files
only — `npm run test:unit -- <file>` from the owning workspace), so suites are
run deliberately, not dumped.

## The Playwright harness: slot-owned infrastructure

`apps/app/test/e2e/` boots the whole stack against **throwaway infra owned by a
slot**, never the compose services and never a real `data/` directory:

- Every harness port is `basePort + 10 * slot` — production-build stack on
  31xx, dev-mode stack on 32xx, hop-test apps on 33xx — so two worktrees holding
  different slots cannot collide with each other or with a running `npm run
  dev` on 300x.
- Per-slot containers: `redis-e2e-<slot>`, `feedback-pg-e2e-<slot>`
  (`postgres:17-alpine` on an ephemeral loopback port),
  `rabbitmq-e2e-<slot>` (`rabbitmq:4.1-alpine`) — plus a per-worktree queue so
  concurrent worktrees never share broker state. An explicit
  `TEST_REDIS_URL`/`E2E_*_PORT` env override always wins over the derived slot
  value.
- Two invocations (`test:e2e`) — production build and `next dev` — because the
  two share `apps/app/.next` and cannot coexist on disk.

The access-gate behavior (403 header-less, 307 unauthenticated owner) is
covered here too: `access-gate.spec.ts` runs the app in both normal and
degraded form.

## Coverage aggregation

`scripts/coverage.mjs` (`npm run test:coverage`) merges every suite's lcov —
each workspace's jest run plus the `node --test` suites under `scripts/` — into
one repository-relative `.coverage/lcov.info` for the scanner. Two subtleties it
exists to get right: `SF:` paths are rewritten repository-relative (a
workspace-relative path silently matches no indexed file), and a source file
instrumented by more than one workspace keeps the hit counts of the
most-covered run.

## Guard tests: contracts with tripwires

| Guard | File | Moves when |
|---|---|---|
| UI token values | `packages/ui/test/tokens.test.ts` | a deliberate theme change — same commit |
| Arch topology rules (3–7) | `scripts/arch-check.test.mjs` (`npm run test:arch`) | the rule's behavior changes; proven to fail on planted violations |
| E2E selector surface | Playwright specs (roles, visible text, aria-labels, `button.trash-delete`) | only with explicit user approval |

`scripts/arch-check.test.mjs` runs under `node --test` and includes tests that
plant a violation (a shared store, a missing env forwarding, a `self-hosted`
runner in a workflow) and assert the rule catches it — a guard that has never
been proven able to fail is not a guard.

## See also

- [Data layer](../architecture/data-layer.md) — the cache behavior these
  suites pin (e.g. `entries-cache.e2e-spec.ts` asserts ciphertext structure in
  cached rows).
- [CI gates](../operations/ci-gates.md) — where the suites run.
