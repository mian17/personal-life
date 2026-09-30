# Implementation Plan: per-route apps — login returns to the requested route + per-route PWA identity

Branch: `feature/todo-ecosystem` (follow-up; `master` stays untouched).
Spec amended in the same change (owner): `docs/specs/SPEC-app-rp.md`.
Reference (read-only mirror): the existing per-attempt cookie stack
(`apps/app/lib/auth/login-attempt.ts`, `apps/app/lib/auth/callback.ts`,
`apps/app/app/auth/login/route.ts`, `apps/app/app/auth/callback/route.ts`).

Process: global protocol §3 (testing), §5 (mandatory task template), §6 (plan
validation gate), §7 (review + five-lane gate). Every task below is in §5
template form. Test runs are targeted, named files only, max 2 executions; no
full suite. Every task is reviewed under §7 (blast radius, contract, project
contracts) before the next dependent task starts. The five-lane gate (T8) is
executed by five parallel subagent lanes, not a shell command.

## Objective

Two coupled fixes, both requested by the user:

1. **Login returns to the originating route.** Today the identity gate sends an
   unauthenticated request to `/auth/login` with no destination, so every
   completed login lands on `/` → `/notes`. A user who opens the saved `/todos`
   PWA is always dropped into the notes app. Preserve the requested same-origin
   path through the whole code+PKCE chain and land there after auth.
2. **Each route gets its own PWA identity.** There is exactly one manifest
   (`apps/app/public/manifest.json`, name "Personal Life — Notes", `start_url
   "/"`, no `scope`/`id`) linked once in the root layout. Give `/notes` and
   `/todos` their own manifests (`start_url` + `scope` + `id` + name/short_name)
   so a PWA saved from a route opens that route. The root `/` manifest stays the
   default app.

## User requirement (verbatim)

> i would want each route to be separate apps, but the re routing is currently
> always routing back to the todos app. for example, i save a PWA on my phone,
> when i enter todo app, if i have to sign in, i expect it to be login to route
> me to todo route, currently i think the behavior is always routing to notes
> app, this is not the behavior that i want.

## Scope

- **(A)** Fix the login chain to return the user to the originating route.
- **(B)** Give each app route its own PWA manifest/identity.

Out of scope: any multi-zone / per-app Next rewrite; IdP changes; token values;
the e2e selector surface. Contract 2 (backend data layer) is **not engaged** —
no backend service is touched. **Cache plan: not applicable** (no data service).

## Ground truth (verified by reading, current tree)

- Gate: `apps/app/middleware.ts:26-43`; `decideGate` in
  `apps/app/lib/auth/gate.ts:41-56`; unauth → `absoluteUrl(req, '/auth/login')`
  at `middleware.ts:43` — no destination parameter. Matcher `middleware.ts:50`.
  Defense-in-depth `apps/app/lib/auth/require-session.ts:18-24`.
- Login: `apps/app/app/auth/login/route.ts:38-57` ignores the request, calls
  `buildAuthorizationRequest()`; the per-attempt cookie `app_auth_attempt`
  carries only `{state, nonce, codeVerifier}`
  (`apps/app/lib/auth/login-attempt.ts:10-53`), path-scoped `/auth`.
- Post-login: hard-coded `/` at `apps/app/app/auth/callback/route.ts:28-29`
  (303), then `apps/app/app/page.tsx:7-9` `permanentRedirect('/notes')`.
- IdP: `apps/idp/src/oidc/clients.ts:79-88` allow-lists only the registered
  `redirect_uri`; the IdP has no per-route destination logic and needs none —
  `returnTo` never leaves the app RP.
- PWA: exactly one manifest `apps/app/public/manifest.json`, linked once at
  `apps/app/app/layout.tsx:6`.
- Next.js file-convention fact (verified by a throwaway `next build` with the
  installed `next@15.5.25`): a `manifest.ts` colocated in a nested segment
  (`app/notes/manifest.ts`) is **not** a route — `isMetadataRouteFile` anchors
  `manifest` to the app root — and the generated `/notes` HTML was ignored (no
  route in `app-path-routes-manifest.json`, link still `/manifest.json`). The
  working mechanism is a `public/*.json` manifest + `metadata.manifest` in a
  nested `layout.tsx` (verified: `/notes` → `/manifest-notes.json`, `/todos` →
  `/manifest-todos.json`, root → `/manifest.json`). See Deviations.

## Design

### 1. `returnTo` mechanism (reuses the per-attempt cookie; no new cookie)

