# Spec: pomodoro-flow — `/pomodoro` phase-boundary flow

Module id: `pomodoro-flow`. Traces to intent: `docs/intent/pomodoro-flow.md`
(confirmed 2026-10-20, supersedes `docs/intent/pomodoro-app.md` where they disagree).

Scope check: **one capability, one spec, no capability map.** Everything here serves
one behavior cluster on one page pair (`/pomodoro`, `/pomodoro/settings`) with one
consumer (the owner): the phase boundary becomes a visible, deliberate step. The
settings move, the toolbar, the pills, and reload resume are acceptance criteria of
that one flow, not independently shippable capabilities — none has a consumer or data
of its own. This spec supersedes `docs/specs/SPEC-pomodoro.md` where they conflict
(auto-advance, pause/reset, "Session N of 4" text, durations on the timer page,
reload behavior); that spec remains the base contract for the workspace shape, the
preference cookies, and the mount route.

All work follows AGENTS.md Contract 1 (Shared UI Contract): every visual element maps
an existing `@life/ui` primitive; the one gap (`Stack align`) goes upstream
spec-first in the same change. Contract 2 has no surface (no backend; durations ride
the existing preference cookies, timer state is client state).

## 1. Objective

Rework the shipped `/pomodoro` timer so a phase boundary is impossible to miss and a
reload never throws away progress. When a phase ends the countdown holds at `00:00`,
the screen announces the next phase in words, a short beep sounds, the tab title
flashes, and one primary button — focused — starts the next phase. Nothing counts
until that button is pressed. The screen shows the phase name, the digits, and four
session pills — centred in a full-viewport-height page, the way `/todos/matrix`
fills one, with no "Session N of 4" text. Durations move to
`/pomodoro/settings` (with the theme toggle). The page carries the same toolbar as
every other app: feedback + settings icons. A reload mid-phase resumes the remaining
time.

User stories / acceptance criteria:

- As the owner, a 25-minute focus ending is a visible boundary screen: `00:00` held,
  the next phase named ("Next: Short break"), a beep, a flashing tab title, and
  `Start break` focused. No countdown runs until I press it.
- The screen reads the phase name, the digits, and four session pills — centred on
  both axes of a page that fills the viewport, inside the same `--panel` card the
  rest of the page uses, so the timer keeps its surface instead of sitting flat on
  the page background. No "Session N of 4" text; the pill row carries
  `aria-label="Session N of 4"` for screen readers.
- The tab title keeps the countdown from drifting: a backgrounded tab counts down at
  wall-clock speed (~4× drift is gone).
- A reload mid-phase shows the remaining time and keeps counting down; a phase whose
  deadline passed while the page was gone lands on the boundary screen, not in a
  silently running next phase.
- `/pomodoro/settings` holds the three durations (focus / short break / long break)
  plus the theme toggle, and edits survive a reload.
- `/pomodoro` carries the same toolbar as `/todos`: a feedback icon and a settings
  icon linking to `/pomodoro/settings`.

Out of scope (intent, verbatim): pause and reset controls; skipping a break; browser
`Notification` permission; tree/forest visuals; a nav entry pointing at `/pomodoro`;
editing durations while a phase runs (see Assumption 5).

## 2. Tech Stack

- TypeScript ~5.7 (strict, existing repo config shape).
- React 19 (`react` / `react-dom` ^19.0.0).
- Next.js 16 App Router (`next` 16.4.2 pinned in `apps/app/package.json`; peer
  `^16.0.0` in `packages/ui` and `packages/app-kit`) — `apps/app` serves `/pomodoro`
  and `/pomodoro/settings`; `apps/pomodoro` stays framework-agnostic React. No Next
  upgrade is part of this task.
