# Spec: `pomodoro-stats` — the `/pomodoro/stats` surface

Module id: `pomodoro-stats` (from the capability map `MAP-pomodoro-focus-stats.md`,
whose §0 surfaces the run's assumptions before this spec's content; module-specific ones
are in §9). Serves the confirmed intent in `docs/intent/pomodoro-focus-stats.md`.
Consumes `focus-service`'s wire contract and `ui-charts`' prop contract; never redefines
either.

## 1. Objective

For the repository owner (375 px iPhone SE first, desktop second): the timer stops
recording effort and discarding it. Every focus block the owner completes or stops early
is recorded durably, and `/pomodoro/stats` shows today's progress against today's goal,
a week | month | year trend of buckets against the goal target line, scrollable leftwards
into earlier periods — with a shape-only Stats icon in the pomodoro top-right nav, order
**stats → feedback → settings**.

Acceptance criteria:

- Completing a focus block writes one session row; stopping early writes its actual
  elapsed minutes (paused time excluded, floored); anything under one minute writes
  nothing. Rows survive reload — the read comes back from `focus-service`.
- Today's bar: `ProgressBar`, `width:%` = today's minutes against the goal resolved for
  today. Changing the goal today re-measures today (bar and percentage re-read against
  the new number); a past day keeps the goal it was measured against.
- Period filter week | month | year, rolling windows ending today (map §0.12): week = 7
  daily bars, month = 30 daily bars, year = 12 monthly bars. Each bar is that bucket's
  total focus minutes; the target line comes from `ui-charts` semantics — each daily bar
  targets that day's resolved goal, each monthly bar the sum of its month's resolved
  daily goals (map §0.13).
- The period window scrolls leftwards into earlier periods (one period back per shift)
  and returns to today — all on 375 px: no tap target, axis, or interaction may require
  a wider screen.
- The daily goal is edited on `/pomodoro/settings` as a fourth minutes input (existing
  form shape, `MINUTES_RANGE` clamp) and persisted via `PUT /api/goal` with the
  client-passed date.
- The nav is stats → feedback → settings; the stats entry is a shape-only `IconLink`
  (aria-label `Stats`), no visible text.
- Timer mechanics unchanged: `timer.ts` transitions stay byte-identical to `origin/dev`.
- No streaks, gamification, notifications, or any edit/delete of past sessions exist
  anywhere in the surface.

## 2. Tech Stack

- Next.js 16 (app router) + React 19 in `apps/app` (`@life/app`), TypeScript 5.7.x.
- `@life/ui` primitives only (`BarChart`, `ProgressBar`, `IconLink`, `Input`, `Button`,
  `ManagerBlock`, `SettingsBlock`, `SettingsRow`, …) — Contract 1: no raw HTML UI
  elements, no `next/link`, no `recharts` import in `apps/*`.
- `@life/pomodoro` for the timer — mechanics untouched; recording rides the additive
  observation seam (§9).
- `@life/app-kit` (`readPrefNumber`/`setPrefNumbers` patterns, `settingsHref`,
  `routeLayoutMetadata`) and `apps/app/lib/focus-api.ts` (owned by
  `SPEC-focus-service.md`) through `callService` — server-only, IdP JWT, client-passed
  dates; the browser never sees a token.
- jest + ts-jest + jsdom + @testing-library/react (route/component tests); Playwright
  for e2e.

## 3. Commands

Repo profile commands only. The repo profile has no build knob, so this spec adds no
build step.

```bash
# typecheck — run in the touched workspace
npm run typecheck -w @life/app
# typecheck — all workspaces (before handing the PR over)
npm run typecheck

# unit tests — one file, from the owning workspace; max 2 runs per command
npm run test:unit -w @life/app -- test/routes-pomodoro-stats.test.tsx

# e2e — only after a DOM change, and only for the behaviour it actually covers
npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

## 4. Project Structure

```
apps/app/app/pomodoro/stats/page.tsx           the route (server: fetch rows + goals, compose)
apps/app/app/pomodoro/stats/                   client widgets: period filter, bucketing,
                                               scroll window, trend chart, today bar