```
unauth GET /todos
  └─ middleware (route identity gate)
       → 307 Location: /auth/login?returnTo=%2Ftodos
  └─ GET /auth/login  (apps/app/app/auth/login/route.ts)
       → sanitizeReturnTo(?returnTo)  → stored inside app_auth_attempt
         {state, nonce, codeVerifier, returnTo}
       → 303 to the IdP (unchanged authorize URL; returnTo is NOT sent to the IdP)
  └─ GET /auth/callback  (apps/app/app/auth/callback/route.ts)
       → resolveCallback(...) re-validates returnTo from the cookie
       → 303 Location: returnTo ?? '/'
         ('/' → permanentRedirect('/notes') = current default landing)
  └─ app_auth_attempt cleared (single-use, unchanged)
```

- **Cookie name:** unchanged — `app_auth_attempt` (`LOGIN_ATTEMPT_COOKIE`).
  `returnTo` is an added field, not a parallel mechanism. It is cleared with the
  attempt cookie in the callback (`maxAge: 0`), so no separate lifecycle.
- **Where set:** `apps/app/app/auth/login/route.ts` reads
  `req.nextUrl.searchParams.get('returnTo')`, validates it, and encodes it into
  the attempt cookie.
- **Where captured:** `apps/app/middleware.ts:40-43` appends
  `?returnTo=<encodeURIComponent(pathname + search)>` to the login redirect.
  Only for **GET navigations that are not `/api/*`** — a GET to a POST-only BFF
  route after login would be a 405, so API requests keep the default landing.
- **Where validated:** the exported pure function `sanitizeReturnTo` in
  `apps/app/lib/auth/login-attempt.ts`, called (a) by the login route before the
  value enters the cookie, (b) by `decodeLoginAttempt` on every read (defense in
  depth — a tampered/crafted cookie cannot redirect off-origin), and (c) by
  `encodeLoginAttempt` (never serializes an unsafe value).
- **Where consumed:** `apps/app/lib/auth/callback.ts` `resolveCallback` returns
  `returnTo` on success; `apps/app/app/auth/callback/route.ts` redirects to
  `absoluteUrl(req, outcome.returnTo ?? '/')`.
- **Rejection behaviour:** `sanitizeReturnTo` returns `undefined` for anything
  that is not a local absolute path; the chain then falls back to the default
  landing (`/` → `/notes`). A rejected value is dropped, never surfaced.

**Exact contract — `apps/app/lib/auth/login-attempt.ts`:**

```ts
export interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Validated same-origin path to land on after auth; absent → default landing. */
  returnTo?: string;
}

/**
 * Returns `value` when it is a safe LOCAL absolute path, otherwise `undefined`.
 * Rejects: empty/absent; not starting with `/`; starting with `//`
 * (protocol-relative); containing `\` (browsers may treat it as `/`); containing
 * any control character; longer than 2048 chars. It does NOT decode
 * percent-encoding — a same-origin `new URL(value, origin)` keeps `%2f%2f`
 * inside the path, never in the host.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | undefined;
```

- `encodeLoginAttempt(attempt)`: serializes `{state, nonce, codeVerifier}` plus
  `returnTo` only when `sanitizeReturnTo` yields a value.
- `decodeLoginAttempt(value)`: requires the three strings as today; attaches
  `returnTo` only when `sanitizeReturnTo(parsed.returnTo)` yields a value.

**Exact contract — `apps/app/lib/auth/callback.ts`:**

```ts
export type CallbackResult =
  | { ok: true; sessionId: string; returnTo?: string }
  | { ok: false; status: number; message: string };
```

### 2. Per-route PWA identity

- **Root (default app):** `apps/app/public/manifest.json` stays as the default
  app (`start_url "/"`, name "Personal Life — Notes"). Decision: keep `/` as the
  notes default rather than repointing it to `/notes`, because `/` is the
  canonical entry and already `permanentRedirect`s to `/notes`; repointing would
  change the identity of already-installed PWAs for no gain. `/notes` gets its
  own manifest on top.
- **`/notes`:** `apps/app/public/manifest-notes.json` with `id "/notes"`,
  `start_url "/notes"`, `scope "/notes"`, name "Personal Life — Notes",
  short_name "Notes".
- **`/todos`:** `apps/app/public/manifest-todos.json` with `id "/todos"`,
  `start_url "/todos"`, `scope "/todos"`, name "Personal Life — Todos",
  short_name "Todos".
- **Wiring:** a nested `metadata.manifest` overrides the root layout's link for
  that segment (verified with the installed Next). `apps/app/app/notes/layout.tsx`
  and `apps/app/app/todos/layout.tsx` are fragment pass-throughs exporting only
  `metadata`; they add no DOM node and no visual language.
- **Public assets:** add `/manifest-notes.json` and `/manifest-todos.json` to
  `PUBLIC_EXACT` in `apps/app/lib/auth/gate.ts` so a manifest fetch is served
  without a session (same treatment `/manifest.json` and `/icon.svg` already
  get). The middleware matcher is not changed (it is only a perf pre-filter; the
  gate already lets `/icon.svg` through via `PUBLIC_EXACT`).
