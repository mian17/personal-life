# Spec: slot-owned-infra — every e2e slot boots its own Postgres, RabbitMQ, Redis

Scope check (Phase 0): this request is one capability — slot-owned throwaway
infrastructure (derived container identities + the one boot recipe + the demoted
Redis/hop gates) has a single consumer (the e2e harness) and a single concept (the
held slot's external identity); the pieces do not ship or verify without each other.
One spec, no capability map. Module id `slot-owned-infra`, chosen once, never renamed.

## 1. Objective

Today only the feedback Postgres is throwaway and slot-named
(`startThrowawayPostgres`, `apps/app/test/e2e/stack.ts:257`); Redis exists only when
the human hand-starts one and points `TEST_REDIS_URL` at it, and RabbitMQ exists only
as the compose `rabbitmq-feedback` a human may have started by hand. Two worktrees
running the e2e harness at once can therefore collide on a hand-started broker or
Redis, and the future first RabbitMQ consumer test would discover both problems in
the worst moment.

Make every e2e run boot its own Postgres, RabbitMQ and Redis for the slot it holds,
exactly the recipe `startThrowawayPostgres` already uses: container name
`<name>-e2e-<slot>`, published loopback port chosen by Docker, read back via
`docker port`. Two concurrent runs (`E2E_CONCURRENCY=2`) share no external identity —
no container name, no port, no URL. Explicit overrides
(`E2E_FEEDBACK_PG_CONTAINER`, `E2E_FEEDBACK_MQ_CONTAINER`, `E2E_REDIS_CONTAINER`,
`TEST_REDIS_URL`) keep winning when set. The broker boots **unused by design** — no
consumer, no service wiring in this change. Because Redis now always exists, the
hop proof moves its own run gate to `E2E_HOP=1` so the default suite never silently
gains two extra app replicas.

User stories:

- As the author of the first RabbitMQ consumer test, the broker for my slot is
  already up, uniquely named and uniquely ported — I never hand-start anything and
  never collide with another worktree.
- As an agent running two e2e invocations at once (`E2E_CONCURRENCY=2`), each run's
  containers, ports and URLs are mine alone (`*-e2e-0` vs `*-e2e-1`).
- As the operator of a constrained machine, `TEST_REDIS_URL` demotes to an escape
  hatch: set it and the harness boots no Redis and uses my endpoint; set the
  container-name overrides and they win over every derived name.

Acceptance criteria (normative, restated testably in §8):

- AC1: container identities (`feedback-pg-e2e-<slot>`, `feedback-mq-e2e-<slot>`,
  `redis-e2e-<slot>`) derive from the slot index and differ per slot; the four
  overrides above win when set.
- AC2: all three containers publish a Docker-chosen loopback port read back via
  `docker port` — the `startThrowawayPostgres` recipe, no fixed host ports.
- AC3: with `E2E_CONCURRENCY=2` two runs share no container name, no port, no URL.
- AC4: `TEST_REDIS_URL` set → the harness boots no Redis container and every Redis
  consumer uses that URL.
- AC5: the two-replica hop proof runs only under `E2E_HOP=1`; the default suite never
  boots the extra app replicas, even though Redis now always exists.
- AC6: the broker boots unused — no consumer, no consumer-side test, no
  `RABBITMQ_URL` wiring into the feedback-service harness env.

## 2. Tech Stack

- Node.js 22 (`@types/node` ^22.13.9), TypeScript ^5.7.3, npm workspaces monorepo.
- Jest 29.7.0 + ts-jest ^29.2.6 — unit tests for the derivation (`slot-ports.test.ts`).
- `@playwright/test` ^1.55.0 — e2e runner; harness code is plain TS under
  `apps/app/test/e2e`, loaded by Playwright directly.
- Docker, images matching `compose.yaml`: `postgres:17-alpine`, `rabbitmq:4.1-alpine`,
  `redis:8-alpine`.
- **No new dependencies** (hard constraint). `node:child_process` `execFileSync`
  against the `docker` CLI only, same as `startThrowawayPostgres` today.

## 3. Commands

Full executable commands from the repo profile, not widened:

- Typecheck: `npm run typecheck`
- Unit test: `npm run test:unit -- <file>` (run from the owning workspace, `apps/app`;
  this change's file is `test/slot-ports.test.ts`)
- Max test runs: 2
- E2e (the only policy-allowed e2e command):
  `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"`
- Build: **none** — the repo profile declares no build command, so this spec writes
  none. (The harness invokes workspace builds internally at run time; that is
  product behavior, not a spec build step.)

## 4. Project Structure

```
apps/app/test/e2e/config.ts            MODIFIED — feedbackMqContainer(),
                                       redisContainer() beside feedbackPgContainer();
                                       testRedisUrl() demoted to the boot-suppressing
                                       override it now is
apps/app/test/e2e/stack.ts             MODIFIED — the startThrowawayPostgres recipe
                                       generalized to one throwaway-container helper;
                                       boot Postgres, RabbitMQ, Redis for cfg.slot;
                                       readiness (pg_isready / rabbitmq-diagnostics
                                       ping / redis-cli ping) then `docker port` read
                                       back; stopThrowawayPostgres generalized to all
                                       three (still scoped to the held slot)
apps/app/test/e2e/global-teardown*.ts  MODIFIED — release stops all three containers
                                       of the held slot
apps/app/test/e2e/hop.spec.ts          MODIFIED — gate moves to E2E_HOP=1;
                                       TEST_REDIS_URL no longer gates
apps/app/test/e2e/hop-app.ts           MODIFIED — replicas' REDIS_URL comes from the
                                       slot's Redis (or TEST_REDIS_URL when set)
apps/app/test/slot-ports.test.ts       MODIFIED — derived container identities differ
                                       per slot; all four overrides win in any slot
docs/specs/SPEC-slot-owned-infra.md    THIS SPEC
```

Unchanged by design: `apps/app/test/e2e/env-file.ts` already adopts `E2E_*`
(`E2E_HOP` matches its regex) and `TEST_REDIS_URL` from the repo-root
`.env.development`; `apps/app/test/e2e/slot-queue.ts` (`MAX_SLOT_COUNT` stays 9 —
nine slots × three throwaway containers, cap not reduced); `publisher.service.ts`,
`dispatcher.service.ts`, every consumer.

Container identity derivation (the table `slot-ports.test.ts` proves):

| Container | Name | Override that wins when set |
|---|---|---|
| feedback Postgres | `feedback-pg-e2e-<s>` | `E2E_FEEDBACK_PG_CONTAINER` |
| feedback RabbitMQ | `feedback-mq-e2e-<s>` | `E2E_FEEDBACK_MQ_CONTAINER` |
| Redis | `redis-e2e-<s>` | `E2E_REDIS_CONTAINER` |

Ports are never derived: each container publishes `-p 127.0.0.1::<container port>`
and the harness reads the host port back with `docker port <name> <port>/<proto>`
exactly as `startThrowawayPostgres` does, so two slots can never share a port or a
URL. RabbitMQ runs with a non-guest default user (`RABBITMQ_DEFAULT_USER`/
`RABBITMQ_DEFAULT_PASS`), because the stock `guest` account is loopback-restricted
and a published-port client arrives from the bridge gateway.

## 5. Code Style

Repo style from `apps/app/test/e2e/config.ts` and `stack.ts`: named exports, JSDoc
one-liners, env-var escape hatch with `??`/`||`, semicolons, no cleverness.

```ts
/**
 * The throwaway RabbitMQ the harness gets in: a slot-named `rabbitmq:4.1-alpine`
 * container on an ephemeral loopback port, never the compose `rabbitmq-feedback`.
 * An explicit env override always wins over the value derived from the slot.
 */
export function feedbackMqContainer(slot = 0): string {
  return process.env.E2E_FEEDBACK_MQ_CONTAINER?.trim() || `feedback-mq-e2e-${slot}`;
}
```

## 6. Testing Strategy

- Framework: Jest (unit), Playwright (e2e, unchanged suites). Unit tests live in
  `apps/app/test/*.test.ts` (`slot-ports.test.ts` pattern) and prove everything
  derivable: names, per-slot disjointness, override precedence.
- `slot-ports.test.ts`: for slots 0-8 the three derived names match the table above,
  any two distinct slots share no container name, and `E2E_FEEDBACK_PG_CONTAINER`,
  `E2E_FEEDBACK_MQ_CONTAINER`, `E2E_REDIS_CONTAINER` each win over the derived name
  in any slot (the existing override test grows the two new names).
- Boot behavior (Docker run, readiness, `docker port` read back, teardown removal)
  is not unit-testable against a real daemon; it is proven in the e2e lane with the
  policy e2e command (`docker ps`/`docker port` observations in §8), and it reuses
  the one already-shipped recipe rather than a second implementation.
- Verify with `npm run test:unit -- <file>`; at most 2 test runs per command.

## 7. Boundaries

- **Always do:** derive every container name from the held slot; publish
  Docker-chosen loopback ports and read them back via `docker port`; fail fast and
  legibly when Docker is unavailable (the `startThrowawayPostgres` error style);
  `docker rm -f` the run's own name before boot and at teardown, scoped to the held
  slot; let the four overrides win when set; keep `MAX_SLOT_COUNT` at 9; run
  typecheck and the targeted unit tests before calling the work done.
- **Ask first:** changing container names, images, or the readiness probes; wiring
  `RABBITMQ_URL` or `REDIS_URL` into any service's harness env (that is the consumer
  chapters' work); reducing `MAX_SLOT_COUNT`; changing hop-gate semantics beyond the
  `E2E_HOP=1` move; touching the frozen e2e selector surface or token values.
- **Never do:** edit `publisher.service.ts` or `dispatcher.service.ts`; write a
  RabbitMQ consumer or any consumer-side test; assert publish→confirm→cursor-advance;
  wire `RABBITMQ_URL` into the feedback-service harness environment (the broker
  boots unused by design); depend on a hand-started external broker or Redis (the
  compose `rabbitmq-feedback` / `redis-*` services are never e2e dependencies);
  publish a fixed host port for any of the three containers; add a dependency; widen
  any command beyond the repo profile (no build step, no extra test-runner flags).

## 8. Success Criteria

1. `npm run test:unit -- test/slot-ports.test.ts` (from `apps/app`) proves, for slots
   0-8: `feedbackPgContainer(s)`/`feedbackMqContainer(s)`/`redisContainer(s)` yield
   `feedback-pg-e2e-<s>`/`feedback-mq-e2e-<s>`/`redis-e2e-<s>`, no two slots share a
   name, and each of `E2E_FEEDBACK_PG_CONTAINER`, `E2E_FEEDBACK_MQ_CONTAINER`,
   `E2E_REDIS_CONTAINER` wins over the derived name in any slot.
2. With `E2E_CONCURRENCY=2`, two simultaneous e2e runs hold slots 0 and 1 and leave
   `feedback-pg-e2e-0/1`, `feedback-mq-e2e-0/1`, `redis-e2e-0/1` running side by
   side; `docker port` reports six distinct host ports and the two runs observe no
   shared container name, port, or URL.
3. Every published port is `127.0.0.1`-bound and Docker-assigned; grepping the
   harness for a fixed host port for these containers finds none.
4. `TEST_REDIS_URL=redis://127.0.0.1:6399` → the run boots no `redis-e2e-<slot>`
   container and the hop proof connects to the given URL; `E2E_REDIS_CONTAINER=x`
   still boots (with that name) when `TEST_REDIS_URL` is unset.
5. `E2E_HOP=1` runs the two-replica hop proof (against `TEST_REDIS_URL` when set,
   else the slot's Redis); without `E2E_HOP=1` no extra app replicas boot in any
   run, even though the slot's Redis now always boots.
6. `git diff` shows no change to `apps/feedback-service/src/event/publisher.service.ts`
   or `dispatcher.service.ts`, and `feedbackEnv` still passes `RABBITMQ_URL:
   undefined` — the broker is up and unused.
7. After a run's teardown, `docker ps -a` shows none of the held slot's three
   containers; a concurrent run's slot-1 containers survive slot 0's teardown.
8. `npm run typecheck` passes and the unit run is green within the
   `max-test-runs: 2` budget; no new dependency appears in any `package.json`.

## 9. Assumptions

1. One capability, one spec (the Phase 0 scope check above); module id
   `slot-owned-infra`.
2. Container names are exactly the intent's: `feedback-pg-e2e-<slot>`,
   `feedback-mq-e2e-<slot>`, `redis-e2e-<slot>` — one naming scheme
   (`<name>-e2e-<slot>`) matching the shipped `feedbackPgContainer`.
3. Images match `compose.yaml`: `postgres:17-alpine`, `rabbitmq:4.1-alpine`,
   `redis:8-alpine`.
4. Ports are Docker-chosen ephemeral loopback publishes read back via `docker port`,
   never stride-band numbers — per-slot URL disjointness follows from per-slot
   containers, not from port arithmetic.
5. The container-name overrides rename the container the harness boots (today's
   `E2E_FEEDBACK_PG_CONTAINER` semantics); `TEST_REDIS_URL` is the only
   endpoint-level override and the only thing that suppresses a boot.
6. "Every e2e run" means both harness invocations (prod-build and dev-server), each
   for the slot it holds: all three containers boot per held slot even where a
   service does not consume them yet.
7. The hop gate becomes `E2E_HOP=1` (skips without it); `TEST_REDIS_URL` stops
   gating and only redirects the Redis endpoint and suppresses the Redis boot.
8. Throwaway RabbitMQ uses `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS`
   (e.g. `feedback`/`test-only`) because stock `guest` is loopback-restricted over a
   published port; readiness via `rabbitmq-diagnostics -q ping`, Redis via
   `redis-cli ping`, both with the Postgres 60-second readiness deadline shape.
9. Broker and slot Redis are wired into no service in this change (`feedbackEnv`
   keeps `RABBITMQ_URL`/`REDIS_URL` undefined); the hop proof is the only Redis
   consumer and only under `E2E_HOP=1`.
10. Teardown force-removes exactly the held slot's three containers
    (`stopThrowawayPostgres` generalized); every boot starts with `docker rm -f` of
    its own name so a stale container is reclaimed without manual cleanup.
11. `MAX_SLOT_COUNT` stays 9 (27 throwaway containers at full concurrency); the cap
    is not reduced.

## 10. Open Questions

- Whether the dev harness (which omits feedback-service) should skip the broker as
  it skips Postgres if boot time measurably hurts: the "every e2e run" reading above
  boots it anyway; revisit with evidence.
- Redis readiness deadline: 60 seconds like Postgres, or shorter for `redis:8-alpine`
  (starts in well under a second)? Assumed the shared 60-second shape for one
  recipe; a measured run may justify a smaller constant.
- The next consumer chapter (RabbitMQ consumer tests, feedback cache with
  `REDIS_URL`) will need the slot URLs exported from the harness; the export shape
  (env names on the spawned service vs. a harness export) is deferred to that spec.
