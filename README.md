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
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Generate a shared token and put the same value in both `.env` files:

```unknown
openssl rand -hex 32
```

Set `OWNER_LOGIN` in `apps/web/.env` to your tailnet login (e.g. `you@gmail.com`).

## Run

```unknown
npm run dev        # api :3001 + web :3000
```

In another terminal, expose the web app on the tailnet (identity headers require Serve,
**not** Funnel):

```unknown
tailscale serve --bg --https 443 http://127.0.0.1:3000
```

Open `https://<host>.<tailnet>.ts.net` on the phone and "Add to Home Screen".

## Auth model

1. Tailscale ACL restricts port 443 to tailnet devices.
2. Next.js middleware requires the Serve-injected `Tailscale-User-Login` header to match
   `OWNER_LOGIN`; otherwise 403. Funnel does not carry identity headers, so never use it.
3. The Next.js BFF holds `API_TOKEN` server-side and calls the API on loopback; the browser
   never sees the token.
4. API scripts run on the host and use `API_TOKEN` directly.

For local browser development without Tailscale, no configuration is needed: when
`NODE_ENV=development` (set by `npm run dev`) both gates above are skipped, so localhost
works with no identity header or `API_TOKEN`. Production behavior is unchanged. The
`DEV_AUTH_BYPASS` variable in `apps/web/.env.example` is unused and has no effect.

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

`npm run dev` sets `NODE_ENV=development` and `DB_PATH=data/scratch.db`, so development
writes to a throwaway `apps/api/data/scratch.db` and never touches your personal notes.
`npm run start` uses the real DB.

## Docs

- Intent: `docs/intent/personal-life-api.md`
- Spec: `docs/specs/SPEC-notes.md`
- Plan / tasks: `tasks/plan.md`, `tasks/todo.md`
- Notes UI spec: `docs/specs/SPEC-notes-ui.md`
- Notes UI plan / tasks: `tasks/plan-notes-ui.md`, `tasks/todo-notes-ui.md`
