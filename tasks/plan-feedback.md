# Implementation Plan: feedback (feedback-infra → feedback-service → feedback-ui)

Branch: `feat/app-feedback` (`master` stays untouched; never merged without the user's
explicit request). Module ids: `feedback-infra`, `feedback-service`, `feedback-ui`
(see `docs/specs/MAP-feedback.md`, build order locked there).
Specs (referenced by every task): `docs/specs/SPEC-feedback-infra.md`,
`docs/specs/SPEC-feedback-service.md`, `docs/specs/SPEC-feedback-ui.md`.
Intent: `docs/intent/feedback-service.md` (CONFIRMED — locked decisions consumed,
never re-litigated). Ledger: `tasks/todo-feedback.md`.
Research evidence: `docs/research/big-app-feedback-patterns.md`.

Prior decisions read before planning (lesson 0012): `docs/intent/architecture.md`
("Multi-host orchestration (k8s, service mesh, message brokers) until a real need shows
up", the SQLite posture, and "each new piece … must earn its place"),
`docs/intent/redis-shared-state.md` decision 3 (one instance per service, never shared),
`docs/specs/MAP-redis.md`, `docs/specs/SPEC-db-backup-restore.md` (the SQLite backup
contract the PG variant mirrors), lessons 0003/0005/0006/0010/0011/0012/0014/0016/0018.

Process: global protocol §3 (testing policy), §5 (mandatory task template), §6
(plan-validation gate), §7 (review), §7.6 (five-lane for feature work). Every task is in
§5 template form in the ledger. Test runs are targeted, named files only, max 2
executions per verification; no full suite. Exactly ONE targeted e2e run in the whole
chapter (T14). The five-lane gate (T15) is five parallel subagent lanes, not a shell
command.

## Overview

Three modules in map dependency order, vertically sliced:

1. `feedback-infra` — `postgres` + `rabbitmq` + `redis-feedback` compose services (named
   volumes, healthchecks; `postgres`/`rabbitmq` published host-loopback on
   `127.0.0.1:5432:5432`/`127.0.0.1:5672:5672`, `redis-feedback` internal-only) and a
   PostgreSQL-only backup/restore pair in
   `@life/db` (`db:backup:pg` / `db:restore:pg`, `PgRunner` seam, fake-runner unit tests,
   throwaway-container integration suite skipped when Docker is absent).
2. `feedback-service` — new NestJS workspace `apps/feedback-service` (kernel copy):
   owner-scoped `POST /api/feedback` + `GET /api/feedback` (BE → `@life/cache`
   read-through → Postgres), `enc.v1.` at rest via `@life/crypto`, transactional
   `feedback_event` change log + `AFTER INSERT` `pg_notify` trigger + persistent `LISTEN`
   dispatcher + 60s reconciliation tick → durable RabbitMQ exchange `feedback`, routing
   key `feedback.submitted`, publisher confirms.
3. `feedback-ui` — `@life/ui` blocks `FeedbackForm` + `FeedbackNavItem` (spec-first
   upstream), `/feedback` top-level app in `apps/app` (own PWA identity, lesson 0005)
   hosting the owner inbox grouped app → type, newest-first, and the toolbar item in the
   Notes/Todos/Feedback toolbars.

Governing docs are reconciled FIRST (T1) so the broker/Postgres decision is recorded as
a deliberate cross-chapter change before any code lands (intent 8, lesson 0012).

## Architecture Decisions

Locked by the confirmed intent/map — traced here, not re-decided:

- **A1 (intent 2):** feedback-service is the first Postgres-backed service; the existing
  four services stay on SQLite. → `SPEC-feedback-infra` compose additions,
  `SPEC-feedback-service` data model.
- **A2 (intent 3):** event durability = transactional change log + push. `feedback` +
  `feedback_event` insert in ONE Postgres transaction; `AFTER INSERT` trigger issues
  `pg_notify('feedback_events', …)` delivered only on commit; persistent `LISTEN`
  dispatcher; 60s reconciliation tick over `feedback_event` by `seq` cursor as the
  backstop. A `SELECT … WHERE dispatched_at IS NULL` relay over business rows is
  rejected. → `SPEC-feedback-service` §Event stream.
- **A3 (intent 4):** distribution = RabbitMQ, open AMQP 0-9-1, self-hosted. Durable
  topic exchange `feedback`, routing key `feedback.submitted`, persistent messages,
  publisher confirms. BullMQ rejected. → `SPEC-feedback-infra`, `SPEC-feedback-service`.
- **A4 (intent 5):** client-supplied idempotency key (`feedback.id` PK) + `event_id`
  UNIQUE → one row, one event; at-least-once delivery, exactly-once effect via consumer
  dedup on `event_id`. Repeat of an owned `id` is a no-op `201 { id }`; `409` never
  emitted.
- **A5 (intent 6):** replay = bounded ordered change-log read `WHERE seq > :last_seq
  ORDER BY seq ASC LIMIT <batch>` from the persisted `feedback_cursor` singleton; never
  a business-row scan.
- **A6 (intent 7, Contract 2):** read-through cache on `redis-feedback` (its own
  instance, per-service isolation — lesson 0011), key `feedback:<owner_sub>:v<gen>:list`,
  per-owner generation counter bumped after successful writes, 60s TTL backstop,
  fail-open. Cached values are ciphertext rows as persisted; decrypt + assemble DTOs
  after every hit. Events never drive cache invalidation; event path never in read path.
- **A7 (intent 9):** Postgres-only backup/restore in `@life/db` mirroring the SQLite
  contract (`backup/<UTC-stamp>/`, `manifest.json`, `--pin`/`--only`/`--from`, newest-10
  routine retention via the shared `pruneRoutineSnapshots`, deliberate/pre-restore never
  pruned, `PINNED` marker, non-interactive, exit codes 0/1/2, down-stack precondition,
  verified pre-restore snapshot). `pg_dump -Fc` + `pg_restore --list` replace
  `VACUUM INTO` + `quick_check`; every client runs INSIDE the container via the
  `PgRunner` seam (host has no `psql`/`pg_dump`).
- **A8 (map HTTP/wire locks):** `@Controller('api/feedback')`; prod/container port `3008`,
  dev port `3108` (dev wiring per P1); internal-only in compose — no published host
  port, like note/tags/todo; `FEEDBACK_API_URL` names the app-side base URL (default
  `http://127.0.0.1:3008`);
  `POST` body `{ id, app, type, title, description }` (owner from `principal.sub`); validation
  failures `400` only; `GET` returns a bare `FeedbackDto[]` newest-first;
  wire types live in `@life/shared` (`FeedbackApp`, `FeedbackType`, `FeedbackDto`,
  `CreateFeedbackInput`, `FeedbackSubmitResult`, `FEEDBACK_DESCRIPTION_MAX = 2000`,
  `FEEDBACK_TITLE_MAX = 200`) — one home, never redeclared. The `title` field supersedes this
  lock's original description-only body: the Phase 6 title amendment (2026-10-15, intent
  decision 10) carries the change in T16–T21.
