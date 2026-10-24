# Implementation Plan: slot-owned-infra — every e2e slot boots its own Postgres, RabbitMQ, Redis

Produced by planning-and-task-breakdown; source spec: `docs/specs/SPEC-slot-owned-infra.md` (frozen, validated). Intent: `docs/intent/slot-owned-infra.md`. This plan does not widen the spec's scope.

Kept beside — never over — the existing `tasks/plan.md`, which belongs to the finished `e2e-stack-slots` run.

## Overview

Today only the feedback Postgres is throwaway and slot-named (`startThrowawayPostgres`, `apps/app/test/e2e/stack.ts:257`). Redis exists only as a human hand-started endpoint behind `TEST_REDIS_URL`, and RabbitMQ only as the compose `rabbitmq-feedback` a human may have started. This plan generalizes the one existing throwaway-container recipe into a helper and uses it three times: Postgres, RabbitMQ, Redis, each named `<name>-e2e-<slot>` and published on a Docker-chosen `127.0.0.1` port read back with `docker port`. Both harness invocations (prod-build and dev-server) boot all three for the slot they hold — the dev harness consumes none of them yet and still owns them (spec §4 Assumption 6) — and both teardowns force-remove exactly the held slot's three containers. Because Redis now always exists, the two-replica hop proof moves its gate to its own `E2E_HOP=1` flag, and `TEST_REDIS_URL` is demoted from "boot gate" to "endpoint override that suppresses the Redis boot". The broker boots unused by design: no consumer, no `RABBITMQ_URL` wiring.

No new dependency: `node:child_process` `execFileSync` against the `docker` CLI, exactly as the shipped Postgres recipe does.

## Architecture Decisions

- **One recipe, three uses.** `startThrowawayPostgres` becomes a generic `startThrowawayContainer(...)` (name, image, env, published `<port>/tcp`, readiness argv, URL builder) plus three thin callers. Rationale: the spec forbids a second boot implementation, and the readiness/`docker port`/fail-fast shape is already proven.
- **Ports are read, never derived.** Every container publishes `-p 127.0.0.1::<containerPort>`; the host port comes from `docker port <name> <port>/tcp`. Container names are the only slot-derived identity, which is what makes two slots structurally incapable of sharing a port.
- **`docker rm -f <own name>` before every boot.** A crashed run's container is reclaimed by the next run of the same slot without manual cleanup, and by construction never touches another slot's container.
- **Readiness stays per-image, deadline shared.** `pg_isready -U postgres`, `rabbitmq-diagnostics -q ping`, `redis-cli ping`; 60-second deadline shape as today. Non-guest broker user (`RABBITMQ_DEFAULT_USER=feedback`, `RABBITMQ_DEFAULT_PASS=test-only`) because the stock `guest` account is loopback-restricted and a published-port client arrives from the bridge gateway.
- **Overrides stay the single escape hatch.** `E2E_FEEDBACK_PG_CONTAINER`, `E2E_FEEDBACK_MQ_CONTAINER`, `E2E_REDIS_CONTAINER` win over the derived name in any slot; `TEST_REDIS_URL` wins over the booted Redis entirely (sets `testRedisUrl()` and suppresses the Redis container).
- **Both harness invocations boot the set.** `startStack` starts the three for every `StackConfig`, above the `feedbackPort !== undefined` branch, so `developmentStackConfig` (no feedback port) owns its slot's three containers too. That is spec Assumption 6's reading of "every e2e run"; dev consumes none of them, and `global-teardown.dev.ts` releases them exactly like the prod teardown.
- **RabbitMQ boots unused.** `feedbackEnv` keeps `RABBITMQ_URL: undefined` and `REDIS_URL: undefined`; nothing in the change consumes the broker.
- **Hop gate is `E2E_HOP=1`, not Redis presence.** Redis existing can no longer be the signal, or the default suite would silently grow two extra app replicas.
- **`MAX_SLOT_COUNT` stays 9** (27 throwaway containers at full concurrency). The operator configures concurrency down; the cap is not reduced.

