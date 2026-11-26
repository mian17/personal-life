---
type: "Reference"
title: "System overview"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-0d8b2ba21ac2a0ecea9055df
    resource: repo://apps/app/proxy.ts
  - id: openwiki-source-e201e686a785f09b6d899f0b
    resource: repo://compose.yaml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-eed9fbfe3a39f063b4923686
    resource: repo://scripts/arch-check.mjs
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# System overview

A self-owned personal API in one monorepo: nine apps, ten shared packages, and a
Docker Compose stack that runs the whole thing on the owner's machine behind a
Tailscale gate. Domain #1 is notes/journaling; todos, meals/nutrition, focus
sessions, tags and feedback ride the same architecture.

## The deployed topology

`compose.yaml` defines **18 services** on one internal `life` network:

| Group | Services |
|---|---|
| Built images (8) | `app`, `idp`, `note-service`, `tags-service`, `todo-service`, `feedback-service`, `meal-service`, `focus-service` |
| Cache (8) | `redis-app`, `redis-idp`, `redis-note`, `redis-tags`, `redis-todo`, `redis-feedback`, `redis-meal`, `redis-focus` — one per service, no shared cache |
| Stores & broker (2) | `postgres-feedback` (the one Postgres service), `rabbitmq-feedback` |

Every other service is SQLite, one database file per service on a bind-mounted
`data/` directory. Named volumes exist for the Redis/Postgres/RabbitMQ data.

## The monorepo

Nine apps (`apps/`): `app` (Next.js UI + PWA, the server-side BFF is the only
API caller), `idp` (NestJS OIDC identity provider), and six domain services —
`note-service`, `tags-service`, `todo-service`, `feedback-service`,
`meal-service`, `focus-service` — plus `pomodoro`, focus-screen React components
with no port and no server.

Ten packages (`packages/`): `shared` (DTOs/types), `ui` (the visual language),
`app-kit` (Next helpers), `crypto` (at-rest envelopes), `cache` (the
read-through cache), `service-kit` (auth, health, outbox, keys), `nutrition`
(math), `db` (backup/restore CLIs), `ops` (data-operations registry + `life-ops`
CLI), `mcp-gateway` (stdio MCP server over that registry).

## The contracts that bind them

Two hard contracts live in `AGENTS.md` and are enforced by review plus
mechanical checks:

1. **Shared UI.** Every app renders from `@life/ui` — atoms, blocks, tokens.
   A raw `<button>`/`<input>`/styled `<div>` in app UI code is a symptom, not an
   implementation. See [Shared UI contract](ui-contract.md).
2. **BE → cache → DB.** Every domain service is three layers: service logic,
   a read-through cache, a database reached only through the loader. Ciphertext
   lives at rest and in the cache. See [Data layer](data-layer.md) and
   [Crypto at rest](crypto-at-rest.md).

On top of those, `scripts/arch-check.mjs` (run as `npm run arch:check`, and in
CI) mechanically enforces the topology rules a static read can prove:

- **RULE 3 — one database per service.** Two services may not resolve to the
  same store (same mount, same SQLite file, same Postgres database name); a
  `apps/<name>-service` directory may not ship storeless.
- **RULE 4 — the engine is designated.** SQLite everywhere except explicitly
  allowlisted Postgres services (`feedback-service`).
- **RULE 5 — no cross-service store access.** No importing another service's
  source, no literal path to another service's database file.
- **RULE 6 — required env is forwarded.** Every variable a service reads with no
  fallback must be a key in that service's own `environment:` block in
  `compose.yaml`.
- **RULE 7 — no self-hosted runners.** No workflow may name `self-hosted`;
  PR-triggered code never runs on the owner's machine. See
  [CI gates](../operations/ci-gates.md).

Rules 3, 4 and 6 judge the *topology* (compose + sources), not the diff; rule 5
is diff-scoped. The two cache rules (reads through `getThrough`, ciphertext in
the cache) need a reader and are covered by review and the shared cache
implementation instead.

## Request path, end to end

A browser request reaches `app` through the Tailscale access gate
(`proxy.ts` → `gate.ts`: 403 without the owner's headers, 307 to the IdP for an
unauthenticated visitor). The Next.js server acts as the BFF — it is the only
component that calls domain services. Services authenticate bearer tokens from
the IdP via `@life/service-kit`'s `AuthGuard`, read/write through their cache,
and encrypt content before it reaches disk.

## See also

- [Identity and access](../workflows/identity-and-access.md) — the gate and the IdP.
- [Service kernel](service-kernel.md) — what every service shares.
- [CI gates](../operations/ci-gates.md) — how the contracts stay enforced.