- **A9 (intent 8, lesson 0012):** `docs/intent/architecture.md`'s no-brokers/SQLite
  lines and `docs/specs/MAP-redis.md` are revised deliberately as a recorded
  cross-chapter decision (T1), before infra code.

Decisions taken in planning (recorded here so no task re-opens them silently):

- **P1 — dev/e2e wiring + fallback story.** Confirmed ports: feedback-service binds `3008`
  (prod/container default) and runs on `3108` in dev. Dev wiring mirrors tags/todo exactly:
  the root `dev` script gains `"PORT=3108 npm run dev -w apps/feedback-service"` (compare tags
  `PORT=3104`, todo `PORT=3105`) and `.env.development.example` gains
  `FEEDBACK_API_URL=http://127.0.0.1:3108` (compare `TODO_API_URL=http://127.0.0.1:3105`). Dev
  therefore needs a reachable Postgres and RabbitMQ plus `FEEDBACK_MASTER_KEY` in
  `.env.development`: `FEEDBACK_DB_URL=postgresql://feedback:<password>@127.0.0.1:5432/feedback`
  and `RABBITMQ_URL=amqp://feedback:<password>@127.0.0.1:5672` (the compose `postgres`/`rabbitmq`
  host-loopback publishes), and the service refuses to boot without the DB URL + master key
  (service spec); the local bring-up is `docker compose up -d postgres-feedback rabbitmq-feedback`, documented
  in README by T10. Redis stays optional in dev: cache fail-open is the spec's own failure
  mode (broker-down reconnect/backoff still covers transient broker loss). The e2e harness starts a throwaway Postgres container (`docker run --rm`, the
  `pg-integration.test.ts` pattern), waits for `pg_isready`, and passes `FEEDBACK_DB_URL` to
  the spawned feedback-service — on the harness's own port scheme (31xx/32xx per
  `apps/app/test/e2e/config.ts`; 3008/3108 never enter the harness). The e2e runs NO RabbitMQ
  and NO Redis: broker-down tolerance covers the event path, so the e2e proves the HTTP/UI path
  while the service suites (fake AMQP sink) prove the event path. This supersedes the earlier
  "dev runs with zero Postgres" reading and is the only reading consistent with the confirmed
  port decision and both specs.