apps/app/app/pomodoro/settings/page.tsx        + the "Daily goal" settings row
apps/app/app/pomodoro/actions.ts               + setPomodoroGoal server action
apps/app/app/pomodoro/pomodoro-nav.tsx         + Stats IconLink; order stats → feedback → settings
apps/app/lib/focus-api.ts                      BFF client + wire types (SPEC-focus-service.md)
apps/app/test/routes-pomodoro-stats.test.tsx   route + nav-order tests
apps/app/test/…-stats.test.tsx                 bucketing/recorder/goal-resolution unit tests
apps/app/test/e2e/pomodoro.spec.ts             timer selectors unchanged; stats flow appended
                                               (or apps/app/test/e2e/stats.spec.ts if cleaner)
docs/specs/SPEC-pomodoro-stats.md              this spec
```

## 5. Code Style

Pure functions for every rule, dense intent comments (the repo voice); the bucketing is
app-owned arithmetic with no framework in it:

```ts
/** Rolling windows ending today (map §0.12): 7/30 daily buckets, 12 monthly. */
export function bucketsFor(period: Period, rows: SessionRow[], goals: GoalRow[]): Bucket[] {
  // Buckets are built from the client's local dates only — the service never sees a
  // clock (SPEC-focus-service §1). Each bucket sums its days' minutes and carries the
  // target from the day→goal rule: daily bars use that day's goal, monthly bars sum it.
}

