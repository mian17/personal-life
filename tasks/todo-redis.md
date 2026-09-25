# Todo: Redis chapter (per-service shared state + cache)

Traces to: `tasks/plan-redis.md`, `docs/specs/MAP-redis.md`.
Status: **implementation complete 2026-09-25** — Tasks 1–7 done (subagent-built under the
tech-lead protocol, tech-lead reviewed, slices committed on `feature/redis`).
Close-out verification (sequential): app unit **115/115**, idp **95/95**, note **43/43**,
lint clean (4 workspaces), hop e2e **2/2** (single run), `docker compose config -q` clean.
Hard lines held: `life.db` never written by the chapter's work (re-attested
`7d96a6a9bfba66e533f70e225cad7634` at close-out — the live DB changes only through the
human's app usage; `31767e4d…` was an earlier point-in-time attestation); no Redis port
published; `REDIS_URL`-unset behavior byte-identical (dev/e2e stay zero-Redis).
Remaining: the human deploy checklist below, then merge.

## Task 1: `app-state` store seam + `RedisSessionStore` — ✅ done 2026-09-25

**Description:** Extract the `SessionStore` public surface as the store interface, add
`RedisSessionStore` (JSON record `app:sess:<id>`, sliding TTL), and a factory that picks
the implementation from `REDIS_URL` once at module init. Dev/e2e keep the in-memory
store.

