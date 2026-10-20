# Intent: shared data-operations package (CLI + MCP platform)

- Outcome: Build the shared data-operations platform package `packages/ops` (name up for grabs) — an operation-registry core + shared CLI adapter + shared MCP adapter + shared auth/IdP-token plumbing + HTTP transport — so a future per-service module registers its resources and gets full CRUD on both front-ends from one definition. No per-service modules in this change.
- User: The user — terminals/scripts today, AI clients and future integrations later; the consistent per-service seam is the point.
- Why now: Services are built in parallel and have HTTP APIs only; nothing outside the web app can touch the data, and hand-writing CLI + MCP per service would duplicate the same CRUD twice per service.
- Success: The package proves the contract on its own: one in-package sample resource registry exercises create/get/list/update/delete through both the CLI adapter and the MCP adapter against the same stub API (tests prove parity) — wiring a real service later is just "register resources, point at the API base."
- Constraint: Single-definition DRY design — validation, JSON-schema derivation, auth, transport, error shape live in the core once; adapters only render the registry. Auth is IdP login → local token store (chmod 600). Touches nothing under `apps/` (services are being modified in parallel and must not need any change). Adapters target the services' existing HTTP API contract as its first consumer.
- Out of scope: Per-service registry modules (note/todo/meal/feedback/tags), any edit under `apps/`, cross-service integration/gateway, non-CRUD ops (health/cache/admin), idp resources, UI changes, HTTP API shape changes, publishing beyond the workspace.

## Confirmation
Confirmed: yes — the user explicitly answered "yes" to the six-line restate (2026-10-16), after confirming the ASCII architecture diagram and the narrowed shared-package-only scope. Approved to proceed.

## Design notes (from the interview)
- Scope was deliberately narrowed mid-interview: "currently focus only on the shared package, since other services are running in parallel, i do not want to touch them." The per-service registry modules are a later integration step and are explicitly out of scope; the package must be buildable and testable without any service.
- Purpose stated by the user: "i just want the options to open so that i can integrate later with other services" — the package exists to make future integration cheap, not to integrate now. CLI and MCP are data operations (resource CRUD), not ops/admin tooling (health, cache, backups were explicitly excluded).
- DRY intent is explicit ("both is a shared package, i want to adapt the DRY principles"): one resource/operation definition drives both front-ends. The adapters render the registry; they never own validation, schemas, auth, transport, or error shape.
- Architecture confirmed via ASCII diagram: core (registry + JSON-schema derivation) → cli adapter + mcp adapter, both over shared plumbing (IdP auth: login → local token store chmod 600, HTTP transport with owner auth header + error mapping). Future per-service modules are thin `register(...)` files pointing at each service's API base; the sample registry in `packages/ops/src/fixtures/` is the test target standing in for them.
- MCP adapter is an MCP stdio server exposing registry ops as tools (`todo_create` shape); CLI adapter exposes subcommands (`life-ops <resource> <op> [flags]`). Parity between the two is a tested property, not a convention.
- The services' existing HTTP APIs are the contract the transport targets (first consumer of the future integration surface); no service change is permitted or required.
