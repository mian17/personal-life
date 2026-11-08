# System design

A self-owned personal API and PWA: one owner, one host, no multi-tenancy anywhere in the tree.
Eight deployable services (one Next.js frontend, one identity provider, six domain APIs), a React
package for the pomodoro UI, and ten shared packages. Every domain service follows the same shape
— service → read-through Redis cache → database — so a new route costs one more copy of a known
pattern rather than a new architecture.

Written against `dev` at commit `3f2db74`. Visual language lives in
[`docs/design-systems/personal-life/DESIGN.md`](docs/design-systems/personal-life/DESIGN.md);
process rules live in [`AGENTS.md`](AGENTS.md); setup lives in [`README.md`](README.md).

## Topology

| Path | Role | Prod port | Dev port | Store |
|---|---|---|---|---|
| `apps/app` | Next.js App Router UI + PWA; the server-side BFF is the only API caller | 3002 (`compose.yaml`) | 3100 (`WEB_PORT` default in `apps/app/package.json`) | session in `redis-app` |
| `apps/idp` | OpenID Connect provider (`oidc-provider`): users, login, sessions, JWKS | 3003 | 3102 (`dev:build` in `package.json`) | SQLite `idp.db` + `redis-idp` |
| `apps/note-service` | Notes and tags-registry API | 3001 | 3101 | SQLite `life.db` + `redis-note` |
| `apps/tags-service` | Tag registry shared by notes and todos | 3004 | 3104 | SQLite `tags.db` + `redis-tags` |
| `apps/todo-service` | Todos, lists, reminders, Web Push | 3005 | 3105 | SQLite `todo.db` + `redis-todo` |
| `apps/meal-service` | Meals, foods, entries, nutrition, Gemini photo estimate | 3106 | 3106 | SQLite `meal.db` + `redis-meal` |
| `apps/feedback-service` | Feedback ingest plus a `feedback_event` change log | 3008 | 3108 | **Postgres** `postgres-feedback` + RabbitMQ + `redis-feedback` |
| `apps/focus-service` | Pomodoro sessions and goals | 3107 | 3107 | SQLite `focus.db` + `redis-focus` |

Port provenance: production ports are the `PORT` values in `compose.yaml`; dev ports are pinned in
the root `dev`/`dev:build` scripts (`package.json`) or in each app's own `start`/`dev` script.
`apps/app` and `apps/idp` are the only app services published on the host, and only on loopback
(`127.0.0.1:3002`, `127.0.0.1:3003`) so `tailscale serve` can proxy to them. The six domain
services publish nothing.

Packages, all `workspaces` in the root `package.json`:

- Frontend: `packages/ui` (the visual language — 70 components plus
  `packages/ui/src/styles/tokens.css`), `packages/app-kit` (Next helpers: route layout, query
  suffix, preferences, pending actions), `apps/pomodoro` (focus-screen React components, no port).
- Contracts and kernel: `packages/shared` (DTOs), `packages/crypto` (`enc.v1.` envelopes, `kw.v1.`
  DEK wrapping, master-key loading), `packages/cache` (the read-through cache every service adapter
  extends), `packages/service-kit` (`AuthGuard`, health, keys module, paging, batch),
  `packages/nutrition` (nutrition math).
- Operations: `packages/db` (backup/restore CLIs), `packages/ops` (data-operations registry and
  CLI), `packages/mcp-gateway` (one stdio MCP server over that registry).

## The per-route-app rule

One frontend route is one app is one full backend stack: service + cache + database. The tree
shows it as parallel directories — `apps/app/app/notes`, `apps/app/app/todos`,
`apps/app/app/(meals)/meals`, `apps/app/app/feedback`, `apps/app/app/pomodoro` — each with a
matching `apps/*-service` and its own Redis instance in `compose.yaml`. `apps/tags-service` is
the one deliberate exception: a shared registry serving two routes rather than owning a route.
Adding a route therefore means adding the whole column (UI, BFF client, service, cache adapter,
database, compose entry), not bolting a page onto an existing service. Databases are never
shared in production; dev shares one Postgres/RabbitMQ pair between the host stack and compose
(`scripts/dev-infra.sh` runs a throwaway pair on 5433/5673).

## Request path and auth