## Task List

- [ ] Task 1: Derive the RabbitMQ and Redis container identities
- [ ] Task 2: One throwaway-container recipe, three boots
- [ ] Task 3: Boot all three in the stack, remove all three at teardown
- [ ] Task 4: Demote `TEST_REDIS_URL`, move the hop proof behind `E2E_HOP=1`

### Checkpoint: After Tasks 1-2
- [ ] `npm run typecheck` green in `apps/app`
- [ ] `npm run test:unit -- test/slot-ports.test.ts` green (per-slot names, per-slot disjointness, three override names)
- [ ] No container code path publishes a fixed host port; readiness and `docker port` read-back live in exactly one helper

### Checkpoint: After Tasks 3-4
- [ ] One policy-allowed production e2e run boots `feedback-pg-e2e-<s>`, `feedback-mq-e2e-<s>`, `redis-e2e-<s>` and removes all three at teardown
- [ ] The dev-server invocation (`developmentStackConfig`) boots the same three for its slot and `global-teardown.dev.ts` removes them — boots sit outside the `feedbackPort` branch, checked by reading `stack.ts`, no extra e2e command
- [ ] `git diff` shows no change to `publisher.service.ts` / `dispatcher.service.ts` and `feedbackEnv` still passes `RABBITMQ_URL: undefined`
- [ ] Default (no `E2E_HOP`) run boots no extra app replicas

## Task 1: Derive the RabbitMQ and Redis container identities

**Description:** Grow `apps/app/test/e2e/config.ts` from one container-name function to three, in the exact shape `feedbackPgContainer` already has: `feedbackMqContainer(slot = 0)` returning `feedback-mq-e2e-<slot>` and `redisContainer(slot = 0)` returning `redis-e2e-<slot>`, each letting `E2E_FEEDBACK_MQ_CONTAINER` / `E2E_REDIS_CONTAINER` win when set, with the one-line JSDoc style already in the file. Also demote `testRedisUrl()`'s documentation from "the gate that skips the hop spec" to "an explicit endpoint override that suppresses the slot's Redis boot", keeping its current `?? undefined` behavior. `slot-ports.test.ts` grows the two new names: slots 0-8 match the table, no two distinct slots share any of the three names, and the existing override test gains the two new variables.

**Acceptance criteria:**
- [ ] `feedbackMqContainer(s)` returns `feedback-mq-e2e-<s>` and `redisContainer(s)` returns `redis-e2e-<s>` for every slot 0-8.
- [ ] `E2E_FEEDBACK_MQ_CONTAINER` and `E2E_REDIS_CONTAINER` each win over the derived name in any slot; `E2E_FEEDBACK_PG_CONTAINER` keeps winning as today.
- [ ] For any two distinct slots, the three container names are all different (no shared name).
- [ ] `testRedisUrl()` still returns the trimmed `TEST_REDIS_URL` or `undefined`, and its JSDoc describes it as an endpoint override rather than a boot gate.
- [ ] No new export changes the behavior of `feedbackPgContainer` or any existing port function.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts
- [ ] Manual check: the slot-ports suite lists three distinct names per slot for slots 0 and 1 and shows both new overrides applied

**Dependencies:** None

**Files likely touched:**
- `apps/app/test/e2e/config.ts`
- `apps/app/test/slot-ports.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: One throwaway-container recipe, three boots

**Description:** Generalize `startThrowawayPostgres` in `apps/app/test/e2e/stack.ts` into one helper that takes a container name, image, `-e` variables, a container port to publish on loopback, a readiness argv plus deadline, and returns the host port read back from `docker port <name> <port>/tcp`. The helper keeps the existing failure shape: Docker unavailable fails fast with a legible message naming the image, a container that never becomes ready is force-removed before the error, and the published port is parsed from the first `docker port` line. On top of it, three callers: the Postgres one keeps today's URL and env, a new RabbitMQ one (`rabbitmq:4.1-alpine`, non-guest `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS`, `rabbitmq-diagnostics -q ping`) returns `amqp://…@127.0.0.1:<port>`, and a new Redis one (`redis:8-alpine`, `redis-cli ping`) returns `redis://127.0.0.1:<port>`. Each boot starts with `docker rm -f` of its own derived name. `stopThrowawayPostgres` generalizes the same way so teardown force-removes exactly the held slot's containers.

