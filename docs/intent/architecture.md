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
- Multi-host orchestration (k8s, service mesh, message brokers) until a real need shows up
  — **revised 2026-10-03 by the feedback chapter** (see Revision below).
- Frontend behavior changes beyond the rename.
- Auth/multi-tenancy.

## Revision — first broker + first Postgres (2026-10-03, feedback chapter)

An explicit cross-chapter revision of the 2026-09-24 decisions above, recorded here at the
governing doc (per lesson 0012) rather than restated locally in the new chapter.
Source: `docs/intent/feedback-service.md` decision 8.

- **"message brokers … until a real need shows up"** — the feedback chapter's durable
  push-on-write event stream is that real need. It earns the repo's **first broker,
  RabbitMQ** (`rabbitmq-feedback` compose service) and its **first Postgres store** (`postgres-feedback`
  compose service) for `feedback-service`.
- **SQLite is not abandoned.** The existing four services — `note-service`, `tags-service`,
  `todo-service`, `idp` — stay on SQLite; the SQLite→Postgres data-tier migration is
  deferred. Postgres is the store for the new service, not a repo-wide switch.
- **Not re-opened:** single-user, single-host (Compose + Tailscale); no k8s or service mesh;
  the broker is distribution only.

## Layout (2026-09-24 rename)

- `apps/note-service` — NestJS REST API, SQLite (`@life/note-service`). Was `apps/api`.
- `apps/meal-service` — NestJS REST API on `:3106`, SQLite via `@life/db`, owner-scoped (`@life/meal-service`).
- `apps/app` — Next.js UI + PWA, server-side BFF, the only API caller (`@life/app`). Was `apps/web`.
- `packages/shared` — shared DTO/types (`@life/shared`).
- Compose services are named `note-service` and `app`; the app calls `http://note-service:3001`.

Historical docs under `docs/superpowers/` keep their original paths; they are dated records.

## Where I'll push back before adding microservice machinery

Each new piece (second DB, service-to-service auth, a broker, an orchestrator) must earn its
place against a real problem, not against "that's how microservices are done."
