Produced by planning-and-task-breakdown; source spec: /home/night/WebstormProjects/personal-life/.pi/worktrees/pomodoro-app/docs/specs/SPEC-pomodoro-flow.md

# Implementation Plan: pomodoro-flow — `/pomodoro` phase-boundary flow

Rework the shipped `/pomodoro` timer into a deliberate phase boundary: the machine
gets a `boundary` status (held at `00:00`, advanced only by an explicit start),
remaining time is derived from a wall-clock deadline (`endsAt - now`) instead of
accumulated ticks, and the card becomes phase name + digits + four session pills +
one boundary button, centred. Durations move to a new `/pomodoro/settings` page; the
timer page gains the `TodosNav`-shaped toolbar (`FeedbackNavItem` + `IconLink` to
settings). No backend, no DB, no cache: durations stay on the existing
`pref_pomodoro_*` cookies, timer state stays in `localStorage`.

Ordering follows the spec's dependency graph bottom-up: the one upstream `@life/ui`
gap first (the card needs it), then the pure machine (everything renders from it),
then the hook's deadline/effects layer, then the card, then settings, then toolbar,
then the e2e proof. Tasks 2 and 3 are the risky ones and land first.

No `tasks/todo-pomodoro-flow.md` is written: the plan gate consumes this file, and
`tasks/todo-pomodoro.md` still holds the previous plan's unchecked items, so this is
a new file for different work rather than an overwrite.

## Task 1: `Stack align` prop upstream (`@life/ui`, spec-first)

**Description:** Add the single upstream gap the spec allows: `Stack` gains
`align?: 'start' | 'center' | 'end'`, default `'start'`, rendering
`ui-stack--<align>` alongside the existing gap class. `blocks.css` gains the three
modifier rules — `justify-items` only, so no raw length or colour is introduced —
with the default `'start'` adding no class at all, keeping every existing caller's
markup byte-identical. `docs/specs/SPEC-ui-blocks.md` is updated in the same change
(the block's contract line and a one-line note on what centring means for a grid
stack), and `packages/ui/test/stack.test.tsx` gains the mapping assertions.

**Acceptance criteria:**

- [ ] `Stack` accepts `align?: 'start' | 'center' | 'end'`; omitted or `'start'` renders exactly the classes it renders today (`ui-stack`, `ui-stack--<gap>`, caller `className`).
- [ ] `align="center"` adds `ui-stack--center` and `.ui-stack--center` declares `justify-items: center` with no raw `px`/`rem`/hex value.
- [ ] `align="end"` adds `ui-stack--end` with `justify-items: end`; no other prop, primitive, or token changes.
- [ ] `docs/specs/SPEC-ui-blocks.md`'s `Stack` line names the new prop; `packages/ui/test/stack.test.tsx` asserts the default and both non-default mappings.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `packages/ui`
- [ ] Focused unit tests pass: npm run test:unit -- test/stack.test.tsx from owning workspace (jest) (at most 2 run(s) task)
- [ ] Manual check: render the pomodoro card in a browser once Task 4 lands and confirm the children are horizontally centred with no `.ui-stack` caller regressions elsewhere

**Dependencies:** None

**Files likely touched:**
- `packages/ui/src/components/stack.tsx`
- `packages/ui/src/styles/blocks.css`
- `packages/ui/test/stack.test.tsx`
- `docs/specs/SPEC-ui-blocks.md`

**Estimated scope:** Medium: 3-5 files

## Task 2: Pure boundary machine with deadline-anchored remaining time

**Description:** Replace `apps/pomodoro/src/timer.ts`'s mutable `remainingMs`/`running`
state with the spec's machine: `status: 'idle' | 'running' | 'boundary'`, a phase's
`endsAt` timestamp as the only source of remaining time, and no auto-advance path at
all. `start(state, now)` records `endsAt = now + phaseDurationMs` and reports
`running`; `remainingMs(state, now)` returns `max(0, endsAt - now)`; a tick past the
deadline moves to `boundary` holding `00:00` with phase/session unchanged, and only
`startNext` (or `start` from `boundary`) advances the cycle to the next phase at its
full duration. `serializeMode`/`parseMode` carry `{ phase, session, status,
remainingMs, endsAt }` and restore per spec §4: `running` with positive remaining
resumes `running`, zero/negative lands on `boundary`, `boundary` stays, `idle` is the
phase's full duration. The file stays pure (no React, no `next/*`, `now` passed in).
`apps/pomodoro/test/timer.test.ts` is rewritten around this table.

