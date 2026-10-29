# Implementation Plan: pomodoro focus stats

Produced by planning-and-task-breakdown; source spec: `docs/specs/MAP-pomodoro-focus-stats.md`
(capability map; module specs `docs/specs/SPEC-focus-service.md`,
`docs/specs/SPEC-ui-charts.md`, `docs/specs/SPEC-pomodoro-stats.md`); confirmed intent:
`docs/intent/pomodoro-focus-stats.md`.

This plan is the only artifact of this run. It does not restate, narrow, or rewrite any
spec requirement. Where a spec question is still open, the question is carried in Open
Questions rather than answered by invention.

## Overview

Three modules, built bottom-up along the map's one-way dependency edge. First
`focus-service`: a new NestJS workspace holding two tables (durable focus-session rows and
dated goal rows), owner-isolated by IdP `sub`, every read through the shared `@life/cache`
read-through cache, every date client-passed. Then `ui-charts`: two `@life/ui` primitives,
`BarChart` (the only place `recharts` exists) and `ProgressBar` (a plain `width:%` div), so
`apps/*` never imports a chart library and one token change moves every app. Finally
`pomodoro-stats`: an additive observation seam in `@life/pomodoro` that records every focus
block, a BFF client, the `/pomodoro/stats` route (today's bar, week/month/year trend with a
leftward-scrolling window), the daily-goal setting, and the shape-only Stats nav icon in
the approved stats then feedback then settings order. `timer.ts` transitions stay
byte-identical throughout. One task outside those three modules teaches `@life/db`'s
Postgres backup and restore pair the focus database, so the new tables are covered like
every other service's (`SPEC-focus-service` section 2).

## Architecture Decisions

1. **PostgreSQL via a fail-closed `FOCUS_DB_URL`, wired like `feedback-service`.**
   `SPEC-focus-service` section 2 names PostgreSQL and TypeORM in the `meal-service` shape;
   `meal-service` itself runs `better-sqlite3`, so the database URL is taken from
   `feedback-service`'s fail-closed pattern (`app.module.ts` throws without it) while the
   folder layout, controller, service and cache adapter follow `meal-service`. Writes bump
   the owner generation after the database write, exactly as `target.service.ts` does.

2. **`MINUTES_RANGE` is a local constant inside `focus-service`.** Importing
   `@life/pomodoro` into a Node service drags a React package graph (its barrel re-exports
   `PomodoroPage`) into every boot. So
   `apps/focus-service/src/sessions/dto/session-rules.ts` declares
   `MINUTES_RANGE = { min: 1, max: 180 }` with a comment pinning it to `@life/pomodoro`'s
   value, and a unit test asserts the literal bounds. The wire contract is unchanged;
   `apps/app` still clamps input through `@life/pomodoro`'s export.

3. **The stats window lives in the URL, not in client state.** The `/pomodoro/stats` route
   is a server component: it reads `?period=week|month|year` and `?offset=<n>` where 0 is
   the window ending today, resolves dates with the existing `getToday()`, and fetches only
   that window through the BFF. Shifting leftwards is a `Pill as="a"` or `IconLink` pointing
   at `offset + 1`, so there is no client fetch, no second round trip, and the 375 px
   affordance is a normal tap target. This satisfies `SPEC-pomodoro-stats` section 9.6's
   server-side fetch rule with the scroll state expressed as a link.

4. **The recorder is a separate file, never a `timer.ts` edit.**
   `apps/pomodoro/src/focus-recorder.ts` owns a pure
   `focusBlockMinutes({ phase, durations, remainingMs })` (elapsed is phase length minus
   remaining, floored, and a value below 1 means discard) plus a `useFocusRecorded` hook
   that watches transitions the machine already produces: into `boundary` for a completed
   focus block, and `resetCycle` for an early stop. `timer.ts`, `use-timer.ts` transitions
   and every existing timer test stay untouched; `PomodoroPage` gains one optional prop.

5. **`BarChart` renders `ResponsiveContainer` with `initialDimension`.** jsdom reports zero
   width, so a plain `ResponsiveContainer` would draw nothing in `packages/ui`'s test
   environment. `initialDimension={{ width: 320, height: 160 }}` renders at a test size
   before measuring, so the suite can assert bar fills and the target reference line; in
   the browser the container still measures its 375 px parent.

6. **The target line is one `ReferenceLine` fed by per-bucket targets.** Map section 0.13's
   stepped line is drawn from the `target` values the app passes: the day's resolved goal
   for a daily bucket, the sum of a month's resolved daily goals for a monthly bucket.
   `recharts` never leaves `packages/ui`.

7. **Compose and production wiring are deliberately out of this plan.** Ports and compose
   changes are a hard line (`AGENTS.md`, `SPEC-focus-service` section 7). Tasks below wire
   dev and the e2e harness only; the production compose service is drafted by the human
   after the port question is answered.

8. **Backup coverage goes through the Postgres pair, not the SQLite registry.**
   `SPEC-focus-service` section 2 requires `@life/db` backup tooling to cover the new
   tables. Both new tables are Postgres, and `packages/db/src/paths.ts` names only the five
   `better-sqlite3` files, so Task 15 teaches `backup-pg.ts` / `restore-pg.ts` a list of
   Postgres databases (`resolvePgDatabases`) instead of adding a focus entry to a SQLite
   path table it does not belong in.

## Task List

### Phase 1: `focus-service` (foundation, then two vertical slices)

## Task 1: Scaffold the `apps/focus-service` workspace and its cache adapter

**Description:** Create the workspace the other phases call: `package.json`
(`@life/focus-service`, scripts mirroring `apps/meal-service`, jest config with `testRegex`
`(\.e2e-spec|\.test)\.ts$` and the same `moduleNameMapper` for `@life/*`), `tsconfig.json`,
`nest-cli.json`, `Dockerfile`, and the app shell: `main.ts` with a `PORT` default,
`app.factory.ts` with the global `AuthGuard` and
`ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`, `app.module.ts`
fail-closed on a missing `FOCUS_DB_URL` exactly like
`apps/feedback-service/src/app.module.ts`, and `service-config.ts` declaring
`FOCUS_IDP_JWKS_URL`, `FOCUS_SERVICE_AUDIENCE` and `FOCUS_MASTER_KEY`. Add the one cache
adapter, `src/cache/focus-cache.ts`, pinning the `focus` namespace over `@life/cache`'s
`ReadThroughCache` with `generationKey` and `createFocusCache(redisUrl)` copied in shape
from `meal-cache.ts`, with no forked cache package (Contract 2 Rule 4). Register
`apps/focus-service` in the root `package.json` `workspaces` array.

