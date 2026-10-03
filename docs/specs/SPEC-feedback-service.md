# Spec: `feedback-service` — `apps/feedback-service`

Module id: `feedback-service` (see `MAP-feedback.md`). New workspace app
`apps/feedback-service`, mirroring note-service's stack (NestJS + TypeORM +
`@life/cache` + `@life/crypto` + IdP JWKS auth), with Postgres as its store and
a NOTIFY-push event stream to RabbitMQ.

Traces to intent: `docs/intent/feedback-service.md` (confirmed intent — locked
decisions are consumed here, never re-litigated).

## Objective

Owner-scoped feedback capture + read API (BE → cache → DB), backed by Postgres
`feedback` + `feedback_event` tables. Every insert durably emits one
`feedback.submitted` event via a transactional change log + `pg_notify` push
(no polling selector), dispatched over a persistent `LISTEN` connection to a
durable RabbitMQ exchange. The owner reads everything back newest-first through
a read-through cache; the UI groups by app then type.

## Tech Stack

NestJS + TypeORM (`postgres` driver) + `@life/cache` + `@life/crypto` +
offline JWKS verification (`jose`, the note-service precedent) + `pg` LISTEN
via the TypeORM driver's client + a maintained AMQP 0-9-1 client (e.g.
`amqplib`; chosen at implementation — the only new dependency this service is
allowed beyond the note-service set, forced by locked decision 4).

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/feedback-service
Build:     npm run build -w @life/feedback-service
```

Env contract: `FEEDBACK_DB_URL` (Postgres connection URL), `REDIS_URL`
(`redis-feedback`, its own instance — lesson 0011), `RABBITMQ_URL`,
`IDP_ISSUER` + `FEEDBACK_IDP_JWKS_URL` (kernel two-var pattern),
`FEEDBACK_SERVICE_AUDIENCE` (default `life-api`, kernel token model),
`FEEDBACK_MASTER_KEY` (32-byte base64, own custody — MAP M3 precedent),
`FEEDBACK_TEST_DB_URL` (throwaway Postgres for tests only), and `PORT`
(default `3006`; main.ts binds it, mirroring note-service's bootstrap). The
service refuses to boot without the DB URL, the master key, or the verifier
config.

## Project Structure

```
apps/feedback-service/src/
  main.ts                  → bootstrap (PORT/HOST), mirror note-service
  app.factory.ts           → createApp(): global AuthGuard + global
                              ValidationPipe({whitelist, transform, forbidNonWhitelisted})
  app.module.ts            → TypeOrmModule.forRoot({type:'postgres', url: FEEDBACK_DB_URL,
                              entities:[...], synchronize:true}) + modules below
  auth/                    → AuthGuard + jwt-verifier + principal (kernel copy;
                              offline JWKS, 30s skew, aud=FEEDBACK_SERVICE_AUDIENCE,
                              fail closed; @Public() health only)
  health/                  → /health/live, /health/ready, /health alias (kernel dialect)
  keys/                    → user-keys entity + DEK provisioning (notes-at-rest pattern)
  feedback/                → feedback.controller.ts, feedback.service.ts,
                              feedback-cache.ts, feedback.entity.ts,
                              feedback-event.entity.ts, dto/
  event/                   → trigger DDL (migration-less: ensured at boot, §Event stream),
                              dispatcher.service.ts (LISTEN + cursor),
                              publisher.service.ts (RabbitMQ confirms)
