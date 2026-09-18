# Personal Life

A self-owned personal API that centralizes life data. Domain #1 is **notes/journaling**.

- `apps/api` — NestJS + TypeORM/SQLite REST API (loopback only).
- `apps/web` — Next.js App Router UI + PWA; the server-side BFF is the only API caller.
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

Generate a token and put the same value in the `API_TOKEN` of whichever file you're using:

```unknown
openssl rand -hex 32
```

Set `OWNER_LOGIN` to your tailnet login (e.g. `you@gmail.com`).

## Production (Docker Compose)

Docker Compose is the production path; `npm run start` is no longer used. The web app is
built and published on host loopback only, and the API runs internal to the compose
network with no published port.

```unknown
cp .env.example .env
# Edit .env: set API_TOKEN (openssl rand -hex 32) and OWNER_LOGIN to your tailnet login.
docker compose up -d --build
```

The root `.env` is gitignored and is the single source of secrets for both services. The
real database lives at `apps/api/data/life.db` on the host and is bind-mounted into the API
container at `/data/life.db`, so no data moves.

Expose the web app on the tailnet (identity headers require Serve, **not** Funnel):

```unknown
tailscale serve --bg --https 443 http://127.0.0.1:3003
```

Open `https://<host>.<tailnet>.ts.net` on the phone and "Add to Home Screen".

Useful commands:

```unknown
docker compose logs -f       # tail both services
docker compose down          # stop
docker compose up -d --build # rebuild and restart
```

## Development

```unknown
npm run dev        # api :3001 + web :3000
npm run build      # compile both workspaces
npm run lint
npm test
```

`npm run dev` loads the root `.env.development` (via Node's `--env-file-if-exists`) and
runs with `NODE_ENV=development`, so auth is skipped locally. Ports differ by mode so a
production preview never collides with dev. The API binds loopback on the host in dev;
inside Docker it binds `0.0.0.0` so the web container can reach `http://api:3001`.

## Auth model

1. Tailscale ACL restricts port 443 to tailnet devices.
2. Next.js middleware requires the Serve-injected `Tailscale-User-Login` header to match
   `OWNER_LOGIN`; otherwise 403. Funnel does not carry identity headers, so never use it.
   The web container is published on host loopback (`127.0.0.1:3003`) only, so LAN devices
   cannot bypass this by hitting the port directly.
3. The Next.js BFF holds `API_TOKEN` server-side and calls the API over the compose network
   (`http://api:3001`); the API is never published to the host and the browser never sees
   the token.
4. API scripts run on the host and use `API_TOKEN` directly.

For local browser development without Tailscale, no configuration is needed: when
`NODE_ENV=development` (set by `.env.development` for `npm run dev`) both gates above are
skipped, so localhost works with no identity header or `API_TOKEN`. Production behavior is
unchanged.

Fallback if identity headers are ever unavailable: exchange `API_TOKEN` for a signed
`HttpOnly` session cookie via a one-time login.

## Test / build / lint

```unknown
npm test
npm run build
npm run lint
```

## Data

Single SQLite file (default `apps/api/data/life.db`, override with `DB_PATH`). Copying the
file is a complete backup.

`npm run dev` uses `DB_PATH=data/scratch.db` from `.env.development`, so development writes
to a throwaway `apps/api/data/scratch.db` and never touches your personal notes. The Docker
Compose API sets `DB_PATH=/data/life.db`, bind-mounted to the real `apps/api/data/life.db`
on the host.

## Docs

- Intent: `docs/intent/personal-life-api.md`
- Spec: `docs/specs/SPEC-notes.md`
- Plan / tasks: `tasks/plan.md`, `tasks/todo.md`
- Notes UI spec: `docs/specs/SPEC-notes-ui.md`
- Notes UI plan / tasks: `tasks/plan-notes-ui.md`, `tasks/todo-notes-ui.md`