**Acceptance criteria:**
- [ ] `npm run typecheck -w @life/focus-service` resolves and the workspace appears in the root `workspaces` array.
- [ ] Booting without `FOCUS_DB_URL` throws at module load; booting with it starts the app and `GET /health/ready` answers.
- [ ] `FocusCache` composes keys as `focus:<sub>:v<gen>:<rest>` with counter `focus:gen:<sub>`, and imports every mechanic from `@life/cache` with no local key builder and no local TTL.
- [ ] An absent `REDIS_URL` selects the direct database path, and a client error never surfaces out of the adapter (fail-open inherited from `ReadThroughCache`).

**Verification:**

Run these from `apps/focus-service`; that workspace owns the `test:unit` script.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/health.e2e-spec.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable to this task, because the repository's Playwright suite drives browser surfaces and this task adds none; the jest suite named above is this workspace's end-to-end level.
- [ ] Manual check: `PORT=3107 FOCUS_DB_URL=postgresql://127.0.0.1:5432/focus npm run dev -w @life/focus-service`, then `curl -s localhost:3107/health/ready` returns ok.

**Dependencies:** None

**Files likely touched:**
- `apps/focus-service/package.json`
- `apps/focus-service/tsconfig.json`
- `apps/focus-service/nest-cli.json`
- `apps/focus-service/src/main.ts`
- `apps/focus-service/src/app.factory.ts`
- `apps/focus-service/src/app.module.ts`
- `apps/focus-service/src/service-config.ts`
- `apps/focus-service/src/cache/focus-cache.ts`
- `apps/focus-service/test/health.e2e-spec.ts`
- `package.json`

**Estimated scope:** Large: 5+ files

## Task 2: Wire `focus-service` into the dev stack and the e2e harness

**Description:** Make the new service reachable from `apps/app` in local dev and in the
Playwright harness, without touching compose. The root `dev` and `dev:build` concurrently
lists gain `focus-service` on the spec's proposed dev port `3107`.
`.env.development.example` and `scripts/setup-dev-env.sh` gain `FOCUS_API_URL`,
`FOCUS_DB_URL` and `FOCUS_MASTER_KEY`. `apps/app/test/e2e/config.ts` gains one field in both
port records it already exports: `focusPort` in `testPorts` reading `E2E_FOCUS_PORT` and
defaulting to `portInSlot(3109, slot)`, and `focusPort` in `devPorts` reading
`E2E_DEV_FOCUS_PORT` and defaulting to `portInSlot(3209, slot)`, so each stays inside its own
band and clear of the app, idp, note, tags, todo, meal, feedback and degraded-app ports.
`apps/app/test/e2e/stack.ts` builds and spawns `apps/focus-service` with a `FOCUS_DB_URL`
pointing at the slot's throwaway Postgres (a `focus` database created on it) and exports
`FOCUS_API_URL` into `appEnv`. The existing `apps/app/test/slot-ports.test.ts` already
asserts every port the harness binds, so it gains the two new fields.

**Acceptance criteria:**
- [ ] `slot-ports.test.ts` passes with the two new fields, `focusPort` being `3109` in `testPorts(0)` and `3209` in `devPorts(0)`, with no collision against any existing port.
- [ ] Dev runs `focus-service` on `3107` and `apps/app` reaches it through `FOCUS_API_URL`.
- [ ] A harness stack boot spawns `focus-service` after `idp`, and its `GET /health/ready` answers before any spec runs.
- [ ] No `compose.yaml` change is included; the production compose block stays unwritten pending the owner's port confirmation.

**Verification:**

Run the jest line from `apps/app`, which owns the `test:unit` script. The
`npx playwright test` line is run from the repository root, because its
`--config apps/app/playwright.config.ts` path is root-relative.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/slot-ports.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — this task adds no observable browser behaviour of its own.
- [ ] Manual check: from the repository root, boot the harness once with npx playwright test --config apps/app/playwright.config.ts test/e2e/pomodoro.spec.ts -g "boundary" and confirm the global-setup log shows `focus-service` started and its readiness probe passed.

**Dependencies:** Task 1

**Files likely touched:**
- `package.json`
- `.env.development.example`
- `scripts/setup-dev-env.sh`
- `apps/app/test/e2e/config.ts`
- `apps/app/test/e2e/stack.ts`
- `apps/app/test/slot-ports.test.ts`

**Estimated scope:** Large: 5+ files

## Task 3: Session rows: entity, minutes rule, owner-scoped routes, cache read-through

**Description:** The service's first vertical slice: one focus block in, one durable row
out. `src/sessions/session.entity.ts` follows the `meal-service` `entry.entity.ts` shape:
`id` (uuid, service-generated), `ownerSub` (text, nullable, stamped from `@Principal()`),
`date` (text, client-passed `YYYY-MM-DD`), `minutes` (integer) and `createdAt`, with no start
or end timestamps, no completed or aborted flag, and no update or delete column
(`SPEC-focus-service` section 9.1). `src/sessions/dto/create-session.dto.ts` validates
`date` against a `DATE_ONLY` regex and `minutes` as an integer inside `MINUTES_RANGE`;
`list-sessions.query.ts` requires `from` and `to`. `sessions.service.ts` writes through the
repository then awaits `this.cache.bumpGeneration(sub)`, and reads the owner's range through
`cache.getThrough(sub, 'focus:sessions:<from>:<to>', loader)` returning serialized rows as
persisted, meaning plain row objects and never DTOs (this service has no plaintext concern,
per the recorded `## Cache Rules` deviation). `sessions.controller.ts` exposes
`POST /api/sessions` and `GET /api/sessions?from=&to=`, and never PATCH or DELETE. Add
`test/session-rules.test.ts` pinning the minutes rule as this boundary actually sees it —
the `MINUTES_RANGE` literal bounds 1 and 180, integer-only enforcement, `minutes: 0`,
`minutes: 1.5` and `minutes: 181` refused while `minutes: 1` is accepted — and the
`DATE_ONLY` date shape. The seconds-to-minutes flooring is deliberately not asserted here:
the service boundary accepts whole minutes, so seconds never reach it. The 95-second and
40-second examples belong to Task 9's `test/focus-recorder.test.tsx`, where the
seconds-valued `remainingMs` input exists.