```

No-migration policy (explicit): like every TypeORM service in this repo the
schema is applied by `synchronize: true`; there is no migration framework and
no migration files. Additive changes only.

## Data model

```
feedback(
  id          UUID PRIMARY KEY,      -- client-supplied idempotency key, never generated
  owner_sub   TEXT NOT NULL,
  app         TEXT NOT NULL,         -- caller-supplied app id ('notes', 'todos', …)
  type        TEXT NOT NULL CHECK (type IN ('feature_request','enhancement','bug_report')),
  description TEXT NOT NULL,         -- enc.v1. envelope, AAD life.v1|<sub>|feedback|description|<id>
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- IDX_feedback_owner_created (owner_sub, created_at DESC, id DESC): the list read
feedback_event(
  seq          BIGSERIAL PRIMARY KEY, -- the ordered cursor; total order of the log
  event_id     UUID NOT NULL UNIQUE, -- dedup key: one row per feedback id
  feedback_id  UUID NOT NULL REFERENCES feedback(id),
  owner_sub    TEXT NOT NULL,
  app          TEXT NOT NULL,
  type         TEXT NOT NULL,         -- same CHECK as feedback.type
  occurred_at  TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ NULL      -- set on publish confirm (observability only)
)
feedback_cursor(
  id       TEXT PRIMARY KEY DEFAULT 'feedback',  -- singleton row
  last_seq BIGINT NOT NULL DEFAULT 0             -- resume point of the dispatcher
)
```

The event payload never carries the description — neither plaintext nor
ciphertext. `feedback_event` rows are metadata only.

**Idempotency (exact behavior):** `UNIQUE` on `feedback.id` (the PK) plus
`UNIQUE` on `feedback_event.event_id` (set to the feedback `id`). `POST` with
an `id` the caller already owns is a no-op returning the existing row
(`201 { id }`, byte-identical to a fresh insert — a retry/double-tap produces
exactly one row and one event). An `id` owned by another `sub` (or missing) is
`404`, byte-identical to missing (kernel rule — never `403`/`409`, they leak
existence). A unique-violation on `event_id` inside the write transaction is
swallowed as a won race and returns the existing row.

## API / DTO contract (locked by the map — not re-decided here)

The controller is `@Controller('api/feedback')` — the repo convention
(`notes.controller.ts` `@Controller('api/notes')`, todo-service
`@Controller('api/lists')`) that the BFF's `/api/notes` / `/api/lists` calls
mirror. Both routes live under `/api/feedback`.

- `POST /api/feedback` — body `{ id, app, type, description }` (`id`: UUID v4,
  client-supplied; `type` ∈ the three locked values; `description`: required,
  non-empty after trim, `@MaxLength(2000)`; owner from `principal.sub`, never
  the body). Inserts `feedback` + `feedback_event` in **one Postgres
  transaction**, bumps the owner's generation counter after commit, returns
  `201 { id }`. A repeat of an already-owned `id` returns the same
  `201 { id }` (the no-op in `## Data model`); the service never emits `409`.
- `GET /api/feedback` — owner-scoped; `200` with a **bare `FeedbackDto[]`**
  (no envelope — the `listNoteTagUsage(): Promise<TagUsage[]>` precedent),
  ordered `createdAt DESC, id DESC`. Grouping by app then type is the UI's job
  over this flat newest-first list.
- **Wire types have one home:** `FeedbackDto` (`{ id, app, type, description,
  createdAt }`, description decrypted in the request path only) and
  `FeedbackType` (`'feature_request' | 'enhancement' | 'bug_report'`) are
  imported from `@life/shared` — never redeclared here. `feedback/dto/`
  holds only the Nest validation class `CreateFeedbackDto` (class-validator:
  `@IsUUID('4')` id, `@IsString()` app, `@IsIn([...FeedbackType values])`
  type, `@IsNotEmpty()` + `@MaxLength(FEEDBACK_DESCRIPTION_MAX)` description,
  where `FEEDBACK_DESCRIPTION_MAX = 2000` lives in `@life/shared` alongside the
  wire types), mirroring `@life/shared`'s `CreateFeedbackInput`, exactly as
  note-service mirrors its shared input types in `notes/dto/`.
- Errors: `401` unauthenticated; `404` for foreign and missing ids alike;
  `400` on validation failure (the only validation status — no `422`). Same
  body shape as note-service.

## Event stream (locked decision 3 — transactional log + push, no polling)

There is **no selector loop over business rows** — no
`SELECT … WHERE dispatched_at IS NULL` relay over `feedback`, no timer sweep
over the `feedback` business table. The dispatcher has TWO triggers, both
reading only the `feedback_event` log by `seq` cursor — push for immediacy,
plus a low-frequency reconciliation tick as the safety net:

1. **One transaction** inserts `feedback` + `feedback_event`
   (`event_id = feedback.id`, `occurred_at = now()`).
2. An `AFTER INSERT` trigger on `feedback_event` issues
   `pg_notify('feedback_events', '{"seq":<seq>,"event_id":"<uuid>"}')`.
   Postgres delivers the notification **only on commit** — an aborted write
   never notifies. DDL shape (ensured at boot, no migration framework):
   ```sql
   CREATE OR REPLACE FUNCTION notify_feedback() RETURNS trigger AS $$
   BEGIN PERFORM pg_notify('feedback_events',
     json_build_object('seq', NEW.seq, 'event_id', NEW.event_id)::text);
   RETURN NEW; END; $$ LANGUAGE plpgsql;
   DROP TRIGGER IF EXISTS feedback_notify ON feedback_event;
   CREATE TRIGGER feedback_notify AFTER INSERT ON feedback_event
     FOR EACH ROW EXECUTE FUNCTION notify_feedback();
   ```
   Channel: `feedback_events`. Payloads stay tiny (seq + UUID, far under the
   8000-byte NOTIFY limit); the full row is always loaded from the DB.
3. The **dispatcher** holds one persistent `LISTEN feedback_events` connection
   (push — primary, immediate). On notify it loads the event row by `seq`,
   hands it to the publisher, and on publish confirm advances
   `feedback_cursor.last_seq` and stamps `dispatched_at`. Cursor advance
   happens only after the broker confirm.
4. The **publisher** opens a confirm channel on durable exchange `feedback` and
   publishes persistent messages with routing key `feedback.submitted`,
   body `{ event_id, feedback_id, owner_sub, app, type, occurred_at }`, waiting
   for the publisher confirm before reporting success.
5. **Recovery on startup/reconnect = bounded ordered change-log read, never a
   business-row scan:** `SELECT * FROM feedback_event WHERE seq > :last_seq
   ORDER BY seq ASC LIMIT <batch>` from the persisted cursor, publishing each
   in order, then resuming on notifications. This is a cursor walk over the
   log, not a poll over `feedback`.
6. **Reconciliation tick (safety net, low frequency):** every 60s (default) the
   dispatcher compares the log head (`SELECT MAX(seq) FROM feedback_event`)
   against `feedback_cursor.last_seq` and, if behind, replays the same bounded
   cursor walk (`WHERE seq > :last_seq ORDER BY seq ASC LIMIT <batch>`) until
   caught up. Postgres NOTIFY is transient — undelivered to a disconnected
   listener and dropped silently on listener-queue overflow while staying
   connected — so reconnect replay alone is not sufficient; the table,
   addressed by cursor, is the source of truth and the tick is the backstop.
   The push path is what makes dispatch immediate.

This is NOT the rejected selector: there is still no query over the `feedback`
business table and no `WHERE dispatched_at IS NULL` business-row scan; the only
reads are by `seq` cursor over `feedback_event`.

**Delivery guarantees (stated honestly):** at-least-once delivery —
a crash between confirm and cursor advance replays that event on restart.
Exactly-once *effect* via `event_id` dedup: the consumer dedups on `event_id`
(map contract); replays are harmless by construction.

**Failure mode:** RabbitMQ down never affects the HTTP path (writes keep
committing; the log keeps the events). The dispatcher reconnects with backoff
and replays from the cursor. `/health/ready` checks DB + key custody only
(kernel dialect — never Redis, never RabbitMQ).

## Cache Rules (AGENTS.md Contract 2, Rule 4)

- **Cached shapes (ciphertext rows as persisted):** one shape —
  `feedback:list` → the owner's full `feedback` row set serialized exactly as
  stored (`description` an `enc.v1.` envelope). No DTOs, no plaintext.
- **Key composition:** `feedback:<owner_sub>:v<gen>:list` (map-locked).
  Filters/pagination never enter the key — one entry serves every read variant.
- **Invalidation:** per-owner generation counter `feedback:gen:<owner_sub>`,
  `INCR` **after** every successful write (only `POST` exists in v1; a thrown
  transaction never bumps). 60s TTL backstop. Domain events never drive
  invalidation; the cache is never in the event path and the event path is
  never in the read path.
- **Failure mode:** fail-open on any cache error (direct loader; the fallback
  never writes, never throws). Decrypt + assemble DTOs + order newest-first
  **after** every hit. `decode`/`cacheable` reject any non-`enc.v1.` entry so
  plaintext can never land in Redis.

## Code Style

Kernel copy, thin layers — the service owns authz + encrypt/decrypt, the cache
adapter only pins the `feedback` namespace over `@life/cache`:

```typescript
async findAll(sub: string): Promise<FeedbackDto[]> {
  const rows = await this.cache.getThrough(sub, 'feedback:list', async () => {
    const found = await this.feedback.find({
      where: { ownerSub: sub }, order: { createdAt: 'DESC', id: 'DESC' },
    });
    return found.map(toCachedRow); // description stays an enc.v1. envelope
  }, { decode: decodeCiphertextList, cacheable: (r) => r.every(isCiphertextRow) });
  const dek = await this.readDek(sub, rows);
  return rows.map((row) => toDto(row, sub, dek)); // decrypt + assemble after the hit
}
// Every write ENDS with await this.cache.bumpGeneration(sub);
```

## Testing Strategy

Unit + integration suites. The NOTIFY/LISTEN path needs a real Postgres and
cannot be faked (`pg-mem` does not implement NOTIFY faithfully) — tests run
against a throwaway database via `FEEDBACK_TEST_DB_URL` (created per run, never
a data directory):

1. Idempotency: same `id` twice → one `feedback` row, one `feedback_event` row,
   both calls `201 { id }`; another owner's `id` → `404`.
2. Transactional log: insert commits → trigger fires (real LISTEN receives
   `seq`+`event_id`); rolled-back insert → no notification.
3. Dispatcher: notify → publish (fake AMQP sink recording confirms) → cursor
   advances; restart replays `seq > cursor` in order; replayed `event_id`
   dedups on the consumer fake.
4. Ciphertext assertion (note-service pattern): raw `description` column and
   every cached value contain `enc.v1.` and no known plaintext; event rows and
   message bodies contain neither plaintext nor ciphertext description.
5. Cache: gen-bump invalidation after write, fail-open with a broken client,
   read path without `REDIS_URL` (direct DB).
6. Health: `/health/live` 200 with the DB down; `/health/ready` 503 on DB down
   or missing key custody; `/health` aliases readiness.
7. Dropped-notification reconciliation: advance the log without notifying
   (missed NOTIFY, no reconnect) → the reconciliation tick publishes the missed
   event and advances the cursor, in order, with `event_id` dedup on the
   consumer.

Max 2 test executions per verification (project profile).

## Boundaries

- Always: kernel contracts as written (global guard + whitelist pipe, 404 for
  foreign/missing, health dialect); content encrypted (`enc.v1.` only in
  cache/DB); cursor advance only after broker confirm; tests before commits.
- Ask first: any HTTP/DTO/event-body shape change (map-locked); any new table
  or column; a second RabbitMQ instance; changing the trigger channel.
- Never: a polling selector over business rows; plaintext or ciphertext
  description in events/logs/cache; tag names or any per-app visual concern
  (service owns no UI); SQL content matching over encrypted columns;
  production deploy or production data migration — those are hard-line
  human-run steps (compose wiring and the run checklist are documented by the
  infra/plan chapters; this spec plans nothing that executes them).

## Traceability (locked intent decision → section)

| Intent decision | Spec section |
|---|---|
| 1 Contracts (BE → cache → DB, own Redis, `enc.v1.`) | `## Cache Rules`, `## Data model`, `## Boundaries` |
| 2 Postgres for feedback-service (SQLite is premature-state) | `## Data model`, `## Commands` (`FEEDBACK_DB_URL`) |
| 3 Event durability = tx log + push, no polling selector | `## Event stream` (explicit rejection restated) |
| 4 Distribution = RabbitMQ (`feedback` / `feedback.submitted` / confirms) | `## Event stream` §§3–4, map event contract |
| 5 Dedup / exactly-once effect (`id` key, `event_id` UNIQUE) | `## Data model` (Idempotency), `## Event stream` (guarantees) |
| 6 Replay `seq > cursor` | `## Event stream` §5 + `feedback_cursor` |
| 7 Cache (read-through + gen counter + TTL + fail-open) | `## Cache Rules` |
| 8 Broker + Postgres earn their place (cross-chapter, lesson 0012) | This spec + `MAP-feedback.md`; not re-argued |
| 9 Postgres-only backup/restore | `feedback-infra` module spec (not here) |
| Owner boundary (`principal.sub`) | `## API / DTO contract`, `## Data model` |

## Success Criteria

- [ ] `POST /api/feedback` persists one row + one event in one transaction; a retry
  with the same `id` is a no-op `201 { id }` with no second event.
- [ ] Each commit emits exactly one NOTIFY on `feedback_events`; each notify
  yields exactly one confirmed publish to `feedback` / `feedback.submitted`.
- [ ] Dispatcher restart replays every missed event in `seq` order; redelivery
  dedups on `event_id` (at-least-once delivery, exactly-once effect).
- [ ] `GET /api/feedback` returns the owner's entries newest-first; no plaintext
  or ciphertext description exists outside Postgres + the request path.
- [ ] Typecheck + the seven test groups green within the 2-run limit; no file
  outside this spec touched.

## Open Questions

None — the intent is confirmed and the map locks the interfaces. The consumer
service, SQLite↔Postgres reconciliation, and status workflow are out of scope
(map + intent Out of scope).
