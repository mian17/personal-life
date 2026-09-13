# Tasks: Notes — Personal Life API (Domain #1)

Plan: `tasks/plan.md` · Spec: `docs/specs/SPEC-notes.md`

---

## Task 1: Monorepo scaffold + shared types

**Description:** Initialize the npm workspaces monorepo with `apps/api`, `apps/web`, and
`packages/shared`; wire root scripts and TypeScript config.

**Acceptance criteria:**
- [x] Root `package.json` declares workspaces and `dev`/`build`/`test`/`lint` scripts.
- [x] `apps/api`, `apps/web`, `packages/shared` exist with their own `package.json`.
- [x] `packages/shared` exports `Note`, `Tag`, and DTO types.
- [x] `npm install` succeeds from root.

**Verification:**
- [x] `npm run build` succeeds (empty packages build).
- [x] Manual: `npm install` clean.

**Dependencies:** None
**Files:** `package.json`, `tsconfig.base.json`, `apps/*/package.json`, `packages/shared/**`
**Scope:** Medium

---

## Task 2: SQLite + TypeORM wiring and entities

**Description:** Configure TypeORM with the `better-sqlite3` driver and define the `Note`,
`Tag`, and `note_tag` entities matching the spec data model.

**Acceptance criteria:**
- [ ] API boots with TypeORM pointed at `data/life.db` (path from env).
- [ ] Entities: `Note(id, body, createdAt, updatedAt)`, `Tag(id, name unique)`,
      many-to-many join, cascade deletes.
- [ ] Schema auto-syncs on startup in dev.

**Verification:**
- [ ] `npm test` (placeholder) / `npm run build` passes.
- [ ] Manual: start API, confirm `data/life.db` created with the three tables.

**Dependencies:** Task 1
**Files:** `apps/api/src/app.module.ts`, `apps/api/src/**/*.entity.ts`, `apps/api/.env.example`
**Scope:** Medium

---

## Checkpoint: Foundation
- [ ] `npm run build` succeeds for all workspaces
- [ ] API starts and creates the SQLite schema
- [ ] Review before Phase 2

---

## Task 3: Notes module — create + list + get

**Description:** Implement `POST /api/notes`, `GET /api/notes` (reverse-chron,
cursor-paginated, `limit` default 50), and `GET /api/notes/:id`, including tag upsert on
create.

**Acceptance criteria:**
- [ ] Create returns the note with its tags.
- [ ] List is reverse-chron and honors `limit`/`cursor`.
- [ ] `GET /:id` 404s for unknown ids.

**Verification:**
- [ ] e2e test (added Task 5) or curl: create then list returns the note.
- [ ] Manual curl check.

**Dependencies:** Task 2
**Files:** `apps/api/src/notes/*.ts`, `packages/shared/**`
**Scope:** Medium

---

## Task 4: Notes module — update + delete + tag filter

**Description:** Implement `PATCH /api/notes/:id`, `DELETE /api/notes/:id`,
`GET /api/tags`, and `?tag=` / `?q=` filtering on the list.

**Acceptance criteria:**
- [ ] PATCH updates body and reconciles tags.
- [ ] DELETE removes the note and its join rows.
- [ ] `?tag=` and `?q=` return correct subsets; `GET /api/tags` lists tags.

**Verification:**
- [ ] Manual curl: update, delete, filter by tag, text query.
- [ ] Build passes.

**Dependencies:** Task 3
**Files:** `apps/api/src/notes/*.ts`, `apps/api/src/tags/*.ts`
**Scope:** Medium

---

## Task 5: Bearer-token guard + DTO validation

**Description:** Add a global bearer guard checking `API_TOKEN`, and `ValidationPipe` with
shared DTOs (non-empty bounded body; trimmed, deduped, bounded tag names).

**Acceptance criteria:**
- [ ] Missing/wrong token → 401.
- [ ] Invalid body/tags → 400 with a clear message.
- [ ] Valid requests unaffected.