**Acceptance criteria:**
- [ ] `POST /api/sessions {date, minutes}` returns 201 with `{ id, ownerSub, date, minutes, createdAt }`, and a `GET` over that range returns the row.
- [ ] `minutes: 0`, `minutes: 1.5`, `minutes: 181` and a malformed `date` each answer 4xx, while `minutes: 1` succeeds.
- [ ] Every query is scoped by the principal's `sub`, so a second owner's `GET` never returns the first owner's rows.
- [ ] The cached value is the serialized row with no DTO mapping and no field renaming, and the write path calls `bumpGeneration` after the insert.

**Verification:**

Run these from `apps/focus-service`; that workspace owns the `test:unit` script.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/session-rules.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable to this task, because the repository's Playwright suite drives browser surfaces and this task adds none; the behavioural proof is Task 5's jest `*.e2e-spec.ts` suites.
- [ ] Manual check: `curl -XPOST localhost:3107/api/sessions` with a bearer token and body `{"date":"2026-10-28","minutes":20}` returns 201, and a follow-up `GET` shows the row.

**Dependencies:** Task 1

**Files likely touched:**
- `apps/focus-service/src/sessions/session.entity.ts`
- `apps/focus-service/src/sessions/dto/create-session.dto.ts`
- `apps/focus-service/src/sessions/dto/list-sessions.query.ts`
- `apps/focus-service/src/sessions/dto/session-rules.ts`
- `apps/focus-service/src/sessions/sessions.service.ts`
- `apps/focus-service/src/sessions/sessions.controller.ts`
- `apps/focus-service/src/sessions/sessions.module.ts`
- `apps/focus-service/src/app.module.ts`
- `apps/focus-service/test/session-rules.test.ts`

**Estimated scope:** Large: 5+ files

## Task 4: Goal rows: dated insert, replace on same date, locked resolution rule

**Description:** The service's second slice: the daily goal as history. `goal.entity.ts`
holds `id`, `ownerSub`, `validFrom` (text `YYYY-MM-DD`), `minutes` and `createdAt`, one row
per changed day. `goals.service.ts` exposes the locked rule
`resolveGoal(rows, day): number | null`, returning the minutes of the latest row whose
`validFrom` is at or before `day`, and `null` when no row applies, with rows sorted by
`validFrom`. It also exposes `setGoal(sub, dto)`, which replaces the row whose `validFrom`
equals the client-passed date, never touches another date's row, and then bumps the owner
generation. `goals.controller.ts` exposes `PUT /api/goal` taking `{date, minutes}` and
`GET /api/goal` returning all the owner's goal rows. Per `SPEC-focus-service`'s
`## Cache Rules` and Contract 2 Rule 1, that read is not a direct repository query:
`goals.service.ts` reads the owner's goal rows through
`cache.getThrough(sub, 'focus:goal', loader)`, keyed `focus:<sub>:v<gen>:goal` — one entry
per owner holding the whole goal list, no date range in the key, serialized rows as
persisted (`validFrom`, `minutes`) and never DTOs — and the repository access lives inside
that loader and nowhere else. `setGoal` writes through the repository, then bumps the owner
generation, so the next read repopulates. The service never reads its own clock: a missing
or malformed date is a 400 through a `requireDay` helper shaped like `target.service.ts`'s.
Add `test/goal-resolution.test.ts` covering past-day stability, same-date replacement and
the empty-row `null`.

**Acceptance criteria:**
- [ ] `PUT /api/goal {date: D, minutes: 30}` followed by `{date: D, minutes: 40}` leaves exactly one row for `D` at 40 minutes, and a row for the prior day is unchanged.
- [ ] `resolveGoal` returns 30 for a day before a later change and 40 for the day of the change.
- [ ] `resolveGoal` returns `null` for a day earlier than every row, and `GET /api/goal` returns an empty array for a fresh owner.
- [ ] `GET /api/goal` reaches the database only through `cache.getThrough(sub, 'focus:goal', loader)`, so `grep -n "getThrough" apps/focus-service/src/goals/goals.service.ts` is non-empty and no repository call sits outside the loader.
- [ ] A request with no `date` or an impossible date is a 400 and never falls back to a default day.

**Verification:**

Run these from `apps/focus-service`; that workspace owns the `test:unit` script.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/goal-resolution.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable to this task, because the repository's Playwright suite drives browser surfaces and this task adds none; the HTTP proof is Task 5's `goals.e2e-spec.ts`.
- [ ] Manual check: send `PUT /api/goal` twice for the same date and confirm `GET /api/goal` holds one row for that date plus the unchanged row for the prior date.

**Dependencies:** Task 1

**Files likely touched:**
- `apps/focus-service/src/goals/goal.entity.ts`
- `apps/focus-service/src/goals/dto/set-goal.dto.ts`
- `apps/focus-service/src/goals/goals.service.ts`
- `apps/focus-service/src/goals/goals.controller.ts`
- `apps/focus-service/src/goals/goals.module.ts`
- `apps/focus-service/src/app.module.ts`
- `apps/focus-service/test/goal-resolution.test.ts`

**Estimated scope:** Large: 5+ files

## Task 5: Durability, isolation and cache suites for `focus-service`

**Description:** Prove the behaviours the service exists for, in jest, using the
`meal-service` harness pattern: an ephemeral Ed25519 JWKS server in `test/jwt-harness.ts`, a
fake Redis client in `test/fake-redis.ts`, and a throwaway Postgres schema.
`sessions.e2e-spec.ts` covers row durability across a cache flush and an app rebuild against
the same database, owner isolation on read and write, 4xx on malformed rows, and a
generation bump after each write. `goals.e2e-spec.ts` covers the same-date replace through
HTTP and the dated read of `GET /api/goal`. `focus-cache.e2e-spec.ts` asserts both keys
`SPEC-focus-service`'s `## Cache Rules` locks: the sessions key
`focus:<sub>:v<gen>:sessions:<from>:<to>` and the goal key `focus:<sub>:v<gen>:goal`, that
values are rows as persisted and byte-equal the entity rows rather than DTOs (session rows
and goal rows alike), that the range arguments are the only per-fetch component while
filters and pagination never enter a key and no date ever enters the goal key, and that a
cache error degrades to the direct loader without throwing and without writing. It also
asserts a generation bump after every successful write, session create and goal upsert both.
Record the spec's `## Cache Rules` deviation in a comment: rows are numbers and timestamps,
so no `enc.v1.` tripwire applies, while the rows-as-persisted discipline still holds
absolutely.

