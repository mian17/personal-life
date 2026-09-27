# Confirmed Intent: todo-ecosystem (todo + shared tags + service contracts)

Confirmed by the user 2026-09-28 via interview-me (explicit "yes" on the restate,
after two refinements: tags extraction, health routes).

## Statement of intent (the confirmed restate)

- Outcome: three moves as one effort —
  (1) extract tags from note-service into a standalone `apps/tags-service`
  (the ecosystem-wide tag authority: any entity in any service can be tagged),
  (2) build `apps/todo-service` with title, optional note, done toggle, due date,
  todo-local lists + references into the shared tags,
  (3) UI at `/notes` (moved from `/`) and `/todos` (new),
  (4) a uniform `/health/live` + `/health/ready` pair on every service.
- User: single user (personal + work), daily driver beside `/notes`.
- Why now: `@life/crypto` is ready to consume, and the todo domain + future
  ecosystem interactions need one tag vocabulary and consistent service contracts
  before anything orchestrates them.
- Success: todos captured/cleared daily in `/todos`; tags act as one vocabulary
  everywhere (create anywhere, rename ecosystem-wide, delete detaches, content is
  never deleted as a side effect); note-service's existing tags survive extraction
  untouched; every service answers the same health dialect; contracts (`TagRef`,
  todo REST DTOs, `origin` links, health routes) documented so a later orchestrator
  or Kubernetes rollout is pure addition.
- Constraint: contract consistency first (the orchestrator seam); `tags-service`
  is the sole registry (domains reference tags by id, never store names);
  `@life/crypto` at rest in every new/moved service + AGENTS.md Contract 2 cache layer;
  readiness mirrors real failure semantics (fail-open cache never gates it);
  frozen Playwright selectors except the URL navigation the route request covers;
  the tag data migration and deploys are human-run at the cut-over.
- Out of scope: the ecosystem suggestion layer ("remember to…" → todo — its own
  later chapter); schedule/pomodoro; lists/notes appearing in each other's app;
  recurrence, subtasks, priorities; any orchestrator now.

## Interview decisions (fleshed out in the specs)

| # | Decision |
|---|---|
| I1 | `todo-service` is a standalone service — NOT a productivity monolith. Rationale from the user: keep services separable, make contracts consistent and agreed-upon now so switching to an orchestrator later causes no rework. |
| I2 | MVP todo fields: title, optional note, done toggle, due date. Organized by tags + lists. No recurrence/subtasks/priorities (v2 candidates). |
| I3 | Tags are one ecosystem-wide vocabulary, extracted from note-service into their own service: create from any app, rename affects the whole ecosystem, delete detaches everywhere (content never deleted). "In the future tags could mean anything associated with it across the whole ecosystem." |
| I4 | Lists are todo-local and must not show in the notes app ("for now" — the two apps stay separated). |
| I5 | Routes: `/` → `/notes`, todo at `/todos` (plural). The user's route request is the explicit approval for the Playwright navigation URL changes — nothing else in the frozen e2e surface moves. |
| I6 | Health: uniform `/health/live` + `/health/ready` on every service so Docker/Kubernetes can monitor them later. Recommendation accepted: liveness never checks dependencies; readiness checks DB + key custody and deliberately NOT the fail-open cache. |
