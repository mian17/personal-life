# Intent — one dev switch for auth and cookie flags

Supersedes the cookie half of any earlier auth intent. Confirmed 2026-10-21.

## Outcome

`APP_DEV_SKIP_ACCESS_GATE=1` becomes the only thing that distinguishes the dev
stack from a deployed service. While it is set, the ACCESS (Tailscale) gate is
skipped **and** every cookie the app writes is issued without `Secure`. While it
is unset, the ACCESS gate runs and every cookie is `Secure`. `NODE_ENV` stops
being consulted for any cookie flag.

`npm run dev:build` keeps `NODE_ENV=production` — production build, `next start`
runtime. It does not move to `NODE_ENV=development`.

## User

The owner, running the dev stack at `http://127.0.0.1:3100` and the deployed app
behind Tailscale Serve. No other users.

## Why now

Auth decisions currently read `process.env.NODE_ENV === 'production'` in three
places (`apps/app/lib/auth/cookies.ts`, `apps/app/lib/auth/login-attempt.ts`,
`packages/app-kit/src/preferences.ts`). Because `next build` forces
`NODE_ENV=production` on itself, the dev stack is indistinguishable from
production in every one of those reads, so cookies are flagged `Secure` in a
stack the owner runs on plain loopback http. The access-gate skip already exists
and already means "this is the dev stack"; a second, unrelated marker for the
same distinction is the bug.

## Success

1. `APP_DEV_SKIP_ACCESS_GATE=1` ⇒ ACCESS gate skipped, session / auth-attempt /
   `pref_*` cookies carry no `Secure` attribute.
2. Unset ⇒ ACCESS gate enforced (403 without the owner's Tailscale header),
   and those same cookies carry `Secure`.
3. No cookie flag reads `NODE_ENV`. Grep for `NODE_ENV` across
   `apps/app/lib/auth` and `packages/app-kit/src` returns no cookie-attribute use.
4. IDENTITY (IdP session) gate unchanged: a session is required in every
   environment, dev stack included.
5. Cookie-option helpers take a plain boolean argument and do not read
   `process.env` themselves, so the flag cannot be inlined at build time the way
   `NODE_ENV` is (`isProduction:!0` is baked into
   `apps/app/.next/server/chunks/[root-of-the-server]*.js`; the flag survives as
   runtime `process.env.APP_DEV_SKIP_ACCESS_GATE`).
6. `npm run dev:build` still builds under production and starts services with
   the flag set on the app process.
7. Unit tests cover both branches of every changed helper, and the existing
   `apps/app/test/{cookies,gate}.test.ts` expectations still hold.

## Constraint

- `apps/app/middleware.ts` keeps computing the flag once per request and passing
  a boolean down; the flag stays a command-line opt-out, never a value in
  `.env`, compose, or a deployed service's environment.
- No new dependency. No new primitive. Repo Contract 1 untouched.
- Frozen e2e selector surface untouched.
- The flag must never weaken the IDENTITY gate.

## Out of scope

- Moving `dev:build` to `NODE_ENV=development` (explicitly rejected: the build
  cannot run under development mode, and the owner wants the dev stack to keep
  serving a production build).
- ~~Any change to the IdP service, its own cookies, or the login flow.~~
  **Amended 2026-10-21 (owner: "commit first then extend").** The IdP's
  `idp_session` cookie moves to the same flag (`apps/idp/src/login/dev-stack.ts`
  `secureCookie()`), so no cookie in the repo keys on `NODE_ENV`. The IdP is
  `tsc`-compiled, so its old `process.env.NODE_ENV` read was a genuine runtime
  read and was already non-`Secure` under `dev:build` (`.env.development` sets
  `NODE_ENV=development`); the change is consistency and closes the case where a
  shell-exported `NODE_ENV=production` marks loopback cookies `Secure`. Root `dev`
  and `dev:build` now pass the flag to the IdP process. The IdP's `NODE_ENV` use
  for DB path and OIDC secret enforcement is untouched.
- `SameSite`, `HttpOnly`, `Path`, or TTL changes.
- Redirecting or rewriting `OWNER_LOGIN` handling.
- The uncommitted `pi/wf/pomodoro-app` work.

## Confirmation

Confirmed: yes — the owner restated the ask twice and answered "ok, you can
handoff to a subagent to commence this" on 2026-10-21, after correcting an
earlier misreading (dev:build keeps production `NODE_ENV`; only the access-gate
skip moves).
