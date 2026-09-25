# Capability Map: per-service Redis

Traces to intent: `docs/intent/redis-shared-state.md` (2026-09-25).
Status: **boundaries approved** 2026-09-25 — module responsibilities, dependency
direction, and build order confirmed line-by-line in the interview restate.

| Module id | Responsibility | Depends on |
|---|---|---|
| `app-state` | `apps/app` session state moves behind the existing store seam onto its own Redis; adds the cross-replica refresh lock. Dev/e2e keep the in-memory store | — |
| `idp-cache` | `apps/idp` gets a read-through cache in front of its users table (login-path lookups), invalidated on user writes. Rotating OIDC payloads are explicitly **not** cached | — |
| `note-cache` | `apps/note-service` gets a read-through cache for its read methods (list/trash/one/tags), invalidated by generation-bump on every write | — |
| `redis-deploy` | Three internal-only Redis services in `compose.yaml` (one per service), env wiring, integration-test seam (`TEST_REDIS_URL`) | `app-state`, `idp-cache`, `note-cache` |

Build order: `app-state` first (highest risk: distributed refresh lock + fail-closed
semantics), then `idp-cache` ∥ `note-cache` (independent, parallel-safe), with
`redis-deploy` wiring landing alongside and closing with the integration proof.

Module shape: no new processes — all three modules are retrofits inside existing
services. `redis-deploy` is compose + env + test-harness only. Each service reads exactly
one env var (`REDIS_URL`), pointing at its own Redis instance; unset means today's
behavior (in-memory / direct-DB), which is how dev and e2e stay Redis-free.

Build-order constraint: nothing may merge that changes behavior with `REDIS_URL` unset —
the daily driver and the existing suites (app 74 unit / 21 e2e specs, idp 81, note 25)
must stay green untouched. Data hard line: `apps/note-service/data/life.db` never changes.