**Acceptance criteria:**
- [ ] A posted row is still returned by `GET /api/sessions` after a cache flush and after rebuilding the app instance against the same database.
- [ ] Two principals writing and reading never observe each other's sessions or goals.
- [ ] The cache suite observes `focus:<sub>:v<n>:sessions:<from>:<to>` and `focus:<sub>:v<n>:goal` keys, cached values from both equal to the persisted rows, and a bumped generation after a session write and after a goal write.
- [ ] With a client whose `get`, `set` and `incr` all reject, every read still answers from the database and no populate is attempted.

**Verification:**

Run each jest line below from `apps/focus-service`, which owns the `test:unit` script. Each
suite gets its own invocation — `sessions.e2e-spec.ts`, then `goals.e2e-spec.ts`, then
`focus-cache.e2e-spec.ts` — one suite per command, and each command stays inside the
profile's 2-run cap. The three are deliberately not combined into a single invocation, and
every suite this task ships has a declared run line.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/sessions.e2e-spec.ts (at most 2 run(s) for this task)
- [ ] Focused unit tests pass: npm run test:unit -- test/goals.e2e-spec.ts (at most 2 run(s) for this task)
- [ ] Focused unit tests pass: npm run test:unit -- test/focus-cache.e2e-spec.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable to this task, because these jest `*.e2e-spec.ts` suites are this service's end-to-end level as `SPEC-focus-service` section 3 states; the repository's Playwright suites drive browser surfaces the service does not own.
- [ ] Manual check: re-run the same three single-suite commands, one per invocation, against a freshly created schema and confirm each is green on its own.

**Dependencies:** Task 3, Task 4

**Files likely touched:**
- `apps/focus-service/test/jwt-harness.ts`
- `apps/focus-service/test/fake-redis.ts`
- `apps/focus-service/test/sessions.e2e-spec.ts`
- `apps/focus-service/test/goals.e2e-spec.ts`
- `apps/focus-service/test/focus-cache.e2e-spec.ts`
- `apps/focus-service/test/setup-env.ts`

**Estimated scope:** Large: 5+ files

## Checkpoint: After Tasks 1-5

- [ ] `npm run typecheck` is green across the workspace.
- [ ] `apps/focus-service` boots with `FOCUS_DB_URL` and serves sessions and goals owner-scoped, and `grep -rln "getThrough" apps/focus-service/src` is non-empty.
- [ ] `grep -n "## Cache Rules" docs/specs/SPEC-focus-service.md` holds and the code matches what that section says.
- [ ] No session update or delete endpoint exists in any controller.
- [ ] Human review of the service surface before the UI phases consume it.

### Phase 2: `ui-charts` primitives in `@life/ui`

## Task 6: Add `BarChart`, the only home of `recharts`, with target-line semantics

**Description:** Add `recharts` to `packages/ui/package.json` dependencies, the single
dependency the confirmed intent approved, declared here and nowhere else. Write
`packages/ui/src/components/bar-chart.tsx`: a small wrapper taking
`data: { label: string; value: number; target?: number }[]`, an accessible `label`, and an
optional height. It renders recharts' `ResponsiveContainer` with
`initialDimension={{ width: 320, height: 160 }}` so a jsdom render has a size to draw at, one
`Bar` with `fill="var(--accent)"` and `radius={[4, 4, 0, 0]}`, one `ReferenceLine` over the
per-bucket targets with `stroke="var(--amber)"` and `strokeDasharray="4 4"`, and `XAxis` and
`YAxis` styled with `tick={{ fill: 'var(--muted)' }}` and `stroke="var(--border)"`, plus a
visually-hidden list carrying each bucket's label, value and target for screen readers.
Export the tick-thinning helper `visibleTickIndexes(count, maxTicks)` from the same file,
capped at 7 labelled ticks, and use it to blank non-labelled tick labels so 30 daily bars
stay legible at 375 px. Export both from `packages/ui/src/index.ts` and restore
`docs/specs/MAP-ui-primitives.md` from `d1f54c9^` with `BarChart` registered in the existing
entry shape.

**Acceptance criteria:**
- [ ] `packages/ui/test/bar-chart.test.tsx` shows one bar per bucket at its `value`, and one reference line carrying the per-bucket targets when `target` is present.
- [ ] Rendered colour attributes resolve to `var(--accent)`, `var(--amber)`, `var(--muted)` and `var(--border)`, with no colour literal in the component file.
- [ ] `visibleTickIndexes(30, 7)` yields at most 7 indexes, the rendered chart labels no more than 7 ticks, and `role="img"` plus `aria-label` and the visually-hidden bucket list are present.
- [ ] `grep -rn "recharts" apps --include='*.ts*'` is empty and `docs/specs/MAP-ui-primitives.md` lists `BarChart`.

**Verification:**

Run these from `packages/ui`; that workspace owns the `test:unit` script.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/bar-chart.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — the 375 px chart proof belongs to the consuming surface.
- [ ] Manual check: render a 30-bucket chart at 375 px in devtools and confirm no horizontal overflow and readable tick labels.

**Dependencies:** None

**Files likely touched:**
- `packages/ui/package.json`
- `packages/ui/src/components/bar-chart.tsx`
- `packages/ui/src/index.ts`
- `packages/ui/test/bar-chart.test.tsx`
- `docs/specs/MAP-ui-primitives.md`

**Estimated scope:** Medium: 3-5 files

## Task 7: Add `ProgressBar`, the plain `width:%` today bar

**Description:** Add `packages/ui/src/components/progress-bar.tsx`, the primitive the
intent promoted from a plain `width:%` div so no app hand-rolls a styled div (Contract 1
Rule 1, map section 0.14). Props are `value`, a percent in 0 to 100 that the caller clamps
and the component clamps again, and `label`, the accessible name such as "Today: 20 of 30
minutes". It renders a `role="progressbar"` track with `aria-valuemin`, `aria-valuemax` and
`aria-valuenow`, plus a fill div whose inline `width` percentage is the only inline style.
Both elements are styled through `var(--...)` tokens and the component imports nothing from
`recharts`. Export it from `packages/ui/src/index.ts` and register it beside `BarChart` in
`docs/specs/MAP-ui-primitives.md`.

**Acceptance criteria:**
- [ ] The fill width equals the percent value, clamped at both ends: a negative value renders 0 and 150 renders 100.
- [ ] The track exposes `role="progressbar"`, the passed `aria-label`, and `aria-valuenow`, `aria-valuemin` and `aria-valuemax`.
- [ ] The component file imports neither `recharts` nor any chart code, and styles only through `var(--...)` tokens.
- [ ] `docs/specs/MAP-ui-primitives.md` lists both new primitives, and `packages/ui/test/tokens.test.ts` is untouched and green.

