# Intent: per-service Redis (shared state + cache)

Confirmed 2026-09-25 via interview (`interview-me`, explicit yes).
Build artifacts live in `docs/specs/` — map at `docs/specs/MAP-redis.md`.

## Outcome

Each backend service owns its state/cache via **its own Redis endpoint**, so any service
can scale to N replicas without a rewrite:

- **`app-state`:** session store + cross-replica refresh lock (state — there is no DB
  behind sessions; Redis *is* the store).
- **`idp-cache`:** read-through cache in front of the IdP DB (read-mostly lookups only).
- **`note-cache`:** read-through cache in front of the notes DB (reads hit, writes
  invalidate).

## User

Me — single user today. The payoff is replica-safe architecture and a k8s-shaped future.

## Why now

The vision (Kubernetes, many instances per service) is **someday**. The foundation is
implemented **now**, so scale-out becomes configuration, not a rewrite. The IdP chapter
made the per-instance state problem concrete (`globalThis` stores, the two-instance dev
harness, the refresh-race blocker found by the five-lane gate).

## Success

- Two app replicas + one Redis serve sessions that survive hopping replicas.
- idp/note cache reads hit; writes invalidate; cache down → still-correct results from DB.
- Dev and e2e run with **zero Redis** (in-memory backends); all suites stay green.

## Constraint

Single-host `docker compose` today: one Redis per service (cluster-ready clients —
real Redis Cluster is a deploy-time swap). No Redis in the dev workflow. Small and
boring wins; credential safety and data safety stay hard lines.

## Out of scope

Kubernetes manifests, real Redis Cluster mode, the SQLite→Postgres data-tier chapter
(`note-service` per-user boundary included), and **caching rotating grant/session/
interaction payloads anywhere** (they rotate or revoke on every use — stale = security
bug; hit rate ≈ 0).

## Decisions log

- 2026-09-25: **Cache-in-front for `idp-cache` and `note-cache`** (user's instinct,
  validated as the standard pattern): DB stays source of truth; fail-open to DB on cache
  loss — degraded, never wrong.
- 2026-09-25: **`app-state` is a store, not a cache.** Sessions have no DB behind them;
  Redis is the primary store with TTL = sliding session window. Fail-closed: with
  `REDIS_URL` set there is **no** in-memory fallback (split-brain is worse than a
  re-login).
- 2026-09-25: **One Redis instance per service, not shared, not logical-DB-separated.**
  Redis Cluster has only DB 0, so logical-DB isolation is not cluster-ready; per-instance
  ownership is. Cluster-mode clients from day one.
- 2026-09-25: **No shared cache package.** Each service keeps its own thin wrapper
  (~40 lines duplicated beats a coupling point between independently evolving services).
- 2026-09-25: The idp's cached login lookup includes the argon2 hash (verification needs
  it). Same exposure boundary as `idp.db`: internal-only Redis, no published port,
  values never logged.
