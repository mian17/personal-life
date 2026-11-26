---
type: "Reference"
title: "Identity and access"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-579caf3ca45a1d9f960055a7
    resource: repo://.github/workflows/compose-boot.yml
  - id: openwiki-source-31a9daf193e28a37a3e05528
    resource: repo://apps/app/lib/auth/gate.ts
  - id: openwiki-source-13203f84a306dddb7ec0a433
    resource: repo://apps/app/lib/outbox-relay.ts
  - id: openwiki-source-0d8b2ba21ac2a0ecea9055df
    resource: repo://apps/app/proxy.ts
  - id: openwiki-source-a0293781c618fb2c0f7248d8
    resource: repo://apps/idp/src/oidc/clients.ts
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Identity and access

Two independent gates stand in front of the app, evaluated in order by
`apps/app/proxy.ts` → `decideGate` (`apps/app/lib/auth/gate.ts`, pure logic, unit
tested). Identity is never derived from the access gate.

## Gate 1 — ACCESS (Tailscale reachability)

Only the owner's device may reach the app. `NODE_ENV=production` makes Next set
`x-forwarded-host` (the marker that Tailscale Serve forwarded the request) and
the gate demands a `tailscale-user-login` header matching `OWNER_LOGIN`:

- no matching headers → **403** (fail closed; the correct answer, not a defect);
- matching headers → decision passes to gate 2.

The gate is fail-closed by default. Its one switch is
`APP_DEV_SKIP_ACCESS_GATE=1` — a dev-stack command-line flag, never a deployed
env value, and deliberately not `NODE_ENV` because `next build` forces
production semantics on the dev stack too.

## Gate 2 — IDENTITY (IdP session)

Runs in **every** environment, localhost included. A valid app session (the
code + PKCE flow against the IdP) is required; an unauthenticated owner is
**307-redirected** into the login dance. Public paths skip both gates:
`/auth/*` prefixes (login starts/finishes there) and a small `PUBLIC_EXACT` set
of static assets.

**The matcher gap worth knowing:** the middleware matcher is
`/((?!_next/static|_next/image|favicon.ico).*)` — `favicon.ico` and `_next/*`
never reach `decideGate` at all, so `PUBLIC_EXACT`'s favicon entry is dead for
the proxy while live for the unit test. That is why the compose-boot CI
assertion uses `/icon.svg` (a public path that genuinely passes both gates), not
the favicon: asserting a gate answer on an excluded path would assert nothing.

## The IdP

`apps/idp` is the identity provider: OIDC with authorization code + PKCE S256
(both registered clients require PKCE), its own SQLite store, seeded users.

- **The `app` client** — secret required in production (`OIDC_APP_CLIENT_SECRET`
  fails the boot loudly outside a placeholder-free production; a fake dev-only
  placeholder exists outside production so a misconfigured prod boot cannot ship
  a known-public secret). Redirect URIs: `OIDC_APP_REDIRECT_URIS`, else the
  production default behind Tailscale Serve on `:3002`.
- **Producer clients** — one public PKCE client per producer, registered from
  `OIDC_PRODUCER_<NAME>_REDIRECT_URIS` (composed at runtime from the producer's
  name, e.g. `OIDC_PRODUCER_PRODUCER_A_REDIRECT_URIS` — the doubled `PRODUCER_`
  is correct, not a typo). Production **must** supply one per producer or the
  IdP refuses to boot; this is one of the three variables whose absence shipped
  dead features in v0.2.1 and motivated the compose-boot CI job.
- `clientCredentials` is disabled — no service can impersonate a user, which is
  exactly why the outbox's live delivery leg is the BFF's drain (see
  [Events and messaging](../integration/events-and-messaging.md)).

Tokens services accept are verified through
[`@life/service-kit`'s AuthGuard](../architecture/service-kernel.md); owner
provisioning and login UX live in the IdP's `interaction-policy` /
`access-token.policy` / `refresh-token.policy` modules.

## See also

- [Service kernel](../architecture/service-kernel.md) — bearer verification
  downstream of the IdP.
- [CI gates](../operations/ci-gates.md) — the boot job asserts both gates'
  answers (403/307/200) on every PR.
- [Deployment and operations](../operations/deployment.md) — `OWNER_LOGIN` and
  the IdP's required env in the deployed stack.
