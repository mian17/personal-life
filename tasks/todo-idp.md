# Todo: IdP chapter

Traces to: `tasks/plan-idp.md`, `docs/specs/MAP-idp.md`.
Status: approved at plan review (2026-09-24), decisions recorded in `tasks/plan-idp.md`.
Implementation has **not** started — Task 1 begins on the human's go.

## Task 0: Rebuild/deploy the renamed stack (human-owned)

**Description:** Bring the production stack back up under the new service names with the
existing auth flow, unchanged.

**Acceptance criteria:**
- [ ] `docker compose up -d --build` healthy: `app` serving on 127.0.0.1:3002, `note-service` healthy on the internal network
- [ ] Notes load and save through the UI on the tailnet URL
- [ ] `apps/note-service/data/life.db` intact (checksum unchanged from `31767e4d…` baseline is a nice-to-have; "notes are all there" is the bar)

**Verification:**
- [ ] `docker compose ps` shows both services up
- [ ] Manual check on the phone: open the app, open a note

**Dependencies:** None
**Files likely touched:** none (runtime only)
**Estimated scope:** Small

## Task 1: `apps/idp` skeleton + own DB + compose service

**Description:** New NestJS workspace `apps/idp` (`@life/idp`) with TypeORM/SQLite at
`apps/idp/data/idp.db`, healthcheck, and an internal `idp` compose service. Ships dark —
nothing calls it yet.

**Acceptance criteria:**
- [ ] `npm run dev/build/test/lint -w apps/idp` all work
- [ ] `idp.db` is created at `apps/idp/data/idp.db` and is gitignored; `life.db` untouched
- [ ] Compose `idp` service healthy on the internal network

**Verification:**
- [ ] `npm test -w apps/idp` (scaffold e2e: healthcheck) passes
- [ ] `npm run build` at root succeeds
- [ ] `docker compose config -q` passes

**Dependencies:** Task 0
**Files likely touched:** `apps/idp/**`, `package.json`, `compose.yaml`, `package-lock.json`, `.gitignore`
**Estimated scope:** Medium

## Task 2: Users + credentials

**Description:** Users table, argon2id hashing, a seed path for the first user (seeded
single-user decision — no signup), and the verification helper used by login. The only
place in the stack where credentials exist.

**Acceptance criteria:**
- [ ] Passwords stored only as salted hashes; e2e asserts no plaintext anywhere in `idp.db`
- [ ] Seed script creates the initial user; wrong-password verify fails
- [ ] Hash/verify round-trip e2e green

**Verification:**
- [ ] `npm test -w apps/idp` passes
- [ ] Manual check: `strings apps/idp/data/idp.db | grep -i <password>` returns nothing

**Dependencies:** Task 1
**Files likely touched:** `apps/idp/src/users/**`, `apps/idp/test/users.e2e-spec.ts`, `apps/idp/scripts/seed-user.*`
**Estimated scope:** Medium

## Task 3: Login UI + sessions

**Description:** Server-rendered login form, session issuance/verification/logout. Failure
response shape identical whether or not the user exists.

**Acceptance criteria:**
- [ ] Login success sets a session; logout clears it; protected route redirects to login
- [ ] Unknown user and wrong password return identical responses (no enumeration)
- [ ] Session cookie is HttpOnly; e2e covers expiry

**Verification:**
- [ ] `npm test -w apps/idp` passes (login/session e2e)
- [ ] Manual check: login in a browser at `idp`, logout, reload protected page → login

**Dependencies:** Task 2
**Files likely touched:** `apps/idp/src/login/**`, `apps/idp/test/login.e2e-spec.ts`
**Estimated scope:** Medium

## Checkpoint: after Tasks 1–3

- [ ] All tests pass, root build clean
- [ ] `life.db` untouched; the running app's auth unchanged
- [ ] Review with human before proceeding

## Task 4: Signing keys + JWKS + audience-scoped access tokens

**Description:** Keypair generation and storage for `idp` (EdDSA/Ed25519), the JWKS
endpoint, and `aud`-scoped access-token issuance (10-min lifetime) via the decided
`oidc-provider` keystore/JWKS surface.

**Acceptance criteria:**
- [ ] A minted token verifies offline against JWKS alone (separate process, no `idp` call)
- [ ] Wrong `aud`, expired, and tampered tokens all fail verification
- [ ] Signing keys never leave `idp`'s data dir; public JWKS exposes only public material

**Verification:**
- [ ] `npm test -w apps/idp` passes (token/JWKS e2e)
- [ ] Manual check: verify a real token with a standalone JWKS verifier script

**Dependencies:** Task 1 (needs only the skeleton; can follow Tasks 2–3 in order)
**Files likely touched:** `apps/idp/src/crypto/**`, `apps/idp/src/oidc/jwks.*`, `apps/idp/test/token.e2e-spec.ts`
**Estimated scope:** Medium

## Task 5: Authorization code + PKCE

**Description:** Wire the decided `oidc-provider` surface: discovery, `authorize` +
`token` (code+PKCE) integrated with the Task 3 login, the client registry (first clients:
`app`, dev client for tests), and the SQLite storage adapter.

**Acceptance criteria:**
- [ ] Code+PKCE happy path e2e green (authorize → code → token → verified access token)
- [ ] PKCE verifier mismatch and `state` mismatch fail closed
- [ ] Unauthenticated authorize redirects to the Task 3 login, then resumes the flow