- `@life/ui` (workspace) — all visuals: `ListShell` (with its `fill` full-height
  mode), `Stack`, `Card`, `Button`, `StatusText`, `Pill`, `ManagerBlock`,
  `SettingsBlock`, `SettingsRow`, `ThemeToggle`, `FeedbackNavItem`, `IconLink`,
  `Input`. `Stack` gains one upstream prop (`align`) spec-first in
  `docs/specs/SPEC-ui-blocks.md` (where `Stack` is specified) in the same change;
  the layout revision adds its block-axis twin `vAlign`.
- `@life/app-kit` (workspace) — `readPrefNumber` / `setPrefNumber` (existing),
  `settingsHref`.
- `@life/shared` (workspace) — `FEEDBACK_APPS` gains `'pomodoro'`; `feedback.app` is
  plain text, so no DB migration.
- WebAudio (native `OscillatorNode`) — the beep. No asset, no dependency.
- jest ^29.7 + ts-jest ^29.2 (unit), `@playwright/test` ^1.55 (e2e, `page.clock`).
- No new dependencies. No backend, no DB, no cache (Contract 2 out of scope here).

## 3. Commands

```
Typecheck: npm run typecheck                                             # workspace-aware; run in the touched workspace
Unit:      npm run test:unit -- <file>                                   # from the owning workspace (jest)
E2E:       npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
E2E (dev): npx playwright test --config apps/app/playwright.dev.config.ts <file> -g "<name>"
```

- Max test runs: **2** per the repo profile. Targeted runs only (`<file>` + `-g`).
- The repo profile declares no build command, so none is written here.
- Touched workspaces for typecheck: `apps/pomodoro`, `apps/app`, `packages/ui`,
  `packages/shared`.

## 4. Project Structure

```
apps/pomodoro/src/timer.ts           # pure machine: status idle|running|boundary,
                                     # deadline-anchored remaining, phase advance on
                                     # explicit start only (never auto)
apps/pomodoro/src/use-timer.ts       # hook: ticking derives remaining from the wall
                                     # clock deadline; boundary effects (beep, title
                                     # flash, focus the button); localStorage persist
apps/pomodoro/src/pomodoro-page.tsx  # full-height screen: phase name, digits,
                                     # session pills, boundary button — @life/ui
                                     # only, centred on both axes.
apps/pomodoro/src/session-pills.tsx  # four pills, active = focus sessions completed
apps/pomodoro/src/countdown.tsx      # existing digits, unchanged
apps/pomodoro/src/beep.ts            # WebAudio oscillator tone (no asset)
apps/pomodoro/test/timer.test.ts     # unit: boundary semantics, deadline math
apps/app/app/pomodoro/page.tsx       # mount route + NavBar trailing (PomodoroNav)
apps/app/app/pomodoro/pomodoro-nav.tsx  # FeedbackNavItem + IconLink settingsHref('/pomodoro')
apps/app/app/pomodoro/settings/page.tsx # NEW: ManagerBlock, three durations + ThemeToggle
apps/app/app/pomodoro/actions.ts     # existing setPomodoroDurations server action
packages/shared/src/index.ts         # FEEDBACK_APPS += 'pomodoro'
packages/ui/src/components/stack.tsx # + align?: 'start' | 'center' | 'end' (upstream)
docs/specs/SPEC-ui-blocks.md         # Stack align, spec-first, same change
packages/ui/test/…                   # Stack align unit test
apps/app/test/e2e/pomodoro.spec.ts   # rewritten for the boundary flow (its own
                                     # selectors; Pause/Reset/"Session N of 4" copy
                                     # ceases to exist)
docs/specs/SPEC-pomodoro-flow.md     # this spec
```

State and storage:

- **Timer state** — one client island (`@life/pomodoro`) on the timer page. The
  machine's `status` is `idle` (nothing started yet), `running` (phase counting
  down), or `boundary` (phase ended, held at `00:00`, waiting for the button). A
  phase reaches zero and moves to `boundary`; only the button press advances to the
  next phase's full duration. There is no auto-advance path in the machine.
