Produced by planning-and-task-breakdown; source spec: docs/specs/SPEC-pomodoro.md

# Implementation Plan: pomodoro — `/pomodoro` focus timer

## Overview

Mount a single `/pomodoro` page served by `apps/app` and composed from a new
framework-agnostic workspace `@life/pomodoro`: three configurable durations (focus /
short / long, 25 / 5 / 15 by default), the fixed cycle focus → short → focus → short →
focus → short → focus → long → session 1, a large countdown, a "Session N of 4"
indicator, and start / pause / reset. Durations persist as three numeric preference
cookies through `@life/app-kit` (extended upstream, one numeric variant); the mode
(phase + session N) persists in `localStorage` and the countdown restarts at the
restored phase's full duration on reload. Every visual element maps an existing
`@life/ui` primitive; the one gap (a large digit scale) lands upstream as a size
variant on `StatusText`, never as an app-side workaround. No backend, so Contract 2 has
no surface.

## Architecture Decisions

- **Pure machine, thin React.** `apps/pomodoro/src/timer.ts` holds phases, cycle
  transitions, clamping, and the localStorage codec as pure functions with zero React
  or `next/*` imports. Proven by the unit phase-table test; the hook only owns the
  interval and the storage read/write (spec §6 unit-vs-e2e split).
- **Numeric prefs upstream, not per app.** `readPrefNumber(name, fallback)` /
  `setPrefNumber(name, value)` extend `@life/app-kit` beside the boolean pair, sharing
  `prefCookieName` and the same cookie attributes. The boolean `'on'`/`'off'` encoding
  cannot carry numbers and forking cookie helpers per app is forbidden (spec §4).
- **Three cookie keys, one owner.** `pref_pomodoro_focus`, `pref_pomodoro_short`,
  `pref_pomodoro_long`, each an integer minute; absent or malformed falls back to the
  module default. Server-read in the mount route, written by one app-local server
  action.
- **Mode in `localStorage`, client-only.** Phase + session N follow the `ThemeToggle`
  pattern: read inside an effect after mount, so first paint matches the server render
  and no hydration mismatch appears (spec §4).
- **Digits ride a `StatusText` size variant.** `StatusText` (the existing text
  primitive, `span role="status" aria-live="polite"`) gains `size?: 'default' |
  'display'`; `display` sets `font-size: var(--space-3)` — an existing spacing token
  already used as a font-size elsewhere, so the frozen token inventory in
  `packages/ui/test/tokens.test.ts` stays untouched. The countdown passes
  `aria-live="off"` (props spread after the defaults) so a per-second tick does not
  narrate. Spec-first: `docs/specs/SPEC-ui-atoms.md` updates in the same task; zero new
  atoms or blocks.
- **One page, one server route.** `apps/app/app/pomodoro/page.tsx` reads the three prefs
  server-side and renders `PomodoroPage` with the durations plus the `setPomodoroDurations`
  server action; `@life/pomodoro` stays framework-agnostic (no `next/headers`).
- **Durations seed, local state owns the field.** Fields seed from the server prop and
  update local state immediately (the `MatrixSwitch` pattern); the settled value
  persists through the action. No debounce helper is duplicated into the new workspace.