- **P2 — compose split.** T2 owns only `postgres`/`rabbitmq`/`redis-feedback` +
  volumes + the two password names in `.env.example`. The `feedback-service` compose
  block (with the `FEEDBACK_DB_URL`/`RABBITMQ_URL` injection, healthy-`depends_on`,
  `FEEDBACK_MASTER_KEY` fail-fast, `REDIS_URL: redis://redis-feedback:6379`, the verifier
  pair `IDP_ISSUER: ${IDP_ISSUER:-}` +
  `FEEDBACK_IDP_JWKS_URL: ${FEEDBACK_IDP_JWKS_URL:-http://idp:3003/jwks}` (the copied
  verifier throws without `IDP_ISSUER` — fail closed)), the
  Dockerfile, the app-side `FEEDBACK_API_URL`, dev wiring, and README land in T10 after
  the workspace exists — the tags/todo T9 precedent (dev wiring posture: P1; compose
  prod value `FEEDBACK_API_URL: http://feedback-service:3008`). The service stays
  internal-only (no published host port), like note/tags/todo. (Last chapter's five-lane
  HIGH was the compose app missing service URLs.)
- **P3 — new dependencies.** `pg` (TypeORM Postgres driver, T7) and `amqplib` +
  `@types/amqplib` (T9) are the only new runtime dependencies — the service spec's
  allowance, forced by locked decisions 2/4. Lockfile via `npm install` only.