- **Wall clock, not tick accumulation.** Starting (or resuming) a phase records
  `endsAt = Date.now() + remainingMs`; each tick renders `remainingMs = endsAt - now`.
  The interval only triggers re-renders, so backgrounded-tab interval throttling
  cannot slow the countdown. A tick that fires past the deadline lands on the
  boundary on that tick.
- **Persistence** — localStorage `pomodoro-mode` (existing key) now stores
  `{ phase, session, status, remainingMs, endsAt }` on every change. On restore:
  `running` → `remainingMs = max(0, endsAt - Date.now())`, resuming `running` if
  positive and landing on `boundary` if zero or negative; `boundary` → the boundary
  screen as left; `idle` → idle with the phase's full duration. Durations stay in the
  existing `pref_pomodoro_*` cookies (unchanged from `SPEC-pomodoro`).
- **Session pills** — four pills; `active` = a focus session completed this cycle
  (during focus N, N−1 are active; during a break, N; the long break fills all four;
  the next focus resets them). The row is visual only and carries
  `aria-label="Session N of 4"` — N is the focus session in progress, or the one just
  finished during a break (a break belongs to the session it follows, including its
  end boundary). No visible "Session N of 4" text anywhere.

## 5. Code Style

Primitives composed, never raw elements; `cx()` class merges only; tokens only;
pure logic in `timer.ts` with no React imports. One real snippet in the repo's voice:

```tsx
// apps/pomodoro/src/pomodoro-page.tsx
export function PomodoroPage({ durations }: { durations: Durations }) {
  const timer = useTimer(durations);
  return (
    <Stack vAlign="center">
      <Card>
        <Stack align="center">
          <StatusText>{PHASE_LABELS[timer.phase]}</StatusText>
          <Countdown remainingMs={timer.remainingMs} />
          <SessionPills session={timer.session} />
          {timer.status !== 'running' && (
            <Button ref={startRef} onClick={timer.startNext}>
              {startLabel(timer.nextPhase)}
            </Button>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
```

Conventions: named exports; props typed via exported interfaces; the boundary copy is
pinned strings (`Next: Focus`, `Next: Short break`, `Next: Long break`; button
`Start focus` for a focus next phase, `Start break` for either break) so the e2e
reads the same words the owner sees. The settings page is a server component; its
durations form is a server-action `<form>` (structural exemption) whose visuals are
`Input` + `Button` primitives — no new client island.

## 6. Testing Strategy

- **Unit (jest, `apps/pomodoro/test/`)** — owns the behavior. The machine enumerates:
  zero → `boundary` at `00:00` with the next phase named and `session`/pills
  unchanged; no transition without an explicit start; the start button begins the
  next phase at its full duration (focus → short ×3 interleaved, focus 4 → long,
  long → back to session 1 with pills reset); deadline math — `remainingMs` derives
  from `endsAt - now`, so a tick 10× late lands on the boundary rather than losing
  10× the time; restore cases for all three statuses, including a deadline that
  passed while the page was gone. Run targeted:
  `npm run test:unit -- test/timer.test.ts` from `apps/pomodoro`.
- **Unit (jest, `packages/ui/test/`)** — `Stack align` maps to the class the block
  spec describes; default alignment unchanged.
- **E2E (Playwright, prod harness)** — `apps/app/test/e2e/pomodoro.spec.ts`
  rewritten around the boundary flow, pomodoro-owned selectors only (the frozen e2e
  surface outside pomodoro is read-only; this module's own copy may change because
  `Pause`/`Reset`/`Session N of 4` cease to exist). Cases: one boundary end to end
  through the real UI (held `00:00`, `Next: Short break`, `Start break` focused,
  nothing counts until pressed); the beep (an init script stubs `AudioContext` and
  asserts one oscillator start at the boundary) and the flashing title (`page.title()`
  alternates under `page.clock`); reload mid-phase resumes the remaining time;
  `/pomodoro/settings` persists three durations; the toolbar's settings icon lands on
  `/pomodoro/settings`. Wall time stays seconds via `page.clock.install()` / `runFor`.