**Acceptance criteria:**

- [ ] A phase reaching zero yields `status: 'boundary'` with `remainingMs(state, now) === 0`, the same `phase`/`session`, and no transition exists from `boundary` back to `running` other than an explicit `start`/`startNext` call.
- [ ] `startNext` from a focus boundary enters the next phase at its full cookie duration; the cycle is focus → short ×3 interleaved, focus 4 → long, long → focus session 1 (pills reset), each transition requiring its own start.
- [ ] A tick arriving 10× late still reads `endsAt - now`: the machine loses no extra time, and a tick past the deadline lands on `boundary` rather than skipping a phase.
- [ ] `parseMode` round-trips all three statuses, including a `running` mode whose `endsAt` already passed (restores to `boundary`) and a malformed/absent blob (restores `idle`).
- [ ] The unit file enumerates the boundary table above; `timer.ts` imports nothing from `react` or `next`.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/pomodoro`
- [ ] Focused unit tests pass: npm run test:unit -- test/timer.test.ts from owning workspace (jest) (at most 2 run(s) task)
- [ ] Manual check: the test output lists every boundary-table row (zero → boundary, no auto-advance, explicit start at full duration, late tick, restore cases)

**Dependencies:** None

**Files likely touched:**
- `apps/pomodoro/src/timer.ts`
- `apps/pomodoro/test/timer.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Deadline ticking, persistence, and boundary effects in the hook

**Description:** Rebuild `apps/pomodoro/src/use-timer.ts` on the Task 2 machine and add
`apps/pomodoro/src/beep.ts`. The interval only triggers re-renders — each render asks
the machine for `remainingMs(state, Date.now())`, so a throttled background tab counts
at wall-clock speed. Restore runs in a mount effect (the `ThemeToggle` pattern, no
hydration mismatch) and every state change writes `pomodoro-mode` to `localStorage`.
On entering `boundary` the hook fires the boundary effects exactly once: the WebAudio
beep, the 1 s `document.title` alternation between `Pomodoro` and the pinned `Next: …`
line, and a focus on the start button; starting the next phase stops the flash and
restores `Pomodoro`. `beep.ts` is one ~180 ms 880 Hz sine `OscillatorNode` from an
`AudioContext` created on the start gesture, silent no-op where WebAudio is missing.

**Acceptance criteria:**

- [ ] `useTimer` exposes `{ status, phase, session, nextPhase, remainingMs, titles, startNext, startRef }` and derives `remainingMs` from `endsAt - Date.now()` on every render; the interval never subtracts elapsed time.
- [ ] Crossing the deadline (including on a tick that fires long after `endsAt`, and on mount after a reload) enters `boundary` and runs the beep, the title flash, and the button focus once each — not again on subsequent ticks.
- [ ] The flash alternates `document.title` between `Pomodoro` and the pinned next-phase line once per second at `boundary`, and the title is `Pomodoro` while `running`/`idle`.
- [ ] Mounting restores the stored mode: `running` with positive remaining keeps counting down, an expired deadline lands on `boundary`, `boundary` restores as left, `idle` restores the phase's full duration.
- [ ] `beep()` starts one oscillator, stops it after ~180 ms, closes the context, and returns silently when `AudioContext` is unavailable.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/pomodoro`
- [ ] Focused unit tests pass: npm run test:unit -- test/timer.test.ts from owning workspace (jest) (at most 2 run(s) task) — re-run as the regression check for the machine the hook consumes
- [ ] Manual check: in `npm run dev`, start focus, background the tab until the phase ends, and confirm the digits reach `00:00`, a beep plays, the title flashes, the start button is focused, and reloading mid-phase shows the reduced remaining time still counting

**Dependencies:** Task 2

**Files likely touched:**
- `apps/pomodoro/src/use-timer.ts`
- `apps/pomodoro/src/beep.ts`

**Estimated scope:** Small: 1-2 files

## Task 4: Centred boundary card with session pills

**Description:** Recompose `apps/pomodoro/src/pomodoro-page.tsx` around the Task 3
hook: a single `Card` holding a `Stack align="center"` with the phase name
(`StatusText`), the untouched `Countdown` digits, a new
`apps/pomodoro/src/session-pills.tsx` row of four `Pill`s, and — only while
`status !== 'running'` — one primary `Button` carrying `startRef`. At a boundary the
card additionally reads the pinned `Next: …` line, and the button label is
`Start focus` or `Start break`. The "Session N of 4" visible text and the
start/pause/reset row are deleted; the pill row carries
`aria-label="Session N of 4"` for screen readers. The page drops its own `PageShell`
and the durations `Section` (settings owns durations now); everything is `@life/ui`
primitives, no raw elements, no classes recreating primitive visuals.

**Acceptance criteria:**

- [ ] The card renders, centred, the phase name, the `mm:ss` digits, and four session pills; no `Session N of 4` text is visible anywhere, and the pill row exposes `aria-label="Session N of 4"`.
- [ ] Pills follow spec §4: during focus N, N−1 are active; during a break, N; the long break fills four; the next focus resets them.
- [ ] At `boundary` the card reads the pinned `Next: Focus|Short break|Long break` line and exactly one primary button (`Start focus` / `Start break`) that is the focused element; while `running` no start button renders; `idle` shows the full duration and a focused `Start focus`.
- [ ] No duration fields, no `Pause`/`Reset` controls, and no raw `button`/`input`/`span`-with-styling remain in `apps/pomodoro` UI code; `PomodoroPage` takes `{ durations }` only.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/pomodoro`
- [ ] Focused unit tests pass: npm run test:unit -- test/timer.test.ts from owning workspace (jest) (at most 2 run(s) task) — the pill/session mapping the card renders comes straight from that table
- [ ] Manual check: `/pomodoro` first paint reads `Focus`, `25:00`, four inactive pills, a focused `Start focus`; after a boundary it reads `00:00`, `Next: Short break`, `Start break` focused; Contract 1 greps (`<(button|input|textarea|select|a|img|label|progress)\b`, `next/link`, raw colours) are clean under `apps/pomodoro`

