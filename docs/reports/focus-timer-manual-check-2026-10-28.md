# Task 9 manual check — a real timer run lands one row in `GET /api/sessions`

Repair evidence for the Task 9 definition of done: start the timer in the browser, let a focus
block run past a whole minute, stop it, and read the day back from the service over real HTTP.
Real `next dev`, real `focus-service`, real Postgres and Redis — no mock on any hop.

## The blocker that had to be repaired first

`/pomodoro` answered **500** on `next dev`, so no timer could be started at all:

```
TypeError: createContext only works in Client Components. Add the "use client" directive …
  at node_modules_recharts_es6_state_…
```

`packages/ui/src/components/bar-chart.tsx` wraps recharts but carried no `'use client'`, and the
`@life/ui` barrel re-exports it — so every server component graph that imported a primitive also
evaluated recharts' `createContext`. One directive line at the top of the module fixes the whole
barrel: `/notes` was 500 for the same reason and answers 200 with it.

## Setup

- `focus-service` from `dist/main.js` (rebuilt, `npm run build -w @life/focus-service`) on
  `127.0.0.1:3107`:
  - `NODE_ENV=development` — the guard's dev bypass makes every request principal `sub=dev-user`
  - `IDP_ISSUER=http://127.0.0.1:3111` (verifier config resolves up front; the dev bypass never
    uses the JWKS URL, but boot is fail-closed without the issuer)
  - `FOCUS_DB_URL=postgresql://postgres:verify@127.0.0.1:5599/focus` — container `focus-verify-pg`
  - `REDIS_URL=redis://127.0.0.1:6399` — container `focus-verify-redis`
  - `FOCUS_MASTER_KEY` — throwaway base64 32 bytes
- `next dev` on `127.0.0.1:3100` with `APP_DEV_SKIP_ACCESS_GATE=1`,
  `FOCUS_API_URL=http://127.0.0.1:3107`, the same `REDIS_URL`, and one seeded app session
  (`app:sess:manual-task9-sess`, `subject=dev-user`, tokens and expiry far in the future) so
  `requireSession()` resolves instead of redirecting to login.
- Chromium driven by Playwright; the page loads with `app_session=manual-task9-sess`.

## Steps the owner takes, run for real

1. Open `/pomodoro` — reads `Pomodoro | Focus | 25:00 | Reset | Start focus`.
2. Press **Start focus**.
3. Wait ~70 s.
4. Press **Pause** (the timer stops counting, the block is kept).
5. Press **Reset**, accept the confirm — Reset ends the cycle, which is how a focus block is
   abandoned mid-phase (`ownerResetMidFocus` in `@life/pomodoro`), and the block is reported with
   the whole minutes it counted.

## Result

The row inserted by that run, read straight from Postgres:

```
$ docker exec focus-verify-pg psql -U postgres -d focus \
    -c 'select id,"ownerSub",date,minutes,"createdAt" from focus_session'
                  id                  | ownerSub |    date    | minutes |           createdAt
--------------------------------------+----------+------------+---------+-------------------------------
 cde7a3b9-d522-4252-a3a3-308e5b869c24 | dev-user | 2026-10-02 |      25 | 2026-10-28 22:40:53.444101+00
 fafdfa15-43e5-4b62-b34e-861cb638d962 | dev-user | 2026-10-28 |       1 | 2026-10-28 23:07:31.690892+00
```

(`cde7…` is Task 8's synthetic row for `2026-10-02`; `fafd…` is this run.)

The same day read over HTTP, exactly as the requirement states:

```
$ curl -s -i -b 'app_session=manual-task9-sess' \
    'http://127.0.0.1:3107/api/sessions?from=2026-10-28&to=2026-10-28'
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[{"id":"fafdfa15-43e5-4b62-b34e-861cb638d962","ownerSub":"dev-user","date":"2026-10-28",
  "minutes":1,"createdAt":"2026-10-28T23:07:31.690Z"}]
```

**Exactly one row for today, `minutes=1`** — one whole minute out of the 70 s counted, the paused
remainder dropped because the day stores minutes. Nothing was recorded twice: the effect fires
once per block that ended, and the 19 s left on the clock never counted.

The day is the app's own `getToday()`, not the browser clock: the run resolved `2026-10-28` from
the `tz` cookie (`UTC` on this host) exactly as `recordFocusSession` passes it.

## Regression checks after the repair

```
apps/pomodoro      npm run test:unit -- test/focus-recorder.test.tsx   11 passed
packages/ui        npm run test:unit -- test/bar-chart.test.tsx        16 passed
apps/pomodoro      npm run typecheck                                   clean
packages/ui        npm run typecheck                                   clean
```

## Cleanup

Both dev processes stopped and the temporary Playwright driver deleted. The verified row stays in
the throwaway container `focus-verify-pg` — it is the evidence above — and the seeded Redis session
is left to expire. Nothing outside the two throwaway containers, `/tmp` and this report was
written.