- **Frozen surfaces:** the user's request is the explicit approval to touch the
  PWA constants. This change adds files; it does **not** change token values,
  `viewport.themeColor`, or the e2e selector surface.
- **Contract 1:** the layouts are `{children}` fragment pass-throughs with zero
  visual responsibility (structural exemption). The manifest link is metadata,
  not markup. No new visual element, no raw HTML, no app CSS.

## File structure

Create:
- `apps/app/public/manifest-notes.json`
- `apps/app/public/manifest-todos.json`
- `apps/app/app/notes/layout.tsx`
- `apps/app/app/todos/layout.tsx`
- `apps/app/test/login-attempt.test.ts`
- `apps/app/test/callback-route.test.ts`
- `apps/app/test/manifests.test.ts`

Modify:
- `docs/specs/SPEC-app-rp.md`
- `apps/app/lib/auth/login-attempt.ts`
- `apps/app/middleware.ts`
- `apps/app/app/auth/login/route.ts`
- `apps/app/app/auth/callback/route.ts`
- `apps/app/lib/auth/callback.ts`
- `apps/app/lib/auth/gate.ts`
- `apps/app/test/middleware.test.ts`
- `apps/app/test/login-route.test.ts`
- `apps/app/test/callback.test.ts`
- `apps/app/test/gate.test.ts`
- `apps/app/test/e2e/journey.ts`
- `apps/app/test/e2e/suites/journey.suite.ts`

Not modified: `apps/app/lib/auth/require-session.ts` (documented gap, see
Deviations), `apps/idp/**`, `apps/app/public/manifest.json`, token files,
`button.trash-delete` and every e2e selector.

## Task List

### Phase 1 — Spec (spec-first)
- [ ] T1: amend `docs/specs/SPEC-app-rp.md` with the `returnTo` contract and the per-route PWA manifest contract.

### Checkpoint: Spec
- [ ] `grep -n "returnTo" docs/specs/SPEC-app-rp.md` is non-empty.
- [ ] `grep -n "manifest-notes.json" docs/specs/SPEC-app-rp.md` is non-empty.

### Phase 2 — Login chain (`returnTo`)
- [ ] T2: `sanitizeReturnTo` + `returnTo` on the attempt cookie (`login-attempt.ts`).
- [ ] T3: middleware appends `returnTo` to the login redirect (`middleware.ts`).
- [ ] T4: login route validates + stores `returnTo` (`app/auth/login/route.ts`).
- [ ] T5: callback resolves + redirects to `returnTo` (`lib/auth/callback.ts`, `app/auth/callback/route.ts`).

### Checkpoint: Login chain
- [ ] `npm run typecheck -w @life/app` exits 0.
- [ ] `npm run test:unit -w @life/app -- test/login-attempt.test.ts test/middleware.test.ts test/login-route.test.ts test/callback.test.ts test/callback-route.test.ts` green.

### Phase 3 — Per-route PWA identity
- [ ] T6: manifests + nested layouts + gate public paths.

### Checkpoint: PWA
- [ ] `npm run typecheck -w @life/app` exits 0.
- [ ] `npm run test:unit -w @life/app -- test/manifests.test.ts test/gate.test.ts` green.

### Phase 4 — E2E
- [ ] T7: extend the journey suite with the `/todos` landing and per-route manifest assertions; run the two new tests once.

### Phase 5 — Close
- [ ] T8: five-lane verification gate (global protocol §7.6) on the final state.

## Tasks in §5 template form

### T1 — Spec amendment (module `per-route-apps`)

[TASK OBJECTIVE]
  Record the `returnTo` login-chain contract and the per-route PWA manifest
  contract in `docs/specs/SPEC-app-rp.md` before any code changes.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `docs/specs/SPEC-app-rp.md`.
  - Reference files (read-only): `apps/app/lib/auth/login-attempt.ts`,
    `apps/app/lib/auth/callback.ts`, `apps/app/middleware.ts`,
    `apps/app/app/layout.tsx`, `apps/app/public/manifest.json`,
    `docs/specs/SPEC-idp.md`, `tasks/plan-per-route-apps.md`.
  - Strictly prohibited files: every file not listed above (no code, no tests).

