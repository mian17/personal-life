# Personal Life

A self-owned personal API that centralizes life data. Domain #1 is **notes/journaling**.

- `apps/note-service` — NestJS + TypeORM/SQLite REST API (loopback only).
- `apps/app` — Next.js App Router UI + PWA; the server-side BFF is the only API caller.
- `apps/idp` — NestJS OpenID Connect Identity Provider (users, login, sessions, OIDC).
- `packages/shared` — shared DTO/types.

## Requirements

- Node.js latest, npm.
- Tailscale on the host and phone, with HTTPS certificates enabled for the tailnet.

## Setup

```unknown
npm install
```

There are two env files at the repo root, one per environment. Both are gitignored; tracked
`.example` files document their keys.

- `.env.development` — local development, loaded by `npm run dev`.
- `.env` — production, loaded by Docker Compose.

```unknown
cp .env.development.example .env.development
cp .env.example .env
```

Set `OWNER_LOGIN` to your tailnet login (e.g. `you@gmail.com`), and generate the OIDC
client secret with `openssl rand -hex 32` (see the OIDC keys in `.env.example`).

## Production (Docker Compose)

Docker Compose is the production path; `npm run start` is no longer used. Three services
run on the internal `life` network: `note-service` (no published port), `idp` (published
on host loopback `127.0.0.1:3003` so Tailscale Serve can proxy to it), and `app`
(published on host loopback `127.0.0.1:3002`).

```unknown
cp .env.example .env
# Edit .env: set OWNER_LOGIN, OIDC_APP_CLIENT_SECRET, IDP_ISSUER,
# and OIDC_APP_REDIRECT_URI for your tailnet host (see "Auth model").
docker compose up -d --build
```

The root `.env` is gitignored and is the single source of secrets for all services. The
real notes database lives at `apps/note-service/data/life.db` on the host and is
bind-mounted into `note-service` at `/data/life.db`; the IdP keeps its own database at
`apps/idp/data/idp.db` (bind-mounted at `/data/idp.db`). No data moves, and identity data
never touches the notes database.

Seed the single IdP account (production is gated on `NODE_ENV=production`, so the seed
cannot touch the identity DB by accident):

```unknown
NODE_ENV=production SEED_USERNAME=you SEED_PASSWORD='…' npm run seed -w apps/idp
```

### Tailscale Serve topology

Expose both services on the **same tailnet host** so the browser sees them as same-site
(SameSite=Lax cookies and the logout hand-off depend on this). The app owns the root;
the IdP is on a dedicated HTTPS port on the same host:

```unknown
# App on the tailnet root (https://<host>.<tailnet>.ts.net/)
tailscale serve --bg --https 443 http://127.0.0.1:3002

# IdP on a second HTTPS port (https://<host>.<tailnet>.ts.net:8443/)
tailscale serve --bg --https 8443 http://127.0.0.1:3003
```

Then set `IDP_ISSUER=https://<host>.<tailnet>.ts.net:8443` and
`OIDC_APP_REDIRECT_URI=https://<host>.<tailnet>.ts.net/auth/callback` in `.env`.

