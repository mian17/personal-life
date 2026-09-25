# Implementation Plan: per-service Redis (shared state + cache)

Traces to: `docs/specs/MAP-redis.md` + module specs `SPEC-app-state.md`,
`SPEC-idp-cache.md`, `SPEC-note-cache.md`. Tasks recorded in `tasks/todo-redis.md`.

## Overview

Three modules retrofit shared-state/cache onto the existing services, each behind its
own Redis endpoint, selected by one env var (`REDIS_URL`) per service. Unset means
today's behavior byte-for-byte — dev and e2e stay Redis-free. Nothing changes for the
human's `.env`; compose injects the three Redis URLs.

## Architecture Decisions

1. **Client: `redis` (node-redis)** — the officially maintained client (ioredis is
   maintenance-mode; its own npm page directs new projects to node-redis — verified
   2026-09-25 against redis.io + npm guidance). `createClient`/`createCluster` share one
   command surface, so real Redis Cluster is a deploy-time swap. Installed in each
   service separately (no shared package — ~40 lines of wrapper duplicated beats a
   coupling point between independently evolving services). Built-in TS types.
2. **One Redis instance per service** (`redis-app`, `redis-idp`, `redis-note`), internal
   network only, **no published host ports**; image pinned to `redis:8-alpine` (current
   stable major). Not logical-DB-separated: Redis Cluster has
   only DB 0, so per-instance ownership is the only cluster-ready topology.
3. **Asymmetric failure semantics (deliberate):** `app-state` fails **closed** (Redis
   error → no session → login wall; never per-instance fallback — that is split-brain);
   caches fail **open** (error → DB read; degraded, never wrong).
4. **Refresh lock TTL > 30s** (the OIDC client's abort bound), `SET NX EX`, keyed
   `app:lock:refresh:<id>`. The in-process single-flight map stays as the fast path above
   it. Losers of the lock never present a refresh token — they wait for the winner's
   rotated tokens or return `undefined`.
5. **note-cache invalidation = generation bump** (`INCR note:gen` before each write's DB
   mutation; all keys embed the generation). One atomic op per write, no `KEYS`/`SCAN`,
   and a write landing mid-query cannot be masked (populate only if generation unchanged).
6. **Persistence split:** `redis-app` runs AOF + named volume (sessions survive restarts);
   `redis-idp`/`redis-note` run LRU + **no persistence** (caches — note content must not
   hit a second disk).
7. **Hop proof is a real two-instance e2e** (`test/e2e/hop.spec.ts`, two app instances +
   one IdP + one Redis, degraded-app double-boot pattern), **gated on `TEST_REDIS_URL`** —
   skipped in default runs so e2e stays zero-Redis. Test Redis is test-owned (ephemeral
   `docker run` on loopback); prod compose publishes nothing.

## Task List (index — details in `tasks/todo-redis.md`)

Phase 1 (foundation): Task 1 `app-state` store seam → **Checkpoint A**
Phase 2 (core): Task 2 refresh lock → Task 3 hop proof → **Checkpoint B**
Phase 3 (caches, parallel-safe): Task 4 `idp-cache` ∥ Task 5 `note-cache` → **Checkpoint C**
Phase 4 (ship): Task 6 `redis-deploy` wiring → Task 7 verification + human checklist

Build order rationale: `app-state` first (highest risk — distributed lock + fail-closed),
fail fast on the hard module; caches are independent and small.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Lock TTL < refresh duration → two refreshes → reuse detection revokes grant family | High | Lock TTL strictly > 30s client abort; cross-process lock test; hop e2e asserts one refresh |
| Sliding-TTL semantics drift between in-memory and Redis impls | High | One contract suite runs against both implementations (injected clock) |
| Stale cache masks a concurrent write | Med | Generation re-check before populate (SPEC-note-cache stale-guard test) |
| Sensitive data in Redis (argon2 hash, note bodies) | Med | Internal-only, no host ports, caches unpersisted, values never logged; posture is a hard line in both specs |
| Fake/real Redis divergence in tests | Med | `TEST_REDIS_URL`-gated tests against real Redis + compose-provided instances |
| Compose churn disrupts the running stack | Med | Additive services only; `docker compose config -q` + build gate; human deploy checklist |
| E2E suite count changes break acceptance expectations | Low | 21 existing specs untouched; `hop.spec.ts` is skip-gated without `TEST_REDIS_URL` |

## Verification Checkpoints

- **A** (after Task 1): app unit green (74 + new contract tests), `REDIS_URL`-unset
  behavior identical (contract suite on in-memory impl).
- **B** (after Tasks 2–3): lock tests green (single + cross-process); one scoped
  `npx playwright test test/e2e/hop.spec.ts` run with test Redis (E2E authorization:
  spec is authored by this chapter — one run, per AGENTS.md).
- **C** (after Tasks 4–5): idp (81+) and note (25+) suites green sequentially.
- **Final** (Task 7): full suites sequential + `npm run lint` + `docker compose config -q`
  + `life.db` md5 `31767e4d…` unchanged.

Test-execution budget (AGENTS.md cost control): targeted unit tests per task (max 2 runs
each), full workspace suites only at checkpoints, e2e only the one scoped hop run.

## Open Questions

None. Resolved 2026-09-25 at implementation kickoff: client = `redis` (node-redis),
installed into the three service `package.json`s as one atomic lockfile write
(see architecture decision 1).
