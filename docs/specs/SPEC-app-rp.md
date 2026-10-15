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

## Post-login destination (`returnTo`)

A gated GET must be able to return the user to the route they asked for instead of
always landing on the default (`/` → `/notes`).

- **Capture (identity gate):** on `redirect-login`, the gate appends
  `?returnTo=<path>` to the `/auth/login` redirect — **only for GET navigations outside
  `/api/*`**. API requests keep the default landing (a GET to a POST-only BFF route
  after login would be a 405).
- **Validation:** `returnTo` is accepted only as a local absolute path: it starts with
  `/`, does not start with `//`, contains no `\`, contains no control character, and is
  at most 2048 chars. Anything else is rejected and dropped.
- **Storage:** the value is carried in the **existing `app_auth_attempt` cookie**
  (the per-attempt code+PKCE cookie) — **no new cookie is introduced**. It is set in the
  login route before the value enters the cookie, and re-validated on every read
  (defense in depth: a tampered/crafted cookie cannot redirect off-origin). It is
  cleared with the attempt cookie in the callback; no separate lifecycle.
- **Consumption:** on success the callback redirects to the validated `returnTo`; when
  it is absent or rejected it falls back to `/`, which `permanentRedirect`s to `/notes`
  (the current default landing).
- **IdP:** `returnTo` is **not sent to the IdP** and the IdP is unchanged — it lives
  only in the app RP's cookie and the callback redirect. No IdP-side destination logic
  exists or is added.

## Per-route PWA manifests

Each app route gets its own PWA identity so a PWA saved from a route opens that route.
There is no root/default manifest: a manifest is declared only by the routes that are
apps, and an unadorned path (e.g. an error page) declares none.

- **`/notes`:** serves `apps/app/public/manifest-notes.json` with
  `id` / `start_url` / `scope` all `/notes`.
- **`/todos`:** serves `apps/app/public/manifest-todos.json` with
  `id` / `start_url` / `scope` all `/todos`.
- **`/meals`:** serves `apps/app/public/manifest-meals.json` with
  `id` / `start_url` / `scope` all `/meals`.
- **No root manifest:** `apps/app/public/manifest.json` is removed and the root layout
  declares no `manifest`. A root manifest with no `scope` defaults to the whole origin,
  which made every install resolve to the root app (`/` → `/notes`); per the Web App
  Manifest model the per-route `id` / `scope` / `start_url` alone carry the identity.
- **Wiring:** the nested route segment links its manifest via `metadata.manifest` in a
  fragment `layout.tsx` (a `{children}` pass-through with zero visual responsibility).
  The root layout declares none, so nothing competes with the per-route link.
- **Public access:** the manifest files are public — fetchable with no session
  (the gate serves them like `/icon.svg`).
- **Apple install metadata:** each segment layout emits `apple-mobile-web-app-capable`
  (`yes`) and `apple-mobile-web-app-title` ("Notes" / "Todos" / "Meals") via
  `routeLayoutMetadata(manifest, title, icon)`, so iOS shows a standalone Home Screen web
  app with a route-specific name. iOS ignores SVG for the Home Screen, so each route
  declares its own PNG `apple-touch-icon` (`/icon-notes.png` / `/icon-todos.png` /
  `/icon-meals.png`, 512×512, rasterized from a per-route SVG) and the same PNG as its
  manifest icon.
- **Mechanism:** nested `manifest.ts` file-convention routes are **NOT used** — in the
  installed Next.js the `manifest` metadata convention is anchored to the app root, so a
  colocated `app/<segment>/manifest.ts` is not a route. The verified mechanism is a
  `public/*.json` manifest linked by `metadata.manifest`.

This change adds files and does not alter token values, `viewport.themeColor`, or the
e2e selector surface.
