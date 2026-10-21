# Intent: pomodoro-app

## Restate (confirmed 2026-10-18)

- **Outcome:** A `/pomodoro` page in a new `apps/pomodoro` app — configurable focus /
  short break / long break durations, the standard cycle (4 focus sessions, then a long
  break), a large digit countdown, and a "session N of 4" indicator, with start / pause /
  reset.
- **User:** The repo owner, on phone and desktop, as a daily focus timer.
- **Why now:** Stop re-fighting a timer elsewhere before starting the larger shadcn/Radix
  UI migration.
- **Success:** Reload keeps the chosen durations and mode; the cycle advances focus → short
  → short → short → long correctly; an e2e covers one full cycle; no new primitives
  invented for it.
- **Constraint:** `AGENTS.md` Contract 1 — `apps/pomodoro` composes existing `@life/ui`
  primitives (`Button`, `Input`, `Select`, `Card`, `Stack`, `Section`, `PageShell`,
  `Switch`), tokens only, zero raw HTML elements, no shadcn yet. No backend: durations ride
  the existing preference cookie, cycle position is client state, so Contract 2 has no
  surface here.
- **Out of scope:** shadcn/Radix migration; browser notifications; sound; task list; stats
  or history; PWA manifest changes; a backend service; countdown accuracy while the tab is
  closed.

Assumed defaults unless corrected: 25 / 5 / 15 minutes, 4 sessions per cycle, all three
durations editable on the page.

## Scope additions (owner-approved after confirmation)

- **2026-10-21 — per-route PWA identity for `/pomodoro`.** The owner asked for a
  `manifest-pomodoro.json` + `icon-pomodoro.png`, reversing the "PWA manifest changes"
  out-of-scope line above. Both frozen-surface rules still apply everywhere else: no
  other route's manifest, and no `viewport.themeColor`.

## Confirmation

Confirmed: yes — the user explicitly answered "yes" to the six-line restate above
(2026-10-18), and additionally chose to leave the unrelated `ops-agent-contract` workflow
running overnight.