[IMPLEMENTATION REQUIREMENTS]
  - Add a "Post-login destination (`returnTo`)" section stating: the identity
    gate appends `?returnTo=<path>` only for GET navigations outside `/api/*`;
    the value is validated as a local absolute path (starts with `/`, not `//`,
    no `\`, no control chars, length ≤ 2048); it is stored in the existing
    `app_auth_attempt` cookie (no new cookie); the callback redirects to it and
    falls back to `/` (→ `/notes`) when absent or rejected; the IdP is not sent
    the value and needs no change.
  - Add a "Per-route PWA manifests" section stating: root `/manifest.json` stays
    the default app (`start_url "/"`); `/notes` serves
    `/manifest-notes.json` (`id`/`start_url`/`scope` = `/notes`); `/todos` serves
    `/manifest-todos.json` (`id`/`start_url`/`scope` = `/todos`); the nested
    route segment links its manifest via `metadata.manifest` in a fragment
    `layout.tsx`; the manifest files are public (no session required).
  - State explicitly that nested `manifest.ts` file-convention routes are NOT
    used (Next.js anchors the convention to the app root).
  - No spec text may claim an IdP-side destination, a new cookie, or a change to
    token values.

[VERIFICATION & TESTING RULES]
  - Permitted test command: none. This is a docs task; no test execution.
  - Verification: `grep -n "returnTo" docs/specs/SPEC-app-rp.md` and
    `grep -n "manifest-notes.json" docs/specs/SPEC-app-rp.md` are both non-empty.
  - Strict constraints: NO full suites, NO E2E; typecheck not required (docs
    only); max test executions: 2.

[DEFINITION OF DONE]
  - [ ] Code meets all implementation requirements.
  - [ ] No files outside the allowed scope were modified.
  - [ ] The two grep verifications return non-empty.
  - [ ] No placeholder or contradictory text remains.

---

### T2 — `sanitizeReturnTo` + attempt cookie (module `per-route-apps`)

[TASK OBJECTIVE]
  Add the validated `returnTo` field to the per-attempt cookie carried through
  the OIDC round-trip, with a pure, tested sanitizer.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/auth/login-attempt.ts`,
    `apps/app/test/login-attempt.test.ts` (new).
  - Reference files (read-only): `apps/app/lib/auth/callback.ts`,
    `apps/app/test/callback.test.ts` (existing round-trip assertions),
    `apps/app/app/auth/login/route.ts`.
  - Strictly prohibited files: every file not listed above (no middleware, no
    routes, no gate, no specs).

[IMPLEMENTATION REQUIREMENTS]
  - Add `returnTo?: string` to `LoginAttempt` with the doc comment above.
  - Add `export function sanitizeReturnTo(value: string | null | undefined):
    string | undefined` with the exact contract above (defined inline as the
    constant `MAX_RETURN_TO_LENGTH = 2048`).
  - `encodeLoginAttempt` includes `returnTo` only when `sanitizeReturnTo` yields
    a value; otherwise the payload is exactly today's `{state, nonce,
    codeVerifier}` (the existing `callback.test.ts` round-trip must stay equal).
  - `decodeLoginAttempt` attaches `returnTo` only when `sanitizeReturnTo`
    yields a value; all existing validation is unchanged.
  - TDD order: write `apps/app/test/login-attempt.test.ts` first and watch it
    fail before editing `login-attempt.ts`.

[VERIFICATION & TESTING RULES]
  - Permitted test command:
    `npm run test:unit -w @life/app -- test/login-attempt.test.ts`.
  - Required cases in `test/login-attempt.test.ts`:
    `sanitizeReturnTo` accepts `/`, `/todos`, `/todos?done=false`, `/notes/abc`;
    rejects `undefined`, `''`, `notes`, `https://evil.com`, `//evil.com`,
    `/\\evil.com`, `'/a\nb'`, and a 2049-char path; `encodeLoginAttempt`/
    `decodeLoginAttempt` round-trip preserves `returnTo: '/todos'`; decoding a
    handcrafted base64url payload whose `returnTo` is `//evil.com` yields an
    attempt with no `returnTo`.
  - Strict constraints: NO full suites, NO E2E; only this named file; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] `LoginAttempt.returnTo` and `sanitizeReturnTo` exist with the exact
        signatures/contract above.
  - [ ] The existing callback round-trip expectation is preserved.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] `npm run test:unit -w @life/app -- test/login-attempt.test.ts` passes.

---

### T3 — Middleware carries `returnTo` (module `per-route-apps`)

