# Five-Lane Verification — Redis chapter (`feature/redis`)

**Gate run:** 2026-09-25. **Scope:** `git diff e425cbd..afc2fc9` (11 commits) + one uncommitted fix pass + tech-lead doc corrections.
**Final verdict: STOP — NOT MERGEABLE.** 3/5 after the single permitted fix pass. Merge requires N/N.

## Stage 0 — suite gate (not a lane)

Sequential (parallel suites cause false reds in this repo): app unit **115/115** → idp **95/95** → note **43/43** → lint clean. Lane 4's post-fix re-execution: app **128/128**, idp **98/98**, note **43/43**, lint clean.

## Round 1 — all lanes, parallel, independent

| # | Lane | Verdict | Blockers |
|---|------|---------|----------|
| 1 | correctness-domain | FAIL | 3 |
| 2 | code-quality | FAIL | 3 |
| 3 | security | FAIL | 1 |
| 4 | qa-e2e | FAIL | 1 |
| 5 | plan-conformance | FAIL | 1 |

Consolidated (deduped) — 4 unique must-fix:

- **B1 [HIGH] `compose.yaml`** — `redis-idp`/`redis-note` ran without `--save ""`; redis:8-alpine's default RDB snapshots would write note bodies + cached argon2 hashes to `/data/dump.rdb` (second disk, survives restarts), violating plan decision 6 + SPEC-note-cache's Never list. Found independently by lanes 1, 2, 3 (verified live via `CONFIG GET save`), 5.
- **B2 [MEDIUM] `apps/app/lib/auth/session.ts`** — `performRefresh`'s two early returns sat before the releasing `try/finally`, leaking `app:lock:refresh:<id>` for its full TTL (spurious wait/re-login for other replicas).
- **B3 [HIGH] `apps/app/lib/auth/session-store.ts`** (same shape in `refresh-lock.ts`) — with Redis unreachable, node-redis's default offline queue + infinite reconnect left `connect()` unsettled forever: commands HUNG instead of failing closed (`no session` / `SessionStoreUnavailable`).
- **B4 [MEDIUM] `apps/idp/test/users-cache.e2e-spec.ts`** — named behavior "OIDC payloads never cached" had zero test coverage.

## Fix pass (exactly one — `tests_pass: true`)

B1: `--save "" --appendonly no` (list form) on both cache services. B2: whole post-acquire body in the releasing `try/finally` + 4 spy-release regression tests. B3: shared `createBoundedRedisClient` (`disableOfflineQueue`, `boundedReconnectStrategy`, `connectBounded` hard-timeout race) + `bounded-connect.test.ts`. B4: real-source module-boundary tests + non-vacuous `idp:user:`-only keyspace assertion.
Declared deviations (adjudicated in round 2 as acceptable): `objectContaining({url})` factory assertion (compensated by exact-shape assertions in `bounded-connect.test.ts`); `writtenKeys` recorder on the idp fake; named `REDIS_CONNECT_TIMEOUT_MS` race.

## Round 2 — re-run of ALL five lanes (none had passed; a PASS never re-runs)

| # | Lane | Verdict | Blockers |
|---|------|---------|----------|
| 1 | correctness-domain | FAIL | 2 (R1, R2 below) |
| 2 | code-quality | FAIL | 1 (R1) |
| 3 | security | **PASS_WITH_NITS** | 0 |
| 4 | qa-e2e | **PASS_WITH_NITS** | 0 |
| 5 | plan-conformance | **PASS_WITH_NITS** | 0 |

Verified fixed by re-run: B1 (rendered config + parsed command arrays), B2 (spy-release tests proven discriminating against the pre-fix code), B4 (boundary tests proven non-vacuous), B3's original hang (cold-boot bounded, fail-closed mapping holds).

## Scoring (fail-closed)

`pass(v) := v ∈ {PASS, PASS_WITH_NITS}` → **3/5**. N/N not reached → **no merge, no code commit.**

## Remaining blockers — the next cycle's exact scope