```
browser → tailscale serve (TLS, tailnet only) → app:3002
app middleware: access gate, then session gate
server component / server action / route handler → callService() → service:PORT
service: AuthGuard → verify JWT offline against IdP JWKS → request.principal.sub
```

- **Access gate.** `apps/app/middleware.ts` → `apps/app/lib/auth/gate.ts` requires the
  Serve-injected `tailscale-user-login` header to equal `OWNER_LOGIN`, plus `x-forwarded-host`.
  It grants reachability only, never identity. The single off-switch is
  `APP_DEV_SKIP_ACCESS_GATE=1`, set on dev command lines, never deployed.
- **Identity.** OIDC authorization code + PKCE S256 against `apps/idp`
  (`apps/app/lib/auth/pkce.ts`, `apps/app/lib/auth/oidc-client.ts`, entry routes under
  `apps/app/app/auth/`). The app keeps an opaque session id in an `HttpOnly`, `SameSite=Lax`,
  `Secure` cookie with a 7-day sliding TTL (`apps/app/lib/auth/session-store.ts`); tokens live
  server-side only.
- **Tokens.** Access tokens are EdDSA/Ed25519 JWTs (`apps/idp/src/crypto/signing-keys.ts`,
  `apps/idp/src/oidc/access-token.policy.ts`), `ACCESS_TOKEN_TTL_S = 600`, audience `life-api`
  for every service (mapped from resource indicators by `OIDC_AUDIENCE_MAP`). Refresh tokens are
  opaque, 30 days, rotated on every use with reuse detection
  (`apps/idp/src/oidc/refresh-token.policy.ts`).
- **Verification.** Each service verifies signature, `iss`, `aud`, `exp` offline against
  `http://idp:3003/jwks` — one shared `AuthGuard` from `packages/service-kit/src/auth`; no
  per-request call to the IdP and no shared secret.
- **BFF.** `apps/app/lib/client.ts` `callService()` attaches the caller's access token as
  `Authorization: Bearer` and `cache: 'no-store'`; the browser never sees a token.
- **Two Redis postures.** `redis-app` is a fail-closed session store and cross-replica refresh
  lock (`apps/app/lib/auth/redis-store.ts`, `refresh-lock.ts`: AOF + named volume, no in-memory
  fallback in production). Every other Redis is a fail-open read-through cache with RDB and AOF
  both disabled.

`unverified:` the dev IdP's default issuer value and the exact dev IdP session behaviour were not
read in full; the ports above come from scripts, not from IdP config loading.

One caveat before touching auth: `packages/service-kit/src/auth/auth.guard.ts` skips token
verification when `NODE_ENV === 'development'`, setting `principal.sub = 'dev-user'`. Local dev
therefore exercises authz as one user, not the JWT path.

## The three-layer data contract

Reference implementation: `apps/note-service/src/notes/notes-cache.ts` (the note adapter) over
`packages/cache/src/index.ts` (`ReadThroughCache.getThrough`), used from
`apps/note-service/src/notes/notes.service.ts`.

```
request → service (authz, domain logic, encrypt/decrypt)
        → cache (read-through Redis)
        → DB (reached only through the cache's loader)
```

1. **The DB sits behind the cache.** Read flows call `cache.getThrough(sub, rest, loader, opts)`;
   repository access lives inside the loader. With no `REDIS_URL` the adapter is constructed with
   a `null` client and every call runs the loader directly — that is how dev and e2e run.
2. **Cached values are rows as persisted, never presentation.** The cache stores serialized DB
   rows; content columns stay ciphertext (`enc.v1.` envelopes). Decrypt, assemble DTOs, filter,
   and paginate after the hit. `decode` throwing is treated as a miss; `cacheable: false` keeps a
   legacy plaintext row out of Redis entirely.
3. **The key reflects the fetch, not the request.** Shape `<svc>:<sub>:v<gen>:<rest>`, counter
   `<svc>:gen:<sub>`. Filters (`q`, tag ids) and pagination (`cursor`, `limit`) never enter the
   key. Writes bump the owner's generation with one `INCR`, invalidating every key of that owner
   at once; the client surface has no `DEL`. TTL 60s is the backstop (`CACHE_TTL_SECONDS`). A
   stale-guard captures the generation before the loader and re-reads it after, so a value made
   stale by a concurrent write is not written back.
4. **Fail-open.** Any cache error degrades to the loader. The fallback never writes and never
   throws. Writes never go through the cache: service → DB, then invalidate.