**Dependencies:** Task 1, Task 3

**Files likely touched:**
- `apps/pomodoro/src/pomodoro-page.tsx`
- `apps/pomodoro/src/session-pills.tsx`
- `apps/pomodoro/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Task 5: `/pomodoro/settings` holds the durations, timer page loses them

**Description:** Add `apps/app/app/pomodoro/settings/page.tsx`: a `ManagerBlock`
titled `Settings` backed to `/pomodoro`, an `Appearance` `SettingsBlock` with a
`ThemeToggle` row, and a `Durations` block whose `SettingsRow`s carry the existing
`Input` primitive for focus / short / long plus one `Button` submit. The durations
form is a plain server-action `<form>` (structural exemption) posting to
`setPomodoroDurations`, which is reworked in `apps/app/app/pomodoro/actions.ts` to
read `FormData` and write the same three `pref_pomodoro_*` cookies through
`setPrefNumber`, keeping `clampMinutes`'s rule (non-integer or out-of-range falls
back to the default). The timer route keeps reading the prefs server-side and passing
`durations` to `PomodoroPage`; `apps/pomodoro/src/duration-fields.tsx` is deleted and
its export removed, since the settings page needs no client island.

**Acceptance criteria:**

- [ ] `/pomodoro/settings` composes `ManagerBlock` (title `Settings`, `backHref="/pomodoro"`), a `ThemeToggle` row, and three labelled duration inputs (`Focus`, `Short break`, `Long break`) with one submit `Button`.
- [ ] Submitting writes all three `pref_pomodoro_focus|short|long` cookies; a value that is non-integer or outside 1–180 persists the default, never a throw.
- [ ] `/pomodoro` renders no duration inputs; `duration-fields.tsx` and its barrel export are gone; no new client component is introduced.
- [ ] Edited durations survive a reload of `/pomodoro` (first paint shows the edited full duration) and size the next phase that starts.

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/app` and `apps/pomodoro`
- [ ] Focused unit tests pass: npm run test:unit -- test/routes-manager-blocks.test.tsx from owning workspace (jest) (at most 2 run(s) task) — the `ManagerBlock`/`SettingsBlock` composition this page uses
- [ ] Manual check: edit all three durations on `/pomodoro/settings`, reload `/pomodoro`, and confirm the card's first-paint digits use the edited focus length

**Dependencies:** Task 4

