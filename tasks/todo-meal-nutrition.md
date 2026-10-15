# Task List: meal-nutrition

Plan: `tasks/plan-meal-nutrition.md`. Task list tracked here (repo convention,
`tasks/todo-<chapter>.md`).

## Phase 1: Foundation — `nutrition-model`
- [ ] Task 1: `@life/nutrition` vocabulary and units (Small)
- [ ] Task 2: portion scaling (Small)
- [ ] Task 3: day summation and formatting (Small)
- [ ] Task 4: register the workspace (XS)

### Checkpoint: Foundation
- [ ] `npm run typecheck` clean; `@life/nutrition` unit tests pass
- [ ] The 27-field table matches `docs/research/nutrients-loseit.md` §0.1 exactly

## Phase 2: Service skeleton and targets
- [ ] Task 5: meal-service skeleton (Medium)
- [ ] Task 6: target derivation, pure (Small)
- [ ] Task 7: target versioning + routes (Medium)

### Checkpoint: Targets
- [ ] Past days resolve to the target in effect on their date
- [ ] Zero typecheck errors in `apps/meal-service`
- [ ] `apps/meal-service/Dockerfile` exists (Task 5) and mirrors `apps/note-service/Dockerfile`
      (repo-root context, every workspace `package.json` incl. `@life/nutrition`, `npm prune --omit=dev`)

## Phase 3: Foods, entries, cache
- [ ] Task 8: foods catalog (Medium)
- [ ] Task 9: diary entries (Medium)
- [ ] Task 10: cache contract proof (Small)
- [ ] Task 11: saved meals, frozen snapshots (Medium)

### Checkpoint: Data layer
- [ ] Ownership isolation proven across food, entry, saved meal, target
- [ ] Cache holds ciphertext only; write invalidates the day
- [ ] `docs/specs/MAP-redis.md` updated with the meal-cache module and `redis-meal`

## Phase 4: Gemini photo pipeline
- [ ] Task 12: Gemini client (Medium)
- [ ] Task 13: photo endpoint (Small)

### Checkpoint: Pipeline
- [ ] Failure paths return "could not read" with no invented numbers
- [ ] No key, prompt, or image byte appears in logs, DB, or Redis

## Phase 5: UI
- [ ] Task 14: BFF client + meals day route (Small)
- [ ] Task 15: photo-door upload atom (FilePicker), upstream (Small)
- [ ] Task 16: day view, total vs target (Medium)
- [ ] Task 17: review-correct editor (Medium)
- [ ] Task 18: saved meals UI (Small)
- [ ] Task 19: target onboarding UI (Small)
- [ ] Task 20: E2E spec (Medium)

### Checkpoint: UI
- [ ] Contract 1 mechanical greps return zero hits in meals code
- [ ] Photo door composes the upstream upload atom (no raw `<input type="file">`)
- [ ] "Save as meal" on the review editor creates a saved meal (the fixture Task 18 lists and
      Task 20 re-logs)
- [ ] `@life/nutrition` ships in the app image: `apps/app/Dockerfile` copies/builds it and
      `apps/app/next.config.mjs` transpiles it
- [ ] Single-spec E2E passes

## Phase 6: Wiring and docs
- [ ] Task 21: dev/prod wiring (Small) — dev script + env templates **and** compose: `meal-service`
      service block (dockerfile, `:3106`, `MEAL_MASTER_KEY`, audience, `redis-meal`, healthcheck),
      app block `MEAL_API_URL`, `GEMINI_API_BASE`
- [ ] Task 22: docs (Small)

### Checkpoint: Complete
- [ ] `compose.yaml` builds `apps/meal-service/Dockerfile` and serves meal-service on `:3106`;
      the app reaches it via `MEAL_API_URL`; no uncommented `REDIS_URL` in `.env.development.example`
- [ ] All acceptance criteria met
- [ ] §7 lifecycle complete; five-lane gate returns N/N PASS