- **P4 — UI is spec-first upstream.** `FeedbackForm`/`FeedbackNavItem` and the
  `ListShell` optional-fab fix land in `packages/ui` with `SPEC-ui-list-shell.md` AND
  `MAP-ui-primitives.md` updated in the same change (Contract 1 Rule 3 — the map row is
  required for a new component; SPEC-feedback-ui's structure list names only the spec)
  before `apps/app` consumes them. `@life/ui` gains a types-only `@life/shared`
  dependency edge (one line) so the wire union is never triplicated.
- **P5 — vertical slices, one concern per task.** The service is built as kernel (T7) →
  feedback API slice (T8) → event slice (T9) → tests + wiring (T10); the UI as blocks
  (T11) → route + inbox (T12) → toolbar + PWA (T13) → e2e (T14). No horizontal
  "all DB then all API" phase.

## Task List

### Phase 1 — Governing docs (cross-chapter reconciliation, lesson 0012)
- [ ] T1: revise `docs/intent/architecture.md` (no-brokers / SQLite lines) + `docs/specs/MAP-redis.md` (add `redis-feedback`)

### Checkpoint: Governing docs
- [ ] `grep -n "feedback" docs/specs/MAP-redis.md` non-empty; architecture.md records the
      feedback chapter as the need Postgres + the broker earned their place against.

### Phase 2 — feedback-infra
- [ ] T2: `compose.yaml` — `postgres` + `rabbitmq` + `redis-feedback` (named volumes, healthchecks, `postgres`/`rabbitmq` published host-loopback on `127.0.0.1:5432:5432`/`127.0.0.1:5672:5672`, `redis-feedback` internal-only) + `.env.example` secret names
- [ ] T3: `@life/db` — `PgRunner` seam (`pg-client.ts`: compose/docker runners, URL parsing, dump/verify/count helpers)
- [ ] T4: `@life/db` — `db:backup:pg` (`runBackupPg` + thin CLI + fake-runner unit suite + root/workspace scripts)
- [ ] T5: `@life/db` — `db:restore:pg` (`runRestorePg` + thin CLI + fake-runner unit suite + throwaway-container integration suite + scripts)

### Checkpoint: Infra up
- [ ] `docker compose config` shows the three new services with named volumes, healthchecks,
      and published ports only on host loopback (`127.0.0.1:5432:5432`, `127.0.0.1:5672:5672`;
      `redis-feedback` publishes none).
- [ ] `docker compose up -d postgres-feedback rabbitmq-feedback redis-feedback` → all healthchecks green (tech lead, once).
- [ ] `npm run typecheck -w packages/db` clean; `backup-pg`/`restore-pg` unit suites green; `pg-integration` green or Docker-absent-skipped.

### Phase 3 — feedback-service
- [ ] T6: `@life/shared` — feedback wire types (`FeedbackApp`, `FeedbackType`, `FeedbackDto`, `CreateFeedbackInput`, `FeedbackSubmitResult`, `FEEDBACK_DESCRIPTION_MAX`)
- [ ] T7: `apps/feedback-service` — kernel-copy scaffold (main/app.factory/app.module, AuthGuard, ValidationPipe, health, keys custody)
- [ ] T8: feedback API slice — entity, DTO, controller (`POST`/`GET /api/feedback`), service, read-through cache, `enc.v1.` at rest
- [ ] T9: event slice — `feedback_event`/`feedback_cursor` entities, boot-ensured NOTIFY trigger DDL, LISTEN dispatcher + cursor, RabbitMQ publisher (`amqplib`)
- [ ] T10: service test suites (the spec's seven groups) + Dockerfile + compose `feedback-service` block + env/dev-script/README wiring

### Checkpoint: Service API + event proven
- [ ] `POST` persists one row + one event in one transaction; duplicate `id` → same `201 { id }`, no second event.
- [ ] Notify → publish → cursor advance proven with a fake AMQP sink; restart replay + dropped-NOTIFY tick proven against a throwaway Postgres.
- [ ] Cached values contain `enc.v1.` and no known plaintext; health dialect green.
- [ ] `docker compose config` shows `FEEDBACK_DB_URL`/`RABBITMQ_URL` injected into `feedback-service` with healthy `depends_on`.

### Phase 4 — feedback-ui
- [ ] T11: `@life/ui` — `FeedbackForm` + `FeedbackNavItem` + `ListShell` optional fab (+ `SPEC-ui-list-shell.md`/`MAP-ui-primitives.md`, tests, `@life/shared` types-only edge)
- [ ] T12: `apps/app` — `lib/feedback-api.ts` + `feedback-actions.ts` + `/feedback` route (layout + page + inbox grouping) + inbox suite
- [ ] T13: toolbar item in Notes/Todos+lenses/Feedback + PWA identity (`manifest-feedback.json`, `icon-feedback.png`, gate allowlist) + manifest/gate suites
- [ ] T14: e2e harness gains feedback-service + `feedback.spec.ts` + the ONE targeted e2e run

### Checkpoint: UI end-to-end + Contract mechanical checks
- [ ] The one targeted e2e passed (T14).
- [ ] `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'` → zero hits outside Rule-1 exemptions.
- [ ] `grep -rn "next/link" apps --include='*.tsx'` → zero hits.
- [ ] `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → hits only inside `packages/ui/src/styles/tokens.css`.
- [ ] `grep -riE "note|trash|tag-chip" packages/ui/src` → zero hits in code (CSS mapping-table comments exempt).
- [ ] `grep -rln "getThrough" apps/*/src` → feedback-service read flow goes through the read-through cache.
- [ ] `grep -rn "## Cache Rules" docs/specs/SPEC-feedback-*.md` → present (service) / recorded N/A (infra, ui).
- [ ] `git diff` shows zero changes to `manifest-notes.json`, `manifest-todos.json`, `viewport.themeColor`, `icon.svg`, and the frozen e2e selector surface.
- [ ] Existing affected suite green unchanged: `npm run test:unit -w @life/app -- test/routes-todos-list.test.tsx` (it asserts the Notes/Todos nav aria-labels T13 edits — SPEC-feedback-ui Success 6 "existing suites unchanged and passing").

### Phase 5 — Close
- [ ] T15: five-lane verification gate (§7.6) → report; merge awaits the user's explicit request

### Checkpoint: Complete
- [ ] Five lanes N/N PASS; all acceptance criteria met; merge human-gated.

### Phase 6 — Feedback title (2026-10-15 amendment, intent decision 10)

Design input (landed **before** this phase, as the Tech Lead's spec-first artifact):
`docs/intent/feedback-service.md` (outcome + locked decision 10) and the three specs —
`MAP-feedback.md` (POST body, `FeedbackDto`, `CreateFeedbackInput`, `FEEDBACK_TITLE_MAX`),
`SPEC-feedback-service.md` (data-model column + per-field AAD, API/DTO, cache row, test group 4,
traceability), `SPEC-feedback-ui.md` (form field + ordered validation + frozen strings, inbox
row mapping, tests). These tasks implement them and add no spec text.

- [ ] T16: `@life/shared` — `FEEDBACK_TITLE_MAX` (= 200) + `title` on `FeedbackDto` / `CreateFeedbackInput`
- [ ] T17: `apps/feedback-service` — `title` column (`enc.v1.`, AAD `life.v1|<sub>|feedback|title|<id>`), DTO (`@IsNotEmpty` + `@MaxLength(FEEDBACK_TITLE_MAX)`), encrypt + decrypt **both** fields, cache row guard covers `title`; service suites
- [ ] T18: `@life/ui` — `FeedbackForm` title `Input` above the description + ordered validation (`errorField`) + frozen strings; form suite
- [ ] T19: `apps/app` — inbox row renders `title` + `snippet`; inbox suite
- [ ] T20: e2e — `feedback.spec.ts` gains the title step + the ONE targeted e2e run
- [ ] T21: five-lane verification gate (§7.6) → report

### Checkpoint: Title amendment
- [ ] `FeedbackDto` / `CreateFeedbackInput` carry `title`; `FEEDBACK_TITLE_MAX` = 200 exported from `@life/shared`.
- [ ] The raw `title` column and every cached row hold `enc.v1.` envelopes; no plaintext **or ciphertext** title exists in `feedback_event` rows or published message bodies.
- [ ] The form refuses a blank title (`'Title is required.'`, **no** request) and, with a title present, a blank description (`'Description is required.'`).
- [ ] The inbox renders the title line with the description beneath it (`ListItem` `title` + `snippet`).
- [ ] Pre-amendment rows (no `title`) **fail closed** on read; there is no production backfill — the dev-only remedy is dropped-and-resynced (see risk row).
- [ ] The one targeted e2e passed (T20).

## Ordered index (tasks in `tasks/todo-feedback.md`)

| # | Task | Module | Depends on | Size |
|---|---|---|---|---|
| T1 | Governing-docs reconciliation (architecture.md, MAP-redis.md) | feedback-infra (cross-chapter) | — | S |
| T2 | compose `postgres` + `rabbitmq` + `redis-feedback` + `.env.example` names | feedback-infra | T1 | S |
| T3 | `@life/db` `PgRunner` seam (`pg-client.ts`) | feedback-infra | T2 | M |
| T4 | `@life/db` `db:backup:pg` + CLI + unit suite + scripts | feedback-infra | T3 | M |
| T5 | `@life/db` `db:restore:pg` + CLI + unit + Docker integration suites + scripts | feedback-infra | T4 | M |
| T6 | `@life/shared` feedback wire types | feedback-service | T1 | S |
| T7 | `apps/feedback-service` kernel-copy scaffold | feedback-service | T6 | L (scaffold copy) |
| T8 | feedback API slice (POST/GET + cache + `enc.v1.`) | feedback-service | T7 | M |
| T9 | event slice (trigger DDL + LISTEN dispatcher + RabbitMQ publisher) | feedback-service | T8 | M |
| T10 | service suites (seven groups) + Dockerfile + compose/env/dev-script/README wiring | feedback-service | T9 | M |
| T11 | `@life/ui` `FeedbackForm` + `FeedbackNavItem` + optional-fab `ListShell` | feedback-ui | T6 | M |
| T12 | `apps/app` BFF + server action + `/feedback` route + inbox | feedback-ui | T11 | M |
| T13 | toolbar integration + PWA identity + manifest/gate suites | feedback-ui | T12 | M |
| T14 | e2e harness + `feedback.spec.ts` + ONE targeted e2e run | feedback-ui | T13, T10 | M |
| T15 | five-lane gate (§7.6) | close | T14 | M |
| T16 | `@life/shared` — `FEEDBACK_TITLE_MAX` + `title` fields | feedback-service | — | S |
| T17 | service — `title` column + DTO + encrypt/decrypt both + suites | feedback-service | T16 | M |
| T18 | `@life/ui` — title `Input` + ordered validation + form suite | feedback-ui | T16 | S |
| T19 | `apps/app` — inbox `title` + `snippet` + suite | feedback-ui | T16 | S |
| T20 | e2e — title step + ONE targeted e2e run | feedback-ui | T19 | S |
| T21 | five-lane gate (§7.6) | close | T20 | M |

## Parallelization

T11 ∥ T7–T10 is dependency-safe (T11 needs only T6); execution stays sequential under
single-agent review/commit discipline (global protocol §1) unless a time constraint
forces parallel subagents. Everything else is a strict chain per the index.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| First Postgres + RabbitMQ in the stack (a new infra class: images, volumes, healthchecks, backup semantics) | High | Stock images only; healthcheck-gated `depends_on`; published host-loopback only (`127.0.0.1:5432`/`127.0.0.1:5672`), Redis instances internal-only; the PG backup/restore pair is proven by unit + throwaway-container integration suites (T4/T5) before the service relies on the store; restore fails closed on an up/unknown probe. |
| Postgres NOTIFY is transient — dropped on disconnect or listener-queue overflow | Med | The `feedback_event` table (addressed by `seq` cursor) is the source of truth; the 60s reconciliation tick replays `seq > last_seq` until caught up (A2); service test group 7 proves a dropped notification is republished in order with `event_id` dedup. |
| `@life/ui` → `@life/shared` is a new dependency edge | Med | Types-only, one line in `packages/ui/package.json`; jest `moduleNameMapper` mirrors the existing `@life/*` source-resolution pattern; `npm run typecheck -w @life/ui` and `-w @life/app` gate it; shared never imports ui (no cycle). |
| Docker-dependent tests (`pg-integration.test.ts`, feedback-service suites, the e2e harness's throwaway Postgres) | Med | Unit/integration suites are skipped, not failed, when Docker is absent (infra spec); the e2e fails fast with a clear message (it is the chapter's final proof — a silent skip would hide it); fake-runner unit tests never touch Docker. T17's pre-title rows are a brand-new table (`feedback` ships with T8), so no production backfill exists; the only hazard is a **local dev Postgres already holding `feedback` rows from testing** — in that case `synchronize` cannot turn `title` NOT NULL against old rows, and the fix is documented as dropped-and-resynced (dev-only, never a data directory). |
| `title` is a map-locked wire-contract change (Phase 6) | Low | The `## Boundaries` "Ask first" clause is satisfied by the user's explicit answer ("Required title"); the authorization is recorded in the intent's decision 10, `MAP-feedback.md`, both specs, and this plan. |
| e2e harness must launch feedback-service + a throwaway Postgres | Med | T14 mirrors the `pg-integration.test.ts` container pattern and the existing `spawnService`/`waitForHttp` harness; the app gets `FEEDBACK_API_URL`; `REDIS_URL` unset (fail-open → direct DB) and no RabbitMQ (spec'd broker-down tolerance); teardown force-removes the container. |
| `amqplib` is a new runtime dependency | Low | Forced by locked decision 4; publisher sits behind a small interface so tests use a fake AMQP sink recording confirms; lockfile via `npm install` only. |
| Frozen surfaces (e2e selectors, token values, existing PWA constants) | Med | New selectors and new files only; T13 asserts zero diff to `manifest-notes.json`/`manifest-todos.json`/`viewport.themeColor`/`icon.svg`; the Contract mechanical-checks checkpoint re-runs every grep before the gate. |
| Cross-chapter invariant drift (architecture.md's no-brokers/SQLite posture silently overwritten) | High | T1 reconciles the governing docs FIRST and records the revision as the deliberate cross-chapter decision (lesson 0012); the validation gate checks the plan against it. |
| Dev posture drift (feedback-service needs Postgres + `FEEDBACK_MASTER_KEY` under dev) | Med | P1 recorded: the root `dev` script starts feedback-service on 3108 (tags/todo pattern) and `.env.development.example` gains `FEEDBACK_API_URL=http://127.0.0.1:3108`; README (T10) documents bringing up the local Postgres (compose `postgres`) + setting `FEEDBACK_DB_URL`/`FEEDBACK_MASTER_KEY` before `npm run dev`. |

## Open Questions

None blocking. The `rabbitmq:4.1-alpine` minor tag is confirmed against Docker Hub at
T2 implementation time (infra spec Open Questions); the human-run hard-line checklist
(production deploy, crontab install for `db:backup:pg`) lives in `SPEC-feedback-infra`
and is executed by the human, never the agent.