**Acceptance criteria:**
- [ ] Exactly one function in `stack.ts` runs `docker run`, performs readiness polling, and reads back the published port; all three boots go through it.
- [ ] Every boot publishes `-p 127.0.0.1::<containerPort>`; no fixed host port appears anywhere in the harness for these containers.
- [ ] Container names come from `feedbackPgContainer`, `feedbackMqContainer`, `redisContainer` with the held slot, so each boot and each removal is scoped to that slot only.
- [ ] Each boot begins with `docker rm -f <own name>` so a stale container from a crashed run is reclaimed without manual cleanup.
- [ ] Readiness: `pg_isready -U postgres`, `rabbitmq-diagnostics -q ping`, `redis-cli ping`, all inside the shared 60-second deadline; a timeout force-removes the container and throws a legible error.
- [ ] Docker unavailable fails fast with an error naming the image, in the shipped Postgres error style.
- [ ] The RabbitMQ container runs with explicit `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS`, never the stock `guest` account.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts
- [ ] Manual check: `docker ps` during a stack boot shows three `*-e2e-<slot>` containers, and `docker port <name>` reports a distinct Docker-assigned `127.0.0.1` port for each

**Dependencies:** Task 1

**Files likely touched:**
- `apps/app/test/e2e/stack.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Boot all three in the stack, remove all three at teardown

**Description:** Wire the three boots into `startStack` so the held slot's Postgres, RabbitMQ and Redis come up for every stack the harness starts — prod-build and dev-server alike — and so both harness teardowns remove all three. The boots move out of the `feedbackPort !== undefined` branch: `developmentStackConfig` carries no feedback port, yet per spec §4 Assumption 6 (and §10, which resolves the dev question the same way) "every e2e run" boots all three containers for its held slot even where no service consumes them. Postgres keeps feeding `FEEDBACK_DB_URL` where feedback-service runs; in the dev harness nothing consumes the three. RabbitMQ and Redis are booted and left unconnected: `feedbackEnv` continues to pass `RABBITMQ_URL: undefined` and `REDIS_URL: undefined`, so the broker is up unused by design. `global-teardown.ts` and `global-teardown.dev.ts` both call the generalized stop for the held slot, inside the existing `finally` that releases the slot, and the setup-abort path in `startStack` still stops every spawned service.

**Acceptance criteria:**
- [ ] A production stack boot for slot `s` leaves `feedback-pg-e2e-s`, `feedback-mq-e2e-s` and `redis-e2e-s` running, each on its own `127.0.0.1` Docker-assigned port.
- [ ] A dev-server stack boot (`global-setup.dev.ts` → `developmentStackConfig`, no feedback port) also leaves `feedback-pg-e2e-s`, `feedback-mq-e2e-s` and `redis-e2e-s` running for its held slot; the three boots sit outside the `feedbackPort !== undefined` branch, so dev boots them despite consuming none.
- [ ] `feedbackEnv` still passes `RABBITMQ_URL: undefined` and `REDIS_URL: undefined`; no service in the harness receives a broker or Redis URL from this change.
- [ ] `TEST_REDIS_URL` set ⇒ no `redis-e2e-<slot>` container boots in either invocation and `testRedisUrl()` returns the given URL unchanged.
- [ ] Both harness invocations leave the held slot's three containers running, and both teardowns (`global-teardown.ts`, `global-teardown.dev.ts`) remove exactly the held slot's three; the other slot's containers stay up, and `docker ps -a` shows none of the released slot's three afterwards.
- [ ] `apps/feedback-service/src/event/publisher.service.ts` and `dispatcher.service.ts` are untouched by the diff.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts
- [ ] E2E passes where this task needs an end-to-end check: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/feedback.spec.ts -g "submit feedback from the notes toolbar and read it back in the inbox"
- [ ] Manual check: during that run `docker ps` names the three `*-e2e-<slot>` containers and after it `docker ps -a` shows them gone; reading `stack.ts` confirms the three boots are outside the `feedbackPort` branch (so `developmentStackConfig` boots them too) and `global-teardown.dev.ts` calls the shared stop for `heldSlot()`

**Dependencies:** Task 2

**Files likely touched:**
- `apps/app/test/e2e/stack.ts`
- `apps/app/test/e2e/global-teardown.ts`
- `apps/app/test/e2e/global-teardown.dev.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: Demote `TEST_REDIS_URL`, move the hop proof behind `E2E_HOP=1`