**Files likely touched:**
- `apps/app/app/pomodoro/settings/page.tsx`
- `apps/app/app/pomodoro/actions.ts`
- `apps/pomodoro/src/duration-fields.tsx`
- `apps/pomodoro/src/index.ts`
- `apps/app/app/pomodoro/page.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 6: Timer page carries the standard toolbar

**Description:** Give `/pomodoro` the same toolbar shape `TodosNav`/`MealsNav` use:
a new `apps/app/app/pomodoro/pomodoro-nav.tsx` exporting `PomodoroNav` with
`FeedbackNavItem app="pomodoro" onSubmit={submitFeedbackAction}` followed by
`IconLink href={settingsHref('/pomodoro')} label="Settings"`, rendered into the mount
route's `NavBar` trailing slot above the `PageTitle`. `packages/shared`'s
`FEEDBACK_APPS` gains `'pomodoro'` (plain text `feedback.app`, so no migration), which
narrows `FeedbackApp` for the submit call. A small static-render test pins the two
tabs and their props.

**Acceptance criteria:**

- [ ] `/pomodoro` renders `FeedbackNavItem` with `app="pomodoro"` and an `IconLink` labelled `Settings` whose `href` is `/pomodoro/settings`, matching the `/todos` toolbar order (feedback, then settings).
- [ ] `FEEDBACK_APPS` in `packages/shared/src/index.ts` includes `'pomodoro'`; no other shared vocabulary, service, or migration changes.
- [ ] Only the settings icon on the page links to `/pomodoro/settings`; the feedback item opens the existing feedback form with `app: 'pomodoro'`.
- [ ] No nav entry pointing at `/pomodoro` is added anywhere else (spec out of scope).

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/app` and `packages/shared`
- [ ] Focused unit tests pass: npm run test:unit -- test/pomodoro-nav.test.tsx from owning workspace (jest) (at most 2 run(s) task)
- [ ] Manual check: `/pomodoro` shows two toolbar icons; the gear lands on `/pomodoro/settings` and a submitted feedback entry appears in `/feedback` with `pomodoro` as its app

**Dependencies:** Task 5

**Files likely touched:**
- `apps/app/app/pomodoro/pomodoro-nav.tsx`
- `apps/app/app/pomodoro/page.tsx`
- `packages/shared/src/index.ts`
- `apps/app/test/pomodoro-nav.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 7: Rewrite the pomodoro e2e around the boundary flow

**Description:** Replace `apps/app/test/e2e/pomodoro.spec.ts` with the boundary proof,
keeping the file's fake-clock discipline (`page.clock.install()`, a paused clock after
mount, `runFor` in fake seconds) and its pomodoro-owned selectors only — `Pause`,
`Reset`, and the `Session N of 4` text cease to exist, and no selector outside this
module changes. Two tests: one boundary end to end (focus runs out → `00:00` held,
`Next: Short break` shown, `Start break` focused, clock advances change nothing, press
→ short break starts at its full length) with an `addInitScript` `AudioContext` stub
asserting exactly one oscillator start and title alternation under `page.clock`; and
one reload/resume test (mid-phase reload shows the reduced remaining time and keeps
counting; a deadline that passed while the page was gone lands on the boundary card),
plus `/pomodoro/settings` persisting three durations and the toolbar's settings icon
landing on `/pomodoro/settings`.

**Acceptance criteria:**

- [ ] The boundary test passes: `00:00` held, `Next: Short break`, `Start break` focused, one oscillator started, `page.title()` alternating `Pomodoro` / `Next: Short break`, and no phase change while fake time keeps running at a boundary.
- [ ] The reload test passes: two fake minutes into a 25-minute focus, a reload reads ~`23:00` and continues counting; a reload after the deadline lands on the boundary card with nothing counting.
- [ ] The settings test passes: three durations submitted on `/pomodoro/settings` survive a reload and size `/pomodoro`'s next phase; the gear icon navigates to `/pomodoro/settings`.
- [ ] The spec file imports no CSS/role lookup owned by another suite and asserts no removed control (`Pause`, `Reset`, `Session N of 4`).

**Verification:**

- [ ] Typecheck passes: npm run typecheck (workspace-aware; run in touched workspace) — in `apps/app`
- [ ] E2E passes where task needs end-to-end check: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "phase boundary holds until Start is pressed" (dev mode: playwright.dev.config.ts)
- [ ] E2E passes where task needs end-to-end check: npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "reload resumes the remaining time" (dev mode: playwright.dev.config.ts)
- [ ] Manual check: run the two test names above on the prod harness and confirm the run stays inside fake seconds, with no real-minute waits

**Dependencies:** Task 6

**Files likely touched:**
- `apps/app/test/e2e/pomodoro.spec.ts`

**Estimated scope:** Small: 1-2 files