**Verification:**
- [ ] Jest + supertest e2e: create → list → filter by tag → update → delete against a temp
      SQLite file; plus 401 and 400 cases.
- [ ] `npm test` passes.

**Dependencies:** Task 4
**Files:** `apps/api/src/auth/*.ts`, `apps/api/src/**/*.dto.ts`, `apps/api/test/*.e2e-spec.ts`
**Scope:** Medium

---

## Checkpoint: API Core
- [ ] Notes CRUD works via curl with the token
- [ ] Tag filter returns correct subsets
- [ ] `npm test` green
- [ ] Review before Phase 3

---

## Task 6: Next.js app + BFF proxy to the API

**Description:** Scaffold the App Router app and a server-side proxy that injects the
bearer `API_TOKEN` when calling NestJS on loopback `:3001`.

**Acceptance criteria:**
- [ ] `apps/web` serves a page at `:3000`.
- [ ] `/api/*` server-side calls reach NestJS with the token; browser never sees the token.
- [ ] Root `npm run dev` starts both.

**Verification:**
- [ ] Manual: page loads; a proxied call returns API data.
- [ ] Build passes.

**Dependencies:** Task 5
**Files:** `apps/web/app/**`, `apps/web/lib/api.ts`, `apps/web/next.config.*`
**Scope:** Medium

---

## Task 7: Capture screen (textarea + tags + save)

**Description:** Mobile-first capture form: autofocus textarea, tag input, thumb-reachable
Save via a Server Action.

**Acceptance criteria:**
- [ ] Submitting creates a note and reflects it.
- [ ] Layout is usable at phone viewport (safe-area insets, large tap targets).

**Verification:**
- [ ] Manual: capture on desktop + phone viewport.
- [ ] Build passes.

**Dependencies:** Task 6
**Files:** `apps/web/app/page.tsx`, `apps/web/app/actions.ts`
**Scope:** Medium

---

## Task 8: Reverse-chron list + tag filter

**Description:** Server Component list of notes below the capture form, with tappable tag
chips to filter.

**Acceptance criteria:**
- [ ] List renders reverse-chron with tags.
- [ ] Tapping a tag filters the list; clearing restores all.

**Verification:**
- [ ] Manual: create several tagged notes; filter works.
- [ ] Build passes.

**Dependencies:** Task 7
**Files:** `apps/web/app/page.tsx`, `apps/web/app/**/note-list.tsx`
**Scope:** Medium

---

## Checkpoint: End-to-End
- [ ] Note captured from phone browser over Tailscale appears in the list
- [ ] Filter by tag works from the UI
- [ ] Review before Phase 4

---

## Task 9: Tailscale identity-header middleware

**Description:** Next.js middleware gates every route on `Tailscale-User-Login` matching the
owner login; unmatched requests are refused. Document the session-cookie fallback in the
README/spec note (not implemented).

**Acceptance criteria:**
- [ ] Request without the header (or with wrong login) → refused.
- [ ] Request with the correct header → normal app.

**Verification:**
- [ ] Manual: curl the tailnet URL with/without the header.
- [ ] Build passes.

**Dependencies:** Task 8
**Files:** `apps/web/middleware.ts`, `apps/web/.env.example`
**Scope:** Small

---

## Task 10: Edit/delete in the UI + PWA manifest

**Description:** Tap a note to edit body/tags and delete it; add `manifest.json` for
add-to-home-screen.

**Acceptance criteria:**
- [ ] Edit updates the note; delete removes it; list reflects both.
- [ ] `manifest.json` present; installable to home screen.

**Verification:**
- [ ] Manual: edit + delete on phone viewport.
- [ ] Build passes.

**Dependencies:** Task 9
**Files:** `apps/web/app/**`, `apps/web/public/manifest.json`
**Scope:** Medium

---

## Checkpoint: Complete
- [ ] Non-tailnet/unauthenticated access refused
- [ ] API e2e test passes against a temp DB
- [ ] Manual phone verification of full flow
- [ ] All spec success criteria (1–6) met