**Verification:**

Run these from `packages/ui`; that workspace owns the `test:unit` script.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/progress-bar.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — the today-bar behaviour is asserted by the consuming route and its e2e.
- [ ] Manual check: render the bar at 0, 50 and 100 percent in a 375 px viewport and confirm the fill never exceeds the track.

**Dependencies:** None

**Files likely touched:**
- `packages/ui/src/components/progress-bar.tsx`
- `packages/ui/src/index.ts`
- `packages/ui/test/progress-bar.test.tsx`
- `docs/specs/MAP-ui-primitives.md`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 6-7

- [ ] `npm run typecheck` is green and both `@life/ui` suites are green within their run budgets.
- [ ] `grep -rn "recharts" apps --include='*.ts*'` is empty, and colour literals appear only in `packages/ui/src/styles/tokens.css`.
- [ ] `packages/ui/test/tokens.test.ts` is byte-identical to `origin/dev` and green.
- [ ] Human review of the two prop contracts before the app consumes them.

### Phase 3: `pomodoro-stats` surface

## Task 8: Add the BFF client `apps/app/lib/focus-api.ts`

**Description:** Give the app its single doorway to `focus-service`: a `server-only` module
exporting the wire types `SessionRow { id, ownerSub, date, minutes, createdAt }` and
`GoalRow { validFrom, minutes }` — the names `SPEC-pomodoro-stats` section 5 fixes, kept
identical to the service DTOs per `SPEC-focus-service` section 7 — plus four calls built on
`callService` — `listSessions(from, to)`, `recordSession(date, minutes)`, `listGoals()` and
`setGoal(date, minutes)` — over `process.env.FOCUS_API_URL ?? 'http://127.0.0.1:3107'`,
following the shape of `meal-api.ts`. The browser never sees a token, because every call
goes through `callService`'s `requireSession`. Dates are always parameters and are never
derived here.

**Acceptance criteria:**
- [ ] The four functions exist with the types above — the session wire type is named `SessionRow`, not a `Focus*` synonym — and `listSessions` encodes `from` and `to` as query parameters rather than interpolating them into the path.
- [ ] `recordSession` sends `POST /api/sessions` with `{date, minutes}` and `setGoal` sends `PUT /api/goal` with `{date, minutes}`, and both surface `callService`'s `ApiError` unchanged.
- [ ] The module imports `server-only` and is not imported by any `'use client'` file.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script; the
`npx playwright test` line each consumer task defers is run from the repository root.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/focus-api.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — every consumer task exercises these calls through the route and the e2e suite.
- [ ] Manual check: log one `listSessions` call from a server component against the dev service and confirm a 200 carrying rows.

**Dependencies:** Task 2, Task 3, Task 4

**Files likely touched:**
- `apps/app/lib/focus-api.ts`
- `apps/app/test/focus-api.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 9: Record every focus block through an additive seam in `@life/pomodoro`

**Description:** Turn the timer's existing state into durable rows without touching its
mechanics. Add `apps/pomodoro/src/focus-recorder.ts` with the pure
`focusBlockMinutes({ phase, durations, remainingMs })`, where elapsed is phase length minus
remaining and is floored to whole minutes, with 0 meaning discard, plus a
`useFocusRecorded(state, onBlockEnd)` hook that fires once per focus phase when the machine
settles on `boundary` for a completed block and when the owner resets mid-focus for an early
stop, and never for the `short` and `long` phases. Export both from
`apps/pomodoro/src/index.ts`, leaving `timer.ts` and `use-timer.ts` transitions unedited.
`PomodoroPage` gains one optional prop `onFocusBlockEnd?: (minutes: number) => void`. In
`apps/app`, a `'use server'` action `recordFocusSession(minutes)` in
`apps/app/app/pomodoro/actions.ts` resolves the day with `getToday()`, keeping the date
client-passed per lesson 0019, and discards `minutes < 1` before calling `recordSession`. A
small client wrapper under `apps/app/app/pomodoro/` passes the action to `PomodoroPage`.

**Acceptance criteria:**
- [ ] `focusBlockMinutes` returns 1 for 95 seconds of elapsed focus, 0 for 40 seconds, and 0 for every break phase.
- [ ] `git diff origin/dev...HEAD apps/pomodoro/src/timer.ts` is empty and the existing timer and use-timer suites pass unchanged.
- [ ] A completed focus block and a mid-focus reset each produce exactly one action call, and a block under one minute produces none.
- [ ] Paused time is excluded, so pausing for most of a phase leaves the recorded minutes reflecting counted time only.

**Verification:**

Run these from `apps/pomodoro`, which owns the `test:unit` script this task's suite lives
in. The task also edits `apps/app`, so its typecheck runs there too — a second command, not
a second run of the same one.

- [ ] Typecheck passes: npm run typecheck (in `apps/pomodoro`)
- [ ] Typecheck passes: npm run typecheck (in `apps/app`, whose action and wrapper this task edits)
- [ ] Focused unit tests pass: npm run test:unit -- test/focus-recorder.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — the row's survival is asserted through the stats surface.
- [ ] Manual check: run the timer, stop a focus block after about 70 seconds, and confirm one row for today appears in `GET /api/sessions` for today's range.

**Dependencies:** Task 8

**Files likely touched:**
- `apps/pomodoro/src/focus-recorder.ts`
- `apps/pomodoro/src/pomodoro-page.tsx`
- `apps/pomodoro/src/index.ts`
- `apps/pomodoro/test/focus-recorder.test.tsx`
- `apps/app/app/pomodoro/actions.ts`
- `apps/app/app/pomodoro/timer-recorder.tsx`
- `apps/app/app/pomodoro/page.tsx`

**Estimated scope:** Large: 5+ files

## Task 10: Bucketing and window arithmetic as pure functions

**Description:** One module, `apps/app/lib/stats-buckets.ts`, owns every number the surface
draws, with the signatures `SPEC-pomodoro-stats` section 5 names. It exports
`type Period = 'week' | 'month' | 'year'`,
`type Bucket = { label: string; value: number; target?: number }`, and
`bucketsFor(period: Period, rows: SessionRow[], goals: GoalRow[]): Bucket[]` returning 7
daily buckets for week, 30 daily buckets for month and 12 monthly buckets for year, each
with `label`, `value` as the sum of that bucket's session minutes, and `target` as the day's
resolved goal for a daily bucket or the sum of the month's resolved daily goals for a
monthly bucket, left undefined when no goal applies. Bucket boundaries come from the dates
present in `rows`, so a period's bucket count is the number of its days the caller supplied:
the caller pairs the `days` list `windowFor` returns with the fetched rows into one
`SessionRow` per day of the window and a zero-minute row for a day that has no session, and
`bucketsFor` then sums each bucket over the rows landed in it. It also exports
`resolveGoal(goals: GoalRow[], day: string): number | null`, the same locked rule the
service applies, so the app resolves a day's goal over the goal rows it fetched rather than
importing from the service workspace; and
`windowFor(period: Period, offset: number, today: string): { from: string; to: string; days: string[] }`,
which carries the offset and the client-resolved `today` that `bucketsFor`'s spec signature
deliberately does not take, giving the inclusive `from` and `to` dates to fetch plus the day
list the caller passes as rows. Rolling windows end today at offset 0 and shift one whole
period per offset step. Dates are computed from `YYYY-MM-DD` parts and never through a
`Date` round-trip that could shift a day.

**Acceptance criteria:**
- [ ] `bucketsFor(period, rows, goals)` returns exactly 7, 30 and 12 buckets for week, month and year when the caller passes one row per day of `windowFor(period, 0, today)`'s `days` list, a zero-minute row standing in for a session-less day, and the last bucket ends on `today`.
- [ ] Offset 1 shifts the window one whole period back with the same bucket count, and `windowFor(period, 1, today)` returns a `from`, a `to` and a `days` list covering exactly the buckets returned.
- [ ] `resolveGoal(goals, day)` returns the latest row's minutes with `validFrom <= day` and `null` when no row applies, matching the service's locked rule.
- [ ] A monthly bucket's `target` equals the sum of that month's resolved daily goals, and a bucket with no applicable goal row carries `target: undefined` rather than a default.
- [ ] Session minutes land in the bucket of their own `date`, including a session on the first and the last day of the window, and a window whose days all carry zero minutes still yields the full 7, 30 or 12 buckets.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script; the
`npx playwright test` line this task defers is run from the repository root.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/stats-buckets.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — this task ships pure arithmetic the rendered surface proves.
- [ ] Manual check: call `bucketsFor` for each period with hand-written rows and compare the totals against the input by hand.

**Dependencies:** Task 8

**Files likely touched:**
- `apps/app/lib/stats-buckets.ts`
- `apps/app/test/stats-buckets.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 11: Add the `/pomodoro/stats` route with today's bar, period filter, trend and leftward window