- **Cycle advance truncates the overshoot.** When a phase reaches zero the next phase
  starts at its full duration and runs immediately (Assumption 5). No remainder
  carry-over, no wall-clock drift compensation (Assumption 6, intent's out of scope).

## Task List

1. Task 1: numeric preference helpers in `@life/app-kit`
2. Task 2: `@life/pomodoro` workspace scaffold wired into the monorepo
3. Task 3: pure timer state machine, duration clamping, mode codec + unit tests
4. Task 4: upstream `StatusText` display-size variant (spec + CSS + component + test)
5. Task 5: `/pomodoro` page composition in `apps/pomodoro` (primitives only)
6. Task 6: mount route in `apps/app` wiring prefs, server action, workspace dep
7. Task 7: e2e — one full cycle plus reload persistence

## Task 1: numeric preference helpers in `@life/app-kit`

**Description:** Extend `packages/app-kit` with the numeric preference variant the
spec requires: `readPrefNumber(name, fallback)` parses an integer from the
`pref_<name>` cookie and returns the fallback for absent, non-numeric, or non-integer
values, never throwing (same fail-safe shape as `readPref`); `setPrefNumber(name, value)`
writes the decimal string with the identical cookie attributes `setPref` uses
(`path: '/'`, `sameSite: 'lax'`, `httpOnly`, `secure` in production, one-year `maxAge`).
Both are exported from the barrel (`readPrefNumber`) and the client-safe
`@life/app-kit/preference-action` subpath (`setPrefNumber`). `prefCookieName` is reused,
not re-derived, so both variants share one key shape.

**Acceptance criteria:**

- [ ] `readPrefNumber('pomodoro_focus', 25)` resolves `25` when `pref_pomodoro_focus` is `'25'`.
- [ ] Absent cookie, `'abc'`, `'2.5'`, `''`, `'-3'` all resolve to the supplied fallback.
- [ ] `readPrefNumber` never throws when the cookie store errors (returns the fallback).
- [ ] `setPrefNumber('pomodoro_focus', 25)` calls the cookie store once with `'25'` and the exact `setPref` attribute object.
- [ ] `setPrefNumber` is exported from `@life/app-kit/preference-action` and `readPrefNumber` from the `@life/app-kit` barrel; the boolean `readPref`/`setPref` behavior is unchanged.
- [ ] One unit test file covers both helpers (absent / malformed / error / write / revalidate).

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: npm run test:unit -- test/pref-number.test.ts from the owning workspace (jest) (at most 2 run(s) task)
- [ ] E2E passes where task needs end-to-end check: not applicable — app-kit unit surface only.
- [ ] Manual check: `git diff packages/app-kit` shows `setPref`'s attribute object untouched and reused by `setPrefNumber`.

**Dependencies:** None

**Files likely touched:**

- `packages/app-kit/src/preferences.ts`
- `packages/app-kit/src/preference-action.ts`
- `packages/app-kit/src/index.ts`
- `packages/app-kit/test/pref-number.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 2: `@life/pomodoro` workspace scaffold wired into the monorepo

**Description:** Create the new workspace so TypeScript and jest resolve it before any
product code exists: `apps/pomodoro/package.json` (name `@life/pomodoro`, `main`/`types`
pointing at `src/index.ts`, scripts `typecheck` and `test:unit`, dependencies on
`@life/ui` with `react`/`react-dom` as peers, jest config mirroring `packages/ui`'s
ts-jest + jsdom setup), `tsconfig.json` and `tsconfig.test.json` extending
`../../tsconfig.base.json`, and an `apps/pomodoro/src/index.ts` barrel re-exporting
nothing yet. Root `package.json` workspaces gains `apps/pomodoro`; `npm install` updates
the lockfile. No app code, no visuals.

**Acceptance criteria:**

- [ ] Root `package.json` workspaces lists `apps/pomodoro` and `package-lock.json` records it.
- [ ] `apps/pomodoro/package.json` declares `typecheck` and `test:unit` scripts (repo profile rule for every workspace).
- [ ] `npm run typecheck -w @life/pomodoro` exits 0 on the empty workspace.
- [ ] `npm run test:unit -w @life/pomodoro -- --passWithNoTests` exits 0.
- [ ] No file under `apps/pomodoro` imports `next/*`.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: not applicable — no test file exists yet; the workspace's jest binary is proven with `--passWithNoTests`.
- [ ] E2E passes where task needs end-to-end check: not applicable — scaffold only, nothing renders.
- [ ] Manual check: `npx jest --listTests -w @life/pomodoro` runs from the workspace root without resolving errors.

**Dependencies:** None

**Files likely touched:**

- `package.json`
- `package-lock.json`
- `apps/pomodoro/package.json`
- `apps/pomodoro/tsconfig.json`
- `apps/pomodoro/tsconfig.test.json`
- `apps/pomodoro/src/index.ts`

**Estimated scope:** Large: 5+ files

## Task 3: pure timer state machine, duration clamping, mode codec + unit tests

**Description:** Implement `apps/pomodoro/src/timer.ts` as the whole behavior surface,
framework-free: `Phase = 'focus' | 'short' | 'long'`, `Durations` in integer minutes,
`SESSIONS_PER_CYCLE = 4`, default durations 25 / 5 / 15, `initialState(durations)` at
session 1 / focus / full focus duration / paused, `start`, `pause`, `reset` (session 1,
focus, full chosen focus duration), `tick(state, elapsedMs)` that decrements and on zero
advances immediately (`focus` session < 4 → short; `focus` session 4 → long; `short` →
focus session + 1; `long` → focus session 1) with the next phase at its full duration and
still running, `applyDurations` (a duration edit while paused restarts the current phase
at its new length), integer-minute clamping with fallback on out-of-range input, and the
mode codec `serializeMode` / `parseMode` (phase + session + running-independent shape;
corrupt or stale JSON → initial state). `apps/pomodoro/src/index.ts` exports it.
`apps/pomodoro/test/timer.test.ts` enumerates the full cycle table and the state
semantics.

**Acceptance criteria:**

- [ ] The phase table is asserted step by step: focus 1 → short → focus 2 → short → focus 3 → short → focus 4 → long → focus 1.
- [ ] `reset` returns session 1 / focus / the full chosen focus duration, regardless of prior phase or remaining time.
- [ ] Pause freezes the remaining time and start resumes from it (no jump, no restart) — asserted on the same state object sequence.
- [ ] `tick` with an elapsed larger than the remaining time advances exactly one phase and leaves that phase at its full duration, running.
- [ ] `clampMinutes` accepts integers 1–180 and falls back to the module default for `0`, negatives, `2.5`, `NaN`, and non-numeric strings.
- [ ] `parseMode(serializeMode(state))` round-trips phase + session; `parseMode` of `undefined`, `'not json'`, and `{"phase":"nope"}` yields the initial state.
- [ ] `timer.ts` contains no `react`, `next/`, or `localStorage` reference (purity assertion in the test file reads the source).

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: npm run test:unit -- test/timer.test.ts from the owning workspace (jest) (at most 2 run(s) task)
- [ ] E2E passes where task needs end-to-end check: not applicable — pure module, no page mounted yet.
- [ ] Manual check: the phase table in the test reads as the spec's cycle sentence, one transition per assertion.

**Dependencies:** Task 2

**Files likely touched:**

- `apps/pomodoro/src/timer.ts`
- `apps/pomodoro/src/index.ts`
- `apps/pomodoro/test/timer.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-3

- [ ] `npm run typecheck` passes in `packages/app-kit` and `apps/pomodoro`.
- [ ] The numeric pref test and the timer phase-table test both pass.
- [ ] Cycle order and the three default durations are settled; no page code exists yet.

## Task 4: upstream `StatusText` display-size variant

**Description:** Close the large-digit gap upstream per Contract 1 Rule 3: add
`size?: 'default' | 'display'` to `packages/ui/src/components/status-text.tsx`, emitting
`ui-status-text--display` through `cx` next to the existing class, and add that class to
`packages/ui/src/styles/atoms.css` under the existing `StatusText` section with
`font-size: var(--space-3)` — an existing token, so `tokens.css` and the frozen-value
test are untouched. Record the variant in `docs/specs/SPEC-ui-atoms.md` (its primitive
table) in the same change. `packages/ui/test/status-text.test.tsx` gains the variant
cases. No new atom, no new block, no new token.

**Acceptance criteria:**

- [ ] `<StatusText size="display">25:00</StatusText>` renders `ui-status-text ui-status-text--display` and keeps `span`, `role="status"`, `aria-live="polite"`.
- [ ] Omitting `size` renders exactly today's class list (no `--display` class).
- [ ] `.ui-status-text--display` declares `font-size: var(--space-3)` and no literal length.
- [ ] `docs/specs/SPEC-ui-atoms.md` documents the `size` prop values in the primitive table.
- [ ] `packages/ui/test/tokens.test.ts` passes unmodified (`tokens.css` unchanged).
- [ ] An `aria-live` override passed by a caller still wins (props spread after the defaults).

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: npm run test:unit -- test/status-text.test.ts from the owning workspace (jest) (at most 2 run(s) task)
- [ ] E2E passes where task needs end-to-end check: not applicable — primitive covered by unit tests; the page e2e lands in Task 7.
- [ ] Manual check: `git diff packages/ui/src/styles/tokens.css` is empty.

**Dependencies:** None

**Files likely touched:**

- `packages/ui/src/components/status-text.tsx`
- `packages/ui/src/styles/atoms.css`
- `packages/ui/test/status-text.test.tsx`
- `docs/specs/SPEC-ui-atoms.md`

**Estimated scope:** Medium: 3-5 files

## Task 5: `/pomodoro` page composition in `apps/pomodoro`

**Description:** Compose the page from existing primitives, nothing else:
`src/pomodoro-page.tsx` (`'use client'`) renders `PageShell` → `Section label="Timer"` →
`Card` holding the countdown, the phase label and `Session N of 4` as `StatusText`, and
the controls as `Button` (Start / Pause / Reset, rendered by state), then
`Section label="Durations"` holding three `SettingsRow`s whose controls are
`Input type="number"` (focus / short / long). Supporting modules:
`src/use-timer.ts` (`'use client'` hook: `useState` seeded from `initialState`, a
250 ms interval while running calling `tick`, `localStorage` mode read inside an effect
and write on change via the Task 3 codec, `applyDurations` on prop change);
`src/countdown.tsx` (`StatusText size="display" aria-live="off"` formatting `mm:ss`
from `remainingMs`); `src/duration-fields.tsx` (local state seeded from the prop,
valid-integer change → local state + `onChange`; invalid input re-renders the last valid
value). Duration props flow in from the mount route; the component itself never touches
cookies or `next/*`.

**Acceptance criteria:**

- [ ] The page renders `PageShell`, a `Section` labelled `Timer` with a `Card`, and a `Section` labelled `Durations` with three `SettingsRow`s.
- [ ] Countdown shows `25:00` on first render for defaults and updates once per tick while running; format is zero-padded `mm:ss`.
- [ ] The indicator reads `Session 1 of 4` initially and `Session N of 4` for the focus session in progress; the long break reads `Session 4 of 4`.
- [ ] Controls are `Button` instances: Start disabled while running, Pause disabled while paused, Reset always enabled; Reset returns `Session 1 of 4` and `25:00`.
- [ ] All three duration fields accept integer minutes 1–180 and report through `onDurationsChange`; an empty or invalid field keeps the last valid value.
- [ ] No raw `<button>`, `<input>`, `<label>`, `<a>`, `<img>`, `<progress>` and no `className`/`style` on a `div`/`span` in `apps/pomodoro/src` (mechanical grep in the task's manual check).
- [ ] No module under `apps/pomodoro/src` imports `next/*` or reads `document.cookie`.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: not applicable — this task adds composition only; behavior is owned by `test/timer.test.ts` (Task 3) and the e2e (Task 7).
- [ ] E2E passes where task needs end-to-end check: not applicable — the page is not mounted on a route until Task 6.
- [ ] Manual check: `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps/pomodoro/src --include='*.tsx'` returns zero hits.

**Dependencies:** Task 3, Task 4

**Files likely touched:**

- `apps/pomodoro/src/pomodoro-page.tsx`
- `apps/pomodoro/src/use-timer.ts`
- `apps/pomodoro/src/countdown.tsx`
- `apps/pomodoro/src/duration-fields.tsx`
- `apps/pomodoro/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Task 6: mount route in `apps/app` wiring prefs, server action, workspace dep

**Description:** Make `/pomodoro` reachable and persistent. `apps/app/app/pomodoro/actions.ts`
declares `'use server'` and `setPomodoroDurations(durations)` writing the three keys
through `setPrefNumber` (`pomodoro_focus`, `pomodoro_short`, `pomodoro_long`).
`apps/app/app/pomodoro/page.tsx` is a `force-dynamic` server component: reads the three
prefs with `readPrefNumber` (defaults 25 / 5 / 15), renders `PageTitle` "Pomodoro" plus
`PomodoroPage` with `durations` and the action, sets page metadata, and adds no visuals
of its own. `apps/app/package.json` gains the `@life/pomodoro` dependency and
`next.config.mjs` adds it to `transpilePackages`.

**Acceptance criteria:**

- [ ] `GET /pomodoro` (behind the existing access/identity gate) renders the page with 25 / 5 / 15 and `Session 1 of 4`.
- [ ] Editing a duration and reloading shows the edited value (cookie persisted through the server action).
- [ ] Starting, pausing, resetting, and advancing a phase survives a reload as the restored mode with the restored phase's full duration.
- [ ] `apps/app/app/pomodoro/page.tsx` renders only `@life/ui` primitives plus `PomodoroPage` (no raw HTML visual elements).
- [ ] `next.config.mjs` `transpilePackages` includes `@life/pomodoro`; `npm install` records the workspace dependency.
- [ ] The route file imports no cookie helpers of its own — all persistence goes through `@life/app-kit`.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: not applicable — the route is a thin server mount; persistence and cycle behavior are covered by Tasks 1, 3 and the Task 7 e2e.
- [ ] E2E passes where task needs end-to-end check: not applicable — the automated cycle spec is Task 7 (this task's manual check proves the wiring in the browser).
- [ ] Manual check: `npm run dev`, open `/pomodoro`, set focus to 1 minute, reload, start, watch the phase advance to the short break, reload and confirm the restored phase.

**Dependencies:** Task 1, Task 5

**Files likely touched:**

- `apps/app/app/pomodoro/page.tsx`
- `apps/app/app/pomodoro/actions.ts`
- `apps/app/package.json`
- `apps/app/next.config.mjs`

**Estimated scope:** Medium: 3-5 files

## Task 7: e2e — one full cycle plus reload persistence

**Description:** Add `apps/app/test/e2e/pomodoro.spec.ts` against the production harness:
log in with the existing `logIn` helper, install Playwright's clock, set all three
durations to 1 minute through the real fields, then `runFor` each phase in turn and
assert the focus → short → focus → short → focus → short → focus → long progression with
`Session N of 4` at each focus session (long break reads `Session 4 of 4`), then assert
pause freezes the countdown and reset returns to `Session 1 of 4` at the full focus
duration. A second step reloads and asserts the three chosen durations and the restored
mode. Only pomodoro-owned selectors (roles, labels and visible copy created by this
module); the frozen suite surface is untouched.

**Acceptance criteria:**

- [ ] The spec drives one full cycle through the UI and asserts every phase transition in order, ending back at `Session 1 of 4` after the long break.
- [ ] The `Session N of 4` indicator is asserted at focus 1, 2, 3, 4 and during the long break.
- [ ] After editing all three durations, a reload shows the three chosen values and the restored phase + session.
- [ ] Pause freezes the displayed countdown for a `runFor` interval and start resumes from the frozen time; reset returns to `Session 1 of 4` and the full focus duration.
- [ ] `page.clock.install()` is used so the wall time of the run stays seconds, not minutes.
- [ ] No selector owned by another suite is modified; only pomodoro-owned names are used.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace)
- [ ] Focused unit tests pass: not applicable — e2e-only task; behavior units are Tasks 1 and 3.
- [ ] E2E passes where task needs end-to-end check: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "full cycle" (dev mode: apps/app/playwright.dev.config.ts)
- [ ] Manual check: run the same command a second time on a warm database; the run is green without any manual cleanup (no shared state besides the owner's cookies).

**Dependencies:** Task 6

**Files likely touched:**

- `apps/app/test/e2e/pomodoro.spec.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 4-7

- [ ] `npm run typecheck` passes in `apps/pomodoro`, `apps/app`, `packages/app-kit`, `packages/ui`.
- [ ] The timer phase-table test and the numeric pref test pass.
- [ ] `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "full cycle"` passes.
- [ ] Contract 1 mechanical greps are clean for `apps/pomodoro`; `tokens.css` unmodified; zero new primitives in `packages/ui`.
- [ ] Review with the human before any merge.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Numeric pref writes on every keystroke re-render the route (`revalidatePath('/','layout')`) | Med | Fields keep local state as the source of truth and only valid integers reach the action; the manual check in Task 6 exercises a fast edit sequence. |
| `localStorage` mode read before mount causes a hydration mismatch | High | Read inside `useEffect` (the `ThemeToggle` pattern), initial render always the server-derived default. |
| Playwright clock and the interval drift out of sync, making the cycle test flaky | High | Install the clock before navigation and advance in explicit `runFor` steps per phase; the spec asserts text, not exact remaining seconds. |
| A per-second `aria-live="polite"` countdown floods screen readers | Med | The digits pass `aria-live="off"`; only the phase/session status line stays live. |
| Duration edits mid-phase leave the countdown longer than the new duration | Low | `applyDurations` restarts the current phase at its new length while paused (asserted in Task 3). |
| The `display` digit size (3rem) is smaller than the "large digit" expectation | Low | Uses an existing token, so no token change; raise it only with the user if the open question is settled, and then via the variant, never app CSS. |
| `npm install` after adding the workspace is skipped, so the e2e build cannot resolve `@life/pomodoro` | Med | Task 2 and Task 6 acceptance both require the lockfile update; the Task 7 harness only builds `apps/app`, which fails loudly if the dep is missing. |

## Open Questions

Spec §10 carries four, all answered here by the plan's assumptions; none blocks a task.

- Standalone app (own port/origin/login) or the mounted-workspace shape? Plan assumes
  mounted (`apps/pomodoro` mounted at `apps/app` `/pomodoro`), per repo port hard line.
- Restore exact remaining seconds on reload or restart the phase? Plan restarts the
  restored phase at its full duration (intent excludes closed-tab accuracy).
- Integer minutes only or sub-minute values? Plan clamps to integers 1–180.
- Auto-start the next cycle after the long break, or wait for Start? Plan runs it
  immediately (Assumption 5).
