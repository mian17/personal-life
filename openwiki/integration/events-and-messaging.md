---
type: "Reference"
title: "Events and messaging"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-13203f84a306dddb7ec0a433
    resource: repo://apps/app/lib/outbox-relay.ts
  - id: openwiki-source-68043caafb52d638e9bd63e3
    resource: repo://apps/app/test/e2e/config.ts
  - id: openwiki-source-be8dbba72c31aba42e0006a5
    resource: repo://apps/feedback-service/src/event/event.module.ts
  - id: openwiki-source-4d314ef15f5b74f0c0bde843
    resource: repo://apps/feedback-service/src/event/publisher.service.ts
  - id: openwiki-source-3c7ae0c6dcfe16110ce0ebe6
    resource: repo://apps/feedback-service/src/feedback/feedback-event.entity.ts
  - id: openwiki-source-529adad5b98db00ca5c3989c
    resource: repo://apps/meal-service/src/meal-todo.controller.ts
  - id: openwiki-source-6c296908bf0e09e138e3cd0f
    resource: repo://packages/service-kit/src/outbox/outbox-delivery.ts
  - id: openwiki-source-eed9fbfe3a39f063b4923686
    resource: repo://scripts/arch-check.mjs
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Events and messaging

Two asynchronous paths exist, and they solve different problems:

1. **The feedback change-log stream** — Postgres NOTIFY/LISTEN + a confirmed
   RabbitMQ publisher, in `feedback-service`.
2. **The domain outbox** — transactional outbox rows whose live delivery leg is
   the BFF's drain, not a service (see
   [Todos and the transactional outbox](../workflows/todos-and-outbox.md)).

Plus the boring but load-bearing layer: direct service-to-service HTTP over the
compose network.

## The feedback event stream

`feedback_service` records a `feedback_event` change log row **in the same
transaction** as the feedback it describes. The rest of the pipeline is in
`apps/feedback-service/src/event/`:

- A boot-ensured **NOTIFY trigger** (`trigger-ddl.ts`) wakes the
  **persistent-LISTEN dispatcher** (`dispatcher.service.ts`), which walks the log
  with its own cursor (`feedback_cursor`) and replays on failure.
- The **confirm publisher** (`publisher.service.ts`) publishes to a durable
  topic exchange `feedback` with routing key `feedback.submitted`, as persistent
  messages on a confirm channel, resolving only after `waitForConfirms()`. A
  broker failure rejects, so the dispatcher holds the cursor back and retries.
- **What travels is metadata only.** The wire body (`FeedbackSubmittedBody`) is
  `event_id`, `feedback_id`, `owner_sub`, `app`, `type`, `occurred_at` —
  neither the title nor the description travels, as plaintext or ciphertext, so
  the broker and its management UI sit outside the at-rest boundary and never
  learn content.

The publisher is injected under the `EVENT_SINK` token through an `EventSink`
interface, so tests substitute a fake sink and the dispatcher never sees
amqplib. Reconnect is lazy on the next publish; backoff is the dispatcher's.

## The domain outbox transport

The shared outbox kit (`packages/service-kit/src/outbox/`) is transport-pluggable
via `OUTBOX_DELIVERY`, but the **live delivery leg is the BFF's drain**
(`apps/app/lib/outbox-relay.ts`), and that is deliberate: `origin_grant` in
todo-service is keyed `(ownerSub, clientId)` and the grant belongs to the
client the user's own token names (the BFF's `app` client) — `clientCredentials`
is disabled in the IdP, so a service has no credential to act on a grant. The
default `createHttpDelivery` sender is therefore intentionally inert: the
poller warns once and leaves rows pending until a service-identity path exists.

What the BFF relay guarantees per drain: one bad row never aborts the batch;
outcomes (successes and failures together) are recorded in one report call so a
stuck row carries its `lastError`; and nothing throws into the page — the meal
was logged, the tick is best-effort.

## Service-to-service HTTP

Cross-service calls are direct HTTP over the compose `life` network, with the
target's base URL supplied by env (`MEAL_TODOS_API_URL`, `FOCUS_TODOS_API_URL`
pointing at `http://todo-service:3005` inside containers). These variables have
**no code fallback** on purpose: a guessed port half-succeeds a write (row
saved, message never sent, nothing logged), so a loud refusal naming the missing
variable is the better failure. `scripts/arch-check.mjs` RULE 6 enforces that
every such variable is forwarded in the service's own compose `environment:`
block.

## Queues and brokers, ownership summary

| Resource | Owner | Durable? | Survives restart |
|---|---|---|---|
| `feedback` exchange + `feedback.submitted` routing key | feedback-service | yes (durable exchange, persistent messages) | yes — the change log + cursor replay anything unsent |
| `feedback_event` log + `feedback_cursor` | feedback-service (Postgres) | yes | the source of truth for "what is owed" |
| outbox rows | each producing service (its own DB) | yes | at-least-once via the poller; live delivery via the BFF drain |
| e2e RabbitMQ | test harness, ephemeral port | no | never — see [Testing strategy](../testing/strategy.md) |

## See also

- [Todos and the transactional outbox](../workflows/todos-and-outbox.md) — the
  meal/focus → todo intent flow the BFF drain serves.
- [Data layer](../architecture/data-layer.md) — why nothing async is a write
  path around the cache.
- [Testing strategy](../testing/strategy.md) — slot-owned brokers and queues
  per worktree.