/** The locked day→goal rule (SPEC-focus-service §1), applied over the goal rows. */
export function resolveGoal(goals: GoalRow[], day: string): number | null {
  const applicable = goals.filter((g) => g.validFrom <= day);
  return applicable.length ? applicable[applicable.length - 1].minutes : null;
}
```

## 6. Testing Strategy

- Framework: jest + jsdom + @testing-library/react; suites in `apps/app/test/`, one per
  concern (routes, bucketing, recorder, nav).
- Unit: bucketing (7/30/12 buckets, rolling windows ending today, leftward shift by one
  period, month sums of per-day goals); the day→goal rule over dated rows (past-day
  stability, same-day replace); the recorder rules (floor to whole minutes, discard
  under one minute, paused time excluded); nav order (stats → feedback → settings).
- e2e (Playwright, only where the repo policy allows): the stats flow at the 375 px
  viewport — record a block, open stats via the icon, assert the nav order, today's bar
  against today's goal, filter switch (7/30/12 bars), leftward scroll into the previous
  window, and goal change re-measuring today while yesterday keeps its goal. Frozen
  surface: only the approved nav change (map §0.15) is new; existing timer selectors,
  labels and `button.trash-delete` are untouched.
- Budget: max 2 runs per command.

## Cache Rules

This module owns no cache and no service (Contract 2, Rule 4 satisfied by
`SPEC-focus-service.md`'s section). Its reads go through `focus-service`'s read-through
cache via the BFF; the app never caches rows itself and never holds plaintext concerns
beyond the request path — filtering, bucketing and the scroll window run in memory on
rows fetched per window.

## 7. Boundaries

**Always do**

- Compose from `@life/ui` primitives only; run the Contract 1 mechanical greps at every
  review touching UI.
- Pass client-resolved dates everywhere (lesson 0019); keep filtering, bucketing and the
  scroll window in the app.
- Record through `lib/focus-api.ts` only; keep `@life/pomodoro`'s existing tests green
  (`timer.ts` byte-identical).
- Keep the existing pomodoro e2e selectors and labels verbatim.

**Ask first**

- Any frozen-surface change beyond the approved nav one (map §0.15).
- Any `@life/pomodoro` API change beyond the additive observation seam.
- Token values, PWA constants, or any new dependency.
- Branch/PR mechanics beyond the agreed flow: branches from `origin/dev`, PRs to `dev`,
  never merged without the user's say-so.

**Never do**

- Streaks, gamification, notifications, or any edit/delete of past sessions (no UI, no
  API call).
- Timer mechanics changes (`timer.ts` transitions must remain byte-identical).
- `recharts` imports, raw HTML UI elements, `next/link`, or raw colour/length literals
  in `apps/*`.
- Server-side day derivation from any service clock.
- Add a build command or a build step (the repo profile declares none).
- Widen the test commands or exceed 2 runs per command.
- Merge the PR or push to `main`/`dev`.

## 8. Success Criteria

1. `npm run typecheck -w @life/app` is green; `npm run typecheck` is green before
   handover; the touched suites pass each within 2 runs.
2. Recording rules: completing a focus block creates exactly one row; reset at 95
   seconds elapsed creates `minutes: 1`; reset at 40 seconds creates nothing (asserted
   at the recorder seam and by the row's absence).
3. Durability: e2e — record a block, reload `/pomodoro/stats`, today's bar is unchanged.
4. Goal semantics: e2e — set goal 30 and record 20 (bar reads 67%); change the goal to 40
   and today's bar re-reads 50% while yesterday's bar stays against its own goal.
5. Buckets: week renders 7 daily bars, month 30 daily bars, year 12 monthly bars with
   per-month summed targets; scrolling left shows the previous window's correct totals
   (unit: bucketing + window shift; e2e: the gesture on 375 px).
6. Nav: the Stats entry is shape-only with aria-label `Stats` and no visible text; the
   order is stats → feedback → settings (route test + e2e).
7. 375 px Playwright run: no horizontal overflow on `/pomodoro/stats`; every control is
   reachable and tapped at the `@life/ui` tap-target sizes without a wider screen.
8. Mechanical checks clean: Contract 1 greps (raw UI elements only in exemptions, zero
   `next/link`, colour literals only in `tokens.css`), and `grep -rn "recharts" apps` is
   empty.
9. Out-of-scope absence: no streak/gamification/notification code, and no session
   edit/delete UI or API call anywhere.
10. `git diff origin/dev...HEAD -- apps/pomodoro/src/timer.ts` is empty (mechanics
    untouched).

## 9. Assumptions

1. Rolling windows ending today, leftward shift one period per scroll (map §0.12); the
   recorder, filter, bucketing and scroll window all live in this module.
2. Per-month targets are the sum of the month's per-day resolved goals (map §0.13).
3. The recorder rides an additive seam — an optional observation callback in
   `@life/pomodoro` (`PomodoroPage`/`useTimer`) or `useTimer` state observed in the app —
   and `timer.ts` is not touched (map §0.10).
4. The goal input lives on `/pomodoro/settings` (map §0.7); its server action follows
   `setPomodoroDurations`' shape.
5. Today's bar clamps at 100% width; with no goal set it shows minutes with no target
   claim (map §3).
6. Window data is fetched server-side through `focus-api` (server component / server
   action), so the token never reaches the browser; the client widget owns only filter
   and scroll state.
7. "Period strip" and "trend" collapse into the filter row plus one `BarChart` (map
   §0.11); today's bar is the separate `ProgressBar` (map §0.14).

## 10. Open Questions

1. Mid-focus tab close / navigation away: not recorded (map §3). If it should count as
   an aborted block, that is the map's open question, resolved before the plan freezes.
2. If a second, distinct "period strip" visualization is wanted (map §3), it needs a
   `ui-charts` addition and its own acceptance lines — not smuggled into this spec.
3. The leftward-scroll affordance: swipe-only versus also a labelled prev control. The
   requirement is that the gesture works at 375 px; the plan picks the shape.
4. With no goal set (map §3), whether the today bar should show at all versus showing
   minutes without a target — assumed the latter here.
