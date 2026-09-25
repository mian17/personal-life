# Todo: Redis chapter (per-service shared state + cache)

Traces to: `tasks/plan-redis.md`, `docs/specs/MAP-redis.md`.
Status: **planned 2026-09-25** — awaiting plan review, then subagent-built under the
tech-lead protocol. Hard lines: `apps/note-service/data/life.db` (md5 `31767e4d…`) never
changes; no Redis port ever published; `REDIS_URL`-unset behavior byte-identical to today.

## Task 1: `app-state` store seam + `RedisSessionStore`

**Description:** Extract the `SessionStore` public surface as the store interface, add
`RedisSessionStore` (JSON record `app:sess:<id>`, sliding TTL), and a factory that picks
the implementation from `REDIS_URL` once at module init. Dev/e2e keep the in-memory
store.

**Acceptance criteria:**
- [ ] One contract suite passes against BOTH implementations (create/get sliding/update/destroy/expiry with injected clock)
- [ ] `REDIS_URL` unset → in-memory (today's behavior); set → Redis impl; no caller (`requireSession`, routes) changes behavior
- [ ] Corrupt/absent records fail closed to "no session"; Redis errors surface as `undefined`, not exceptions past the auth layer

**Verification:**
- [ ] `npm run test:unit -w apps/app` green (74 + new)
- [ ] `npm run lint` clean

**Dependencies:** None
**Files likely touched:** `apps/app/lib/auth/session-store.ts`, `apps/app/lib/auth/redis-store.ts` (new), `apps/app/test/redis-store.test.ts` (new), `apps/app/package.json`, `package-lock.json`
**Estimated scope:** Medium

## Task 2: `app-state` cross-replica refresh lock

**Description:** `refresh-lock.ts` (`SET NX EX` on `app:lock:refresh:<id>`, TTL > 30s),
composed inside `getValidSession` beneath the in-process single-flight fast path. Lock
losers never present a refresh token — they poll for the winner's rotated tokens (bounded)
or return `undefined`.

**Acceptance criteria:**
- [ ] N concurrent near-expiry calls in-process → exactly one `refresh()`
- [ ] Two lock clients (simulating two replicas) → still exactly one refresh; loser receives winner's rotated tokens
- [ ] Winner crash / lock expiry → a later request can refresh again (no permanent lockout)
- [ ] Lock TTL > the OIDC client's 30s abort (asserted in test)

**Verification:**
- [ ] `npm run test:unit -w apps/app` green (incl. `redis-lock.test.ts`)
- [ ] `npm run lint` clean

**Dependencies:** Task 1
**Files likely touched:** `apps/app/lib/auth/refresh-lock.ts` (new), `apps/app/lib/auth/session.ts`, `apps/app/test/redis-lock.test.ts` (new), `apps/app/test/session.test.ts`
**Estimated scope:** Medium

## Task 3: `app-state` hop proof (two instances + one Redis)

**Description:** E2E proof that replicas behave like one service: boot app-A and app-B
sharing one `REDIS_URL` and one IdP (the `degraded-app.ts` double-boot pattern), log in
via A, make an authenticated request via B. Gated on `TEST_REDIS_URL` — skipped in
default runs so e2e stays zero-Redis.

**Acceptance criteria:**
- [ ] Session created via A is honored by B (authenticated response, no re-login)
- [ ] Near-expiry hop triggers exactly one refresh across the two instances (no reuse detection)
- [ ] Spec is skip-gated: default e2e runs (21 existing specs) unchanged

**Verification:**
- [ ] One scoped run with test Redis (authorized — this chapter authors the spec):
      `TEST_REDIS_URL=redis://127.0.0.1:6399 npx playwright test test/e2e/hop.spec.ts` (from `apps/app`)
- [ ] Test Redis provisioning (test-owned, ephemeral): `docker run --rm -d --name redis-test -p 127.0.0.1:6399:6379 redis:7-alpine`

**Dependencies:** Task 2
**Files likely touched:** `apps/app/test/e2e/hop.spec.ts` (new), `apps/app/test/e2e/hop-app.ts` (new), `apps/app/test/e2e/` harness wiring
**Estimated scope:** Medium

### Checkpoint B (after Tasks 1–3)
- [ ] `npm run test:unit -w apps/app` green; hop spec green once; `npm run lint` clean

## Task 4: `idp-cache` read-through cache on the login path

**Description:** Cache helper (`getThrough`/`invalidate`) wrapping `UsersService.findByUsername`
(`idp:user:<username>`, TTL 300s, negative sentinel 30s), invalidated on `createUser`.
Rotating OIDC payloads stay uncached (hard rule). Fail-open to DB.

**Acceptance criteria:**
- [ ] Second identical lookup is a repository-level cache hit (repo spy)
- [ ] `createUser` invalidates; unknown-user sentinel expires ≤30s; no-enumeration response shape unchanged (existing e2e is the gate)
- [ ] Redis down/error → login flow behaves exactly as today (fail-open)

**Verification:**
- [ ] `npm run test -w apps/idp` green (81 + new)
- [ ] `npm run lint` clean

**Dependencies:** None (parallel-safe with Task 5)
**Files likely touched:** `apps/idp/src/users/users.service.ts`, `apps/idp/src/users/users-cache.ts` (new), `apps/idp/test/users-cache.e2e-spec.ts` (new), `apps/idp/package.json`
**Estimated scope:** Medium

## Task 5: `note-cache` generation-key cache

**Description:** Cache helper with generation-bump invalidation (`note:v<gen>:…`) over the
four read methods (`findAll`, `findTrash`, `findOne`, `listTags`), TTL 60s; every write
bumps the generation before its DB mutation; populate only if the generation is unchanged
after the query. Fail-open to DB. Cache Redis runs unpersisted.

**Acceptance criteria:**
- [ ] Second identical read is a repository-level cache hit (repo spy)
- [ ] All six writes invalidate (parametrized); stale-guard proven (write during slow query is not masked)
- [ ] Redis down/error → full CRUD behaves exactly as today (fail-open e2e)

**Verification:**
- [ ] `npm run test -w apps/note-service` green (25 + new)
- [ ] `npm run lint` clean

**Dependencies:** None (parallel-safe with Task 4)
**Files likely touched:** `apps/note-service/src/notes/notes.service.ts`, `apps/note-service/src/notes/notes-cache.ts` (new), `apps/note-service/test/notes-cache.e2e-spec.ts` (new), `apps/note-service/package.json`
**Estimated scope:** Medium

### Checkpoint C (after Tasks 4–5)
- [ ] `npm run test -w apps/idp` and `npm run test -w apps/note-service` green (sequential)

## Task 6: `redis-deploy` compose wiring

**Description:** Three internal-only Redis services (`redis-app` AOF + named volume;
`redis-idp`, `redis-note` LRU + unpersisted), env wiring per service (`REDIS_URL`), no
published ports, healthchecks. `.env` unchanged — zero human env burden. README note.

**Acceptance criteria:**
- [ ] `docker compose config -q` passes; images build; each service resolves its own `REDIS_URL`
- [ ] No Redis port published on any interface; `life.db` md5 unchanged
- [ ] README "Auth model" gains a short per-service Redis paragraph

**Verification:**
- [ ] `docker compose config -q` + `docker compose build` pass
- [ ] `npm run lint` clean

**Dependencies:** Tasks 1, 4, 5
**Files likely touched:** `compose.yaml`, `README.md`, `.env.example` (comment only)
**Estimated scope:** Small

## Task 7: verification + human deploy

**Description:** Full verification pass (checkpoints re-run sequentially) + the
human-owned deploy acceptance below.

**Acceptance criteria:**
- [ ] Full suites green sequentially: app unit (74+), idp (81+), note (25+), lint
- [ ] Hop proof green once with test Redis
- [ ] `life.db` md5 `31767e4d…` verified unchanged (hard line)

**Verification:**
- [ ] Human deploy checklist below (human-owned, owner-attested)

**Dependencies:** Tasks 1–6
**Files likely touched:** `tasks/todo-redis.md` (checklist bookkeeping only)
**Estimated scope:** Small

## Human deploy checklist (human-owned)

- [ ] `.env` unchanged (compose injects `REDIS_URL` for each service)
- [ ] `docker compose up -d --build` — `docker compose ps` healthy incl. the three Redis services
- [ ] Phone check: login → open a note → edit → trash/restore (cache is transparent)
- [ ] Optional: hop proof with the test Redis (Task 3 command)
- [ ] Reap any stale test Redis (`docker rm -f redis-test`)
