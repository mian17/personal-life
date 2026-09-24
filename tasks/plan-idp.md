# Implementation Plan: IdP chapter

Traces to: `docs/intent/idp.md`, `docs/specs/MAP-idp.md` and the three module specs
(`SPEC-idp.md`, `SPEC-app-rp.md`, `SPEC-note-service-rs.md`).
Task list target: `tasks/todo-idp.md` (project convention: per-feature suffixed targets).

## Overview

Build a small, self-owned OIDC IdP as its own service with its own database, then convert
`apps/app` into a relying party and `apps/note-service` into a resource server, retiring
the shared `API_TOKEN`. The daily-use app keeps its current auth flow until each consumer
module lands; the IdP ships dark.

## Architecture Decisions

- **One IdP process, one credential store.** `apps/idp` (`@life/idp`) owns users, password
  hashes, sessions, signing keys, and the client registry in `apps/idp/data/idp.db`.
  Per-service databases from day one — identity data never touches `life.db`.
- **Asymmetric JWT + JWKS.** Services verify offline against the public key set; no call
  to `idp` per request. Audience-scoped tokens (`aud=note-service`) so services refuse
  each other's tokens. This is the actual microservice boundary we're here to learn.
- **Authorization code + PKCE** for `app`; refresh tokens with rotation + reuse detection.
- **Standard primitives only.** argon2id, EdDSA/Ed25519 JWT signing, constant-time
  compares. **Protocol surface: library-backed `oidc-provider`** (decided 2026-09-24) —
  we own users, sessions, clients, policies, and the SQLite adapter; the library owns spec
  compliance. Enable only discovery, code+PKCE, token, refresh rotation, and JWKS.
- **Single seeded user** (me) + seed script; no signup path. Lifetimes: access 10 min,
  refresh 30 days rotating + reuse detection.
- **Tailscale gate is access-only.** Kept solely so only my phone reaches the app (tailnet
  ACL + Serve + header check as access control); identity and authentication come from the
  IdP from now on.
- **Dark-ship and dual-run.** `idp` merges unused first; `app-rp` can run before
  `note-service-rs` (BFF keeps `API_TOKEN` toward `note-service` in between); removal of
  `API_TOKEN` is one dedicated commit following `deprecation-and-migration`.

## Dependency Graph

```unknown
idp:
  users + credentials ──> login + sessions ──> signing keys + JWKS + token issuance
                                              ──> authorize + token (code+PKCE)
                                              ──> refresh rotation
app-rp:            (depends on idp's OIDC surface)  OIDC client ──> login gate swap
note-service-rs:   (depends on idp's JWKS)          verify guard ──> API_TOKEN retirement
```

`app-rp` and `note-service-rs` are independent of each other and may run in parallel.

## Task List

### Phase 0: Precondition (human-owned)

- [ ] Task 0: Rebuild/deploy the renamed stack (`docker compose up -d --build` after
      `down --remove-orphans`) and confirm `app` + `note-service` healthy with current auth.

### Phase 1: `idp` service (sequential)

- [ ] Task 1: `apps/idp` skeleton + own DB + compose service
- [ ] Task 2: Users + credentials (argon2id, seeded user)
- [ ] Task 3: Login UI + sessions
- [ ] Task 4: Signing keys + JWKS + audience-scoped access tokens
- [ ] Task 5: Authorization code + PKCE (`authorize`, `token`, discovery, client registry)
- [ ] Task 6: Refresh tokens with rotation + reuse detection

### Checkpoint: `idp` complete

- [ ] All `idp` e2e green; token verifies offline with `aud` enforced; `life.db` untouched;
      `app` and `note-service` still on current auth (nothing user-visible changed)

### Phase 2: consumers (parallelizable)

- [ ] Task 7: `app-rp` OIDC client (PKCE, state/nonce, callback, server-side session)
- [ ] Task 8: `app-rp` login gate swap (redirect dance, logout, Tailscale gate access-only)
- [ ] Task 9: `note-service-rs` verify guard (JWKS, `aud`, rotation) with dual-accept
- [ ] Task 10: Retire `API_TOKEN` everywhere (one commit, `deprecation-and-migration`)

### Checkpoint: complete

- [ ] Full flow through the IdP on the phone; `API_TOKEN` gone from code/env/compose/README;
      all suites green; `life.db` and `idp.db` verified intact

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OIDC protocol surface has a vulnerability exposing real credentials | High | Library-backed `oidc-provider` (decided); only needed flows enabled; standard primitives only; e2e for every auth branch |
| Breaking daily-use auth during migration | High | Dark-ship `idp`; dual-run windows; the existing 16 `note-service` e2e stay green in every task |
| Key rotation lockout (old `kid` gone, sessions/token unverifiable) | Med | Rotation-tolerant JWKS cache (fetch on unknown `kid`), e2e with a rotated `kid` |
| Session/CSRF attacks on login flows | Med | `state` + `nonce` + PKCE verified on callback; fail-closed e2e tests |
| Scope creep toward a full IAM (roles, passkeys, reset emails) | Med | `docs/intent/idp.md` out-of-scope list is binding; "make it small" is the requirement |

## Parallelization

Tasks 7–10 split into two independent streams (`app-rp` stream: 7→8; `note-service-rs`
stream: 9→10) once Task 4 (JWKS) exists — even before the full OIDC surface lands.

## Decisions (2026-09-24 plan review — all resolved)

1. **Protocol surface: library-backed `oidc-provider`** (MIT, v9.x, OpenID-certified).
2. **Seeded single user** + seed script; no signup path.
3. **Token lifetimes:** access 10 min, refresh 30 days rotating + reuse detection.
4. **Signing alg:** EdDSA/Ed25519 (RS256 only on consumer demand).
5. **Hostname/port:** `idp:3003`.
6. **Tailscale gate: access-only.** Kept solely so only my phone reaches the app (tailnet
   ACL + Serve + header check as access control). Identity and authentication come from
   the IdP from now on, for every service.
7. **App session:** 7 days sliding; logout local-only, first cut.
8. **Dual-accept window** before Task 10: short — same week.
