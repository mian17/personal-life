# Intent: microservices architecture

Confirmed 2026-09-24 via interview. This is the vision doc for how the repo is shaped;
feature intents live in `docs/intent/personal-life-api.md`, `docs/intent/notes-trash.md`.

## Outcome

Restructure `personal-life` so each domain — notes now, todos later — lives in its own
honestly separate service, with the frontend as a thin `app` consuming them. Names and
boundaries are fixed *before* the todo service arrives.

## User

Me — daily, single-user usage. The repo doubles as my microservices learning ground.

## Why now

`apps/note-service` is already notes-shaped and a todo service is coming; renaming and
boundary work is cheapest before that second domain lands.

## Success

- The repo *speaks* the architecture: `apps/note-service`, `apps/app`, later `apps/todo-service`.
- Services run and deploy independently.
- My notes never get lost or corrupted.
- I can defend (or reject) microservice patterns from hands-on experience, not blog posts.

## Constraint

Single-user, single-host (Compose + Tailscale). Operational cost is acceptable as learning
tuition — **data safety is the one non-negotiable line.** Complexity must pay learning rent,
not just architectural purity rent.

## Out of scope (for this step)

- Building the todo service.
- Multi-host orchestration (k8s, service mesh, message brokers) until a real need shows up.
- Frontend behavior changes beyond the rename.
- Auth/multi-tenancy.

## Layout (2026-09-24 rename)

- `apps/note-service` — NestJS REST API, SQLite (`@life/note-service`). Was `apps/api`.
- `apps/app` — Next.js UI + PWA, server-side BFF, the only API caller (`@life/app`). Was `apps/web`.
- `packages/shared` — shared DTO/types (`@life/shared`).
- Compose services are named `note-service` and `app`; the app calls `http://note-service:3001`.

Historical docs under `docs/superpowers/` keep their original paths; they are dated records.

## Where I'll push back before adding microservice machinery

Each new piece (second DB, service-to-service auth, a broker, an orchestrator) must earn its
place against a real problem, not against "that's how microservices are done."
