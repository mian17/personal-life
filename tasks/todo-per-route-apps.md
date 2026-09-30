# Ledger — per-route apps: login returns to the route + per-route PWA identity

Module: `per-route-apps`
Branch: `feature/todo-ecosystem` (`master` untouched, not merged)
Plan: `tasks/plan-per-route-apps.md` (validated round 3; re-validated round 4 after the T7a amendment)
Spec: `docs/specs/SPEC-app-rp.md` (amended by T1, spec-first)

## Scope

- **(A)** A gated GET must return the user to the route they asked for after sign-in
  instead of always landing on `/` → `/notes`.
- **(B)** `/notes` and `/todos` get their own PWA identity (`id`/`start_url`/`scope`),
  so a home-screen app saved from a route opens that route. Root `/` stays the default.

## Commits (oldest → newest)

| Commit | Task | Summary |
|---|---|---|
| `e35a048` | T1 | spec amendment + validated plan |
| `00775e4` | T3 | middleware carries `returnTo` on the gated redirect |
| `e5c9586` | T6 | per-route PWA manifests + nested layouts + gate public paths |
| `204ddad` | T2 | `sanitizeReturnTo` + `returnTo` on the attempt cookie |
| `ad963ae` | T4 | `/auth/login` validates + stores `returnTo` |
| `db2666a` | T5 | callback lands on the validated `returnTo` |
| `7c40d59` | — | plan amended with T7a (Deviation 7) |
| `fe7be55` | T7a | `NOTE_MASTER_KEY` passed to note-service in the prod e2e stack |
| `56d8acf` | T7 | e2e: `/todos` returnTo landing + per-route manifest links |

## Evidence

- **Suite gate (run by the tech lead):** `npm run typecheck -w @life/app` → 0 errors;
  `npm run test:unit -w @life/app -- test/login-attempt.test.ts test/middleware.test.ts test/login-route.test.ts test/callback.test.ts test/callback-route.test.ts test/manifests.test.ts test/gate.test.ts` → **7 suites / 57 tests passed**.
- **E2E (T7, single targeted run):**
  `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "per-route"` → **2 passed**, clean teardown, no leaked processes.

## Five-lane gate (T8) — round report

**Round 1: 5/5 PASS — closed.** Five parallel read-only lanes, identical shared context,
none exposed to another lane's verdict. Suite gate ran before the lanes (green).

| # | Lane | Verdict | Blockers |
|---|---|---|---|
| 1 | correctness / domain | `PASS_WITH_NITS` | 0 |
| 2 | code quality (five axes) | `PASS_WITH_NITS` | 0 |
| 3 | security | `PASS_WITH_NITS` | 0 (zero CRITICAL/HIGH/MEDIUM) |
| 4 | QA / coverage | `PASS_WITH_NITS` | 0 |
| 5 | plan conformance | `PASS_WITH_NITS` | 0 |

No fix pass was required: **zero blockers from any lane.**

### Nits (recorded, non-blocking)

- **Lane 1:** a hand-crafted `/auth/login?returnTo=/auth/login` can self-loop (the middleware
  can never generate it — `/auth/*` is public); an RSC `?_rsc` fetch would be stored in
  `returnTo` (noisy but harmless); `/..//evil.com` normalizes to a same-origin path.
- **Lane 2:** `value.length === 0` is redundant with the leading-`/` check; the `encodeLoginAttempt`
  ternary could be a plain field (JSON omits `undefined`); `delete parsed.returnTo` could be a
  destructure; the two manifests duplicate the icon/theme block.
- **Lane 3:** the login route's sanitizer accepts `/api/…` even though the middleware never
  produces it (same-origin, UX-only); `requestOrigin` trusting `x-forwarded-*` is pre-existing
  and out of scope; C1 controls not rejected but `new URL` percent-encodes them into the path.
- **Lane 4:** the `method === 'GET'` and `!startsWith('/api/')` guards are pinned jointly by a
  single `POST /api/…` case (hardening only).
- **Lane 5:** plan checkboxes left unticked; T7a's cited pre-insertion line numbers drifted;
  `startLogin`'s `path` param type is inferred rather than annotated.

## Deviations handled

- **Nested `manifest.ts` does not work** in the installed `next@15.5.25` (`isMetadataRouteFile`
  anchors the convention to the app root) — verified with a throwaway build; the plan uses
  `public/*.json` + `metadata.manifest` in a fragment `layout.tsx` instead (scope unchanged).
- **T7a added mid-execution** (Deviation 7): a pre-existing prod-e2e harness gap — `noteEnv`
  omitted `NOTE_MASTER_KEY`, so note-service failed closed at bootstrap and `globalSetup` died
  before `globalTeardown`. Amended into the plan and re-validated (round 4) before execution.
- **Port leak during the blocked run:** the failed `globalSetup` left four processes on
  3100/3103/3104/3105; ports are a hard line, so the human ran the cleanup (`kill`).

## Related lessons

- `docs/lessons/0005-per-route-apps-auth-returns-to-origin.md`
