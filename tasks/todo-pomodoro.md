# Tasks: pomodoro — `/pomodoro` focus timer

Plan: `tasks/plan-pomodoro.md` · Spec: `docs/specs/SPEC-pomodoro.md`

`tasks/todo.md` belongs to the notes plan and keeps its unchecked items; this chapter
tracks its own list here.

## Phase 1: Foundation

- [ ] Task 1: numeric preference helpers in `@life/app-kit`
- [ ] Task 2: `@life/pomodoro` workspace scaffold wired into the monorepo
- [ ] Task 3: pure timer state machine, duration clamping, mode codec + unit tests
- [ ] Task 4: upstream `StatusText` display-size variant

### Checkpoint: After Tasks 1-3

- [ ] `npm run typecheck` passes in `packages/app-kit` and `apps/pomodoro`.
- [ ] The numeric pref test and the timer phase-table test both pass.
- [ ] Cycle order and the three default durations are settled; no page code exists yet.

## Phase 2: Core feature

- [ ] Task 5: `/pomodoro` page composition in `apps/pomodoro` (primitives only)
- [ ] Task 6: mount route in `apps/app` wiring prefs, server action, workspace dep

## Phase 3: Proof

- [ ] Task 7: e2e — one full cycle plus reload persistence

### Checkpoint: After Tasks 4-7

- [ ] `npm run typecheck` passes in `apps/pomodoro`, `apps/app`, `packages/app-kit`, `packages/ui`.
- [ ] `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/pomodoro.spec.ts -g "full cycle"` passes.
- [ ] Contract 1 mechanical greps clean for `apps/pomodoro`; `tokens.css` unmodified; zero new primitives.
- [ ] Review with the human before any merge.