- **Contract 1 mechanical checks** run at review: zero raw-HTML-element hits under
  `apps/pomodoro` UI code, zero raw colors/lengths outside
  `packages/ui/src/styles/tokens.css`, `grep -rn "next/link" apps --include='*.tsx'`
  clean.
- Levels: the machine is proven deterministic in unit tests; e2e proves the wiring
  (render, focus management, audio/title side effects, cookies, reload). No coverage
  percentage gate — the boundary table is fully enumerated instead.

## 7. Boundaries

- **Always do:** compose `@life/ui` primitives and tokens only; land `Stack align`
  upstream spec-first (`docs/specs/SPEC-ui-blocks.md` + `packages/ui` test in the
  same change); keep `timer.ts` pure and deadline-anchored; keep pomodoro e2e
  selectors self-owned; run typecheck plus the targeted unit tests before considering
  a task done; keep the mount route and settings page visual-free plumbing.
- **Ask first:** any `@life/ui` change beyond the `Stack align` prop; the
  `FEEDBACK_APPS` / feedback-service vocabulary; any touch to the frozen e2e selector
  surface outside pomodoro; adding any dependency; anything touching data
  directories, secrets, or ports; PWA manifest work; widening or replacing the
  commands in §3.
- **Never do:** raw HTML elements (`button`, `input`, `form` with styling, …) as
  visuals in `apps/*`; inline `style=` or ad-hoc CSS recreating primitive visuals;
  raw hex/rgb/px/rem outside `packages/ui/src/styles/tokens.css`; auto-advancing past
  a boundary (the machine has no such transition); pause, reset, or skip controls;
  browser `Notification` or any sound asset/dependency (WebAudio only); visible
  "Session N of 4" text; a nav entry pointing at `/pomodoro`; editing frozen e2e
  selectors; a DB migration for `feedback.app`; touching `public/manifest-*.json` or
  `viewport.themeColor`; inventing build commands.

## 8. Success Criteria

1. `npm run typecheck` exits 0 for `apps/pomodoro`, `apps/app`, `packages/ui`,
   `packages/shared`.
2. `npm run test:unit -- test/timer.test.ts` (from `apps/pomodoro`) passes and
   enumerates the boundary table: zero → boundary held at `00:00`, next phase named,
   no advance without the button; the button starts the next phase at full duration;
   deadline math survives late ticks and reloads.
3. `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "boundary"`
   passes: a fake-clock 25-minute focus ends with the screen at `00:00` reading
   `Next: Short break`, `Start break` focused, one oscillator started, the tab title
   alternating `Pomodoro` / `Next: Short break`, and no phase change until the button
   is pressed.
4. The same e2e's reload case passes: mid-phase reload shows the remaining time
   (e.g. 2 fake-minutes in → ~`23:00`) and the countdown continues.
5. The timer screen shows phase name, digits, and four session pills, centred on
   both axes of a viewport-height page and still on a `Card` (`--panel` surface),
   with no "Session N of 4" text; first use shows `25:00`, `Focus`, no pills active,
   and a focused `Start focus`.
6. `/pomodoro/settings` holds the three durations plus the theme toggle; edits
   survive a reload; the toolbar's settings icon (and only it) links to
   `/pomodoro/settings`, and the feedback icon submits with `app: 'pomodoro'`
   (`FEEDBACK_APPS` includes `'pomodoro'`).
7. Contract 1 mechanical greps are clean for `apps/pomodoro`; `Stack` gained only
   the `align` prop (documented in `docs/specs/SPEC-ui-blocks.md` with a test); no
   frozen e2e selector outside pomodoro changed.

## 9. Assumptions

1. **Module id `pomodoro-flow`**, single capability, one spec, no capability map
   (scope check above). Supersedes `SPEC-pomodoro.md` where they conflict.
2. **Pinned boundary copy** (mine, adjustable — see Open Questions 1): status line
   `Next: Focus` / `Next: Short break` / `Next: Long break`; button `Start focus`
   when the next phase is focus, `Start break` for either break. The button is
   auto-focused at every boundary, and at initial idle.
