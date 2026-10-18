# Spec: pomodoro — `/pomodoro` focus timer

Module id: `pomodoro`. Traces to intent: `docs/intent/pomodoro-app.md` (confirmed
2026-10-18). Single capability — one spec, no capability map (scope check: one page,
one behavior cluster; the tiny `@life/app-kit` numeric-preference extension has one
consumer and is scoped inside this module).

All work follows AGENTS.md Contract 1 (Shared UI Contract): every visual element maps
an existing `@life/ui` primitive; anything missing goes upstream to `packages/ui`
(spec first, prop/slot/variant before a new atom), never into `apps/*` as a fork.
Contract 2 has no surface here — there is no backend (intent): durations ride the
existing preference cookie, cycle position is client state.

## 1. Objective

A daily focus timer at `/pomodoro` in the new `apps/pomodoro` app: configurable focus /
short break / long break durations (25 / 5 / 15 minutes by default), the standard cycle
(4 focus sessions, then a long break), a large digit countdown, a "Session N of 4"
indicator, and start / pause / reset.

User stories / acceptance criteria:

- As the owner I set my three durations on the page and they survive a reload.
- Starting the timer counts the current phase down; pause freezes it; resume continues
  from the frozen remaining time; reset returns to Session 1 / focus / full focus
  duration.
- When a phase reaches zero the timer advances and the next phase runs immediately:
  after focus 1, 2, 3 a short break; after focus 4 a long break; after the long break
  the cycle restarts at focus Session 1. The indicator reads "Session N of 4" for the
  focus session in progress (a break belongs to the session just finished — the long
  break reads "Session 4 of 4").
- A reload keeps the chosen durations and the current mode (phase + session N); the
  countdown restarts at the restored phase's full duration.
- The whole surface is composed from existing `@life/ui` primitives — zero new
  primitives invented for it.

Out of scope (intent, verbatim): shadcn/Radix migration; browser notifications; sound;
task list; stats or history; PWA manifest changes; a backend service; countdown accuracy
while the tab is closed.

## 2. Tech Stack

- TypeScript ~5.7 (strict, existing repo config shape).
- React 19 (`react` / `react-dom` ^19.0.0) — client timer component, server mount route.
- Next.js 15 App Router (`next` ^15.2.4) — `apps/app` serves `/pomodoro`; `apps/pomodoro`
  is framework-agnostic React (no `next/headers` inside it).
- `@life/ui` (workspace) — all visuals: `PageShell`, `Section`, `Stack`, `Card`,
  `Button`, `Input` (and `Select` / `Switch` only if a real need appears).
