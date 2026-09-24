# Capability Map: IdP

Traces to intent: `docs/intent/idp.md` (2026-09-24).
Status: **proposed** — module boundaries, dependency direction, and build order are a
gate; approve (or adjust) before treating the module specs as final.

| Module id | Responsibility | Depends on |
|---|---|---|
| `idp` | The IdP service: users + credentials, login UI + sessions, OIDC core (discovery, authorize, token, JWKS, client registry, refresh tokens) | — |
| `app-rp` | `apps/app` becomes a relying party (authorization code + PKCE); its identity gate moves from the Tailscale header to an IdP login flow | `idp` |
| `note-service-rs` | `apps/note-service` becomes a resource server: verifies JWTs locally via JWKS with an audience scoped to itself; retires `API_TOKEN` | `idp` |

Build order: `idp` → `app-rp` ∥ `note-service-rs` (the last two are parallel and
independently shippable; see the dual-run note below).

Service shape: `idp` ships as one new process — `apps/idp`, package `@life/idp`, its own
SQLite database (`apps/idp/data/idp.db`). Credentials live nowhere else. `app-rp` and
`note-service-rs` are retrofits of existing services, not new processes.

Dual-run note: `app-rp` can land before `note-service-rs` — the BFF keeps presenting
`API_TOKEN` to `note-service` until `note-service-rs` accepts JWTs, at which point the
token is retired (see `deprecation-and-migration` when that happens).

Build order constraint: nothing in `app-rp` or `note-service-rs` may merge while breaking
the current auth flow — the app runs every day.
