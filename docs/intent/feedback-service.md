# Feedback Service — Confirmed Intent

**Status:** CONFIRMED — downstream spec/plan consume this; do not re-litigate locked
decisions without naming new evidence.

**Date:** 2026-10-03
**Source:** `interview-me` session for the feedback feature.

## Outcome

One reusable submit-feedback form, reachable from the top toolbar of every frontend app.
Tapping the feedback icon opens a dialog: choose a type — **feature request / enhancement /
bug report** — and write a **required description**, then submit. Submissions are persisted
and each one durably emits a `feedback.submitted` event. The owner reviews everything in one
owner-only inbox grouped by app, then by type.

## User

The signed-in owner. Rows carry the owner boundary (`principal.sub`) so that each user keeps
their own feedback later; multi-user ready, no public/anonymous submission in v1.

## Why now

Feedback noticed in the moment has nowhere to go; there is also no event seam between
services yet. This chapter adds both — the owner-facing capture/review surface and the
first durable, push-on-write event stream.

## Success

- From Notes or Todos, tap feedback → pick type + write description → submit → the entry
  appears in the `/feedback` inbox, grouped by app then type.
- A retry / double-tap produces exactly one feedback row and one event.
- A consumer service added later can replay every event submitted before it existed.
- The Postgres backup/restore scripts work standalone against the feedback database.

## Constraints and locked decisions

1. **Contracts.** Contract 1 (UI built only from `@life/ui` primitives, tokens only, no raw
   HTML, no inline `style`, no per-app forks) and Contract 2 (BE → cache → DB, own Redis,
   owner-scoped, content encrypted at rest with `@life/crypto` `enc.v1.`).
2. **Postgres for feedback-service.** Feedback-service is the first Postgres-backed service.
   SQLite is treated as the premature-state store; Postgres is the real DB. The existing
   services stay on SQLite for now.
3. **Event durability = transactional change log + push (no polling selector).** The event
   row (`feedback_event`, ordered by `seq`) is written in the **same Postgres transaction**
   as the feedback row. An `AFTER INSERT` trigger issues `pg_notify('feedback_events', …)`,
   which Postgres delivers only on commit. A dispatcher holds a persistent `LISTEN` and
   publishes on notify. A `SELECT … WHERE dispatched_at IS NULL` relay over the business
   table is explicitly rejected (unbounded latency, missed rows, no total order).
4. **Distribution = RabbitMQ.** Open AMQP 0-9-1 standard, self-hosted, no vendor lock
   (BullMQ explicitly rejected as Redis/library-coupled). Durable exchange `feedback`,
   routing key `feedback.submitted`, persistent messages, publisher confirms.
5. **Dedup / exactly-once effect.** Client-supplied idempotency key (unique index) →
   one feedback row; `event_id` UNIQUE → one event row; consumer dedups on `event_id`.
   Delivery is at-least-once, as any distributed system must be.
6. **Replay.** On dispatcher restart/reconnect, replay `feedback_event WHERE seq > cursor`
   (bounded ordered change-log read by cursor; never a scan of business rows).
7. **Cache.** Contract 2 read-through + per-owner generation counter, TTL backstop,
   fail-open. Domain events never drive cache invalidation; the cache is never in the event
   path and the event path is never in the read path.
8. **Governing docs revised deliberately.** `docs/intent/architecture.md`'s "no message
   brokers / SQLite" lines are revised as an explicit cross-chapter decision and recorded
   (per lesson 0012). Broker and Postgres now earn their place.
9. **Postgres-only backup/restore.** A Postgres variant is added to `@life/db` mirroring the
   SQLite contract (same `backup/<UTC-stamp>/` naming, `manifest.json` shape, `--pin` /
   `--only` / `--from` flags, newest-10 routine retention, deliberate/pre-restore never
   pruned, `PINNED` marker, non-interactive, exit codes 0/1/2, `down`-stack precondition,
   pre-restore snapshot before overwrite). `pg_dump -Fc` + `pg_restore --list` verification
   replaces `quick_check`. Host has no `psql`/`pg_dump`, so the scripts execute the client
   **inside the Postgres container**. One version, PostgreSQL only.

## Shape

- **`feedback-service`** — new NestJS workspace, kernel copy. Postgres store with
  `feedback` + `feedback_event` tables, NOTIFY trigger, LISTEN dispatcher, RabbitMQ
  producer. Own Redis (`redis-feedback`) for the read-through cache. Owner-scoped.
- **`postgres` + `rabbitmq`** — new services in `compose.yaml` (each its own instance and
  persistent volume).
- **`/feedback`** — new top-level route in `apps/app`, treated as its own app (own PWA
  manifest/icon) hosting the owner inbox grouped by app then type.
- **Shared submit form** — a `@life/ui` block (dialog + type select + textarea + submit)
  plus a shared toolbar feedback item, reused by every app; each app passes its `app` id.

## Out of scope (v1)

The consuming service; SQLite↔Postgres reconciliation and data-tier migration (deferred);
status/assignment/resolution workflow; replies/comments; attachments/screenshots; email or
push notification; editing/deleting feedback; anonymous/public submission.

## Deferred

- SQLite → Postgres data-tier reconciliation/migration for the existing services.
- The consumer that subscribes to `feedback.submitted`.
- Any broker beyond a single RabbitMQ instance.
