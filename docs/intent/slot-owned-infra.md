# Intent — slot-owned e2e infrastructure (Postgres, RabbitMQ, Redis)

## Outcome

Every e2e run boots its own Postgres, RabbitMQ and Redis for the slot it holds.
Container name is `<name>-e2e-<slot>`, the published loopback port is chosen by
Docker and read back with `docker port` — exactly the recipe
`startThrowawayPostgres` already uses (`apps/app/test/e2e/stack.ts:257`).

Two concurrent runs (`E2E_CONCURRENCY=2`) share no external identity: no
container name, no port, no URL. `slot-ports.test.ts` proves the derived
identities differ per slot, and that the explicit overrides
`E2E_FEEDBACK_PG_CONTAINER`, `E2E_FEEDBACK_MQ_CONTAINER`,
`E2E_REDIS_CONTAINER` and `TEST_REDIS_URL` still win when set.

## User

Two worktrees running the e2e harness at the same time, and the future author of
the first RabbitMQ consumer test who must not discover a cross-worktree
collision or an external dependency they had to hand-start.

## Why now

RabbitMQ is expected to carry a heavy load of automatic processes, with one
broker per service. Slot isolation is cheap to derive while the harness plumbing
is one file; retrofitting it after consumers exist costs a migration of every
consumer's identity assumptions.

## Success

- Concurrency 2 boots `feedback-pg-e2e-0/1`, `feedback-mq-e2e-0/1`,
  `redis-e2e-0/1`, and teardown removes all six.
- RabbitMQ boots and is allowed to idle: nothing consumes from it yet. This is
  deliberate preparation, not an oversight, and it must not be removed on
  "unused" grounds.
- `slot-ports.test.ts` asserts the per-slot container names and that the
  override variables still take precedence.
- `MAX_SLOT_COUNT` stays 9. The operator configures concurrency down when the
  machine cannot hold 9 × 3 containers; the cap is not reduced.

## Constraint

`TEST_REDIS_URL` demotes from gate to escape hatch: when set, the harness uses
that Redis and boots none. The hop proof moves to its own `E2E_HOP=1` flag so
that a Redis now always existing does not silently add two extra app replicas to
every run.

## Out of scope

- Writing a RabbitMQ consumer, or any consumer-side test.
- Editing `publisher.service.ts` or `dispatcher.service.ts`.
- Wiring `RABBITMQ_URL` into the feedback-service harness environment and
  asserting publish→confirm→cursor-advance. The broker boots unused by design.

## Confirmation

Confirmed: yes — the user explicitly answered "Yes" to the restate above
(gate moved to `E2E_HOP=1`; RabbitMQ boots and idles deliberately), 2026-10-24.