**Acceptance criteria:**
- [x] One contract suite passes against BOTH implementations (create/get sliding/update/destroy/expiry with injected clock)
- [x] `REDIS_URL` unset → in-memory (today's behavior); set → Redis impl (factory wiring completes in Task 2a — discovered at review: the sync `Boolean(store.get())` consumer made naive wiring an auth bypass)
- [x] Corrupt/absent records fail closed to "no session"; Redis errors surface as `undefined`, not exceptions past the auth layer (`create` throws typed `SessionStoreUnavailable`)

**Verification:**
- [x] `npm run test:unit -w apps/app` green (97/97 at Task 1)
- [x] `npm run lint` clean

**Dependencies:** None
**Files likely touched:** `apps/app/lib/auth/session-store.ts`, `apps/app/lib/auth/redis-store.ts` (new), `apps/app/test/redis-store.test.ts` (new), `apps/app/test/stubs/fake-redis.ts` (new), `apps/app/package.json`, `package-lock.json`
**Estimated scope:** Medium

## Task 2a: `app-state` async seam wiring (factory goes live) — ✅ done 2026-09-25

**Description:** (Grew out of Task 1's discovered blocker.) Thread `await` through the
auth layer so the `SessionStoreApi` seam (MaybePromise) is actually live: wire
`createSessionStore()` into `sessionStore`, retype `readSession`/`createSession`/
`destroySession` async, update middleware/gate/callback call sites and their tests.
⚠️ **Auth-bypass trap:** `middleware.ts`'s `Boolean(sessionStore.get(...))` must become
`Boolean(await …)` — a bare Promise is always truthy. Also: `resolveCallback`'s
`createSession` call sits outside try/catch — map `SessionStoreUnavailable` to a clean
failure (no 500, no stack trace).

**Acceptance criteria:**
- [x] `REDIS_URL` unset → full behavior unchanged (all app unit tests green); set → Redis store actually serves reads/writes (factory-wiring suite)
- [x] Gate tests prove "no session → login redirect" AND "live session → pass" AFTER the retype (`apps/app/test/middleware.test.ts`, both directions)
- [x] `SessionStoreUnavailable` surfaces as a clean user-facing failure in the callback path (existing failed-login shape)

**Verification:**
- [x] `npm run test:unit -w apps/app` green (104/104 at Task 2a)
- [x] `npm run lint` clean

**Dependencies:** Task 1
**Files likely touched:** `apps/app/lib/auth/{session,session-store,gate,require-session,callback}.ts`, `apps/app/middleware.ts`, `apps/app/app/auth/**` (error mapping), `apps/app/test/{session,gate,require-session,callback,middleware}*.test.ts`
**Estimated scope:** Large (mechanical retype + one trap)

## Task 2b: `app-state` cross-replica refresh lock — ✅ done 2026-09-25

**Description:** `refresh-lock.ts` (`SET NX EX` on `app:lock:refresh:<id>`, TTL > 30s),
composed inside `getValidSession` beneath the in-process single-flight fast path. Lock
losers never present a refresh token — they poll for the winner's rotated tokens (bounded)
or return `undefined`.

**Acceptance criteria:**
- [x] N concurrent near-expiry calls in-process → exactly one `refresh()`
- [x] Two lock clients (simulating two replicas) → still exactly one refresh; loser receives winner's tokens
- [x] Winner crash / lock expiry → a later request can refresh again (no permanent lockout)
- [x] Lock TTL (35s) > the OIDC client's 30s abort (asserted in test)

**Verification:**
- [x] `npm run test:unit -w apps/app` green (115/115 at Task 2b, incl. `redis-lock.test.ts`)
- [x] `npm run lint` clean

**Dependencies:** Task 2a
**Files likely touched:** `apps/app/lib/auth/refresh-lock.ts` (new), `apps/app/lib/auth/session.ts`, `apps/app/test/redis-lock.test.ts` (new), `apps/app/test/session.test.ts`
**Estimated scope:** Medium

## Task 3: `app-state` hop proof (two instances + one Redis) — ✅ done 2026-09-25

**Description:** E2E proof that replicas behave like one service: boot app-A and app-B
sharing one `REDIS_URL` and one IdP (the `degraded-app.ts` double-boot pattern), log in
via A, make an authenticated request via B. Gated on `TEST_REDIS_URL` — skipped in
default runs so e2e stays zero-Redis.

**Acceptance criteria:**
- [x] Session created via A is honored by B (authenticated response, no re-login); cookie-less B is walled (proves no shared-memory shortcut)
- [x] Near-expiry hop triggers exactly one refresh across the two instances (proven via the rotation observable: one rotation, lock released; direct IdP call-count instrumentation is an acknowledged gap — the IdP's token TTL is a hardcoded constant with no env lever)
- [x] Spec is skip-gated: default e2e runs (21 existing specs) unchanged

**Verification:**
- [x] One scoped run (authorized — this chapter authored the spec): `TEST_REDIS_URL=redis://127.0.0.1:6399 npx playwright test test/e2e/hop.spec.ts` (from `apps/app`) → **2/2 passed, single run**
- [x] Test Redis provisioning (test-owned, ephemeral): `docker run --rm -d --name redis-test -p 127.0.0.1:6399:6379 redis:8-alpine` — started and reaped

**Dependencies:** Task 2b
**Files likely touched:** `apps/app/test/e2e/hop.spec.ts` (new), `apps/app/test/e2e/hop-app.ts` (new), `apps/app/test/e2e/{config,stack}.ts` (additive harness wiring)
**Estimated scope:** Medium

### Checkpoint B (after Tasks 1–3) — ✅ passed
- [x] `npm run test:unit -w apps/app` green; hop spec green once; `npm run lint` clean

## Task 4: `idp-cache` read-through cache on the login path — ✅ done 2026-09-25

**Description:** Cache helper (`getThrough`/`invalidate`) wrapping `UsersService.findByUsername`
(`idp:user:<username>`, TTL 300s, negative sentinel 30s), invalidated on `createUser`.
Rotating OIDC payloads stay uncached (hard rule). Fail-open to DB.

**Acceptance criteria:**
- [x] Second identical lookup is a repository-level cache hit (repo spy)
- [x] `createUser` invalidates; unknown-user sentinel ≤30s; no-enumeration response shape unchanged (existing e2e gate green)
- [x] Redis down/error → login flow behaves exactly as today (fail-open)

**Verification:**
- [x] `npm run test -w apps/idp` green (95/95 at Task 4)
- [x] `npm run lint` clean

**Dependencies:** None (parallel-safe with Task 5)
**Files likely touched:** `apps/idp/src/users/users.service.ts`, `apps/idp/src/users/users-cache.ts` (new), `apps/idp/test/users-cache.e2e-spec.ts` (new), `apps/idp/test/fake-cache-client.ts` (new), `apps/idp/package.json`
**Estimated scope:** Medium

## Task 5: `note-cache` generation-key cache — ✅ done 2026-09-25 (bump-order corrected in review)

**Description:** Cache helper with generation-bump invalidation (`note:v<gen>:…`) over the
four read methods (`findAll`, `findTrash`, `findOne`, `listTags`), TTL 60s; every write
bumps the generation **after** its DB mutation (bump-first leaves a stale window — see
SPEC-note-cache review finding); populate only if the generation is unchanged after the
query. Fail-open to DB. Cache Redis runs unpersisted.

**Acceptance criteria:**
- [x] Second identical read is a repository-level cache hit (repo spy)
- [x] All six writes invalidate (parametrized, ordering-asserted: mutation strictly before bump); stale-guard proven (write during slow query is not masked); failed mutation never bumps
- [x] Redis down/error → full CRUD behaves exactly as today (fail-open e2e)

**Verification:**
- [x] `npm run test -w apps/note-service` green (43/43 at Task 5)
- [x] `npm run lint` clean

**Dependencies:** None (parallel-safe with Task 4)
**Files likely touched:** `apps/note-service/src/notes/notes.service.ts`, `apps/note-service/src/notes/notes-cache.ts` (new), `apps/note-service/test/notes-cache.e2e-spec.ts` (new), `apps/note-service/test/fake-redis.ts` (new), `apps/note-service/package.json`
**Estimated scope:** Medium

### Checkpoint C (after Tasks 4–5) — ✅ passed
- [x] `npm run test -w apps/idp` and `npm run test -w apps/note-service` green (sequential)

## Task 6: `redis-deploy` compose wiring — ✅ done 2026-09-25

**Description:** Three internal-only Redis services (`redis-app` AOF + named volume;
`redis-idp`, `redis-note` LRU + unpersisted), env wiring per service (`REDIS_URL`), no
published ports, healthchecks. `.env` unchanged — zero human env burden. README note.

**Acceptance criteria:**
- [x] `docker compose config -q` passes; each service resolves its own `REDIS_URL` (rendered-config proof)
- [x] No Redis port published on any interface (rendered-config proof); `life.db` untouched
- [x] README "Auth model" gains a short per-service Redis paragraph; `.env.example` comment-only

**Verification:**
- [x] `docker compose config -q` + rendered inspection pass (build deferred to the human's deploy — images unchanged by this task)
- [x] (no code changed — lint/tests not applicable)

**Dependencies:** Tasks 1, 4, 5
**Files likely touched:** `compose.yaml`, `README.md`, `.env.example`
**Estimated scope:** Small

## Task 7: verification + human deploy — ✅ verification done 2026-09-25

**Description:** Full verification pass (checkpoints re-run sequentially) + the
human-owned deploy acceptance below.

**Acceptance criteria:**
- [x] Full suites green sequentially: app unit **115/115**, idp **95/95**, note **43/43**, lint clean
- [x] Hop proof green once with test Redis (**2/2**, Task 3)
- [x] `life.db` verified untouched by the chapter's work (re-attested `7d96a6a9bfba66e533f70e225cad7634` — live DB, changes only via the human's app usage; agents/tests never wrote it)

**Verification:**
- [ ] Human deploy checklist below (human-owned, owner-attested)

**Dependencies:** Tasks 1–6
**Files likely touched:** `tasks/todo-redis.md` (this bookkeeping)
**Estimated scope:** Small

## Human deploy checklist (human-owned)

- [ ] `.env` unchanged (compose injects `REDIS_URL` for each service)
- [ ] `docker compose up -d --build` — `docker compose ps` healthy incl. the three new Redis services (`redis-app`, `redis-idp`, `redis-note`)
- [ ] Phone check: login → open a note → edit → trash/restore (caches are transparent; a forced re-login on deploy is expected — session state now lives in `redis-app`, which starts empty)
- [ ] Optional: hop proof with the test Redis (Task 3 command)
- [ ] Reap any stale test Redis (`docker rm -f redis-test`)