Why port routing rather than a `/idp` path: `oidc-provider` supports an issuer with a
path prefix, but Tailscale Serve's `--set-path` **strips** the prefix before proxying
and has a long-standing sub-path routing bug
([tailscale#12413](https://github.com/tailscale/tailscale/issues/12413)); the IdP would
also need prefix-aware login/logout form actions. A second HTTPS port on the same host
keeps everything same-site with no application changes. `ts.net` is a public suffix, so
both URLs share the registrable domain `<tailnet>.ts.net`.

> The IdP is **not** reachable on the public internet: `tailscale serve` is tailnet-only
> (never `tailscale funnel`), and `idp` binds host loopback only.

Open `https://<host>.<tailnet>.ts.net` on the phone and "Add to Home Screen".

Useful commands:

```unknown
docker compose logs -f       # tail all services
docker compose down          # stop
docker compose up -d --build # rebuild and restart
tailscale serve status       # show the current Serve routes
```

## Development

```unknown
npm run dev        # note-service :3001 + app :3000
npm run dev -w apps/idp   # IdP :3003 (run separately; not in the root dev script)
npm run build      # compile all workspaces
npm run lint
npm test
```

`npm run dev` loads the root `.env.development` (via Node's `--env-file-if-exists`) and
runs with `NODE_ENV=development`, so the auth gates are skipped locally. Ports differ by
mode so a production preview never collides with dev. The API binds loopback on the host
in dev; inside Docker it binds `0.0.0.0` so the web container can reach
`http://note-service:3001`.

Outside production the IdP uses a throwaway database (`apps/idp/data/scratch.db`) — the
dev server and the dev seed share it, and the production identity DB
(`apps/idp/data/idp.db`) is only ever seeded with `NODE_ENV=production`:

```unknown
SEED_USERNAME=you SEED_PASSWORD='…' npm run seed -w apps/idp
```

## Auth model

Identity is owned by the self-hosted IdP (`apps/idp`). Tailscale is **access only** — it
decides whether a device can reach the app, never *who* the user is.

1. **Access (Tailscale).** A tailnet ACL restricts the Serve ports to the owner's
   devices, and Next.js middleware requires the Serve-injected `Tailscale-User-Login`
   header to match `OWNER_LOGIN`; otherwise 403. Funnel does not carry identity headers,
   so never use it. The app container is published on host loopback only, so LAN devices
   cannot bypass this. This gate provides reachability, not identity.
2. **Identity (IdP, OIDC authorization code + PKCE S256).** With no app session, the
   middleware redirects to `/auth/login`, which starts the dance against the IdP
   (`IDP_ISSUER`). The IdP authenticates the user (single seeded account; no signup),
   returns a code to the callback, and the app exchanges it for tokens. The app keeps an
   `HttpOnly`, `SameSite=Lax`, `Secure` session cookie (7-day sliding); tokens live
   server-side only and never reach the browser.
3. **Tokens.** Access tokens are **JWTs** (EdDSA/Ed25519) with `aud=<target service>`
   (default `note-service`) and a 10-minute lifetime; resource servers verify them
   offline against the IdP's JWKS (`GET /jwks`) — no call back to the IdP per request.
   Refresh tokens are opaque, 30-day, rotated on every use, with reuse detection that
   revokes the whole grant family.
4. **Logout.** Posts to `/auth/logout`, which destroys the app session and hands off (a
   top-level GET) to the IdP's `/logout` landing; that landing auto-POSTs the IdP's own
   `POST /logout` from the IdP origin, so the IdP session cookie always attaches. The IdP
   then revokes the user's grants (every refresh token dies immediately) **and** destroys
   its own SSO session (`_session` cleared), so a fresh login requires the password again
   — no silent re-login. RP-initiated/back-channel logout (`end_session`) remains deferred.
5. **BFF → note-service (JWT-only).** The Next.js BFF calls `note-service` over the
   compose network (`http://note-service:3001`) with the caller's **session access
   token** as `Authorization: Bearer <jwt>`. The token is read from the server-side
   session (refreshed when near expiry; a refresh failure means re-login) and never
   reaches the browser. `note-service` verifies it offline against the IdP's JWKS —
   no shared secret, no per-request call to the IdP. The former shared static token
   was retired (see Rollback below).

### Redirect-URI byte-identity

The redirect URI must be the **exact same string** in three places, or login fails
closed at the callback:

1. `.env` → `OIDC_APP_REDIRECT_URI` (used by the app *and* registered on the IdP as
   `OIDC_APP_REDIRECT_URIS`), e.g. `https://<host>.<tailnet>.ts.net/auth/callback`.
2. The Tailscale Serve route that maps the browser URL to `127.0.0.1:3002`.
3. The URL the browser actually lands on after login — same scheme, host, **port**, and
   path.

`IDP_ISSUER` must likewise be the browser-reachable URL (not the compose hostname); it
is the `iss` claim and the base for discovery/authorize/token/JWKS URLs.

For local browser development without Tailscale, no configuration is needed: when
`NODE_ENV=development` (set by `.env.development`) the gates are skipped, so localhost
works with no identity header or session.

### Rollback

Service-to-service auth is JWT-only. If verification needs to be temporarily disabled,
`git revert` the retirement commit restores the previous dual-accept guard (a static
shared token **or** a JWT), and the shared-token env entries can be reintroduced from
that commit's `.env` examples.

## Test / build / lint

```unknown
npm test
npm run build
npm run lint
```

## Data

Single SQLite file (default `apps/note-service/data/life.db`, override with `DB_PATH`). Copying the
file is a complete backup.

`npm run dev` uses `DB_PATH=data/scratch.db` from `.env.development`, so development writes
to a throwaway `apps/note-service/data/scratch.db` and never touches your personal notes. The Docker
Compose API sets `DB_PATH=/data/life.db`, bind-mounted to the real `apps/note-service/data/life.db`
on the host.

## Docs

- Intent: `docs/intent/personal-life-api.md`
- Spec: `docs/specs/SPEC-notes.md`
- Plan / tasks: `tasks/plan.md`, `tasks/todo.md`
- Notes UI spec: `docs/specs/SPEC-notes-ui.md`
- Notes UI plan / tasks: `tasks/plan-notes-ui.md`, `tasks/todo-notes-ui.md`
