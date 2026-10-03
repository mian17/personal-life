# Production runbook addendum — meal-service (meal-nutrition chapter)

Scope: the **meal-nutrition** chapter — a **new** backend service, `apps/meal-service`
(NestJS REST API on **`:3106`**), its shared library `packages/nutrition`, its dedicated
Redis (`redis-meal`), and the meals routes/BFF in `apps/app`. Backend + compose + env; the
`apps/app` meals surface rides along with the same `app` image rebuild.

Read this **with** `docs/runbooks/production-deploy.md` (the baseline stack runbook) and
`docs/specs/MAP-meal-nutrition.md` (capabilities + Decision log).

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it. Do **not** merge to `master` unless asked explicitly.

## 0. What is new

1. **`meal-service` service** on `:3106` — its own SQLite DB
   (`apps/meal-service/data/meal.db`, bind-mounted to `/data/meal.db`), its own at-rest
   master key, JWT-only auth via the same offline-JWKS pattern as note-service.
2. **`redis-meal`** — a dedicated Redis 8 instance, one per service (intent decision 3 of
   `docs/intent/redis-shared-state.md`). No persistence (`--save ""`, `--appendonly no`):
   it is a cache holding meal ciphertext, never a source of truth, and fail-open.
3. **`packages/nutrition`** — the one owner of the unit table and the health-score math,
   consumed by both the service and the app.
4. **`apps/app` meals routes** — the BFF calls the service through `MEAL_API_URL`.

```bash
grep -n "meal-service" compose.yaml     # service block + redis-meal block
```

## 1. Migration / schema verdict — none

No migration files exist (repo-wide). Tables are created at boot by the service's own
schema sync — booting `meal-service` creates `meal.db`. **Never regenerate
`MEAL_MASTER_KEY`** on a stack where it already exists: it is write-once, and changing it
makes every existing encrypted meal row undecryptable.

## 2. Env surface (all eight names)

`.env` values never touch a doc — only the **names** and safe examples are here.

| Var | Meaning | Safe example / default |
|---|---|---|
| `MEAL_API_URL` | **App-side, not service-side**: the `apps/app` BFF's base URL for the service | `http://127.0.0.1:3106` (dev) / `http://meal-service:3106` (compose, injected) |
| `MEAL_IDP_JWKS_URL` | Offline JWKS the service verifies access tokens against | `http://idp:3003/jwks` (compose default; unset → derived as `<IDP_ISSUER>/jwks`) |
| `MEAL_SERVICE_AUDIENCE` | Required `aud` claim | `life-api` (compose default — must match the `…https://meal-service=life-api` entry in `OIDC_AUDIENCE_MAP`) |
| `MEAL_MASTER_KEY` | 32-byte base64 content-encryption key (per-service custody, MAP M3) | generate once: `openssl rand -base64 32` — never commit it |
| `REDIS_URL` | Read-through cache target; **unset = direct-DB path** (dev/e2e stay Redis-free by design) | `redis://redis-meal:6379` (injected by compose) |
| `GEMINI_API_KEY` | Gemini key for the photo estimate | from Google AI Studio; never commit. Unset ⇒ estimate answers its explicit failure shape, service still boots |
| `GEMINI_MODEL` | Gemini model id — **from env, never hardcoded** (Decision log, Task 12) | unset ⇒ photo estimate off, service boots |
| `GEMINI_API_BASE` | Gemini API base — **from env, never hardcoded** (Decision log, Task 12) | unset ⇒ photo estimate off, service boots |

**Fail-fast `MEAL_MASTER_KEY`:** compose interpolates it as
`${MEAL_MASTER_KEY:?MEAL_MASTER_KEY is required (openssl rand -base64 32)}` — `docker
compose up` refuses to start without it, and the service itself also refuses to boot
(`apps/meal-service/src/keys/keys.service.ts`). Verify a key is 32 bytes before pasting:
`printf '%s' "$K" | base64 -d | wc -c` → `32`.

## 3. Pre-flight

- [ ] Working tree clean on the deploy ref: `git status --short && git log -1 --oneline`.
- [ ] `.env` has the names from §2 set — at minimum `MEAL_MASTER_KEY` (the only hard
      requirement) plus `OIDC_AUDIENCE_MAP` containing `https://meal-service=life-api`
      (already at `.env.example:43`; a `.env` carried over from an older deploy needs it
      added, or every `meal-service` request 401s).
- [ ] Record the images you are about to replace (rollback target):
      `docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life`
- [ ] Baseline health: `docker compose ps` — `app` and `idp` healthy.

## 4. Deploy

```bash
git -C /path/to/personal-life fetch
git -C /path/to/personal-life checkout <ref>
cd /path/to/personal-life
docker compose up -d --build meal-service app
```

- [ ] `docker compose ps` — `meal-service` healthy (healthcheck hits
      `http://127.0.0.1:3106/health/ready` every 10 s), `redis-meal` up, `app` healthy.
- [ ] `docker compose logs meal-service --since 2m` — boot completed with `MEAL_MASTER_KEY`
      accepted, no JWKS/audience error, no unhandled exception.
- [ ] `docker compose logs app --since 2m` — no `/meals` BFF error.

## 5. Verify

- [ ] `curl -fsS http://127.0.0.1:3106/health/ready` → 200.
- [ ] Auth: a request with no/foreign-audience token is **401** (JWT-only, `life-api`).
- [ ] On the app: `/meals` opens, an entry can be created and reads back, the unit table
      renders (`packages/nutrition` one owner).
- [ ] **Photo estimate (if the three `GEMINI_*` vars are set):** a kitchen photo returns an
      estimate with the per-field confidence gate; the correction step shows before
      save. **If unset:** the failure shape renders and nothing 500s.
- [ ] Cache sanity: a second identical list read is served with `redis-meal` as the cache
      (and the service still works if `docker compose stop redis-meal` — fail-open).

## 6. Local start (not production)

```bash
npm run dev -w apps/meal-service      # single service, PORT default 3106
npm run dev                           # repo root: all six processes incl. meal-service
```

Built output runs as `node dist/main.js` (`npm start -w apps/meal-service` →
`PORT=${PORT:-3106} node dist/main.js`); `HOST` defaults to `127.0.0.1` locally and is set
to `0.0.0.0` only in compose. Dev/e2e deliberately run **without** `MEAL_MASTER_KEY` and
**without** `REDIS_URL`.

## 7. Rollback

- [ ] **Code:** check out the previous ref and rebuild:

      git checkout <previous-ref>
      docker compose up -d --build meal-service app

- [ ] **Data:** no restore needed for a rollback that stays after the chapter's first
      deploy (`meal.db` is backward-compatible within the chapter). Rolling **back across
      the service's introduction** leaves `apps/meal-service/data/meal.db` in place — it
      is a volume, not an image layer; do not delete it.
- [ ] **Never** rotate or regenerate `MEAL_MASTER_KEY`; **never** `docker compose down` —
      both are hard lines (see below).

## Hard lines

No one else does these: `docker compose down`, `db:backup`, `db:restore`, `docker compose up`
against production, generating or rotating `MEAL_MASTER_KEY`, and any merge to `master`.

## Related

- Baseline: `docs/runbooks/production-deploy.md`
- Spec: `docs/specs/MAP-meal-nutrition.md`, `docs/specs/SPEC-meal-service.md`,
  `docs/specs/SPEC-notes-at-rest.md`
- Cache: `docs/specs/MAP-redis.md` (`meal-cache`, `redis-deploy`)
- Lessons: `docs/lessons/0011-cache-contract-and-stale-maps.md`,
  `docs/lessons/0012-cross-chapter-invariants.md`