[TASK OBJECTIVE]
  Make the identity-gate redirect preserve the requested same-origin path for
  GET navigations, without changing the gate decision.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/middleware.ts`,
    `apps/app/test/middleware.test.ts`.
  - Reference files (read-only): `apps/app/lib/auth/gate.ts`,
    `apps/app/lib/auth/origin.ts` (`absoluteUrl`),
    `apps/app/lib/auth/login-attempt.ts`.
  - Strictly prohibited files: every file not listed above (no `gate.ts`, no
    login/callback routes).

[IMPLEMENTATION REQUIREMENTS]
  - In the `decision === 'redirect-login'` branch, build the login URL with
    `absoluteUrl(req, '/auth/login')`, then
    `login.searchParams.set('returnTo', `${req.nextUrl.pathname}${req.nextUrl.search}`)`
    **only when** `req.method === 'GET' && !req.nextUrl.pathname.startsWith('/api/')`.
  - `NextResponse.redirect(login)` replaces the current fixed redirect. The
    `'forbidden'` and `next` branches are unchanged; `decideGate` is not touched.
  - Update the middleware doc comment to state that the redirect carries the
    requested path (when safe) and that `returnTo` is validated downstream.
  - TDD order: extend `test/middleware.test.ts` first and watch the new cases
    fail before editing `middleware.ts`.

[VERIFICATION & TESTING RULES]
  - Permitted test command:
    `npm run test:unit -w @life/app -- test/middleware.test.ts`.
  - Required cases (added to the existing suite): unauth GET `/todos` → 307 with
    a Location containing `/auth/login` and `returnTo=%2Ftodos`; unauth GET
    `/todos?done=false` → `returnTo=%2Ftodos%3Fdone%3Dfalse`; unauth POST
    `/api/notes/flush` → Location contains `/auth/login` and does **not** contain
    `returnTo`. The existing four cases stay green (they assert
    `toContain('/auth/login')`).
  - The test helper gains a method argument and uses `NextRequest` (already
    imported).
  - Strict constraints: NO full suites, NO E2E; only this named file; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] GET gated requests carry `returnTo` = requested path+search; API/POST
        requests do not.
  - [ ] The gate decision logic is unchanged.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] `npm run test:unit -w @life/app -- test/middleware.test.ts` passes.

---

### T4 — Login route stores a validated `returnTo` (module `per-route-apps`)

[TASK OBJECTIVE]
  Read `?returnTo=` on `/auth/login`, validate it, and carry it inside the
  per-attempt cookie.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/auth/login/route.ts`,
    `apps/app/test/login-route.test.ts`.
  - Reference files (read-only): `apps/app/lib/auth/login-attempt.ts`,
    `apps/app/lib/auth/oidc-client.ts`, `apps/app/test/callback.test.ts`.
  - Strictly prohibited files: every file not listed above (no middleware, no
    callback, no gate).

[IMPLEMENTATION REQUIREMENTS]
  - Change `GET(_req)` to `GET(req: NextRequest)`; read
    `req.nextUrl.searchParams.get('returnTo')` and pass it through
    `sanitizeReturnTo`.
  - Encode the attempt as
    `encodeLoginAttempt({ state, nonce, codeVerifier, ...(returnTo ? { returnTo } : {}) })`.
    The 503 identity-unavailable path is unchanged and still sets no cookie.
  - TDD order: extend `test/login-route.test.ts` first and watch the new cases
    fail before editing the route.

[VERIFICATION & TESTING RULES]
  - Permitted test command:
    `npm run test:unit -w @life/app -- test/login-route.test.ts`.
  - Required cases (added to the existing suite): the two existing cases stay
    green (the request helper switches to `NextRequest`); a request to
    `/auth/login?returnTo=%2Ftodos` sets an `app_auth_attempt` cookie whose
    decoded value is `{state, nonce, codeVerifier, returnTo: '/todos'}`; a
    request to `/auth/login?returnTo=https%3A%2F%2Fevil.com` sets a cookie whose
    decoded value has no `returnTo`.
  - Strict constraints: NO full suites, NO E2E; only this named file; max test
    executions: 2.

[DEFINITION OF DONE]
  - [ ] `/auth/login` validates the query value with `sanitizeReturnTo` and
        stores only a valid `returnTo`.
  - [ ] The 503 failure path is unchanged.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] `npm run test:unit -w @life/app -- test/login-route.test.ts` passes.

---

### T5 — Callback resolves and redirects to `returnTo` (module `per-route-apps`)

[TASK OBJECTIVE]
  Return the validated `returnTo` from the callback decision logic and land the
  browser there (falling back to the current default landing).

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/auth/callback.ts`,
    `apps/app/app/auth/callback/route.ts`, `apps/app/test/callback.test.ts`,
    `apps/app/test/callback-route.test.ts` (new).
  - Reference files (read-only): `apps/app/lib/auth/login-attempt.ts`,
    `apps/app/lib/auth/env.ts`, `apps/app/lib/auth/origin.ts`,
    `apps/app/app/page.tsx`.
  - Strictly prohibited files: every file not listed above (no middleware, no
    login route, no gate).

[IMPLEMENTATION REQUIREMENTS]
  - `CallbackResult` success variant gains `returnTo?: string`.
  - `resolveCallback` returns `{ ok: true, sessionId: session.id, ...(attempt.returnTo
    ? { returnTo: attempt.returnTo } : {}) }`; every failure path is unchanged.
  - `app/auth/callback/route.ts` success redirect becomes
    `NextResponse.redirect(absoluteUrl(req, outcome.returnTo ?? '/'), { status: 303 })`
    (the `?? '/'` preserves the current default: `/` → `/notes`). Cookie
    set/clear logic is unchanged.
  - TDD order: extend `test/callback.test.ts` and write
    `test/callback-route.test.ts` first, watching them fail, before editing.

[VERIFICATION & TESTING RULES]
  - Permitted test command:
    `npm run test:unit -w @life/app -- test/callback.test.ts test/callback-route.test.ts`.
  - `test/callback.test.ts` (added cases): a valid attempt cookie carrying
    `returnTo: '/todos'` yields `{ ok: true, sessionId, returnTo: '/todos' }`; a
    handcrafted cookie whose `returnTo` is `//evil.com` yields `{ ok: true,
    sessionId }` with no `returnTo`.
  - `test/callback-route.test.ts` (new): mock `@/lib/auth/oidc-client`
    (`completeAuthorization` resolves a token set) and `@/lib/auth/session`
    (`createSession` resolves `{ id: 'session-1' }`); `GET` on
    `http://localhost/auth/callback?code=CODE&state=s` with an
    `app_auth_attempt` cookie carrying `returnTo: '/todos'` returns 303 with a
    Location path `/todos`; the same request with no `returnTo` returns 303 with
    a Location path `/`; a tampered `state` returns 400 and sets no session.
  - Strict constraints: NO full suites, NO E2E; only these two named files; max
    test executions: 2.

