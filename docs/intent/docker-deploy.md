# Intent — Docker Compose deployment

Date: 2026-09-18
Status: Confirmed by user

## Outcome

A `docker compose`-based production deployment that fully replaces `npm run start`.
The only externally reachable service is the web app, published on host loopback port 3002
for Tailscale Serve to target. The API runs internal-only on the compose network.

## User

The user alone, on their own host, reaching the app from their phone over the tailnet.

## Why now

The manual `npm run start` (api :3003 + web :3002) is fragile to run and keep in sync.
Containers make production a single reproducible command.

## Success

- `docker compose up -d --build` builds and runs web + api.
- Web is published `127.0.0.1:3002` (loopback only), api is not published.
- Web reaches the api over the compose network by service name.
- Tailscale Serve targets `http://127.0.0.1:3002` and works from the phone.
- Existing `apps/note-service/data/life.db` is bind-mounted, so all real notes survive untouched.

## Constraints

- Secrets (`API_TOKEN`, `OWNER_LOGIN`) come from a gitignored root `.env` loaded by compose.
  Never committed.
- The real DB is a host bind-mount; zero migration.
- Production auth (Tailscale `tailscale-user-login` header + BFF `API_TOKEN`) stays enforced:
  the web container must NOT run with `NODE_ENV=development`.
- Web must keep binding host loopback only (publish `127.0.0.1:3003`) so the middleware's
  "no `x-forwarded-host` means local host" assumption stays true and LAN devices cannot
  bypass auth by hitting 3002 directly.
- Do not copy `apps/note-service/data/` or `.env*` into any image.

## Out of scope

- Containerizing Tailscale itself.
- Changing the dev workflow (`npm run dev` stays as-is).
- DB migration or data changes.
- Auto-purging trash or other feature work.

## Decisions

- 3002 (the web's former `npm run start` port) becomes the web's published host port.
- Internal API port is 3001; internal web port is 3002.
- Bind-mount `apps/note-service/data/` from the host.
- Env via a single root `.env` consumed with compose `env_file`.
