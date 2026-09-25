# Intent: small, self-owned IdP

Confirmed 2026-09-24 via interview (continues `docs/intent/architecture.md`).
The build artifacts live in `docs/specs/` — see the map at `docs/specs/MAP-idp.md`.

## Outcome

- **Now (closed 2026-09-25):** the renamed stack kept running on its existing auth code
  flow — Tailscale identity header at the edge, BFF-held `API_TOKEN`. Nothing about auth
  changed until the IdP landed. *(Horizon closed: deploy attested by the human
  2026-09-25; `feature/idp` merged to `master`, five-lane N/N.)*
- **Later → landed 2026-09-25:** a small, self-owned IdP (OpenID Connect provider) is now
  the single source of identity for the stack. The app is a relying party (authorization
  code + PKCE); `note-service` (and later `todo-service`) verifies tokens via JWKS. We own
  the IdP; it stays small on purpose. The Tailscale gate is kept for access
  only (only my phone reaches the app); identity and authentication come from the IdP
  from now on.

## User

Me — daily use, single user today. Shaped so admitting someone later is a data change,
not a rewrite.

## Why now

Daily use cannot wait on an auth rewrite, so the running app stays untouched. The IdP is
the next learning chapter and is built deliberately, after the rename chapter closed.

## Success

- Now: containers healthy, auth behavior unchanged.
- Later: one source of identity in the stack; every service authenticates its own callers
  with per-service, audience-scoped tokens; no secret shared across services; I can defend
  OIDC flow design hands-on.

## Constraint

Small and boring wins. Standard primitives only (argon2id/bcrypt, standard JWT signing,
constant-time compares) — **credential safety is as hard a line as data safety.** Single
host, single-user scale. "Small IdP" means core OIDC only: login, users, sessions,
clients, token issuance, JWKS.

## Out of scope (first IdP cut)

Roles/permissions, passkeys, social login, federation, multi-tenancy, email/reset
infrastructure, and RP-initiated logout (`end_session` + back-channel logout).

## Decisions log

- 2026-09-25: **Logout revokes grants (decision B).** `revokeByGrantId` on logout, so every
  refresh token dies immediately. Stateless 10-min access tokens live out their TTL by
  design. **RP-initiated logout (decision C) is deferred** to the multi-RP chapter, where
  its core action is exactly this revocation — B is the engine, C is the standard wrapper.
- 2026-09-25: **Logout also ends the SSO session.** Beyond revoking grants, the IdP
  destroys its own provider session and clears the `_session` cookie on logout — a fresh
  login requires the password again (no silent SSO re-resolve).