[DEFINITION OF DONE]
  - [ ] `resolveCallback` surfaces the validated `returnTo`; the route redirects
        to it with a `/` fallback.
  - [ ] All existing failure-path behaviour is unchanged.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] The prescribed two-file test command passes.

---

### T6 — Per-route PWA manifests (module `per-route-apps`)

[TASK OBJECTIVE]
  Add `/notes` and `/todos` manifests (own `id`/`start_url`/`scope`/name) linked
  by the route segment, keep root `/` as the default app, and make the new
  manifests fetchable without a session.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/public/manifest-notes.json` (new),
    `apps/app/public/manifest-todos.json` (new),
    `apps/app/app/notes/layout.tsx` (new),
    `apps/app/app/todos/layout.tsx` (new),
    `apps/app/lib/auth/gate.ts`, `apps/app/test/gate.test.ts`,
    `apps/app/test/manifests.test.ts` (new).
  - Reference files (read-only): `apps/app/public/manifest.json`,
    `apps/app/app/layout.tsx`, `apps/app/lib/auth/gate.ts` (existing
    `PUBLIC_EXACT`), `docs/specs/SPEC-ui-tokens.md`.
  - Strictly prohibited files: `apps/app/public/manifest.json` (stays the
    default), every token file, `packages/ui/**`, every e2e file.

[IMPLEMENTATION REQUIREMENTS]
  - Primitive reuse plan (Contract 1): none. `app/notes/layout.tsx` and
    `app/todos/layout.tsx` are `{children}` fragment pass-throughs
    (`return <>{children}</>;`) with zero visual responsibility — the Contract 1
    structural exemption. Their only content is `export const metadata:
    Metadata = { manifest: '/manifest-notes.json' }` (resp. todos). No raw HTML,
    no CSS, no `@life/ui` primitive, no visual language.
  - `manifest-notes.json`: `{ "id": "/notes", "name": "Personal Life — Notes",
    "short_name": "Notes", "start_url": "/notes", "scope": "/notes",
    "display": "standalone", "background_color": "#0f1115", "theme_color":
    "#0f1115", "icons": [{ "src": "/icon.svg", "sizes": "any", "type":
    "image/svg+xml", "purpose": "any" }] }`.
  - `manifest-todos.json`: same shape with `id`/`start_url`/`scope` = `/todos`,
    name "Personal Life — Todos", short_name "Todos".
  - `apps/app/lib/auth/gate.ts`: add `'/manifest-notes.json'` and
    `'/manifest-todos.json'` to `PUBLIC_EXACT`. Do not touch `decideGate` or the
    middleware matcher.
  - `apps/app/public/manifest.json` is left byte-identical.
  - TDD order: write `test/manifests.test.ts` (and extend `test/gate.test.ts`)
    first, watching them fail, before creating the JSON/layout/gate changes.

[VERIFICATION & TESTING RULES]
  - Permitted test command:
    `npm run test:unit -w @life/app -- test/manifests.test.ts test/gate.test.ts`.
  - `test/manifests.test.ts`: read the three JSON files with `fs.readFileSync`
    (`path.join(__dirname, '..', 'public', ...)`) and assert root
    `start_url === '/'`, notes `id`/`start_url`/`scope` all `'/notes'` and
    `short_name === 'Notes'`, todos `id`/`start_url`/`scope` all `'/todos'` and
    `short_name === 'Todos'`, and each has at least one icon; import
    `{ metadata as notesMetadata } from '@/app/notes/layout'` and
    `{ metadata as todosMetadata } from '@/app/todos/layout'` and assert
    `metadata.manifest` is `/manifest-notes.json` / `/manifest-todos.json`.
  - `test/gate.test.ts`: add `/manifest-notes.json` and `/manifest-todos.json`
    to the existing `isPublicPath` public-list assertion.
  - Strict constraints: NO full suites, NO E2E; only these two named files; max
    test executions: 2.

[DEFINITION OF DONE]
  - [ ] Both manifest files exist with the exact fields above; the root manifest
        is unchanged.
  - [ ] `/notes` and `/todos` layouts export the matching `metadata.manifest`
        and are fragment pass-throughs.
  - [ ] Both new manifest paths are in `PUBLIC_EXACT`.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] The prescribed two-file test command passes.

---

### T7 — E2E coverage for the two behaviours (module `per-route-apps`)

[TASK OBJECTIVE]
  Prove in a real browser that a gated `/todos` entry lands on `/todos` after
  login, and that `/notes` and `/todos` each link their own manifest.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/test/e2e/journey.ts`,
    `apps/app/test/e2e/suites/journey.suite.ts`.
  - Reference files (read-only): `apps/app/test/e2e/journey.prod.spec.ts`,
    `apps/app/test/e2e/dev/journey.dev.spec.ts`, `apps/app/test/e2e/config.ts`,
    `apps/app/app/todos/page.tsx`, `apps/app/app/notes/page.tsx`.
  - Strictly prohibited files: every e2e selector/role/text/aria-label, the
    `button.trash-delete` hook, every app/spec file not listed above.

[IMPLEMENTATION REQUIREMENTS]
  - `journey.ts`: widen `startLogin(page: Page, path: string = '/notes')` to
    navigate to `path`. No other helper changes.
  - `journey.suite.ts`: add two tests inside the existing `test.describe`:
    - `'per-route returnTo: a saved /todos entry logs in and lands on /todos'` —
      `startLogin(page, '/todos')`, `submitCredentials`, then
      `expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible({ timeout: 30_000 })`.
    - `'per-route PWA: each route links its own manifest'` — `logIn(page)`, then
      assert `page.locator('link[rel="manifest"]')` has href
      `/manifest-notes.json`; `page.goto('/todos')`; assert href
      `/manifest-todos.json`.
  - No existing test body, name, role, visible text, aria-label, or selector is
    changed. The e2e selector surface is frozen; only new assertions are added.
  - TDD order: the two tests are written first (they fail against the unfixed
    behaviour); the green state comes from T2–T6.

[VERIFICATION & TESTING RULES]
  - Permitted test command (single targeted run; the e2e spec file is
    modified, which is the one allowed E2E condition):
    `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "per-route"`.
    Expected: 2 passed.
  - Strict constraints: NO full suites, NO bare `test:e2e`; one targeted run, then
    at most one re-run after a fix; max test executions: 2.
  - The e2e selector surface (roles, visible text, aria-labels,
    `button.trash-delete`) is NOT part of this task's allowed changes; the
    post-login landing assertions are the only behaviour that moves, and the
    existing `/notes` landing tests remain valid unchanged.

[DEFINITION OF DONE]
  - [ ] The two new tests assert the `/todos` landing and the per-route manifest
        links.
  - [ ] No existing test/selector changed.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck -w @life/app` passes with zero errors.
  - [ ] The prescribed targeted E2E command passes (2/2).

---

### T8 — Five-lane verification (module `per-route-apps`)

[TASK OBJECTIVE]
  Run the global protocol §7.6 five-lane gate on the final integrated state and
  iterate until it returns N/N PASS.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: none (verification only; any fix re-opens its
    owning task T2–T7).
  - Reference files (read-only): the working diff,
    `tasks/plan-per-route-apps.md`, `docs/specs/SPEC-app-rp.md`.
  - Strictly prohibited files: everything (this task changes nothing).

[IMPLEMENTATION REQUIREMENTS]
  - Step 1 — suite gate first (red never reaches the lanes), with these exact
    commands:
    `npm run typecheck -w @life/app`,
    `npm run test:unit -w @life/app -- test/login-attempt.test.ts test/middleware.test.ts test/login-route.test.ts test/callback.test.ts test/callback-route.test.ts test/manifests.test.ts test/gate.test.ts`.
    Iterate fix → re-run until both are green.
  - Step 2 — fire five parallel lane subagents (read-only; the QA lane runs the
    Step 1 suite-gate commands), each returning exactly
    `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
    1. Correctness/domain (the login chain returns to the requested same-origin
       route and rejects off-origin values; the per-route manifests are correct
       and distinct);
    2. Code quality (five axes);
    3. Security (open-redirect validation, no token/secret exposure, zero
       CRITICAL/HIGH/MEDIUM on the changed files);
    4. QA (executes the Step 1 commands; the T7 e2e run is recorded separately as
       already executed in T7);
    5. Plan conformance (the working diff vs `tasks/plan-per-route-apps.md` and
       `docs/specs/SPEC-app-rp.md`).
  - Step 3 — fail-closed: a crashed, missing, or empty lane verdict is a failure.
    Any failed lane → fix its blockers → re-run ONLY the failed lanes → repeat
    until every lane returns PASS. Never mark done, commit, or merge on a partial
    verdict (the skill's one-fix-pass budget is overridden by the global
    protocol: iterate until N/N).
  - Step 4 — commit only on N/N PASS, staged by explicit paths (never
    `git add -A`).

[VERIFICATION & TESTING RULES]
  - Permitted test commands: the two suite-gate commands in Step 1 (run by the QA
    lane), within the repo profile.
  - Strict constraints: NO full suites, NO additional E2E; max test executions: 2
    per suite-gate iteration.
  - The gate's evidence is the per-round lane reports (verdicts + blockers).

[DEFINITION OF DONE]
  - [ ] Both suite-gate commands pass.
  - [ ] Five lanes each return a verdict; every lane is PASS (N/N).
  - [ ] No partial verdict was treated as done; no commit outside explicit paths.
  - [ ] Any blocker was fixed and only the failed lanes were re-run.

## Dependency order and parallelization

```
T1 (spec)
 ├─ T2 (login-attempt)  ── T4 (login route) ──┬─ T5 (callback) ─┐
 ├─ T3 (middleware)                            │                │
 └─ T6 (PWA manifests)                         │                │
                                               └── T7 (e2e) ───┴─ T8 (five-lane)
```

- T1 first (spec-first).
- After T1: **T2, T3, T6 run in parallel** (T3 and T6 do not depend on T2).
- T4 depends on T2 (uses `sanitizeReturnTo`/`LoginAttempt.returnTo`).
- T5 depends on T2 (surfaces `returnTo`) and can run in parallel with T4.
- T7 depends on T4, T5, T6 (the behaviour under test must exist).
- T8 is last, after every change.

## Deviations / risks

1. **Manifest mechanism vs the suggested route-segment `manifest.ts`.** The
   tech lead's example (`apps/app/app/notes/manifest.ts`,
   `apps/app/app/todos/manifest.ts`) does not work in the installed `next@15.5.25`:
   `isMetadataRouteFile` anchors `manifest` to the app root, and a throwaway
   `next build` with a nested `manifest.ts` produced **no** route (absent from
   `app-path-routes-manifest.json`; `/notes` HTML still linked `/manifest.json`).
   The plan uses the verified equivalent — `public/manifest-notes.json` /
   `public/manifest-todos.json` linked by `metadata.manifest` in a nested
   `layout.tsx` — which produced `/manifest-notes.json` and
   `/manifest-todos.json` links per route and left root `/manifest.json` as the
   default. Scope (per-route manifest identity) is unchanged; only the
   mechanism differs.
2. **Open port question (investigated).** `apps/app/package.json` dev runs
   `-p ${WEB_PORT:-3100}` and `start` runs `-p ${WEB_PORT:-3002}`;
   `apps/app/lib/auth/env.ts:98-100` defaults the redirect to
   `http://127.0.0.1:3002/auth/callback`; `apps/idp/src/oidc/clients.ts:20-23`
   defaults dev redirect URIs to `:3000`. `.env.development` (and
   `.env.development.example`) set `WEB_PORT=3100`,
   `OIDC_APP_REDIRECT_URI=http://127.0.0.1:3100/auth/callback` and
   `OIDC_APP_REDIRECT_URIS=http://localhost:3100/...,http://127.0.0.1:3100/...`,
   and production `compose.yaml` sets the redirect from `.env`. The `3002`/`3000`
   values are dead fallbacks in dev, not a functional mismatch. This plan does
   **not** change any port or default.
3. **IdP allow-list.** `returnTo` is never sent to the IdP — it lives only in the
   app's `app_auth_attempt` cookie and the callback redirect. The registered
   `redirect_uri` and `OIDC_APP_REDIRECT_URIS` are unchanged; the IdP needs no
   change.
4. **E2E landing assertion.** The existing `/notes` landing tests remain valid
   (they start at `/notes`, so `returnTo=/notes`). The plan **adds** a `/todos`
   landing test and per-route manifest assertions. The frozen e2e selector
   surface (roles, visible text, aria-labels, `button.trash-delete`) is not
   touched; `link[rel="manifest"]` is a new attribute selector on metadata, not a
   change to an existing UI selector.
5. **`require-session.ts` defense-in-depth.** Its fallback `redirect('/auth/login')`
   cannot carry a destination (no pathname is available server-side in a server
   component/action without extra plumbing). The middleware is the primary gate
   and carries `returnTo`; this residual path keeps the default landing.
   Documented, not changed.
6. **Contract 2.** Not engaged — no backend data service is touched, so no
   `## Cache Rules` work is required for this change.

## Open Questions

None. Both behaviours and the mechanism are decided and verified against the
installed runtime.
