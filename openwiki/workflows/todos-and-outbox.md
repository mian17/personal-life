---
type: "Reference"
title: "Todos and the transactional outbox"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-13203f84a306dddb7ec0a433
    resource: repo://apps/app/lib/outbox-relay.ts
  - id: openwiki-source-a538da111c5a9b502287166b
    resource: repo://apps/focus-service/src/todos/focus-todos.client.ts
  - id: openwiki-source-529adad5b98db00ca5c3989c
    resource: repo://apps/meal-service/src/meal-todo.controller.ts
  - id: openwiki-source-8c21825cf511a134a6812f17
    resource: repo://apps/meal-service/src/meal-todo/meal-todo-producer.service.ts
  - id: openwiki-source-f906d097101c8c6ba17eca1b
    resource: repo://apps/meal-service/src/meal-todo/todo-intents.ts
  - id: openwiki-source-ead9edd1c261b0b4c4f4fa38
    resource: repo://apps/todo-service/src/todos/dto/create-with-origin.dto.ts
  - id: openwiki-source-0008d52b7a3962d547fc323e
    resource: repo://apps/todo-service/src/todos/todos.controller.ts
  - id: openwiki-source-3dacd9878f9b23d22428ba51
    resource: repo://apps/todo-service/src/todos/todos.service.ts
  - id: openwiki-source-fb27e3de333c30f4e46b1c57
    resource: repo://packages/service-kit/src/grants/origin-grant.entity.ts
  - id: openwiki-source-9b816c81131c37af8b9eaf41
    resource: repo://packages/service-kit/src/outbox/outbox-poller.service.ts
  - id: openwiki-source-85235f2a74131932cd21d27e
    resource: repo://packages/service-kit/src/outbox/outbox.entity.ts
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Todos and the transactional outbox

Todos are the cross-service hub: notes and tags are single-service, but meals
and focus sessions *produce* todos. That is where the transactional outbox
exists — so a domain write and its "tell another service" intent are one atomic
fact, and the tick can never be silently lost.

## The todo-service surface

`api/todos` is ordinary CRUD (create, list, update, trash, tags) plus the
**origin** routes that outside surfaces use:

- `POST api/todos/origin` — create a todo on behalf of an origin,
- `GET api/todos/origin/open` — the origin's open todos,
- `POST api/todos/origin-grant` — grant the caller's own origin,
- `POST api/todos/origin/:originId/complete` and `.../rename` — act on one.

Every origin route is enforced by the **origin grant**
(`origin_grant`, keyed `(ownerSub, clientId)`, see
[Service kernel](../architecture/service-kernel.md)): the grant is written
before any intent is enqueued, and a UI toggle is convenience, never the
enforcement point. The client that holds the grant is the one the user's own
token names — the BFF's `app` client.

## The producer side: intents in the same transaction

`meal-service` turns a logged meal into todo intents ("eat this", completions,
renames). `meal-todo/todo-intents.ts` computes the payloads as **pure
functions** (no I/O, no clock — the day is always the client's), and
`MealTodoProducerService` decides when: the intent row is inserted into the
service's outbox **in the same transaction** as the meal write. A committed
meal therefore always owes its todo; a rolled-back one never sends anything.

## Why sequential delivery is correctness, not waste

The outbox poller delivers rows one at a time and advances its cursor only after
delivery confirms. Parallel fan-out would let one failing row abort or reorder
the batch — and for todos, order is meaning ("create then complete" inverted is
a different outcome). The cursor is the only progress marker and only the
poller writes it, so a crash between "sent" and "marked sent" re-sends rather
than loses: at-least-once, which is the whole point of the pattern.

## The delivery leg is the BFF's drain

Live delivery does not run in a service: `origin_grant` needs the *user's*
token and `clientCredentials` is disabled, so
`apps/app/lib/outbox-relay.ts` drains meal-service's pending queue
(`GET /api/meal-todo/pending`), sends each intent to todo-service's origin
routes with the user's session, and reports all outcomes back in one call
(`POST /api/meal-todo/published`) — successes and failures together, so a stuck
row keeps its `lastError`. One bad row never aborts the batch and nothing
throws into the page: the meal was logged, the tick is best-effort. Details of
the transport contract: [Events and messaging](../integration/events-and-messaging.md).

## The focus integration: direct service-to-service HTTP

Focus sessions name the task they work on, and `focus-service` calls
todo-service directly over the compose network
(`focus-todos.client.ts`, `HttpFocusTodos`) using `FOCUS_TODOS_API_URL`. Both
this and `MEAL_TODOS_API_URL` (meal's outbox target URL) have **no code
fallback**: unset, the read fails loudly and the feature refuses — a guessed
port would half-succeed writes. Inside containers the values are
container-network addresses (`http://todo-service:3005`); dev keeps
`127.0.0.1:3105`. v0.2.1 shipped both unset, which is why
[CI gates](../operations/ci-gates.md) now boots the real stack and arch-check
RULE 6 enforces the forwarding.

## See also

- [Service kernel](../architecture/service-kernel.md) — the outbox and grants
  building blocks.
- [Data layer](../architecture/data-layer.md) — the one-bump-per-write
  discipline the outbox respects.
- [Meals and nutrition](meals-and-nutrition.md) — where meal intents come from.
