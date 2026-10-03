# MAP-feedback — Feedback capability map

**Status:** CONFIRMED — the index for the feedback capability. Module specs trace to a
module id here; do not add a module spec without adding its row here first.

**Date:** 2026-10-03
**Source:** `docs/intent/feedback-service.md` (confirmed intent).

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `feedback-infra` | Postgres + RabbitMQ compose services/volumes; Postgres-only backup/restore tooling in `@life/db` | — |
| `feedback-service` | Feedback domain: owner-scoped capture + read API (BE → cache → DB), Postgres `feedback` + `feedback_event` change log, NOTIFY trigger + LISTEN dispatcher → RabbitMQ publisher | `feedback-infra` |
| `feedback-ui` | Shared `@life/ui` submit-feedback block + toolbar feedback item; `/feedback` top-level app (owner inbox grouped by app then type) | `feedback-service` |

Build order: `feedback-infra` → `feedback-service` → `feedback-ui`.

Dependency direction is one-way (ui → service → infra). No cycles.

## Locked interfaces (shared across module specs)

These are fixed by the confirmed intent; module specs must not re-decide them.

### Infrastructure / env
- Postgres: own compose service + persistent named volume. Service reads `FEEDBACK_DB_URL`.
  Tests read `FEEDBACK_TEST_DB_URL`.
- RabbitMQ: own compose service. Producer reads `RABBITMQ_URL`.
- Redis: `redis-feedback`, own instance (per-service isolation), `REDIS_URL` as elsewhere.

### Event contract
- Exchange `feedback` (durable, topic), routing key `feedback.submitted`.
- Message body: `{ event_id, feedback_id, owner_sub, app, type, occurred_at }`.
  Never contains the plaintext description or the ciphertext.
- Producer: persistent delivery + publisher confirms.
- Consumer: at-least-once; dedups on `event_id`.

### Service HTTP contract
- `POST /feedback` — body `{ id, app, type, description }` where `id` is the client-supplied
  idempotency key (UUID); owner taken from the JWT (`principal.sub`). Returns `201 { id }`.
- `GET /feedback` — owner-scoped; returns entries newest-first for in-memory grouping by
  app then type. Cache key shape `feedback:<owner_sub>:v<gen>:list` (filters/pagination never
  in the key, per Contract 2 Rule 3).
- Feedback DTO: `{ id, app, type, description, createdAt }` (description decrypted in the
  request path only).

### Cache contract (Contract 2)
- Read-through, per-owner generation counter bumped on successful writes, TTL backstop,
  fail-open. Domain events never drive cache invalidation. Each backend module spec includes
  a `## Cache Rules` section.

## Out of scope (whole map)

The consuming service; SQLite↔Postgres reconciliation and data-tier migration; feedback
status workflow; attachments; notifications; edit/delete; anonymous submission.