**Verification:**
- [ ] `npm test -w apps/idp` passes (oidc e2e)
- [ ] Manual check: complete the dance with a throwaway client script

**Dependencies:** Tasks 3, 4
**Files likely touched:** `apps/idp/src/oidc/**`, `apps/idp/test/oidc.e2e-spec.ts`
**Estimated scope:** Medium

## Task 6: Refresh tokens with rotation + reuse detection

**Description:** Refresh tokens bound to client + subject, rotated on use with reuse
detection (library-native in `oidc-provider`); prove rotation and family revocation with
our own e2e.

**Acceptance criteria:**
- [ ] Refresh rotates (old token dead after use) and returns a new access token
- [ ] Reuse of a rotated-out token triggers family revocation (e2e proven)
- [ ] Access-token lifetime independent of refresh lifetime

**Verification:**
- [ ] `npm test -w apps/idp` passes (refresh e2e)

**Dependencies:** Task 5
**Files likely touched:** `apps/idp/src/oidc/refresh.*`, `apps/idp/test/refresh.e2e-spec.ts`
**Estimated scope:** Small

## Checkpoint: `idp` complete

- [ ] All `idp` e2e green; offline verification with `aud` enforced
- [ ] `life.db` untouched; app and note-service unchanged (dark ship)
- [ ] Review with human before starting Phase 2

## Task 7: `app-rp` OIDC client

**Description:** PKCE/state/nonce generation, callback route, server-side session in
`apps/app`. No gate changes yet — login works but the app isn't switched over.

**Acceptance criteria:**
- [ ] Callback with bad `state` or verifier fails closed (4xx, no session)
- [ ] Tokens stay server-side (`server-only` modules; no token in client components)
- [ ] Session cookie HttpOnly; unit tests for PKCE/state generation

**Verification:**
- [ ] `npm test -w apps/app` passes (unit + callback e2e)
- [ ] `npm run lint`, `npm run build` clean

**Dependencies:** Task 5 (Task 4's JWKS is enough to start)
**Files likely touched:** `apps/app/lib/auth/**`, `apps/app/app/login/**`, `apps/app/test/**`
**Estimated scope:** Medium

## Task 8: `app-rp` login gate swap

**Description:** Middleware redirects unauthenticated traffic to `idp` login (code+PKCE);
logout is local-only (first cut). Identity comes from the IdP — the Tailscale gate stays
**access-only** (only my phone reaches the app; no identity from the Tailscale header).
Playwright e2e of the cold-browser flow.

**Acceptance criteria:**
- [ ] Cold browser → IdP login → callback → working notes UI (Playwright green)
- [ ] Identity comes from the IdP session; the Tailscale gate remains, access-only (no identity derived from the Tailscale header)
- [ ] `API_TOKEN` BFF behavior unchanged (dual-run intact)

**Verification:**
- [ ] `npm test -w apps/app` passes (Playwright login spec)
- [ ] Manual check on the phone: full login on the tailnet URL

**Dependencies:** Tasks 7, 0
**Files likely touched:** `apps/app/middleware.ts`, `apps/app/lib/auth/**`, `apps/app/app/login/**`, `apps/app/playwright.config.*`
**Estimated scope:** Medium

## Task 9: `note-service-rs` verify guard (dual-accept)

**Description:** JWT verification guard (JWKS cache with rotation tolerance, `aud=note-service`,
fail-closed) alongside the existing `API_TOKEN` path.

**Acceptance criteria:**
- [ ] Valid JWT → 200; wrong `aud` / expired / tampered / garbage → 401 (e2e)
- [ ] Rotated `kid` at `idp` still verifies
- [ ] `API_TOKEN` path still green — the existing 16 e2e unchanged

**Verification:**
- [ ] `npm test -w apps/note-service` passes (old + new e2e)
- [ ] Manual check: BFF call with a minted JWT succeeds

**Dependencies:** Task 4
**Files likely touched:** `apps/note-service/src/auth/**`, `apps/note-service/test/auth.e2e-spec.ts`
**Estimated scope:** Medium

## Task 10: Retire `API_TOKEN` (one commit)

**Description:** Remove the static-token path from `note-service` and the `app` BFF, plus
`.env*` examples, compose, and README. Follows `deprecation-and-migration`: single commit,
old tests deleted in the same commit.

**Acceptance criteria:**
- [ ] No `API_TOKEN` reference remains outside `docs/superpowers/` and dated history
- [ ] All suites green with JWT-only auth
- [ ] Deploy verified on the tailnet URL after the switch

**Verification:**
- [ ] `npm test`, `npm run lint`, `npm run build` all clean at root
- [ ] `grep -r API_TOKEN` returns only historical docs
- [ ] Manual check on the phone after `docker compose up -d --build`

**Dependencies:** Tasks 8, 9 (dual-run window elapsed — decided: short, same week)
**Files likely touched:** `apps/note-service/src/auth/**`, `apps/app/lib/api.ts`, `.env*.example`, `compose.yaml`, `README.md`
**Estimated scope:** Medium

## Checkpoint: complete

- [ ] Full flow through the IdP on the phone
- [ ] `API_TOKEN` gone from code/env/compose/README; all suites green
- [ ] `life.db` and `apps/idp/data/idp.db` intact
- [ ] Review with human; update `docs/intent/idp.md` ("Now" horizon closed)
