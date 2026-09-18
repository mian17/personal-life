# Spec: Notes — Personal Life API (Domain #1)

Date: 2026-09-14
Status: Draft — pending human review
Module id: `notes`
Traces to intent: `docs/intent/personal-life-api.md`
Design source: `docs/superpowers/specs/2026-09-14-personal-life-api-notes-design.md`

## Objective

Centralize the user's personal data into one self-owned API. Domain #1 is **notes/
journaling**: freeform text with light, consistent tags and timestamps, captured from a
phone and readable/filterable later. The notes corpus is deliberately unstructured so it
can be mined later to recommend domain #2, and eventually feed an agent (north star, not
this build).

Success: notes live in the user's own API, tagged and timestamped consistently, captured
from a phone in seconds.

## Tech Stack

- Node.js latest, npm workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`).
- API: NestJS, SQLite via TypeORM (`@nestjs/typeorm` + `better-sqlite3` driver).
  `ponytail:` three tables would need no ORM; TypeORM chosen per user preference. Chosen over
  Prisma because it is the canonical NestJS DI integration with no codegen step. Reversible —
  schema is three entities.
- Web: Next.js App Router, React Server Components for reads, Server Actions for writes.
- Auth: Tailscale identity headers gated in Next.js middleware; service token `API_TOKEN`
  between Next.js and NestJS.
- Tests: Jest + supertest (API e2e).

## Commands

```
Install:   npm install                 (from repo root)
Dev:       npm run dev                 (starts web :3000 + api :3001)
Build:     npm run build               (builds all workspaces)
Test:      npm test                    (runs api e2e)
Lint:      npm run lint
```

## Project Structure

```
apps/api/        NestJS API (notes + tags modules, auth guard, SQLite access)
apps/web/        Next.js UI + PWA; middleware gates on Tailscale identity header
packages/shared/ DTO / model types shared by web and api
docs/            Intent, design, specs
tasks/           plan.md, todo.md (created during planning)
```

## Code Style

- TypeScript strict; no `any` at module boundaries.
- DTOs validated with `class-validator`; types exported from `packages/shared`.
- Raw SQL in a single data-access module per entity; controllers stay thin.
- No comments unless a non-obvious tradeoff needs explaining.

```ts
export class CreateNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(20000)
  body!: string;

  @IsArray() @IsString({ each: true }) @MaxLength(50, { each: true })
  tags: string[] = [];
}
```

## Data Model

```
note(id TEXT PK, body TEXT NOT NULL, created_at TEXT, updated_at TEXT, deleted_at TEXT NULL)
tag(id INTEGER PK, name TEXT UNIQUE)
note_tag(note_id → note ON DELETE CASCADE, tag_id → tag ON DELETE CASCADE, PK(note_id, tag_id))
```

`ponytail:` tags as their own table (not a CSV) because filtering is the first feature past
capture. `ponytail:` search via `LIKE`; FTS5 only if quality bites. `ponytail:` no `type`
column until a second note-like kind appears. `ponytail:` soft-delete is a nullable
`deleted_at` timestamp (null = active); no separate trash table and no scheduled purge,
matching the confirmed intent's "trash never purges on its own".

## API Surface

All under `/api`, guarded by a single bearer-token guard (`API_TOKEN`); no users/sessions.

```
POST   /api/notes               { body, tags[] }
GET    /api/notes?tag=&q=&limit=&cursor=
GET    /api/notes/trash?limit=&cursor=
DELETE /api/notes/trash
GET    /api/notes/:id
PATCH  /api/notes/:id           { body?, tags? }
DELETE /api/notes/:id
POST   /api/notes/:id/restore
DELETE /api/notes/:id/permanent
GET    /api/tags
```

- `tags` on write = array of names; API upserts and reconciles `note_tag`.
- List reverse-chron, cursor-paginated (`created_at` + `id`), `limit` default 50.
- `DELETE /api/notes/:id` is a **soft** delete: sets `deleted_at`; the note leaves the
  list, `GET /:id`, and tag filters but remains recoverable. Trash/restore never change
  `version`.
- `GET /api/notes/trash` lists only soft-deleted notes, ordered `deleted_at DESC, id DESC`,
  cursor-paginated (`deleted_at` + `id`); same `limit` rules as the main list.
- `DELETE /api/notes/trash` empties the trash (`{ ok: true, count }`).
- `POST /api/notes/:id/restore` clears `deleted_at`, preserving `createdAt`, tags, and
  `version`.
- `DELETE /api/notes/:id/permanent` hard-deletes a trashed note; 404 if it is not in trash.
- Static `trash` routes are declared before `:id` routes so `/trash` is not parsed as an id.
- Trashed notes are excluded from `GET /api/tags` (a tag with only trashed notes is hidden).

## Authentication & Authorization

No authorization (single user owns everything). Authentication boundary:

1. **Network:** Tailscale ACL — only tailnet devices reach port 3000 (primary boundary).
2. **Browser → Next.js:** `tailscale serve` identity header `Tailscale-User-Login`;
   middleware gates every route on it matching the owner login
   (`lethevinh1997@gmail.com`). No login page/session.
   **Verified** (Tailscale 1.102.4, 2026-09-14): Serve injects`Tailscale-User-Login` and
   strips/ignores forged copies of the header; Funnel does **not** carry identity headers,
   so **Serve, not Funnel** is required. Headers are not populated for tagged devices
   (user devices are fine). Backend must bind loopback only — verified setup uses
   `tailscale serve --https 443 http://127.0.0.1:<port>` after
   `sudo tailscale set --operator=$USER`. HTTPS certs must be enabled in the tailnet.
   `ponytail:` if this ever becomes unavailable, fall back to exchanging `API_TOKEN` for a
   signed `HttpOnly` `SameSite=Lax` session cookie via a one-time login.