**R1 [HIGH] `apps/app/lib/auth/redis-store.ts` — the B3 fix introduced a permanent-outage regression.**
`boundedReconnectStrategy` returns `false` after 3 attempts (~600 ms); node-redis then latches `#isOpen=false` and **never reconnects** (verified in `node_modules/.../socket.js` and empirically). Nothing re-calls `connect()` (stores are built once at module init). A transient Redis blip therefore leaves a replica permanently fail-closed: permanent login wall (`get`→`undefined`, `create`→`SessionStoreUnavailable`→400) and the refresh lock silently degraded forever — losing the chapter's core one-refresh guarantee with no signal. Round-1 B3's hang did not need the bounded strategy: the `connectBounded` hard-timeout race alone settles `ready`.
*Remediation:* keep node-redis's default retry-forever reconnect (background recovery) behind the existing `connectBounded` timeout race + `disableOfflineQueue: true` — commands then reject fast while down (fail-closed ✓), never hang (✓), and traffic resumes when Redis returns (✓). Alternatively an explicit re-connect path. Add a recovery-lifecycle test (connect settles → errors → recovers → commands succeed again) alongside the existing never-settling/rejecting cases.

**R2 [HIGH] `apps/idp/test/users-cache.e2e-spec.ts` — new spec is non-isolated and non-idempotent.**
Static `import { AppModule }` is evaluated before the describe-body `process.env.DB_PATH = TEST_DB` assignment, so `resolveDbPath()` at decorator time captures the default path: fixtures land in `apps/idp/data/scratch.db`, `test-idp-users-cache.db` is never created, and a second run fails 7/17 with `UNIQUE constraint failed: user.username`. Every other idp spec uses the deferred `await import('../src/app.factory')` pattern.
*Remediation:* deferred import after `DB_PATH` is set (house pattern); make the spec idempotent (own DB, created/cleaned per run). Also delete the stray `cache-*` fixture rows it wrote into `scratch.db` (scratch, not `life.db` — the hard line is intact).

## Residual observations (nits — not blockers)

- **Live-vs-tree divergence (deploy-relevant!):** the RUNNING `redis-idp`/`redis-note` containers still execute the old command (RDB on) until the human redeploys. The tree is correct; `docker compose up -d --build` closes it.
- idp suite parallel flakiness (`this.sqlite is not a constructor`, 5s hook timeouts) — pre-existing runner contention on specs outside this diff; `--runInBand` green; not chapter-attributable.
- `connectBounded`'s hard timeout can wall a slow-but-healthy boot for one shot (lane 1); `get`'s `KEEPTTL`+`EXPIRE` is 2 round-trips (lane 2); `redis-app` keeps RDB on (deliberate state store, lane 3); `todo-redis.md` suite counts (115/95) stale vs 128/98 (lane 2); `SPEC-app-state` "ioredis" leftover — closed in this commit (lane 5).
- lane 3: `SessionStoreUnavailable.cause` must never be serialized by future error handlers (nothing does today). `npm audit` unavailable (registry mirror returns NOT_IMPLEMENTED) — advisory data unverified, stated as a limitation.

## Machine-readable verdicts

```json
{"round":1,"lanes":{"correctness-domain":"FAIL","code-quality":"FAIL","security":"FAIL","qa-e2e":"FAIL","plan-conformance":"FAIL"},"unique_blockers":4,"fix_pass":{"tests_pass":true,"used":1}}
{"round":2,"lanes":{"correctness-domain":"FAIL","code-quality":"FAIL","security":"PASS_WITH_NITS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"PASS_WITH_NITS"},"remaining_blockers":["R1","R2"]}
{"gate":"STOP_NO_MERGE","score":"3/5","merge_condition":"N/N","fix_pass_budget":"spent"}
```

## Next

Per the gate, the fix budget for this run is spent — the gate stops here. The next cycle ("fix and re-run") has exactly two items (R1, R2); after them only lanes 1 and 2 need re-running — lanes 3/4/5 stand on their PASS verdicts. Code changes from the fix pass remain **uncommitted** until a gate reaches N/N.
