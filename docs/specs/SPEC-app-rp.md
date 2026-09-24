# Spec: `app-rp` — `apps/app` becomes a relying party

Traces to module id: `app-rp` (see `docs/specs/MAP-idp.md`).
Traces to intent: `docs/intent/idp.md`.

## Objective

Give the app a standard OIDC identity layer: authorization code + PKCE against `idp`.
Identity and authentication come from the IdP — from now on, for the whole stack. The
Tailscale gate is kept for one job only: **access** (only my phone can reach the app over
the tailnet). It provides no identity. The BFF keeps holding whatever secret authenticates
it to `note-service` (still `API_TOKEN` until `note-service-rs` lands), so the browser
never sees service credentials.

Tailscale keeps its transport/ACL role (Serve for HTTPS, tailnet-only reachability) and
the header check as an access control — neither is identity. This module layers IdP
identity inside that access gate.

## Tech Stack

Next.js 15 App Router (existing `apps/app`), an OIDC client library for the code+PKCE
dance (choose at implementation; spec-level constraint: standard-compliant, maintained),
server-side session cookie for the app, `@life/shared` for any shared types.

## Commands

```unknown
npm run dev   -w apps/app    # local, with .env.development
npm run build -w apps/app
npm test      -w apps/app    # e2e: Playwright login-flow spec
npm run lint  -w apps/app
```

## Project Structure

```unknown
apps/app/
  lib/auth/     OIDC client, PKCE, token/session handling (server-side only)
  app/login/    login entry + callback routes
  middleware.ts gate: valid app session → through; else → redirect to IdP
```

## Code Style

Match existing `apps/app` code: server-only modules for anything holding tokens
(`import 'server-only'`), typed helpers, no token ever reaches client components.

```typescript
// lib/auth/session.ts
import 'server-only';

export async function requireSession(req: NextRequest): Promise<Session> {
  const session = await readSessionCookie(req);
  if (!session) throw redirect(toIdpLogin(req.url)); // PKCE params attached
  return session;
}
```

## Testing Strategy

Playwright browser e2e for the redirect dance (unauthenticated → IdP → callback → app),
logout, and session expiry behavior. Unit tests for PKCE/state generation (verifier
mismatch and CSRF state mismatch rejected). Existing notes-UI behavior must stay green —
no visual or interaction changes beyond the login entry.

## Boundaries

- Always: tokens stay server-side; `server-only` on every auth module; validate `state`
  and `nonce` on callback; tests before commits.
- Ask first: session cookie policy changes (lifetime, SameSite), logout semantics
  (local vs. IdP session), any change that lets a token reach the browser.
- Never: put access/refresh tokens in client-visible storage; roll our own crypto for
  PKCE/state; weaken the notes UI's behavior as a side effect.

## Success Criteria

- [ ] Cold browser with no session → redirected to `idp` login → back in the app with a
      working notes UI (Playwright-verified).
- [ ] Callback with mismatched `state` or PKCE verifier fails closed (4xx, no session).
- [ ] Identity comes from the IdP session; the Tailscale gate serves access only (only my
      phone reaches the app) — no identity is derived from the Tailscale header.
- [ ] `API_TOKEN` still works end-to-end during the dual-run window (unchanged
      `note-service` contract).

## Decisions (2026-09-24, plan review)

1. **Tailscale gate kept, access-only.** Its sole job is that only my phone can reach the
   app (tailnet ACL + Serve + header check as access control). Identity and authentication
   come from the IdP — from now on, for every service.
2. **App session cookie:** 7 days, sliding (accepted default).
3. **Logout:** the app's logout ends the IdP session and **revokes the user's grants
   server-side** (decision B, 2026-09-25) — refresh tokens die immediately. Full
   RP-initiated logout (`end_session`) is deferred to the multi-RP chapter (decision C).
