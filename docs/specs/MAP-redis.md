# Capability Map: per-service Redis

Traces to intent: `docs/intent/redis-shared-state.md` (2026-09-25).
Status: **boundaries approved** 2026-09-25 — module responsibilities, dependency
direction, and build order confirmed line-by-line in the interview restate.

| Module id | Responsibility | Depends on |
|---|---|---|
| `app-state` | `apps/app` session state moves behind the existing store seam onto its own Redis; adds the cross-replica refresh lock. Dev/e2e keep the in-memory store | — |
| `idp-cache` | `apps/idp` gets a read-through cache in front of its users table (login-path lookups), invalidated on user writes. Rotating OIDC payloads are explicitly **not** cached | — |
| `note-cache` | `apps/note-service` gets a read-through cache for its read methods (list/trash/one/tags), invalidated by generation-bump on every write | — |
| `tags-cache` | `apps/tags-service` gets a read-through cache for its own tag rows, invalidated by generation-bump on every write | — |
| `todo-cache` | `apps/todo-service` gets a read-through cache for its own reads, invalidated by generation-bump on every write | — |
| `feedback-cache` | `apps/feedback-service` gets a read-through cache for its own reads, invalidated by generation-bump on every write. Its `redis-feedback` instance is provisioned by the feedback chapter alongside the `postgres-feedback` + `rabbitmq-feedback` services (`SPEC-feedback-infra.md`) — **its own instance, never shared** (intent decision 3, lesson 0011), `REDIS_URL` as elsewhere | — |
| `meal-cache` | `apps/meal-service` gets the service's single namespace adapter over `@life/cache` (`src/cache/meal-cache.ts`) — a read-through cache for its food/entry/saved reads, invalidated by generation-bump on every write | — |
| `redis-deploy` | Seven internal-only Redis services in `compose.yaml` — one per service (`redis-app`, `redis-idp`, `redis-note`, `redis-tags`, `redis-todo`, `redis-meal`, `redis-feedback`) — **never shared** (intent decision 3) — env wiring, integration-test seam (`TEST_REDIS_URL`) | `app-state`, `idp-cache`, `note-cache`, `tags-cache`, `todo-cache`, `meal-cache`, `feedback-cache` |

Build order: `app-state` first (highest risk: distributed refresh lock + fail-closed
semantics), then `idp-cache` ∥ `note-cache` (independent, parallel-safe), with
`redis-deploy` wiring landing alongside and closing with the integration proof.

Module shape: no new processes — every cache module is a retrofit inside an existing
service. `redis-deploy` is compose + env + test-harness only. Each service reads exactly
one env var (`REDIS_URL`), pointing at its own Redis instance; unset means today's
behavior (in-memory / direct-DB), which is how dev and e2e stay Redis-free.

`todo-due-repeat-notify` note: `redis-todo` ownership is **unchanged** — the reminder
sweep still bumps the existing per-owner generation counter (through `TodosService`'s
`markReminded` seam) and adds no second Redis instance or cache module; the sweep's own
due-row query reads the DB directly (documented deviation, `SPEC-todo-service.md`), and
`push_subscription` is never cached.

Build-order constraint: nothing may merge that changes behavior with `REDIS_URL` unset —
the daily driver and the existing suites (app 74 unit / 21 e2e specs, idp 81, note 25)
must stay green untouched. Data hard line: `apps/note-service/data/life.db` never changes.
