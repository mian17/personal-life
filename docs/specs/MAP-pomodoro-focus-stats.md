# Capability Map: pomodoro-focus-stats

/ Source: `docs/intent/pomodoro-focus-stats.md` (confirmed 2026-10-28).
Status: **spec phase** — the map and the three module specs below are this run's
specification artifacts; the implementation plan is written from them.

**User (canonical, defined once here):** the repository owner, primarily on a 375 px
iPhone SE, secondarily on desktop. Every module spec's §1 Objective states this user
outright; the definition lives here so the spec set has a single, citable source.

## 0. Assumptions this run proceeds on

Correct me now or the specs below stand on them.

1. **Scope check (honest):** the ask bundles three independently testable capabilities —
   durable focus-session + goal-history data (`focus-service`), reusable chart/progress
   primitives (`ui-charts`), and the stats surface with its recorder, nav, and goal
   control (`pomodoro-stats`) — plus the wire and prop contracts they sit on. Acceptance
   criteria cluster per module, and any module could ship (or be cut) without rewriting
   the others' requirements. So: a capability map and one spec per module, per
   `spec-driven-development` Phase 0.
2. **Storage:** the repo already has a specification system (`docs/specs/MAP-*.md` +
   `SPEC-<module>.md`, grep-pinned by `AGENTS.md` mechanical checks). The skill defers
   to the existing system's storage conventions, so the map and specs live in
   `docs/specs/`. The map is the index; the module ids below are stable and are never
   renamed mid-run.
3. **Only focus blocks are recorded.** Every focus block the owner completes or stops
   early becomes one session row; breaks (short/long) are never recorded.
4. **Minutes are whole minutes.** Actual elapsed minutes, floored (paused time excluded —
   it is not elapsed effort); anything under one minute is discarded and no row exists.
5. **The day is client-resolved** (the meal-service rule, lesson 0019): the app passes
   the owner's local `YYYY-MM-DD`, and no service derives a day from its own clock.
   Filtering, bucketing and the scroll window stay in the app.
6. **The goal is a set of dated rows resolved per day**, exactly like meal targets'
   `validFrom`: a day resolves to the latest goal row with `validFrom <= day`. A goal
   change writes a new row dated (client-passed) today and never rewrites past rows —
   which yields both success semantics verbatim: a past day keeps the goal it was
   measured against, and changing the goal today re-measures today.
7. **The daily goal is edited on `/pomodoro/settings`** as a fourth minutes input in the
   existing settings form shape, clamped by `MINUTES_RANGE` (1–180). Placement on the
   stats screen instead is an open question.
8. **`focus-service` rows are non-content** (timestamps, minute counts, goal numbers — no
   free text), so the at-rest ciphertext contract (`enc.v1.` / `@life/crypto`) does not
   apply; the cache still stores serialized rows as persisted. Recorded as a deviation in
   that spec's `## Cache Rules`.
9. **`focus-service` is a new NestJS workspace modelled on `apps/meal-service`**
   (TypeORM + PostgreSQL, `@life/cache` read-through with a per-owner generation
   counter, IdP JWT on the shared `life-api` audience). It needs a new loopback port;
   `3107` is proposed — ports are a hard line, so the exact value is ask-first.
10. **Timer mechanics are untouched.** Recording rides on an additive seam (an optional
    observation callback in `@life/pomodoro`, or `useTimer` state observed by the app);
    `timer.ts` transitions stay byte-identical. A tab close or navigation away mid-focus
    is **not** captured (no `beforeunload`, no mechanics change) — open question.
11. **"A period strip, and a trend" reads as one chart family** — the period filter row
    (week | month | year) plus the leftward-scrollable period window, and the `@life/ui`
    bar chart of that window: 7 daily bars (week), 30 daily bars (month), 12 monthly bars
    (year), carrying the goal target line. If a second distinct visualization was meant,
    correct me now.
12. **Windows are rolling and end at today:** week = the 7 days ending today, month = the
    30 days ending today, year = the last 12 monthly buckets. Scrolling leftwards shifts
    the window back one period at a time.
13. **The year view's per-month target is the sum of that month's per-day resolved
    goals** (days may resolve to different goal rows). Daily bars use that day's resolved
    goal directly.
14. **The today bar is not a chart** (intent: "plain `width:%` div") — but it is a styled
    element, so per Contract 1 it ships as a `@life/ui` primitive (`ProgressBar`, plain
    div fill) inside `ui-charts`, never hand-rolled in the app.
15. **Pomodoro nav becomes stats → feedback → settings**, the stats entry a shape-only
    `IconLink` (aria-label `Stats`), no visible text. This reorder + new icon is the
    frozen-surface change the confirmed intent explicitly approves; all existing labels
    and `button.trash-delete` stay verbatim.

## 1. Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `focus-service` | Durable focus-session rows + dated daily-goal rows, owner-isolated, owning the wire contract (`apps/app/lib/focus-api.ts` shapes) and the day→goal resolution rule. | — |
| `ui-charts` | The `@life/ui` chart wrappers over `recharts` (bar chart with target-line semantics; tokens, radius, axis, accessibility owned once) plus the plain `ProgressBar` (today's bar). | — |
| `pomodoro-stats` | The `/pomodoro/stats` surface: today's bar vs today's goal, period filter + trend chart, leftward scrolling, the nav icon, the focus-block recorder, and the daily-goal edit. | `focus-service`, `ui-charts` |

Build order: `focus-service` + `ui-charts` in parallel → `pomodoro-stats`.

Dependency direction is one-way and acyclic. Interfaces live at the provider boundary:
the wire contract and goal-resolution rule are owned by `SPEC-focus-service.md`, the
chart prop contract by `SPEC-ui-charts.md`; `SPEC-pomodoro-stats.md` consumes both and
never redefines them.

## 2. Notes on boundaries

- Contract 1: no visual language in `apps/*` — the trend chart is consumed only through
  the `@life/ui` wrappers and the today bar only through `ProgressBar`; `recharts` never
  reaches an app. `ui-charts` registers its components in `MAP-ui-primitives.md`
  (restored from `d1f54c9^`) per Rule 3, in the same change. The Contract 1 mechanical
  greps run at every review touching UI.
- Contract 2: `focus-service` carries the mandatory `## Cache Rules` section and composes
  the shared `@life/cache` `ReadThroughCache` exactly as `meal-service` does; it must not
  fork `notes-cache.ts`.
- Frozen surfaces: the only selector change is the pomodoro nav one in assumption 15
  (approved by the confirmed intent). Token values (`packages/ui/test/tokens.test.ts`),
  PWA constants, and `button.trash-delete` are untouched.
- Out of scope, binding on every module spec: streaks, gamification, notifications,
  editing or deleting past sessions (no update/delete session API or UI may exist), and
  timer mechanics changes. Nothing in a module spec may require them.

## 3. Open questions (cross-module)

- `focus-service`'s exact PORT (hard line; `3107` proposed).
- Whether a mid-focus tab close / navigation away should count as an aborted block — it
  would need a persistence seam that respects the timer-mechanics exclusion.
- "Period strip" vs "trend" as two separate surfaces (assumption 11 collapses them into
  one chart family) — say so if a second visualization is wanted.
- No goal set: today's bar shows minutes with no target line and no percentage claim
  (assumed). No default goal value is invented; if one is wanted, pick it.
