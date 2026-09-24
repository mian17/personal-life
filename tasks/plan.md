# Implementation Plan: Notes — Personal Life API (Domain #1)

Spec: `docs/specs/SPEC-notes.md`
Intent: `docs/intent/personal-life-api.md`
Design: `docs/superpowers/specs/2026-09-14-personal-life-api-notes-design.md`

## Overview

Build domain #1 (notes/journaling) end-to-end: a self-owned SQLite-backed NestJS API, a
mobile-first Next.js UI, and a Tailscale-only auth boundary. Vertical slices: scaffold →
notes API with tags → UI capture/list → edit/delete/filter → auth boundary → e2e.

## Architecture Decisions

- npm workspaces monorepo: `apps/note-service` (NestJS), `apps/app` (Next.js), `packages/shared`.
- SQLite + TypeORM via `@nestjs/typeorm`, `better-sqlite3` driver (user choice).
- Next.js server is the BFF: holds `API_TOKEN` server-side, calls NestJS on loopback
  3001. Browser only ever talks to `:3000`.
- Auth: Tailscale Serve injects `Tailscale-User-Login`; Next.js middleware gates routes on
  the owner login. NestJS additionally requires the bearer `API_TOKEN` guard.
  (Verified live: Serve injects + strips forged headers; Funnel is not used.)
- No authorization layer (single user owns everything).

## Task List

Tracked in `tasks/todo.md` (default target). Ordered by dependency.

### Phase 1: Foundation
- [ ] Task 1: Monorepo scaffold + shared types
- [ ] Task 2: SQLite + TypeORM wiring and entities

### Checkpoint: Foundation
- [ ] `npm run build` succeeds for all workspaces
- [ ] API starts and creates the SQLite schema

### Phase 2: Notes API (vertical slice)
- [ ] Task 3: Notes module — create + list + get
- [ ] Task 4: Notes module — update + delete + tag filter
- [ ] Task 5: Bearer-token guard + DTO validation

### Checkpoint: API Core
- [ ] Notes CRUD works via curl with the token
- [ ] Tag filter returns correct subsets

### Phase 3: Web UI (vertical slice)
- [ ] Task 6: Next.js app + BFF proxy to the API
- [ ] Task 7: Capture screen (textarea + tags + save)
- [ ] Task 8: Reverse-chron list + tag filter

### Checkpoint: End-to-End
- [ ] Note captured from phone browser over Tailscale appears in the list
- [ ] Filter by tag works from the UI

### Phase 4: Auth Boundary + Hardening
- [ ] Task 9: Tailscale identity-header middleware
- [ ] Task 10: Edit/delete in the UI + PWA manifest

### Checkpoint: Complete
- [ ] Non-tailnet/unauthenticated access refused
- [ ] API e2e test passes against a temp DB
- [ ] Manual phone verification of full flow

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Next.js version/App Router API drift | Med | Confirm versions at Task 6; source-driven |
| TypeORM + better-sqlite3 type friction | Low | Keep entities minimal; raw query escape hatch |
| Identity header absent on some client | Med | Verified live; session-cookie fallback documented |
| SQLite single-writer contention | Low | Single user; acceptable per spec |
| Laptop asleep on capture | Med | Accepted in v1; offline queue deferred |

## Open Questions

None — all spec open questions resolved 2026-09-14.

## Definition of Done

- Spec success criteria (1–6) all met.
- `npm test` passes the single API e2e path.
- Manual phone verification over Tailscale.