- `@life/app-kit` (workspace) — preference-cookie behavior, extended with a numeric
  preference variant (this module's upstream addition, see §4).
- jest ^29.7 + ts-jest ^29.2 (unit), `@playwright/test` ^1.55 (e2e, incl. `page.clock`).
- No new dependencies. No backend, no DB, no cache (Contract 2 out of scope here).

## 3. Commands

```
Typecheck: npm run typecheck                       # workspace-aware; run in the touched workspace
Unit test: npm run test:unit -- <file>             # from the owning workspace (jest)
E2E:       npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
E2E (dev): npx playwright test --config apps/app/playwright.dev.config.ts <file> -g "<name>"
```

- Max test runs: **2** per the repo profile. Targeted runs only (`<file>` + `-g`).
- No build step: the repo profile declares no build command, so none is written here.
- Touched workspaces for typecheck: `apps/pomodoro`, `apps/app`, `packages/app-kit`.

## 4. Project Structure

```
apps/pomodoro/                       # NEW workspace, package name @life/pomodoro
  package.json                       # adds typecheck / test:unit scripts (profile rule)
  src/pomodoro-page.tsx              # page composition — @life/ui primitives only
  src/timer.ts                       # pure timer state machine (phases, cycle, transitions)
  src/…                              # countdown display, duration fields, controls
  test/timer.test.ts                 # unit: cycle table, start/pause/reset semantics
apps/app/app/pomodoro/page.tsx       # thin mount route: reads prefs server-side, passes
                                     # props into @life/pomodoro; metadata; zero visuals
packages/app-kit/src/preferences.ts  # + readPrefNumber (numeric variant)
packages/app-kit/src/preference-action.ts  # + setPrefNumber (same cookie attributes)
packages/app-kit/test/…              # unit: numeric pref parse/write edge cases
apps/app/test/e2e/pomodoro.spec.ts   # prod e2e: one full cycle + reload persistence
docs/specs/SPEC-pomodoro.md          # this spec
```

State and storage:

- **Durations** — three numeric preference cookies `pref_pomodoro_focus`,
  `pref_pomodoro_short`, `pref_pomodoro_long` (integer minutes), same naming and
  attributes as `setPref` (`path: '/'`, `sameSite: 'lax'`, `httpOnly`, one year). The
  boolean `readPref`/`setPref` encoding (`'on'`/`'off'`) cannot carry numbers, so
  `@life/app-kit` gains `readPrefNumber(name, fallback)` / `setPrefNumber(name, value)`
  — upstream, per "never fork these helpers per app or per key". Absent or malformed
  value falls back to the default (25 / 5 / 15). Read server-side in the mount route,
  written via the server action from the client page.
- **Mode + cycle position** — client state (phase, session N, remaining ms at last
  tick), persisted to `localStorage` on change and restored on mount (the ThemeToggle
  pattern — client-only state needs no cookie). No wall-clock drift compensation:
  remaining time is restored as stored, and a stale entry simply restarts the phase at
  its full duration on reload (see Assumption 6).

## 5. Code Style

Primitives composed, never raw elements; `cx()` class merges only; tokens only. One
real snippet in the repo's voice:

```tsx
// apps/pomodoro/src/pomodoro-page.tsx
export interface PomodoroPageProps {
  durations: Durations; // minutes: { focus: 25; short: 5; long: 15 }
  onDurationsChange: (next: Durations) => void;
}

export function PomodoroPage({ durations, onDurationsChange }: PomodoroPageProps) {
  const timer = useTimer(durations);
  return (
    <PageShell>
      <Section label="Timer">
        <Card>
          <CountdownDigits value={timer.remainingMs} />
          <StatusText>{`Session ${timer.session} of ${SESSIONS_PER_CYCLE}`}</StatusText>
          <TimerControls state={timer.state} onStart={timer.start} onPause={timer.pause} onReset={timer.reset} />
        </Card>
      </Section>
      <Section label="Durations">
        <DurationFields value={durations} onChange={onDurationsChange} />
      </Section>
    </PageShell>
  );
}
```

Conventions: named exports; props typed via exported interfaces; pure logic in
`timer.ts` with no React imports; the large digits ride an existing text primitive with
an upstream size **variant** if the scale is missing (Rule 3: prop/slot/variant first —
that is not a "new primitive", a new atom/block would be).

## 6. Testing Strategy

- **Unit (jest, `apps/pomodoro/test/`)** — owns the behavior: the full phase table
  (focus → short ×3 interleaved, focus 4 → long, long → back to session 1), reset
  semantics, pause/resume continuity, duration clamping (integer minutes, valid range),
  and the localStorage persistence parse/restore. Run targeted:
  `npm run test:unit -- test/timer.test.ts` from `apps/pomodoro`.
- **Unit (jest, `packages/app-kit/test/`)** — numeric pref edge cases: absent,
  malformed, non-numeric values → fallback; write encodes the decimal value with the
  standard cookie attributes.
- **E2E (Playwright, prod harness)** — one spec `apps/app/test/e2e/pomodoro.spec.ts`
  covering one full cycle end to end through the real UI, plus reload persistence
  (durations and mode survive). Wall time stays seconds via Playwright clock control
  (`page.clock.install()` / `runFor`), because the fields take integer minutes. It
  touches only pomodoro-owned selectors — the frozen e2e selector surface is read-only.
- **Contract 1 mechanical checks** run at review: zero raw-HTML-element hits under
  `apps/pomodoro`, zero raw colors/lengths outside `packages/ui/src/styles/tokens.css`.
- Levels: timer state machine is proven in unit tests (deterministic); e2e proves the
  wiring (render, cookie persistence, reload, cycle through the real controls). No
  coverage percentage gate — the phase table is fully enumerated instead.

## 7. Boundaries

- **Always do:** compose existing `@life/ui` primitives; style through tokens only;
  keep `timer.ts` pure and framework-free; persist durations through `@life/app-kit`
  (upstream fix, never an app-local cookie fork); keep the mount route visual-free
  plumbing; run typecheck plus the targeted unit tests before considering a task done;
  keep pomodoro e2e selectors self-owned.
- **Ask first:** any change to `@life/ui` primitives or tokens; the `@life/app-kit`
  preference API shape; any touch to the frozen e2e selector surface; adding any
  dependency; anything that touches data directories, secrets, or ports; PWA manifest
  work; widening or replacing the commands in §3.
- **Never do:** raw HTML elements (`button`, `input`, `select`, …) in `apps/*` UI code;
  inline `style=` or ad-hoc CSS classes recreating primitive visuals; raw hex/rgb/px/rem
  outside `packages/ui/src/styles/tokens.css`; new atoms/blocks for this page (variant
  first — "no new primitives invented for it"); shadcn/Radix; a backend service or any
  Contract 2 surface; browser notifications, sound, task list, stats/history; touching
  `public/manifest-*.json` or `viewport.themeColor`; editing frozen e2e selectors;
  inventing build commands.

## 8. Success Criteria

1. `npm run typecheck` exits 0 for `apps/pomodoro`, `apps/app`, `packages/app-kit`.
2. `npm run test:unit -- test/timer.test.ts` (from `apps/pomodoro`) passes and
   enumerates the cycle: focus 1 → short → focus 2 → short → focus 3 → short → focus 4
   → long → focus 1; reset returns to Session 1 / focus / full focus duration.
3. `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "full cycle"`
   passes and drives one full cycle through the real UI, asserting each phase
   transition and the "Session N of 4" indicator at each focus session.
4. The same e2e (or its reload step) asserts: after editing all three durations and
   reloading, the page shows the chosen durations and the same mode (phase + session N).
5. First use shows 25 / 5 / 15 and "Session 1 of 4"; start / pause / reset all work from
   the visible controls.
6. Contract 1 mechanical greps are clean for `apps/pomodoro` (zero raw HTML elements,
   zero raw colors/lengths), and no `packages/ui` component was copied or forked.
7. Zero new primitives in `packages/ui`; any scale gap is covered by a variant on an
   existing primitive (or recorded as an open question), never an app-side workaround.

## 9. Assumptions

1. **Placement.** `apps/pomodoro` is a new workspace (package `@life/pomodoro`) owning
   the page composition and timer behavior; `/pomodoro` is served by the existing
   `apps/app` frontend through a thin mount route. This satisfies "a `/pomodoro` page
   in a new `apps/pomodoro` app" without a second frontend/port (ports are a hard line)
   and keeps the mandated apps/app e2e harness, auth, and preference cookie in play.
   Not assumed: a standalone deployable frontend with its own origin (see Open
   Questions 1).
2. Module id `pomodoro`; single capability, one spec, no capability map.
3. Durations are integer minutes (25 / 5 / 15 defaults), all three editable on the
   page; storage is three numeric `pref_pomodoro_*` cookies via the upstream
   `@life/app-kit` numeric variant (the existing boolean encoding cannot carry numbers,
   and forking the cookie helpers per app is forbidden).
4. Cycle shape is fixed at 4 focus sessions: focus → short → focus → short → focus →
   short → focus → long, then back to focus Session 1. "Session N of 4" counts focus
   sessions; a break belongs to the session just finished.
5. A phase reaching zero advances immediately and the next phase runs without waiting
   for Start (one Start begins the whole cycle; pause/resume is per countdown).
6. Reload restores durations + mode (phase, session N); the countdown restarts at the
   restored phase's full duration. Exact remaining-time restore and closed-tab drift
   compensation are out of scope (intent).
7. Reset = back to Session 1, focus, full chosen focus duration (not "current phase
   only").
8. The full-cycle e2e uses Playwright clock control so a minutes-scale cycle runs in
   seconds of wall time; the dev-mode harness is not extended (feedback-chapter
   precedent: feature e2e lives in the prod harness).

## 10. Open Questions

1. Did "a new `apps/pomodoro` app" mean a fully standalone frontend (own port, own
   origin, own login)? Ports are a hard line and the repo's e2e policy pins the run to
   `apps/app`'s Playwright harness, so this spec assumes the mounted-workspace shape.
   Correcting this changes Project Structure and the e2e story.
2. Should a reload restore the exact remaining seconds of the current phase (needs a
   persisted deadline), instead of restarting the phase at its full duration?
3. Durations: integer minutes only, or do you want sub-minute values (e.g. 0.5) for
   short bursts and faster manual testing?
4. After the long break ends, auto-start Session 1 of the next cycle (assumed in
   Assumption 5's "next phase runs") or pause and wait for Start?