3. **Wall-clock deadlines** (Assumption-level fix for both the ~4× backgrounded drift
   and reload resume): remaining time is always `endsAt - now`, never accumulated
   ticks. A phase whose deadline passed while the tab was closed or reloading lands
   on the boundary screen — "nothing counts until the button is pressed" also covers
   time that passed while the page was gone (the prior spec's "no countdown accuracy
   while the tab is closed" out-of-scope item is superseded by this intent).
4. **Reload of a running phase resumes and keeps counting down** ("resumes the
   remaining time"), not paused. A reload at a boundary or at idle restores the same
   screen.
5. **Duration edits take effect at the next phase start.** Editing durations while a
   phase runs is out of scope; the minimal defined behavior is that the running
   phase's deadline is untouched and the new value sizes the phase that starts after
   the next button press.
6. **The settings page needs no new client island**: durations edit through a
   server-action `<form>` posting to the existing `setPomodoroDurations` action;
   `ThemeToggle` is an existing client primitive. The timer page's single island is
   `@life/pomodoro`; `FeedbackNavItem`/`IconLink` are existing primitives.
7. **Pills and their aria-label**: four pills, `active` = focus sessions completed
   this cycle (long break fills all four, next focus resets); the row's
   `aria-label="Session N of 4"` uses the session in progress, or the one just
   finished during a break (a break belongs to the session it follows, including its
   end boundary).
8. **Beep** = one short (~180 ms, 880 Hz sine) `OscillatorNode` tone at each phase
   end, from an `AudioContext` created on the Start gesture; silent no-op where
   WebAudio is unavailable. **Title flash** = `document.title` alternating `Pomodoro`
   and the `Next: …` line once per second while at a boundary, restored to `Pomodoro`
   when the next phase starts.
9. **Toolbar shape** follows the `TodosNav`/`MealsNav` precedent exactly:
   `FeedbackNavItem app="pomodoro"` + `IconLink href={settingsHref('/pomodoro')}`,
   in a `PomodoroNav` rendered into `NavBar`'s trailing slot.
10. **`Stack align`** is the single upstream gap ("centred"), added as
    `align?: 'start' | 'center' | 'end'` (default unchanged) in `packages/ui`,
    spec-first in `SPEC-ui-blocks.md` where `Stack` lives — a prop, not a new
    primitive. Vertical centring adds the block-axis twin `vAlign` on the same
    terms; it is `align-content: safe center`, because plain `center` in a grid
    that cannot fit its rows pushes the first row above the scroll origin, where
    it cannot be scrolled back to.
11. **Full height comes from `ListShell fill`, not from pomodoro CSS**: the page
    shell already owns the full-viewport column (`.ui-page.ui-list-shell--fill`,
    `.ui-list-shell__body`), `/todos/matrix` already relies on it, and the app-side
    visual language stays untouched. The body slot is a definite-height grid, so
    the `vAlign` stack distributes inside it. The `Card` stays: it owns the
    `--panel` surface (`--bg` is the page behind it), and dropping it leaves the
    timer reading as bare text with no panel. The fill page's bottom padding still
    reserves `--space-5` for a fab this page does not render, so the card sits
    ~half that above the geometric centre — accepted rather than forking the shared
    shell rule.

## 10. Open Questions

1. Is the pinned boundary copy (`Next: Short break`, `Start break`) the wording you
   want? It is chosen so the success line "`Start break` focused" holds verbatim;
   changing it changes the e2e strings.
2. Should the button after focus 4 read `Start long break` instead of `Start break`
   (the screen already names "Next: Long break")? Current rule keeps one label per
   phase kind.
3. When a phase's deadline passed while the tab was closed for hours, land on the
   boundary screen as assumed (Assumption 3) — or is that a case for a "restart this
   phase" affordance later (not pause/reset, which stay out of scope)?
