# Spec: `app-state` — Redis-backed app session state + refresh lock

Traces to: `docs/specs/MAP-redis.md`, `docs/intent/redis-shared-state.md`.

## Objective

`apps/app` replicas must behave like one service: a session created on replica A is
honored by replica B, and at most one token refresh happens per session across **all**
replicas (a cross-replica refresh race trips the IdP's rotation reuse detection and
revokes the grant family — the defect the five-lane gate found in-process). Dev/e2e keep
today's in-memory store; zero Redis in the dev workflow.

## Contract (the seam)

- The `SessionStore` public surface in `apps/app/lib/auth/session-store.ts` is the
  interface: `create / get / update / destroy / nowMs` (+ test aids `size / clear`).
  Semantics preserved **exactly**: 7-day sliding TTL (`SESSION_TTL_MS`), `get` slides the
  window, `update` patches tokens in place, expired sessions are gone.
- Two implementations: the existing in-memory `SessionStore` (default when `REDIS_URL`
  is unset) and a new `RedisSessionStore`. Selection happens **once at module init**
  (`createSessionStore()` reading `REDIS_URL`). Seam methods return `MaybePromise<T>`;
  callers in the auth layer thread `await` (Next middleware is async-capable) —
  **behavior** unchanged, signatures async where the seam is reached.
  ⚠️ **Auth-bypass trap (review finding 2026-09-25):** `middleware.ts`'s
  `Boolean(sessionStore.get(...))` must become `Boolean(await …)` — a bare Promise is
  always truthy and would let every request through. The gate tests must prove
  "no session → login redirect" after the retype.
- Redis record: JSON of `AppSession` at `app:sess:<id>`; key TTL tracks the sliding
  window and is re-extended on `get`. A record that fails JSON parsing is treated as
  absent (fail closed).
- **Refresh lock:** `app:lock:refresh:<id>` acquired with `SET NX EX`. The existing
  in-process single-flight map stays as the fast path *above* it in `getValidSession`;
  the lock sits inside `performRefresh`. Lock TTL must exceed the OIDC client's 30s
  abort. Contract: concurrent near-expiry requests across replicas cause **exactly one**
  refresh; losers never present a refresh token — they poll the session record (bounded
  by the same window) for the winner's rotated tokens, else return `undefined`.
- **Fail-closed:** with `REDIS_URL` set, any Redis error means "no session" (login wall)
  or a clean failure on login (no stack trace). There is **no** in-memory fallback —
  per-instance memory in prod is split-brain.

## Tech Stack

- `redis` (node-redis — the officially maintained client; chosen 2026-09-25 per redis.io
  and npm guidance: "for new projects, node-redis is the recommended client library";
  ioredis is maintenance-mode). `createClient`/`createCluster` share one command surface —
  cluster-ready by construction. Commands used: `GET SET (EX / KEEPTTL) DEL EXPIRE`.
- TypeScript, Next.js `server-only` module (tokens must never reach a client component).

## Commands

```
Unit:        npm run test:unit -w apps/app
Integration: TEST_REDIS_URL=redis://127.0.0.1:6379 npx vitest run test/redis-store test/redis-lock   (from apps/app)
Typecheck:   npm run lint
```

## Project Structure

```
apps/app/lib/auth/session-store.ts   → interface + in-memory impl (existing) + factory
apps/app/lib/auth/redis-store.ts     → RedisSessionStore (new)
apps/app/lib/auth/refresh-lock.ts    → lock abstraction (Redis / in-process passthrough)
apps/app/lib/auth/session.ts         → getValidSession composes fast path + lock (contract unchanged)
apps/app/test/redis-store.test.ts    → store contract vs in-memory (always) + Redis (TEST_REDIS_URL)
apps/app/test/redis-lock.test.ts     → one-refresh-per-session contract (cross-process via two lock clients)
apps/app/test/e2e/hop.spec.ts        → hop proof: TWO real app instances + one IdP + one Redis
apps/app/test/e2e/hop-app.ts         → boots app-A and app-B sharing REDIS_URL (degraded-app.ts pattern)
```

## Code Style

```ts
/** Selected once at module init: REDIS_URL set → shared store; unset → in-process. */
export function createSessionStore(): SessionStoreApi {
  const url = process.env.REDIS_URL;
  return url ? new RedisSessionStore(new Redis(url)) : new SessionStore();
}
```

Same conventions as the surrounding auth layer: `server-only`, dependency-injected
`store:` parameters for tests, every non-obvious edge case commented (see
`session.ts`'s single-flight comment as the house style).

## Testing Strategy

- One **contract suite** run against both implementations (sliding TTL with injected
  clock, update-patch, destroy, expiry) — proves the swap is behavior-identical.
- Lock tests: N concurrent `getValidSession` calls in one process → 1 refresh; simulated
  second process (second lock client) → still 1 refresh, loser returns winner's tokens.
- Fail-closed tests with an injected failing client: session ops → `undefined`, no throw
  past the auth layer.
- The hop proof (two app instances + one real Redis) runs **only** with `TEST_REDIS_URL`.
  With it unset everything above runs against the in-memory impl — dev stays Redis-free.

## Boundaries

- **Always:** fail closed on auth paths; `REDIS_URL`-unset behavior byte-identical to
  today; tests per slice; tokens stay `server-only`.
- **Ask first:** any new dependency beyond `ioredis`; changes to `getValidSession`'s
  public signature; anything that touches `apps/note-service/`.
- **Never:** fall back to per-instance memory when `REDIS_URL` is set; publish the Redis
  port to the host; cache or log token values; run e2e from this module's tasks.

## Success Criteria

1. `RedisSessionStore` passes the same contract suite as `SessionStore`.
2. Hop proof: session created via replica A is honored by replica B (integration, real
   Redis).
3. Two replicas, one near-expiry session → exactly one IdP refresh call; no reuse
   detection fires.
4. With `REDIS_URL` unset: app unit suite (74) and e2e behavior unchanged.

## Open Questions

None blocking. The hop proof's redis provisioning (`docker compose up redis-app` vs
embedded test container) is decided in `tasks/plan-redis.md` — compose-provided.
