# Intent: pomodoro-flow

Rework of the shipped `/pomodoro` timer (branch `pi/wf/pomodoro-app`) after the owner
tested it and reported the flow is wrong. Supersedes `docs/intent/pomodoro-app.md`
where the two disagree.

## Restate

- **Outcome:** `/pomodoro` stops at every phase boundary instead of silently
  auto-advancing. When a phase ends the countdown holds, the card announces the next
  phase in words, a short beep sounds, the tab title flashes, and one primary button
  starts the next phase. The card shows the phase name, the digits, and four session
  pills — centred — and no "Session N of 4" text. Durations move to `/pomodoro/settings`.
  The page gets the same toolbar as every other app: feedback + settings icons. A reload
  mid-phase resumes the remaining time instead of restarting the phase.
- **User:** repo owner, on phone and desktop, daily focus timer.
- **Why now:** the shipped build is not usable: a phase boundary is invisible (label
  flips, next countdown already running), there is no alert, a backgrounded tab drifts
  ~4× slow, and a reload throws away progress.
- **Success:** a 25-minute focus ends in a visible boundary card with the next phase
  named, a beep, a flashing tab title, and `Start break` focused; nothing counts until
  that button is pressed; reload mid-phase resumes the remaining time; the page carries
  the same feedback + settings toolbar as `/todos`; `/pomodoro/settings` holds the three
  durations plus the theme toggle.
- **Constraint:** `AGENTS.md` Contract 1 — every visual from `@life/ui` primitives and
  tokens. One new prop (`Stack align`) goes upstream spec-first, in the same change; no
  new primitive, no new dependency (the beep is a WebAudio oscillator, not an asset), one
  client island per page. The toolbar reuses `FeedbackNavItem` and `IconLink` +
  `settingsHref`, so `FEEDBACK_APPS` gains `'pomodoro'`; `feedback.app` is plain text, so
  no DB migration. Frozen e2e surfaces outside pomodoro are untouched; the pomodoro spec
  may change because `Pause`/`Reset`/`Session N of 4` on the timer page cease to exist.
- **Out of scope:** pause and reset controls, skipping a break, browser `Notification`
  permission, tree/forest visuals, a nav entry pointing at `/pomodoro`, editing durations
  while a phase runs.

## Session pills

Four pills, `active` = focus session completed this cycle; a long break fills all four
and the next focus resets them. The row is visual only, so it carries
`aria-label="Session N of 4"` for screen readers.

## Confirmation

Confirmed: yes — the owner answered "yes, ok" to the refinements above (durations on a
settings page, `Pause`/`Reset`/`Session N of 4` removed from the timer page, session
pills carrying an `aria-label`), 2026-10-20.
