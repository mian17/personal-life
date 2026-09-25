# Five-Lane Verification — `feature/idp` (IdP chapter)

Date: 2026-09-25 · Gate target: `master...feature/idp` (32 commits + fix commit `8d5e8b5`)
Process: `five-lane-verification` skill — suite gate first, 5 parallel independent lanes,
fail-closed scoring, exactly one fix pass, re-run failed lanes only, commit on N/N.

## Suite gate (step 0)

Green on the reviewed tree: `apps/idp` 78/78 → **81/81** post-fix, `apps/app` 72/72 unit →
**74/74** post-fix, `apps/note-service` 25/25 (untouched by the fix), root `npm run lint` clean,
Playwright e2e **20/20** (human's run on `1f0f779`) + **1/1** `login-degraded.spec.ts` post-fix.
An initial concurrent-run red (idp + note-service) was refuted as resource contention: both suites
pass serially with exact recorded counts; no test binds the human's dev ports.

## Lane verdicts

| Lane | Round 1 | Round 2 (post-fix) |
|---|---|---|
| 1 correctness/domain | FAIL (1 HIGH) | **PASS_WITH_NITS** |
| 2 code quality | FAIL (1 HIGH, 1 MEDIUM) | **PASS_WITH_NITS** |
| 3 security | PASS_WITH_NITS (0 blockers) | stands — not re-run |
| 4 QA / e2e | FAIL* (1 MEDIUM, contradictory verdict) | **PASS_WITH_NITS** |
| 5 plan conformance | FAIL (1 HIGH, 1 MEDIUM) | **PASS_WITH_NITS** |

\* Lane 4 returned `PASS_WITH_NITS` while listing a must-fix blocker; fail-closed scoring
treated the contradiction as FAIL. Result: **N/N = 5/5 PASS** at round 2.

## Blockers found (round 1) and their fixes (`8d5e8b5`)

1. **HIGH** `apps/app/lib/auth/session.ts` — no single-flight refresh; `Promise.all` data calls
   presented the same rotating refresh token → reuse detection revoked the grant family →
   intermittent forced re-login. Fixed: `globalThis`-anchored in-flight map, cleared on settle.
2. **MEDIUM** `apps/idp/src/login/cookies.ts` — unguarded `decodeURIComponent` → 500s on malformed
   cookies. Fixed: fail closed to "no cookie".
3. **HIGH** `apps/idp/src/oidc/oidc.service.ts` — `rpInitiatedLogout` enabled by library default
   (`end_session` served/advertised) = FORBIDDEN (f) of the plan (deferred to the multi-RP
   chapter; would also have been a divergent logout path without grant revocation).
4. **MEDIUM** same file — PAR + userinfo outside the plan's enable-only surface.
   Fixed 3+4: explicit enable-only feature block (discovery, code+PKCE, token, refresh rotation,
   JWKS + RFC 8707 resource indicators); disabled endpoints 404 and are absent from discovery.
5. **MEDIUM** QA — behavior 12 (IdP down → 503 page) had no browser-level proof.
   Fixed: `apps/app/test/e2e/login-degraded.spec.ts` + `degraded-app.ts` (isolated app on 3199,
   dead-IdP issuer 3198); ran green 1/1 twice (fix agent + QA lane).

## Auditability checklist (skill §Verification)

1. Every lane returned valid JSON with a schema-conformant verdict — yes.
2. Fail-closed held — yes (QA's contradictory verdict counted FAIL, not pass).
3. Merge condition N/N — yes (5/5), and merge itself held per repo rule (human deploy gate first).
4. Failed lanes re-verified by lane agents, not self-certified by the fixer — yes (round 2 re-read
   the current files and QA re-executed the suites).
5. This report records per-lane verdicts + remaining blockers (none) — yes.

## Remaining nits (tracked, non-blocking)

- No user-facing logout affordance in the app UI (only `POST /auth/logout`).
- `resolveIssuer()` accepts an empty `IDP_ISSUER` (compose default) instead of failing at boot;
  `/auth/login` folds config errors into the generic 503.
- No login rate limiting (accepted under single-user tailnet exposure).
- `devClient()` registered in every environment including production.
- `STATIC_OIDC_PATHS` still forwards disabled paths (they 404 — inert residue).
- Provider cookies lack `Secure` (library default); provider rows never GC'd (`purgeExpired` unused).
- `tasks/todo-idp.md` says "8c" but no Task 8c is defined; implementation checkboxes left `[ ]`.
- Environmental: a stale e2e process holds `127.0.0.1:3103` (pid 737943) — reap before the next
  full Playwright run; the prod e2e build shares `apps/app/.next` with a running `npm run dev`.

## Human-owned remainder (unchanged)

Deploy checklist in `tasks/todo-idp.md` (`.env` edits, Tailscale Serve, `docker compose up`,
production seed, phone check) → then merge `feature/idp` → `master`.