**Description:** Build the surface. `apps/app/app/pomodoro/stats/page.tsx` is a server
component: it reads `?period=` defaulting to week and `?offset=` defaulting to 0, resolves
`today` with `getToday()`, fetches the one window through `focus-api`, and renders
`ManagerBlock title="Stats" backHref="/pomodoro"` with three parts. First, today's
`ProgressBar`, whose percent is today's minutes divided by the day's goal resolved through
the bucketing module's own `resolveGoal(goals, today)` and clamped, and which shows the
minutes with no percentage claim when that resolution is `null`. Second, a period filter
built from `PillGroup` and `Pill as="a"` for week, month and year, each linking to
`?period=<p>&offset=0`, plus one labelled `IconLink` pointing at `?offset=<offset + 1>` for
the leftward shift. Third, the `BarChart` fed by `bucketsFor(period, rows, goals)` over the
rows whose dates `windowFor(period, offset, today)` names, with that window's `days` list
paired against the fetched rows so every day carries a row (zero minutes when no session
landed on it) and the bar count is the window length. The shift is a link, so the tree stays
server-rendered and every control is an existing `@life/ui` primitive.
`apps/app/test/routes-pomodoro-stats.test.tsx` renders the route with a mocked `focus-api`
and asserts the today bar's percentage against a goal, the 7, 30 and 12 bar counts per
period, and the shift link's target.

**Acceptance criteria:**
- [ ] With a 30-minute goal and 20 recorded minutes today, the today bar renders at 67 percent and its accessible label states the minutes.
- [ ] With no goal row, the route renders the minutes with no percentage claim and no target line, because `resolveGoal` returns `null` for that day.
- [ ] Week renders 7 bars, month 30 and year 12, each carrying its target when a goal applies, and the shift link points at `offset + 1`.
- [ ] The route composes only `@life/ui` primitives, with no hand-rolled styled element, no `next/link` and no `recharts` import, and reads its window through `focus-api` with `today` from `getToday()`.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script; the
`npx playwright test` line this task defers is run from the repository root.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/routes-pomodoro-stats.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — that spec drives this route at 375 px end to end.
- [ ] Manual check: open `/pomodoro/stats` at 375 px, switch between week, month and year, shift left once, and confirm no horizontal overflow and that the previous window's totals differ.

**Dependencies:** Task 6, Task 7, Task 10

**Files likely touched:**
- `apps/app/app/pomodoro/stats/page.tsx`
- `apps/app/app/pomodoro/stats/stats-view.tsx`
- `apps/app/test/routes-pomodoro-stats.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 12: Add the daily-goal edit on `/pomodoro/settings`

**Description:** Build the goal's write side where the map placed it (section 0.7). Extend
`apps/app/app/pomodoro/settings/page.tsx` with a "Focus stats" `SettingsBlock` holding one
`SettingsRow` labelled "Daily goal", an `Input type="number"` clamped by `MINUTES_RANGE` and
defaulted from `resolveGoal(goals, getToday())`'s value, blank when that is `null`, and a
submit `Button`. Extend `actions.ts` with `setPomodoroGoal(formData)`, which clamps the
minutes, resolves today with `getToday()`, and calls `setGoal(today, minutes)`, so today
re-measures against the new number while past days keep theirs. Extend
`apps/app/test/routes-pomodoro-settings.test.tsx` to cover the new row and the action's
clamped argument.

**Acceptance criteria:**
- [ ] The settings route renders a "Daily goal" row whose input carries `min` and `max` from `MINUTES_RANGE` and the currently resolved today goal as its default.
- [ ] Submitting writes `PUT /api/goal` with the client-resolved today and the clamped minutes, and an out-of-range value is clamped rather than sent raw.
- [ ] The existing three duration rows, their labels and their save behaviour are unchanged.
- [ ] The page keeps composing `@life/ui` primitives only: `SettingsBlock`, `SettingsRow`, `Input` and `Button`.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script; the
`npx playwright test` line this task defers is run from the repository root.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/routes-pomodoro-settings.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — that spec changes a goal and asserts today's bar re-measures.
- [ ] Manual check: set the goal to 40 on `/pomodoro/settings`, return to `/pomodoro/stats`, and confirm today's percentage changed while a past day's bar is unchanged.

**Dependencies:** Task 8, Task 11

**Files likely touched:**
- `apps/app/app/pomodoro/settings/page.tsx`
- `apps/app/app/pomodoro/actions.ts`
- `apps/app/test/routes-pomodoro-settings.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 13: Add the Stats nav entry in the order stats then feedback then settings