Adapters: `apps/tags-service/src/tags/tags-cache.ts`, `apps/todo-service/src/cache/todo-cache.ts`,
`apps/meal-service/src/cache/`, `apps/feedback-service/src/feedback/feedback-cache.ts`,
`apps/focus-service/src/cache/focus-cache.ts`, `apps/idp/src/users/users-cache.ts` — each pins a
namespace, none forks the mechanics.

## The UI contract

Every app renders from `@life/ui`. `packages/ui/src/components` holds 70 files; the package root
exports them from `packages/ui/src/index.ts`, and `packages/ui/src/styles.css` (which pulls in
`base.css`, `theme.css`, `tokens.css`) is imported exactly once, in `apps/app/app/layout.tsx`.

- A raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<a>`, `<img>`, `<label>`, or `<progress>`
  in `apps/*` UI code is a bug. Structural tags (`div`, `span`, `p`, `form`) are allowed only as
  unstyled glue.
- Styles come from tokens only (`packages/ui/src/styles/tokens.css`), via `var(--token)`. Raw
  colours and lengths in app CSS are forbidden; `next/link` is owned by `packages/ui`, not apps.
- A missing primitive or a bad fit is fixed upstream in `packages/ui`, never worked around in an
  app — and not by copying a primitive into an app.
- App-specific **behaviour** (autosave engines, BFF clients, server actions) stays in `apps/*`.

Visual values themselves are not repeated here: see
[`docs/design-systems/personal-life/DESIGN.md`](docs/design-systems/personal-life/DESIGN.md).

## Storage map

| Service | Store | Content encryption |
|---|---|---|
| `app` | none; `redis-app` holds sessions and refresh locks (AOF + volume) | n/a |
| `idp` | SQLite `idp.db`, argon2 password hashes, users/grants cache in `redis-idp` | password hashing, not envelope encryption |
| `note-service` | SQLite `life.db` | note body is an `enc.v1.` envelope |
| `tags-service` | SQLite `tags.db` | tag names encrypted |
| `todo-service` | SQLite `todo.db` | titles, notes, list names encrypted; dates/flags not |
| `meal-service` | SQLite `meal.db` | food/entry/saved-meal text encrypted |
| `focus-service` | SQLite `focus.db` | rows are numbers and date keys; master key guards the owner-key table |
| `feedback-service` | **Postgres** (`postgres-feedback`) + RabbitMQ | title/description encrypted |

Only feedback is Postgres. Every other service is a single SQLite file, opened through TypeORM
from a host bind mount: `compose.yaml` mounts each service's host data directory into the
container at `/data`, and `.gitignore` excludes those directories and database files — so no
database file is in the git tree, and the names in this table are the file names you will find on
a running host. Backups go to a gitignored `backup/` directory via `packages/db`.

The encryption story is one mechanism repeated: each service loads its own master key
(`NOTE_MASTER_KEY`, `TAGS_MASTER_KEY`, `TODO_MASTER_KEY`, `MEAL_MASTER_KEY`,
`FEEDBACK_MASTER_KEY`, `FOCUS_MASTER_KEY`) fail-closed at boot through
`KeysModule.forRoot()` in `packages/service-kit/src/keys/keys.module.ts`; per-owner data keys are
generated once, wrapped as `kw.v1.` under a HKDF-derived KEK, and stored in the `user_keys`
table (`packages/crypto/src/keys.ts`); field values become `enc.v1.<nonce>.<ct>` with an AAD
naming service, owner, field, and row id (`packages/crypto/src/envelope.ts`). Master keys live in
`.env` and nowhere in the tree.

## Testing and type-checking

- Per workspace: `npm run typecheck` and `npm run test:unit` (jest everywhere; `apps/app` also runs
  `tsc -p tsconfig.e2e.json --noEmit` from its `typecheck` script — that is what type-checks
  `apps/app/test/e2e`, which sits deliberately outside `apps/app/tsconfig.json`).
- e2e: Playwright in `apps/app/test/e2e` (23 files: specs plus harness helpers) with its own
  stack. `global-setup.ts` builds and launches idp + services + app; `extraHTTPHeaders` injects
  the `tailscale-user-login` header so the access gate is genuinely exercised. Two configs run
  the same specs: `apps/app/playwright.config.ts` (production `next build` output, 31xx ports)
  and `apps/app/playwright.dev.config.ts` (`next dev`, 32xx ports); they cannot share the same
  Next build directory, so `npm run test:e2e` runs them as two invocations.
- Ports are slotted, not fixed: `apps/app/test/e2e/config.ts` computes `basePort + 10 * slot`, so
  concurrent worktrees never collide. Output is written outside the repo.
- Cross-service hypotheses get their own proof: `apps/app/test/e2e/hop.spec.ts` boots two app
  replicas against one Redis (opt-in).
- Guards that fail on regression: `scripts/dev-infra.test.mjs` (`npm run test:dev-infra`) fails if
  any `docker rm` loses `-v`; `scripts/seed-stack.test.mjs`, `scripts/screens-ids.test.mjs`, and
  `scripts/coverage.test.mjs` cover their scripts the same way. CI runs `npm run test:coverage`
  (`.github/workflows/tests.yml`).

Commands and test policy live in `AGENTS.md` and `README.md`; this section only says what exists.

## Deploy and state

Production is Docker Compose: `docker compose up -d --build` (`compose.yaml`, 18 services on one
`life` bridge network). Ordering is `depends_on` + healthchecks: redis instances → the six domain
services and `idp` → `app`. Published host ports: `127.0.0.1:3002` (app), `127.0.0.1:3003`
(idp), `127.0.0.1:5432` (postgres-feedback), `127.0.0.1:5672` (rabbitmq-feedback). The last two
exist so the host-run dev feedback service on 3108 can reach them; everything else is internal to
the compose network, and no Redis publishes a port.

Named volumes (`compose.yaml`): `redis-app-data`, `redis-feedback-data`, `redis-focus-data`,
`postgres-feedback-data`, `rabbitmq-feedback-data`. Irreplaceable state, in order of pain:

1. `apps/*/data/*.db` — six SQLite files on host bind mounts, outside any volume.
2. `postgres-feedback-data` — the only feedback database.
3. `redis-app-data` — live sessions; losing it forces a re-login, nothing more.
4. `rabbitmq-feedback-data` — queued feedback events.
5. `redis-feedback-data` / `redis-focus-data` — caches; safe to lose by contract.

Backup: `npm run db:backup -- --pin` (six SQLite files, `PRAGMA quick_check` verified) and
`npm run db:backup:pg -- --pin` (the one Postgres database), both writing UTC-stamped directories
under `backup/`. Restore mirrors them: `db:restore`, `db:restore:pg`.

**Never run `docker compose down -v`.** It deletes the named volumes, and it is the only command
in this repo that destroys state in one character. The full ordered checklist is
`docs/runbooks/production-deploy.md`.

## Invariants

True by construction; a violation is a bug rather than a choice.

- The browser never holds an access or refresh token. Tokens live in the server-side session.
- Services never call the IdP per request; verification is offline against the JWKS.
- No domain service is reachable except through the app's BFF.
- Redis in front of content never holds plaintext; a decrypted cache value is a privacy bug.
- A write invalidates by bumping the owner's generation; there is no per-key delete path.
- A cache failure degrades, never fails the request. A session-store failure fails closed.
- Every service-owned database is one service's alone in production; only feedback uses Postgres.
- App UI code contains no raw form/control elements and no raw colours or lengths.
- `packages/ui` and `packages/cache` are extended upstream; never forked per app or per service.
- Every read key embeds the owner's `sub`; a request without a verified `sub` is rejected.
- The visual design system is data, not opinion: token values change only with
  `packages/ui/test/tokens.test.ts` in the same commit.

## Where the rest lives

| Need | File |
|---|---|
| Setup, env files, run commands, Tailscale Serve layout | [`README.md`](README.md) |
| Agent process, delegation template, branches, hard lines | [`AGENTS.md`](AGENTS.md) |
| Visual design system: tokens, palette, type, components | [`docs/design-systems/personal-life/DESIGN.md`](docs/design-systems/personal-life/DESIGN.md) |
| Incident lessons (27 files, read before repeating a mistake) | [`docs/lessons/`](docs/lessons/) |
| Deploy, restore, e2e, ops runbooks | [`docs/runbooks/`](docs/runbooks/) |
| Backmerge procedure | [`docs/ops/backmerge.md`](docs/ops/backmerge.md) |
| Research notes and open design questions | [`docs/research/`](docs/research/) |
