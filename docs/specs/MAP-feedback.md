# MAP-feedback — Feedback capability map

**Status:** CONFIRMED — the index for the feedback capability. Module specs trace to a
module id here; do not add a module spec without adding its row here first.

**Date:** 2026-10-03
**Source:** `docs/intent/feedback-service.md` (confirmed intent).

**Amendment 2026-10-16 (user-authorized):** the confirmed intent
`docs/intent/feedback-status.md` gives every feedback entry a fixed **status workflow** and
supersedes this map's "feedback status workflow" out-of-scope line. Three additive flags
follow; nothing else is re-decided, and the full contract lives in
`docs/specs/SPEC-feedback-status.md`:

1. `FeedbackDto` gains a required `status` (wire vocabulary owned by `@life/shared`).
2. A new owner-scoped route `PATCH /api/feedback/:id` sets it.
3. `POST /api/feedback`, the event contract, and the cache key shape stay byte-identical.

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
- Postgres: own compose service + persistent named volume, publishing
  `127.0.0.1:5432:5432` (host loopback only, so the host-run dev service reaches it;
  production addresses stay on the compose network, `postgres-feedback:5432`). Service reads
  `FEEDBACK_DB_URL`.
  Tests read `FEEDBACK_TEST_DB_URL`.
- RabbitMQ: own compose service, publishing `127.0.0.1:5672:5672` (host loopback only;
  production `rabbitmq-feedback:5672`; management UI never published). Producer reads `RABBITMQ_URL`.
- Redis: `redis-feedback`, own instance (per-service isolation), `REDIS_URL` as elsewhere.
  Internal-only: no published host port, fail-open in dev.

### Event contract
- Exchange `feedback` (durable, topic), routing key `feedback.submitted`.
- Message body: `{ event_id, feedback_id, owner_sub, app, type, occurred_at }`.
  Never contains the plaintext description or the ciphertext.
- Producer: persistent delivery + publisher confirms.
- Consumer: at-least-once; dedups on `event_id`.

### Service HTTP contract
- Routes live under the repo's `/api/<resource>` prefix (as `api/notes`, `api/lists`):
  `POST /api/feedback`, `GET /api/feedback`, `PATCH /api/feedback/:id`. Service port `3008`
  (dev `3108`).
- `POST /api/feedback` — body `{ id, app, type, title, description }` where `id` is the
  client-supplied idempotency key (UUID); owner taken from the JWT (`principal.sub`).
  Returns `201 { id }`. A repeat of an already-owned `id` is the same no-op `201 { id }` —
  `409` is never emitted. Validation failures are `400` (never `422`).
- `GET /api/feedback` — owner-scoped; returns a **bare `FeedbackDto[]`** (no envelope),
  newest-first, for in-memory grouping by app then type. Cache key shape
  `feedback:<owner_sub>:v<gen>:list` (filters/pagination never in the key, per
  Contract 2 Rule 3).
- `PATCH /api/feedback/:id` — body `{ status }` where `status ∈ FEEDBACK_STATUS_VALUES`;
  owner from the JWT (`principal.sub`), never the body. Returns `200 { id, status }`; a
  repeat of the current status is the same no-op `200`, never `409`. A missing or foreign
  id is `404` (byte-identical, never `403` — existence must not leak), an invalid status is
  `400`. A status change writes no `feedback_event` row and emits no event, and it bumps the
  owner's cache generation like any successful write.
- Wire types live in `@life/shared` (`feedback/dto/`): `FeedbackDto = { id, app, type,
  title, description, status, createdAt }` (title and description decrypted in the request
  path only; `status` is plaintext metadata like `app`/`type`), `FeedbackType`,
  `FeedbackStatus` / `FEEDBACK_STATUS_VALUES`, `CreateFeedbackInput`, `FEEDBACK_TITLE_MAX`,
  and `FEEDBACK_DESCRIPTION_MAX` (2000).

### Cache contract (Contract 2)
- Read-through, per-owner generation counter bumped on successful writes, TTL backstop,
  fail-open. Domain events never drive cache invalidation. Each backend module spec includes
  a `## Cache Rules` section.

## Out of scope (whole map)

The consuming service; SQLite↔Postgres reconciliation and data-tier migration;
attachments; notifications; edit/delete; anonymous submission.

**Superseded 2026-10-16:** "feedback status workflow" was listed here, out of scope; the
confirmed intent `docs/intent/feedback-status.md` brings it in as the additive `status`
field and `PATCH /api/feedback/:id` above (`docs/specs/SPEC-feedback-status.md`). The
workflow's own limits stay out of scope: board/column view, custom statuses, status
history/audit trail, per-status count badges, and status palette theming.
