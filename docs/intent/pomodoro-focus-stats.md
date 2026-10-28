# Intent — Focus session persistence + stats surface

## Outcome
Every focus block the owner completes or stops early is saved durably by a new
`focus-service`, and `/pomodoro/stats` shows today's progress against today's target,
a period strip, and a trend — filterable by week / month / year and scrollable leftwards
into earlier periods.

## User
The repository owner, primarily on a 375 px iPhone SE, secondarily on desktop.

## Why now
`/pomodoro` persists only the three duration cookies (`pomodoro_focus|short|long`).
Sessions vanish on reload, so no history exists to review — the timer records effort
and then discards it.

## Success
A session row survives reload. Today's bar reads against today's goal. A past day keeps
the goal it was measured against even after the goal changes. Changing the goal today
re-measures today, so hitting the old number does not count as hitting the new one.

## Constraint
375 px is the design target: no tap target, axis, or interaction may require a wider
screen. An aborted block counts its actual elapsed minutes; anything under one minute is
discarded. Charts are `recharts`, consumed only through new `@life/ui` chart wrappers —
tokens, radius, axis, target-line semantics, and accessibility owned there, spec-first per
Contract 1 Rule 3 — so one styling change moves every app. The app keeps data, filter,
bucketing, and the scroll window. Week = 7 daily bars, month = 30 daily bars, year = 12
monthly bars; today's bar stays a plain `width:%` div. Stats is reached by a shape-only
icon in the pomodoro top-right nav, order **stats → feedback → settings**.

## Out of scope
Streaks, gamification, notifications, editing or deleting past sessions, and timer
mechanics changes.

## Confirmation
Confirmed: yes — the user answered "yes" to the final restate, 2026-10-28, after refining
the goal-snapshot semantics, the 375 px target, the nav order, and upgrading the chart
decision to `@life/ui` wrappers.
