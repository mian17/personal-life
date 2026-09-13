# Personal Life API — Notes (Domain #1) Design

Date: 2026-09-14
Status: Approved (pending user review of written spec)

## Goal

A personal, self-owned API that centralizes one's life data so apps no longer need to be
scattered across services. This spec covers **domain #1 only: notes/journaling**. Other
domains (tasks, health, finances, contacts, media) are explicitly out of scope and will be
added later, one at a time, letting the shared core emerge from real use rather than being
guessed up front.

Success criterion for v1: capture a note from a phone in seconds and read/filter past notes,
with all data owned locally.

## Constraints & Decisions

- **Stack:** NestJS + SQLite for the API; Next.js (App Router) for the UI.
- **Hosting:** local-only, reachable from phone over Tailscale. No public exposure, no TLS
  cert management. Path to a ~$4–5/mo VPS if always-on access is later required.
- **Interaction:** API + mobile-first web UI (installable PWA).
- **Cost-conscious:** zero recurring cost initially.

## 1. Architecture (two processes, one host)

```
browser (phone / laptop)
        │  Tailscale (encrypted)
        ▼
Next.js  apps/web  :3000   ── serves UI + PWA, proxies /api/* server-side
        │  localhost only
        ▼
NestJS   apps/api  :3001   ── REST ── SQLite  data/life.db
```

- npm workspaces monorepo: `apps/web`, `apps/api`, `packages/shared`.
- `packages/shared` holds DTO / model types (Note, Tag) reused by web and api. It starts
  with only what notes need.
- **Next.js server acts as a BFF.** It holds `API_TOKEN` and proxies to NestJS. The browser
  never sees the token, so there is no CORS config, no token in localStorage, and only
  port 3000 is exposed on the Tailscale interface. NestJS binds to localhost only.
- Both processes start with one root `npm run dev` (concurrently); in production a single
  systemd unit (or equivalent) supervises both.
- SQLite file is the whole datastore. Backup = copy the file.
  `ponytail:` single-writer only — fine for a single user; move to Postgres only if multiple
  instances are ever run.

### Availability

Tailscale is a mesh VPN, not a LAN tool: the phone reaches the laptop from any network
(cellular included), via NAT hole-punching with a DERP relay fallback. Location is irrelevant.
The real constraint is that **the laptop must be powered on and awake** for capture to work.
v1 accepts this; an always-on VPS (~$4–5/mo) or a phone-side offline queue is the upgrade path.

## 2. Data Model

Scope is notes and tags only. No generic "records/links" abstraction yet.

```
note
  id          TEXT PK (uuid)
  body        TEXT NOT NULL
  created_at  TEXT (ISO-8601 UTC)
  updated_at  TEXT (ISO-8601 UTC)

tag
  id    INTEGER PK
  name  TEXT UNIQUE

note_tag
  note_id  → note.id (ON DELETE CASCADE)
  tag_id   → tag.id  (ON DELETE CASCADE)
  PK (note_id, tag_id)
```

`ponytail:` add a `type` column when a second note-like kind appears.
`ponytail:` search via SQLite `LIKE` — replace with FTS5 only if search quality becomes a problem.

Tags are a real table rather than a delimited string because tag filtering is the first
feature beyond capture, and a DB-level join is the correct place for it.

## 3. Authentication & Authorization

With a single user there is no **authorization** requirement — no roles, no per-resource
permission checks; the user owns everything. What matters is a well-drawn **authentication
boundary**. Four layers, each reusing something already present:

1. **Network — Tailscale ACL (primary boundary).** Only devices on the tailnet can reach
   port 3000. This is the strongest and cheapest layer; the rest is defense in depth.
2. **Browser → Next.js — Tailscale identity headers.** Served via `tailscale serve`, which
   injects an identity header (e.g. `Tailscale-User-Login`). Next.js middleware gates every
   route on that header matching the owner's login. No login page, no session store, no
   cookie — the tailnet has already authenticated the device.
   `ponytail:` verify the identity header is actually injected in the chosen `tailscale serve`
   setup during implementation; if it is not available, fall back to exchanging the token for
   a signed `HttpOnly` `SameSite=Lax` session cookie via a one-time login.
3. **Next.js → NestJS — service token.** `API_TOKEN` lives server-side only; a NestJS guard
   checks it and NestJS binds to loopback. This stops other local processes/users on the host
   from touching the API.
4. **Scripts / CLI → API.** Remote scripts cannot reach the loopback-only API. In v1, run
   scripts on the host and use `API_TOKEN` directly. A hashed personal-access-token table with
   independent revocation is deliberately deferred until remote scripts are actually needed.

Secrets: `.env` is gitignored and `chmod 600`; the token is never logged or sent to the
browser. Origin checks plus Server Actions' built-in CSRF protection cover the browser path.
No rate limiting — the Tailscale boundary and single user make it unnecessary.

## 4. API Surface

All routes are served by NestJS under `/api`, protected by a single bearer-token guard
(`API_TOKEN` env). No users table, sessions, or refresh tokens — single user.

```
POST   /api/notes          { body, tags[] }          → created note
GET    /api/notes?tag=&q=&limit=&cursor=             → list (reverse-chron)
GET    /api/notes/:id
PATCH  /api/notes/:id      { body?, tags? }
DELETE /api/notes/:id
GET    /api/tags
```

- `tags` on write is an array of names; the API upserts tags and reconciles `note_tag`.
- List is paginated with a cursor (created_at + id); `limit` default 50.
- Validation via NestJS `ValidationPipe` with DTOs from `packages/shared` (`body` non-empty,
  bounded length; tag names trimmed, deduplicated, bounded length).

## 5. UI — Next.js (App Router)

Single primary screen (`app/page.tsx`):

- Large autofocus textarea → tag input → Save button.
- Reverse-chron list of notes below; tag chips are tappable to filter/edit.
- Mobile-first: correct viewport meta, thumb-reachable Save, safe-area insets.
- Reads: React Server Components fetch from the NestJS API via the server-side proxy.
- Writes: Server Actions; no client-side fetch layer.
- PWA: `manifest.json` + add-to-home-screen for an app icon with no native build.
  `ponytail:` no service worker / offline queue in v1 — add when offline journaling is
  actually needed.

## 6. Testing

- **API:** one `supertest` e2e test covering create → list → filter by tag → update → delete,
  run against a temporary SQLite database. This is the single runnable check.
- **Web:** manually verified on phone viewport; no automated UI test in v1.

## 7. Out of Scope (v1)

Multi-user, sync/conflict resolution, rich text / markdown rendering, search ranking, note
linking within or across domains, and the other five life domains.

## 8. Future Core Extraction

When domain #2 (e.g. tasks) is added, promote only what both domains genuinely share
(candidate: a common `tag`, timestamp conventions, list/pagination behavior, auth guard,
BFF/proxy pattern). Do not build a speculative generic core before then.