**Description:** Make the one approved frozen-surface change (map section 0.15). Add a
shape-only `IconLink href="/pomodoro/stats" label="Stats"` carrying a lucide chart icon with
`aria-hidden` to `apps/app/app/pomodoro/pomodoro-nav.tsx`, placed before the existing
`FeedbackNavItem`, so the toolbar reads stats then feedback then settings. No visible text is
added and no existing label changes. Update `apps/app/test/pomodoro-nav.test.tsx` to assert
the new order and the new `aria-label`, keeping its existing feedback-app assertion.

**Acceptance criteria:**
- [ ] The toolbar renders three items in the order stats then feedback then settings, the stats item has `aria-label="Stats"` with no visible text, and its `href` is `/pomodoro/stats`.
- [ ] `aria-label="Send feedback"` and `aria-label="Settings"` are unchanged and the gear remains last.
- [ ] The nav test asserts the order and the stats label and passes.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script; the
`npx playwright test` line this task defers is run from the repository root.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/pomodoro-nav.test.tsx (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: deferred to Task 14, which runs npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" from the repository root — that spec asserts the nav order in the running app.
- [ ] Manual check: on a 375 px viewport, confirm three tap-sized icons in the top-right with the chart icon leftmost and no visible label text.

**Dependencies:** Task 11

**Files likely touched:**
- `apps/app/app/pomodoro/pomodoro-nav.tsx`
- `apps/app/test/pomodoro-nav.test.tsx`

**Estimated scope:** Small: 1-2 files

## Task 14: Add the Playwright e2e for the stats flow at 375 px

**Description:** One spec, `apps/app/test/e2e/stats.spec.ts`, with
`test.use({ viewport: { width: 375, height: 667 } })`, driven through the existing `logIn`
journey helper. It starts a focus block and lets it run out or stops it early, opens
`/pomodoro/stats` from the toolbar icon, asserts the nav order stats then feedback then
settings, asserts today's bar reads against today's goal, switches week to month to year and
asserts 7, 30 and 12 bars, shifts left once and asserts the previous window's totals differ,
reloads and asserts the today bar is unchanged, then changes the goal on `/pomodoro/settings`
and asserts today's bar re-measures while yesterday's bar keeps its own goal. It asserts no
horizontal overflow at 375 px by comparing `document.documentElement.scrollWidth` with
`clientWidth`. Existing timer selectors and every `button.trash-delete` label stay untouched.

**Acceptance criteria:**
- [ ] The spec passes at a 375 px viewport and asserts no horizontal document overflow on `/pomodoro/stats`.
- [ ] Recording survives reload, so the today bar's value before and after a reload is identical.
- [ ] Changing the goal today re-measures today's bar while a past day's bar keeps the goal it was measured against.
- [ ] Week, month and year render 7, 30 and 12 bars respectively, and one leftward shift shows the previous window.

**Verification:**

Run the jest line below from `apps/app`, which owns the `test:unit` script. Run the
`npx playwright test` line from the repository root, because the profile's
`--config apps/app/playwright.config.ts` path is root-relative and does not resolve from
inside a workspace.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/routes-pomodoro-stats.test.tsx (at most 2 run(s) for this task) — this task adds no unit suite of its own, so it re-runs the route suite its spec drives.
- [ ] E2E passes where this task needs an end-to-end check: npx playwright test --config apps/app/playwright.config.ts test/e2e/stats.spec.ts -g "stats" (from the repository root)
- [ ] Manual check: run the same flow by hand at 375 px in devtools and confirm every control is reachable without horizontal scrolling.

**Dependencies:** Task 9, Task 11, Task 12, Task 13

**Files likely touched:**
- `apps/app/test/e2e/stats.spec.ts`
- `apps/app/test/e2e/journey.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 8-14

- [ ] `npm run typecheck` is green and every touched suite is green within its 2-run budget.
- [ ] `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'` shows only the documented exemptions, and `grep -rn "next/link" apps --include='*.tsx'` is empty.
- [ ] `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` hits only `packages/ui/src/styles/tokens.css`.
- [ ] `grep -rln "getThrough" apps/focus-service/src` is non-empty and no session update or delete route exists.
- [ ] No streak, gamification, notification, or session edit and delete code exists anywhere in the change.
- [ ] Human review before the five-lane gate.

### Phase 4: Backups for the new tables

## Task 15: Wire the focus database into `@life/db` backup and restore tooling

**Description:** `SPEC-focus-service` section 2 requires that `@life/db` backup tooling
cover the new tables like every other service's. Both new tables live in a Postgres
database, so the coverage belongs to the Postgres pair, not the SQLite registry: the
`DatabaseName` list and path table in `packages/db/src/paths.ts` stay untouched, because
they name the five `better-sqlite3` files and the focus database is not one of them.
Instead the Postgres tools stop assuming a single database. `packages/db/src/pg-client.ts`
gains `DEFAULT_FOCUS_DB_URL` and `resolveFocusDb(env)` beside `DEFAULT_FEEDBACK_DB_URL` and
`resolveFeedbackDb`, plus one exported `resolvePgDatabases(env): PgIdentity[]` list the two
tools iterate, so a database is added in one place. `backup-pg.ts` dumps every resolved
database per run and keeps one `databases` entry and one `<database>.dump` per database in
the same UTC-stamped directory, with `--only <name>` restricting the run and rejecting any
name outside that list before anything is written. `restore-pg.ts` takes the same list,
replaces only the selected database, takes that database's pinned pre-restore snapshot, and
compares its post-write counts against that database's manifest entry rather than
`databases[0]`. Retention, the verified-`pg_restore --list` gate and the stack-stopped probe
keep their current behaviour. The root `db:backup:pg` / `db:restore:pg` scripts already
forward argv after `--`, so they only change if a second database name stops being
expressible through that forwarding.

**Acceptance criteria:**
- [ ] `resolveFocusDb(env)` parses `FOCUS_DB_URL` with default `postgresql://focus@postgres-focus:5432/focus`, and `resolvePgDatabases(env)` returns the feedback and focus identities in that order.
- [ ] `npm run db:backup:pg -- --only focus` from the repository root dumps the focus database with `pg_dump -Fc --no-owner`, verifies it with `pg_restore --list`, and records the focus entry with per-table counts in `manifest.json`; a run with no `--only` covers both databases in one snapshot directory.
- [ ] `npm run db:restore:pg -- --from backup/<stamp> --only focus` replaces only the focus database, writes its pinned pre-restore snapshot, and compares its post-write counts against the focus manifest entry.
- [ ] An `--only` name outside `{feedback, focus}` exits 1 as a usage error before any dump, copy or write happens, and `packages/db/src/paths.ts` is unchanged.

**Verification:**

Run each jest line from `packages/db`, which owns the `test:unit` script. Each suite gets
its own invocation, one suite per command, inside the profile's 2-run cap.

- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/backup-pg.test.ts (at most 2 run(s) for this task)
- [ ] Focused unit tests pass: npm run test:unit -- test/restore-pg.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable to this task, because the repository's Playwright suite drives browser surfaces and this task adds none; the fake-`PgRunner` suites above are this tooling's test level.
- [ ] Manual check: boot the dev stack, then run `npm run db:backup:pg -- --only focus` from the repository root and confirm the archive, the `manifest.json` focus entry and its table counts.

**Dependencies:** Task 1

**Files likely touched:**
- `packages/db/src/pg-client.ts`
- `packages/db/src/backup-pg.ts`
- `packages/db/src/restore-pg.ts`
- `packages/db/test/backup-pg.test.ts`
- `packages/db/test/restore-pg.test.ts`
- `package.json`

**Estimated scope:** Large: 5+ files

## Checkpoint: After Task 15

- [ ] The two fake-runner suites are green, and `grep -n "resolveFocusDb" packages/db/src` is non-empty.
- [ ] `db:backup:pg --only focus` and `db:restore:pg --only focus` both name the focus database and neither touches feedback's rows.
- [ ] `packages/db/src/paths.ts` and `packages/db/scripts/*` retain their current database lists and arguments.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `focus-service` needs a Postgres the dev stack and the harness do not have yet | High | Task 2 points the harness at the slot's existing throwaway Postgres and creates a `focus` database on it; dev reuses the same server through `FOCUS_DB_URL`, and Task 1 fails closed so a missing URL is loud rather than silent |
| The dev port `3107` is only the spec's proposal and the harness already binds 3107 to feedback on 31xx | High | Dev default stays `3107` on the host dev stack, and the harness binds `3109` in `testPorts` (`E2E_FOCUS_PORT`) and `3209` in `devPorts` (`E2E_DEV_FOCUS_PORT`), one per band and both asserted by `slot-ports.test.ts`; all three are raised in Open Questions and compose stays untouched |
| recharts renders nothing under jsdom because `ResponsiveContainer` measures zero width | Medium | Task 6's `initialDimension` decision, asserted by the bar-chart suite rather than discovered later |
| The recorder double-counts a block through an effect replay or StrictMode | Medium | `focusBlockMinutes` is pure and the hook fires on a transition keyed by the phase's `endsAt`; Task 9's suite pins one call per block |
| Monthly bucket targets are easy to mis-sum | Medium | Task 10 pins the sum-of-daily-goals rule with a unit test before Task 11 consumes it |
| Teaching `db:backup:pg` / `db:restore:pg` a second database could silently change feedback's existing backup and restore behaviour | High | Task 15 keeps the fake-`PgRunner` suites (`backup-pg.test.ts`, `restore-pg.test.ts`) green, restricts every change to selecting from a list instead of a single URL, and its acceptance criteria require an unmatched `--only` name to exit 1 before any write |
| A frozen surface drifts: nav labels, token values, PWA constants | High | Only the approved nav item is added, and `tokens.test.ts` plus the PWA constants are untouched and checked at the phase checkpoints |

## Open Questions

1. **`focus-service` port.** `3107` is the spec's proposal, and the e2e harness already
   binds 3107 to `feedback-service` on the 31xx band. The plan adds two harness values in
   `apps/app/test/e2e/config.ts`: `focusPort` in `testPorts` (`E2E_FOCUS_PORT`, default
   `portInSlot(3109, slot)`) and `focusPort` in `devPorts` (`E2E_DEV_FOCUS_PORT`, default
   `portInSlot(3209, slot)`), one per band. Confirm all three values before merge — ports
   are a hard line.

2. **Production compose wiring.** The `focus-service` block, its Postgres, and the app's
   `FOCUS_API_URL` are deliberately outside this plan (`SPEC-focus-service` section 7).
   That block follows the port answer and is a human-run deploy step.

3. **Task-list target.** `tasks/todo.md` and `tasks/plan.md` already hold the in-flight
   `SPEC-ui-shadcn-primitives` plan's unchecked tasks, so this plan is written to
   `tasks/plan-pomodoro-focus-stats.md` rather than bulk-closing that one.

4. **Leftward scroll control (map 10.3).** The plan expresses the previous-period shift as
   a URL-carrying `IconLink`, because the route is server-rendered and the intent forbids a
   client-side refetch. If the owner wants a drag gesture instead, that is an intent change,
   not a plan edit.

5. **Mid-focus reset (map 0.10, 10.1).** The intent records an early stop as a recorded
   block; the plan honours that without touching timer mechanics by observing the existing
   `resetCycle` transition. Confirm whether a reset within the first minute should still be
   discarded — the plan discards it, on `SPEC-pomodoro-stats` section 5's whole-minute rule.

6. **`bucketsFor` signature.** The spec names `bucketsFor(period, rows, goals)` with no
   window, so the plan keeps that signature exactly and puts the offset and the
   client-resolved `today` on a sibling export, `windowFor(period, offset, today)` returning
   `{ from, to, days }`; the caller passes one row per day of `windowFor`'s `days` into
   `bucketsFor`. Nothing else in the spec's named API is renamed or widened: `SessionRow`,
   `GoalRow` and `resolveGoal(goals, day)` keep the spec's names. Because the spec signature
   also carries no window, `bucketsFor` takes its bucket boundaries from the rows it is
   handed: the caller pairs `windowFor`'s `days` with the fetched rows, one row per day and a
   zero-minute row for a session-less day. If the spec would rather see the offset and the
   day list on `bucketsFor` itself, that is a spec edit, not a plan edit.