**Description:** Redis now always exists, so Redis presence can no longer be what turns the two-replica hop proof on: that would silently add two extra app replicas to the default suite. Add an `E2E_HOP` reading to the harness config and gate `hop.spec.ts` on `E2E_HOP === '1'` instead of on `TEST_REDIS_URL`. The spec then points its replicas at `TEST_REDIS_URL` when set, else at the held slot's booted Redis URL, and `hop-app.ts` keeps taking the URL it is handed rather than reading an env var itself. The skip reason text changes to name `E2E_HOP=1`.

**Acceptance criteria:**
- [ ] Without `E2E_HOP=1`, `hop.spec.ts` skips and no extra app replicas boot, regardless of whether `TEST_REDIS_URL` is set or the slot's Redis came up.
- [ ] With `E2E_HOP=1` and no `TEST_REDIS_URL`, the proof runs against the held slot's booted `redis-e2e-<slot>` URL.
- [ ] With `E2E_HOP=1` and `TEST_REDIS_URL` set, the proof runs against that URL and no Redis container is needed.
- [ ] The skip message names `E2E_HOP=1`, and `hop-app.ts` receives its Redis URL as an argument (no second source of truth for the endpoint).
- [ ] Default e2e spec count and boot set are otherwise unchanged.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts
- [ ] E2E passes where this task needs an end-to-end check: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/hop.spec.ts -g "no re-login"
- [ ] Manual check: `E2E_HOP=1` with no `TEST_REDIS_URL` runs the proof against the slot's Redis; unset, the same command reports one skipped describe and boots nothing extra

**Dependencies:** Task 3

**Files likely touched:**
- `apps/app/test/e2e/config.ts`
- `apps/app/test/e2e/hop.spec.ts`
- `apps/app/test/e2e/hop-app.ts`

**Estimated scope:** Medium: 3-5 files

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Broker boot time slows every e2e run | Med | Boots happen once per run, in parallel with the existing builds; revisit only on measured evidence (spec §10 open question) |
| Docker daemon with many slots (9 × 3 containers) exhausts resources | Med | `MAX_SLOT_COUNT` stays 9 and concurrency is operator-configurable; names stay slot-scoped so a down configure never collides |
| Stale containers after a crashed run | Low | Every boot begins with `docker rm -f <own name>`; teardown force-removes the held slot's three |
| Hop proof silently rejoining the default suite | Med | Gate moves to `E2E_HOP=1`; the skip reason and Task 4 verification make the default set observable |
| `guest` broker account unreachable over a published port | Low | Non-guest `RABBITMQ_DEFAULT_USER`/`PASS` from the start |

## Open Questions

- Dev harness skips feedback-service today; whether it should also skip the broker if boot time proves measurable (spec §10) — Assumption 6 boots all three in both invocations for now, so any skip needs a spec revision first.
- Redis readiness deadline: shared 60-second shape assumed; a measured run may justify a smaller constant (spec §10).
- Export shape of the slot URLs for the next consumer chapter (env names on spawned services vs. harness exports) is deferred by spec §10 and not built here.