3. **Next.js → NestJS:** server-side `API_TOKEN`; NestJS binds loopback only.
4. **Scripts:** run on the host, use `API_TOKEN` directly. No PAT table yet.

`.env` gitignored and `chmod 600`; token never logged or sent to the browser.

## Testing Strategy

- **API:** one Jest + supertest e2e covering create → list → filter by tag → update →
  delete, against a temp SQLite file. The single runnable check. Trash coverage: a
  soft-deleted note is absent from the list and `GET /:id` (404) but present in
  `GET /api/notes/trash`; restore returns it with the same `createdAt`, tags, and
  `version`; permanent delete removes it from trash and 404s on a second call; and
  `DELETE /api/notes/trash` empties the trash and returns a `count`.
- **Web:** manually verified at phone viewport; no automated UI test in v1.

## Boundaries

- **Always:** validate inputs at the API boundary; run the e2e test before commits; keep
  the token server-side only.
- **Ask first:** adding a dependency; changing the data model; exposing a new port.
- **Never:** commit secrets; expose the API beyond loopback; remove the failing test to
  make a build pass.

## Success Criteria

1. Create a note with tags from a phone browser over Tailscale and see it appear in the
   reverse-chron list in under ~5 seconds round trip.
2. Filter the list by a tag and by a text query; results are correct.
3. Edit a note's body and tags; delete a note; list reflects it.
4. `npm test` passes the single e2e path against a temp DB.
5. Unauthenticated browser access (non-tailnet) is refused by middleware.
6. Data persists in a single SQLite file; copying the file is a complete backup.

## Open Questions

All resolved 2026-09-14:

1. Node version / package manager: latest Node, npm. ✓
2. ORM: TypeORM (per user preference) instead of raw SQL. ✓
3. Tailscale identity header: verified live on Tailscale 1.102.4 — Serve injects
   `Tailscale-User-Login`, strips forged copies, and is the correct transport (Funnel is
   not). ✓
