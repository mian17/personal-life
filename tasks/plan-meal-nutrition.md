# Implementation Plan: meal-nutrition (photo → Gemini → calories)

Specs: `docs/specs/MAP-meal-nutrition.md`, `SPEC-nutrition-model.md`,
`SPEC-target-onboarding.md`, `SPEC-meal-service.md`, `SPEC-meal-capture-ui.md`.
Intent: `docs/intent/meal-nutrition.md`. Task list: `tasks/todo-meal-nutrition.md`.
Research: `docs/research/nutrients-loseit.md` §0.1, `nutrition-tracking-*.md`.

## Overview

Third service chapter in `personal-life`. A new pure workspace package
(`@life/nutrition`) owns the 27-nutrient vocabulary and portion arithmetic; a new
`apps/meal-service` (NestJS) owns owner-scoped foods, entries, saved meals, targets, and the
Gemini photo pipeline; the existing `apps/app` grows a meals route group that composes
`@life/ui` primitives only. Build order is the capability map's:
`nutrition-model` → `target-onboarding` → `meal-service` → `meal-capture-ui`.

## Governing decisions this chapter must reconcile (lesson 0012)

Read before implementing; the plan follows each rather than re-deciding it:

| Standing decision | Where | This chapter's obligation |
|---|---|---|
| UI comes from `@life/ui`, tokens only, no raw elements | Contract 1 | `meal-capture-ui` composes primitives; gaps go upstream |
| DB behind read-through cache; ciphertext values | Contract 2 | `meal-service` consumes `@life/cache`/`@life/crypto`; no fork |
| One Redis instance per service | `docs/intent/redis-shared-state.md` dec. 3 | dedicated `redis-meal`, wired with the repo's single per-service `REDIS_URL` (`MAP-redis.md:21`); update `MAP-redis.md` |
| Dev/e2e run Redis-free | `MAP-redis.md:21-23`; `.env.example` ("No Redis keys belong here… Leaving it unset in dev/e2e") | `REDIS_URL` is **not** set in `.env.development.example` (a commented prod-only knob at most); `compose.yaml` injects it in production; unset keeps the direct-DB path |
| Content encrypted at rest | `docs/intent/data-privacy.md` | content fields are `enc.v1.` with byte-exact AAD |
| Per-service DEK custody under a master key | `SPEC-notes-at-rest.md` | `MEAL_MASTER_KEY` + the `keys/` module shape |
| BFF is the only caller of a service | `personal-life-api.md`, `apps/app/lib/*` | `lib/meal-api.ts` server-only; browser never reaches meal-service |
| Audience mapping | `.env.development.example`, `.env.example` | add `https://meal-service=life-api` to the `OIDC_AUDIENCE_MAP` in both (the tracked `.env.example` is the production template the IdP reads at `compose.yaml:153`); there is exactly one app-side audience (`life-api`, `lib/client.ts`) — no second audience config exists |
| PWA identity per top-level route | lesson 0005; `apps/app/app/{notes,todos}/layout.tsx` | the meals group mounts its own layout reusing the app's **existing** `/manifest-todos.json` + `/icon-todos.png` constants; **no `public/manifest-meals.json`** (frozen surface, user unavailable) — Task 16 owns it |
| Photo → suggestion → editor | `SPEC-meal-capture-ui.md`, intent "photo front door" | one endpoint path `POST /api/estimates/photo` (Task 13) and one call site (Task 17's `actions.ts`); the suggestion becomes the editor's draft, the explicit failure shape opens it empty |
| "Today" is the client's zone | lesson 0019 | client resolves the day via the existing shared owner `apps/app/lib/today.ts` (`getToday()`); service never uses its own clock |
| Dates render through the shared helper | lesson 0003 | no ad-hoc date formatting in the meals UI |
| One owner per rule | lesson 0016, Contract 1/2 | single owner named per rule below |

Rules with exactly one owner in this chapter (lesson 0016):

- The 27-nutrient table, units, scaling, summation, and display formatting → `@life/nutrition`
  only. Service sums, UI formats, neither re-derives.
- "Which day is now" → `apps/app/lib/today.ts` (`getToday()`), the existing shared owner the
  todo routes already use and `apps/app/test/today.test.ts` already covers. The meals route
  reuses it; the service receives a date.
- Target derivation math → `meal-service/src/targets/target.ts` (pure), consumed by the
  target service and its DTO validation, not re-derived in the UI.
- Cache mechanics → `@life/cache`. meal-service holds only a namespace adapter
  (`apps/meal-service/src/cache/meal-cache.ts`, Task 7). Target reads are deliberately **uncached**
  (a single indexed date lookup; the spec's key table carries no target shape), while every write —
  including a target change — still bumps the owner's generation.

## Architecture Decisions

- **`@life/nutrition` is a workspace package, not service code** (decided in the map): the
  service and the UI must not hold two copies of the unit table.
- **Entries store a confirmed nutrient snapshot**, not a live reference to the food row.
  Editing a food never rewrites history.
- **Saved meals are frozen snapshots** of corrected values (intent doc, confirmed).
- **Targets are versioned by `validFrom`**; a date resolves to the applicable row, so past days
  never re-render against a new profile.
- **Photo estimates are never persisted or cached**; only a confirmed entry is written. Image
  bytes live for the request only.
- **Gemini over plain `fetch`, no SDK.** One endpoint, one JSON shape. Model id and base URL
  come from env (`GEMINI_MODEL`, `GEMINI_API_BASE`). Verified against official docs at
  implementation time (`source-driven-development`), recorded in an ADR.
- **`redis-meal` is a dedicated instance** (lesson 0011), not `redis-note` with a prefix.
- **Port `:3106`**, `MEAL_API_URL` (on the app container), `MEAL_MASTER_KEY`, `GEMINI_API_KEY`,
  `GEMINI_MODEL`, `GEMINI_API_BASE`, `REDIS_URL` (one per-service env var
  named `REDIS_URL`, pointing at `redis-meal` — `MAP-redis.md:21`), audience
  `https://meal-service`.

## Task List

### Phase 1: Foundation — `nutrition-model`

- [ ] **Task 1: `@life/nutrition` vocabulary and units** — *Small*
  - Create `packages/nutrition` (package.json, tsconfig, jest mirroring `packages/cache`) **and
    register it in the root `workspaces` array with the creation** (app-kit precedent,
    `tasks/plan-shared-page-blocks.md` T5: the creating task registers its workspace), so Tasks
    2–3's `-w @life/nutrition` commands resolve. Regenerate the tracked `package-lock.json`
    (`npm install`) in the same change — the new workspace link must land in the lock, or every
    Dockerfile's `npm ci` fails out of sync.
  - `src/nutrients.ts`: the 27 nutrients in the agreed order, each with a unit from
    `'kcal'|'g'|'mg'|'mcg'|'ml'`, plus the display-label map.
  - Acceptance: `NUTRIENTS` has exactly 27 entries, unique, in the §0.1 order; every unit is
    in the union; a test asserts count/order/uniqueness; root `workspaces` lists
    `packages/nutrition` so `-w @life/nutrition` resolves.
  - Verify: `npm run typecheck -w @life/nutrition`; `npm run test:unit -w @life/nutrition -- test/nutrients.test.ts`
  - Files: `packages/nutrition/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/nutrients.ts,test/nutrients.test.ts}` (the `tsconfig.build.json` mirrors `packages/cache`, per `SPEC-nutrition-model.md` project structure), `package.json` (root — add `"packages/nutrition"` to `workspaces`), `package-lock.json` (regenerated by `npm install` with the workspace link)

- [ ] **Task 2: portion scaling** — *Small*
  - `src/food.ts` (`Food`, `Serving`, `Portion`), `src/scale.ts`
    (`scale(food, quantity) → NutrientVector`), complete vector always.
  - Acceptance: exactly linear in quantity, tested at 0×, 0.5×, 2×; a zero quantity yields an
    all-zero complete vector; no `NaN`/`undefined` for any nutrient.
  - Verify: `npm run test:unit -w @life/nutrition -- test/scale.test.ts`
  - Files: `packages/nutrition/src/{food.ts,scale.ts,index.ts}`, `test/scale.test.ts`

- [ ] **Task 3: day summation and formatting** — *Small*
  - `src/sum.ts` (additive, complete vector for empty input), `src/format.ts` (unit rendering;
    `%DV` derived from a reference table for the eight eligible micronutrients).
  - Acceptance: `sum` is exactly additive; `%DV` never appears in `scale`/`sum` output; `mcg`
    renders as `mcg` (ASCII) and small values are not rendered as `0.0024 mg`-style strings;
    the formatter renders an estimated-but-unknown value as the explicit unknown affordance (an
    em dash `—`), never a fabricated `0` (`SPEC-meal-capture-ui.md` §Code Style).
  - Verify: `npm run test:unit -w @life/nutrition -- test/sum.test.ts test/format.test.ts`
  - Files: `packages/nutrition/src/{sum.ts,format.ts,index.ts}`, `test/{sum,format}.test.ts`

- [ ] **Task 4: register the workspace** — *XS*
  - Add `apps/meal-service` to the root `workspaces` array (the creating workspace's own
    registration, app-kit precedent: `tasks/plan-shared-page-blocks.md` T5 registers the
    workspace it creates). `packages/nutrition` was already registered by Task 1. Regenerate the
    tracked `package-lock.json` (`npm install`) with the registration, so `npm ci` elsewhere stays
    in sync with the explicit `workspaces` list.
  - Acceptance: root `workspaces` lists `apps/meal-service`; root `npm run typecheck` passes
    (npm's workspace glob simply yields no match for the not-yet-created path until Task 5 adds
    `apps/meal-service/package.json`, from which point every `-w apps/meal-service` command
    resolves).
  - Verify: `npm run typecheck`
  - Files: `package.json` (root — add `"apps/meal-service"` to `workspaces`), `package-lock.json` (regenerated by `npm install` with the workspace link)

### Checkpoint: Foundation
- [ ] `npm run typecheck` clean; `@life/nutrition` unit tests pass
- [ ] The 27-field table matches `docs/research/nutrients-loseit.md` §0.1 exactly

### Phase 2: Service skeleton and targets

- [ ] **Task 5: meal-service skeleton** — *Medium*
  - `apps/meal-service` with `main.ts`, `app.factory.ts` (global `AuthGuard` +
    `ValidationPipe({whitelist,transform,forbidNonWhitelisted})`), `app.module.ts`,
    `health/`, `auth/` (guard, jwt-verifier, principal, public decorator — copied shape from
    `note-service`), `keys/` (`MEAL_MASTER_KEY`, DEK get-or-create).
  - Consume `@life/nutrition` (Task 1–4's workspace package): add `"@life/nutrition": "*"` to
    `dependencies` and `"^@life/nutrition$": "<rootDir>/../../packages/nutrition/src/index.ts"`
    to jest `moduleNameMapper`, mirroring the existing `^@life/cache$` / `^@life/db$` /
    `^@life/crypto$` / `^@life/shared$` entries in the same file. The service is the day-sum
    consumer (`SPEC-nutrition-model.md:20`; `MAP-meal-nutrition.md:10`).
  - `test/setup-env.ts` and `test/health.e2e-spec.ts` are created here, mirroring
    `apps/note-service/test/` (`setup-env.ts` is the jest `setupFiles` entry — `<rootDir>/test/setup-env.ts`
    — that seeds a deterministic fake `MEAL_MASTER_KEY` so `AppModule` boots in tests; the
    health suite proves the boot/health contract). Tasks 6–11's `test:unit` runs depend on it.
  - `apps/meal-service/Dockerfile` is a Task 5 deliverable (this task is its single owner; the
    container/compose wiring task consumes it and does not create it): the skeleton task
    that creates the service owns its image. Mirror `apps/note-service/Dockerfile` file-for-file:
    build context is the repo root; `COPY package.json package-lock.json ./`; copy every
    referenced workspace `package.json` (**including** `packages/nutrition/package.json`, newly
    registered by Task 1 — the service consumes `@life/nutrition`, so the build-stage `npm ci`
    must see it); `npm ci`; `COPY tsconfig.base.json`; copy and build `@life/shared`,
    `@life/db`, `@life/crypto`, `@life/cache`, **and `@life/nutrition`**; then build
    `@life/meal-service`; `npm prune --omit=dev`; a runtime stage copying each package's
    `package.json` + `dist`, exposing `:3106`, with `CMD ["node", "dist/main.js"]`.
  - Acceptance: boots on `:3106`; `/health` and `/health/ready` respond (the latter is the
    readiness probe the compose healthcheck uses, mirroring the other services' blocks); a
    request without a token is rejected by
    the global guard; `REDIS_URL` absent still boots; a source import of `@life/nutrition`
    resolves under jest (mapped to the workspace `src/index.ts`, matching the `@life/cache`
    mapping style).
  - Verify: `npm run typecheck -w apps/meal-service`; `npm run test:unit -w apps/meal-service -- test/health.e2e-spec.ts`
  - Files: `apps/meal-service/{package.json,tsconfig.json,nest-cli.json,src/main.ts,src/app.factory.ts,src/app.module.ts,src/health/*,src/auth/*,src/keys/*}`, `apps/meal-service/test/{setup-env.ts,health.e2e-spec.ts}`, `apps/meal-service/Dockerfile`, `package-lock.json` (regenerated by `npm install` with `apps/meal-service`'s new `@life/nutrition` dependency — the tracked lock must stay in sync or every Dockerfile's `npm ci` fails)

- [ ] **Task 6: target derivation (pure)** — *Small*
  - `src/targets/target-calculator.ts` (Mifflin-St Jeor + named `ACTIVITY_FACTORS`),
    `src/targets/target.ts` (profile + goal → target with macro gram floors).
  - Acceptance: BMR/TDEE formula cases pass; every activity level is in the enum (a missing
    level is a type error); macro grams reconcile with the calorie target within rounding.
  - Verify: `npm run test:unit -w apps/meal-service -- test/target.test.ts`
  - Files: `apps/meal-service/src/targets/{target.ts,target-calculator.ts}`, `test/target.test.ts`

- [ ] **Task 7: target versioning + routes** — *Medium*
  - `target.entity.ts` (ownerSub index, `validFrom`, profile inputs **and** computed outputs),
    `dto/update-profile.dto.ts`, `target.service.ts` (row-per-change; date → applicable row,
    oldest-row fallback), `target.controller.ts` (`GET /api/target?date=`, `PUT /api/target/profile`),
    `target.module.ts`, and the service's **one namespace adapter**
    `src/cache/meal-cache.ts` (`MEAL_CACHE` token; `createMealCache(redisUrl)` mirroring
    `notes-cache.ts` — `createCache({service: 'meal', client})` with a `null` client when
    `REDIS_URL` is unset). This is the service's first write path, so it introduces the adapter;
    Tasks 8/9/11 compose it rather than creating a second Redis client (Governing decisions:
    "meal-service holds only a namespace adapter").
  - **Target reads are not cached.** No `target` row exists in `SPEC-meal-service.md`'s key table,
    so no `targets-cache.ts` is created; `GET /api/target?date=` reads the DB directly. A successful
    `PUT /api/target/profile` still bumps the owner's generation through the adapter.
  - Acceptance: `PUT` creates a new row and leaves prior rows untouched; reading a past date
    after a profile change returns the old target; the client cannot send computed kcal; a
    successful `PUT` calls the adapter's `bumpGeneration(sub)` **after** the insert (asserted with
    an injected stub in `test/target-versioning.test.ts`) and a `GET` never writes to Redis.
  - Cache plan (Contract 2 Rule 4; `SPEC-meal-service.md` `Cache Rules`): **shapes** — none cached;
    target rows are read directly from the DB (the spec's key table covers food, entries, saved
    meals, and the counter only). **Key** — the sole key this task touches is the counter
    `meal:gen:<sub>` (`@life/cache` composes `<service>:gen:<sub>`; no read key is ever built).
    **Invalidation** — `target.service.ts` calls `@life/cache`'s `bumpGeneration(sub)` after each
    successful profile write (spec `Cache Rules`: invalidate on "target change"), never before,
    never on a failed write. **Failure mode** — fail open: `REDIS_URL` unset ⇒ `null` client ⇒
    direct-DB path (dev/e2e), and a bump error never blocks the write (`@life/cache` swallows it).
  - Verify: `npm run test:unit -w apps/meal-service -- test/target-versioning.test.ts`;
    `npm run typecheck -w apps/meal-service`
  - Files: `apps/meal-service/src/targets/{target.entity.ts,target.service.ts,target.controller.ts,target.module.ts,dto/update-profile.dto.ts}`, `apps/meal-service/src/cache/meal-cache.ts`, `test/target-versioning.test.ts`

### Checkpoint: Targets
- [ ] Past days resolve to the target in effect on their date, proven by test
- [ ] Zero typecheck errors in `apps/meal-service`

### Phase 3: Foods, entries, cache

- [ ] **Task 8: foods catalog** — *Medium*
  - `food.entity.ts`, `serving.entity.ts` (per-serving `NutrientVector`), `dto/`,
    `foods.service.ts` (owner-scoped; `ownerSub` from `@Principal()`; **food-name search `q`**),
    `foods.controller.ts` (`@Controller('api/foods')` — the repo's `api/<noun>` convention, as
    `notes.controller.ts`/`todos.controller.ts`: `GET /api/foods?q=`, `POST /api/foods`,
    `GET /api/foods/:id`, `PATCH /api/foods/:id`, `DELETE /api/foods/:id`), `foods.module.ts`,
    `foods-cache.ts` (food read keys composed through Task 7's `MEAL_CACHE` namespace adapter
    `src/cache/meal-cache.ts` — no second Redis client and no forked `@life/cache` wrapper).
  - `test/ownership.e2e-spec.ts` is the single owner of the cross-entity owner-isolation proof
    (`SPEC-meal-service.md` Success Criterion 1): this task starts it for food and target, and
    Tasks 9 and 11 extend it for entry and saved meal.
  - Food-name search is a **post-decrypt, in-memory** filter over the owner's decrypted rows
    (`SPEC-meal-service.md` Cache Rules: "Content matching (search over food names) runs
    post-decrypt, in memory — never `LIKE` over encrypted columns"); no `LIKE`/SQL match touches
    the encrypted name column anywhere in `foods.service.ts`/`foods-cache.ts`.
  - Acceptance: a food round-trips with a complete nutrient vector; a `q` search returns only the
    owner's matching foods and is applied post-decrypt in memory (asserted in
    `test/foods-search.test.ts`); user B cannot read, mutate, or delete user A's food **or
    target**; `REDIS_URL` unset runs the direct path.
  - Cache key shape (`SPEC-meal-service.md` key table; Contract 2 Rule 3): `foods-cache.ts`
    composes keys through `@life/cache` so the final key is `meal:<sub>:v<gen>:food:<rest>` —
    the owner `<sub>` segment is always present, so no task builds an owner-colliding key.
  - Verify: `npm run test:unit -w apps/meal-service -- test/ownership.e2e-spec.ts test/foods-search.test.ts`
  - Files: `apps/meal-service/src/foods/*`, `test/{ownership.e2e-spec.ts,jwt-harness.ts,foods-search.test.ts}`

- [ ] **Task 9: diary entries** — *Medium*
  - `entry.entity.ts` (ownerSub index, `version`, `deletedAt`, date + meal group + food +
    quantity + **confirmed snapshot vector**), `dto/`, `entries.service.ts` (write → DB →
    `bumpGeneration`; read via `getThrough`; meal-group filter applied post-decrypt in memory),
    `entries.controller.ts` (`@Controller('api/entries')` — the repo's `api/<noun>` convention, as
    `notes.controller.ts`/`todos.controller.ts`: `POST /api/entries`, `GET /api/entries?date=`,
    `GET /api/entries/:id`, `PATCH /api/entries/:id`, `DELETE /api/entries/:id`),
    `entries.module.ts`, `entries-cache.ts`.
  - Acceptance: an entry stores the scaled, confirmed `NutrientVector` as a snapshot and
    editing the source food afterwards leaves the entry's stored vector unchanged (spec Testing
    Strategy "Entry snapshot immutability — editing a food must not rewrite history", asserted
    in `test/entry-snapshot.test.ts`); a day's total equals `sum()` of its entries; deleting one
    entry moves the total; the service never calls `new Date()` in a request path; filters run
    in memory after decrypt; user B cannot read, mutate, or delete user A's entry
    (`test/ownership.e2e-spec.ts` extended).
  - Cache key shape (`SPEC-meal-service.md` key table; Contract 2 Rule 3): `entries-cache.ts`
    composes keys through `@life/cache` so the final key is `meal:<sub>:v<gen>:entries:<date>` —
    the owner `<sub>` segment is always present, so no task builds an owner-colliding key; the
    date is part of the fetch identity, filters are not.
  - Verify: `npm run test:unit -w apps/meal-service -- test/entries.e2e-spec.ts test/entry-snapshot.test.ts test/ownership.e2e-spec.ts`
  - Files: `apps/meal-service/src/entries/*`, `test/{entries.e2e-spec.ts,entry-snapshot.test.ts,ownership.e2e-spec.ts}`

- [ ] **Task 10: cache contract proof** — *Small*
  - `test/fake-redis.ts` + `test/entries-cache.e2e-spec.ts` (pattern:
    `note-service/test/notes-cache.e2e-spec.ts`).
  - Acceptance: cached values contain `enc.v1.` and no known plaintext; a write bumps the
    generation and a subsequent read misses; a cache error falls open to the loader.
  - `docs/specs/MAP-redis.md` gains the `meal-cache` module row and `redis-meal` instance
    (ownership, not presence — lesson 0011); this task is the owning task for that map update.
  - Verify: `npm run test:unit -w apps/meal-service -- test/entries-cache.e2e-spec.ts`
  - Files: `apps/meal-service/test/{fake-redis.ts,entries-cache.e2e-spec.ts}`, `docs/specs/MAP-redis.md`

- [ ] **Task 11: saved meals (frozen snapshots)** — *Medium*
  - `saved-meal.entity.ts`, `saved-meal-item.entity.ts`, `dto/`, `saved-meals.service.ts`,
    `saved-meals.controller.ts` (`@Controller('api/saved-meals')` — the repo's `api/<noun>`
    convention, as `notes.controller.ts`/`todos.controller.ts`: `POST /api/saved-meals` (save the
    corrected snapshot), `GET /api/saved-meals` (list — the route Task 18's list reads),
    `GET /api/saved-meals/:id` (read one — the route the BFF re-log composes from)),
    `saved-meals.module.ts`, `saved-meals-cache.ts`. Re-log is BFF composition (read the snapshot,
    then `POST /api/entries`), never a fresh Gemini guess.
  - Acceptance: saving copies the corrected values; editing the source food afterwards does not
    change the saved meal; re-logging from a saved meal does not call Gemini; user B cannot read,
    mutate, or delete user A's saved meal (`test/ownership.e2e-spec.ts` extended).
  - Cache key shape (`SPEC-meal-service.md` key table; Contract 2 Rule 3): the saved-meal cache
    adapter composes keys through `@life/cache` so the final key is
    `meal:<sub>:v<gen>:saved:<rest>` — the owner `<sub>` segment is always present, so no task
    builds an owner-colliding key.
  - Verify: `npm run test:unit -w apps/meal-service -- test/saved-meals.e2e-spec.ts test/ownership.e2e-spec.ts`
  - Files: `apps/meal-service/src/saved-meals/*`, `test/{saved-meals.e2e-spec.ts,ownership.e2e-spec.ts}`

### Checkpoint: Data layer
- [ ] Ownership isolation proven across food, entry, saved meal, target
- [ ] Cache holds ciphertext only; write invalidates the day
- [ ] `docs/specs/MAP-redis.md` updated with the `meal-cache` module and `redis-meal`

### Phase 4: Gemini photo pipeline

- [ ] **Task 12: Gemini client** — *Medium*
  - `src/photo/gemini.client.ts` (plain `fetch`; the client reads **all three** of its
    coordinates from env — `GEMINI_API_KEY`, `GEMINI_MODEL`, and the API base URL
    `GEMINI_API_BASE` (`SPEC-meal-service.md:24-25`: "Model id and API base come from env,
    never hardcoded")), with an explicit request/response schema including a **failure shape**.
  - First, verify the current endpoint, model id, image constraints, and response schema
    against official Gemini docs (`source-driven-development`); record an ADR.
  - Acceptance: a hint is passed through as steering input; the request URL is built from
    `GEMINI_API_BASE` + model + method (never a hardcoded host); a non-2xx, a timeout, or a
    schema-violating body all map to the same "could not read" result — never a partial guess;
    the key never appears in a response or a log.
  - Verify: `npm run test:unit -w apps/meal-service -- test/gemini.client.test.ts`
  - Files: `apps/meal-service/src/photo/gemini.client.ts`, `test/{gemini.client.test.ts,fake-gemini.ts}`, `docs/specs/MAP-meal-nutrition.md` (Decision log entry — ADR-style decisions live in the map's Decision log; there is no `adr-*` file convention in this repo)

- [ ] **Task 13: photo endpoint** — *Small*
  - `dto/estimate-photo.dto.ts`, `photo.service.ts`, `photo.controller.ts`
    (`@Controller('api/estimates')` — the repo's `api/<noun>` convention, as
    `notes.controller.ts`/`todos.controller.ts`: `POST /api/estimates/photo`, the ONE path string
    Task 17's server action posts to), `photo.module.ts`. The client posts the image bytes plus the
    optional hint string (`SPEC-meal-capture-ui.md` §Code Style: a hint, if present, is sent as
    steering input — never a correction).
  - Acceptance: returns a suggestion or an explicit failure and **never writes an entry**;
    image bytes are not persisted or logged; estimate responses are not cached.
  - Verify: `npm run test:unit -w apps/meal-service -- test/photo.e2e-spec.ts`
  - Files: `apps/meal-service/src/photo/*`, `test/photo.e2e-spec.ts`

### Checkpoint: Pipeline
- [ ] Failure paths return "could not read" with no invented numbers
- [ ] No key, prompt, or image byte appears in logs, DB, or Redis

### Phase 5: UI

- [ ] **Task 14: BFF client + meals day route** — *Small*
  - `apps/app/lib/meal-api.ts` (`import 'server-only'`, `callService(MEAL_API_URL)`) and the
    meals route entry `apps/app/app/(meals)/meals/page.tsx`, which resolves "which day is now"
    by calling the **existing shared owner** `getToday()` from `@/lib/today` (lesson 0016:
    `apps/app/lib/today.ts` already owns this rule — used by the todo routes and covered by
    `apps/app/test/today.test.ts` — so no second day-derivation module is created).
  - Consume `@life/nutrition` server-side only (Task 1–4's package): add
    `"@life/nutrition": "*"` to `apps/app/package.json` `dependencies` and
    `"^@life/nutrition$": "<rootDir>/../../packages/nutrition/src/index.ts"` to its jest
    `moduleNameMapper`, mirroring the existing `^@life/ui$` entry in the same file. The
    meals UI is the unit-formatting / `%DV` consumer (`SPEC-nutrition-model.md:20`;
    `MAP-meal-nutrition.md:21`), and formatting happens **server-side only** inside the
    `server-only` BFF layer — the browser bundle must not carry `@life/nutrition` (no
    `'use client'` component imports it).
  - The same dependency must ship in the app image and the Next build:
    `apps/app/next.config.mjs` adds `@life/nutrition` to `transpilePackages`
    (`['@life/shared', '@life/ui', '@life/app-kit']` → gains `@life/nutrition`), and
    `apps/app/Dockerfile` gains `COPY packages/nutrition/package.json packages/nutrition/` before
    its build-stage `npm ci` (a workspace missing from that COPY set makes `npm ci` fail), copies
    `packages/nutrition` alongside `packages/shared`, builds it with `npm run build -w
    @life/nutrition` next to `@life/shared`, and in the runtime stage copies the package's
    `package.json` + `dist` into `node_modules/@life/nutrition/` — the same shape as the existing
    `@life/shared` safety net, so the standalone server can always require it. Regenerating the
    tracked `package-lock.json` (`npm install`) with the new `apps/app` dependency is part of this
    task, so `npm ci` in every Dockerfile stays in sync.
  - Acceptance: a route test, `apps/app/test/routes-meals-day.test.tsx`, mocks `@/lib/today`
    (`getToday`) and `@/lib/meal-api` the way `apps/app/test/routes-todos-list.test.tsx` does,
    then asserts the rendered meals day route uses the mocked day — proving the route consumes
    the shared owner instead of re-deriving it; no `new Date()` host-local day in a request
    path; `@life/nutrition` is imported only from `server-only` modules (no client component
    imports it) and resolves under jest via the mapper above.
  - Verify: `npm run test:unit -w apps/app -- test/routes-meals-day.test.tsx`; `npm run test:unit -w apps/app -- test/today.test.ts`; `npm run typecheck -w apps/app`;
    `grep -n "@life/nutrition" apps/app/next.config.mjs apps/app/Dockerfile` prints the transpile
    and copy/build lines and exits 0
  - Files: `apps/app/lib/meal-api.ts`, `apps/app/app/(meals)/meals/page.tsx` (**created here** as the minimal day route; Task 16 **extends** it and keeps `test/routes-meals-day.test.tsx` green), `apps/app/package.json`, `apps/app/test/routes-meals-day.test.tsx`, `apps/app/next.config.mjs`, `apps/app/Dockerfile`, `package-lock.json` (regenerated by `npm install` with the new dependency)

- [ ] **Task 15: photo-door upload atom (upstream)** — *Small*
  - Contract 1 Rule 3: the photo door needs a file/upload primitive that does not exist in
    `packages/ui` (`SPEC-meal-capture-ui.md` §Code Style: "otherwise a new atom goes upstream
    first"). Spec-first, then implement, then consume — never work around it in the app.
  - Spec-first: `docs/specs/SPEC-ui-atoms.md` gains the new `FilePicker` atom's entry and `docs/specs/MAP-ui-primitives.md`
    lists it under `ui-atoms` in the same change (a new atom is an "Ask first" change — recorded here).
    The atom is a generic upload control (`type="file"`, `accept="image/*"`, `capture` hint forwarded),
    owns its `ui-file-picker` classes in `atoms.css` with tokens only, never notes/meals-shaped.
  - Implement `packages/ui/src/components/file-picker.tsx` with a rendering + behavior unit test
    (same jest + jsdom + `@testing-library/react` harness as the other atoms), and export it from
    `packages/ui/src/index.ts`.
  - Acceptance: the atom renders a file input with its accessible label forwarded; the spec and
    map name it; the barrel exports it; `packages/ui` unit tests pass; no app-side markup recreates it.
  - Verify: `npm run typecheck -w packages/ui`; `npm run test:unit -w packages/ui -- test/file-picker.test.tsx`
  - Files: `packages/ui/src/components/file-picker.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/styles/atoms.css`, `packages/ui/test/file-picker.test.tsx`, `docs/specs/SPEC-ui-atoms.md`, `docs/specs/MAP-ui-primitives.md`
  - Dependencies: none (additive to `ui-atoms`); blocks Tasks 16 and 17.

- [ ] **Task 16: day view (total vs target)** — *Medium*
  - `app/(meals)/meals/page.tsx` (**extends** Task 14's minimal day route — Task 14 creates it;
    this task keeps `apps/app/test/routes-meals-day.test.tsx` green and may adjust its fixtures,
    not the `getToday()` assertion it makes) + `[date]/…`: total/target/remaining, meal groups,
    the three doors, empty state. Primitives only (`PageShell`, `PageTitle`, `Card`, `List`/`ListItem`,
    `EmptyState`, `FabLink`/`IconLink`, `StatusText`, and Task 15's upload atom for the photo door).
    This task also owns the meals mount identity: `apps/app/app/(meals)/meals/layout.tsx` mirrors
    `apps/app/app/todos/layout.tsx` file-for-file — `RouteLayout` +
    `routeLayoutMetadata('/manifest-todos.json', 'Todos', '/icon-todos.png')` with a
    `SnackbarProvider` — reusing the app's **existing** manifest/icon constants. Per the locked
    decision above, **no new `public/manifest-meals.json`** is created (frozen surface; the user is
    unavailable, so the existing identity is reused).
  - Acceptance: total is the sum of confirmed entries; three doors all reachable (photo →
    `/meals/entry/new?door=photo`, manual → `/meals/entry/new`, saved → `/meals/saved`; the upload
    atom itself is composed on Task 17's editor page, which the photo door opens); zero raw
    elements; no app-local CSS;
    dates rendered via the shared helper; the meals mount carries the existing manifest/icon
    constants and the `SnackbarProvider`, with no frozen surface changed.
  - Verify: `npm run typecheck -w apps/app`; `npm run test:unit -w apps/app -- test/meal-day-view.test.tsx`; `npm run test:unit -w apps/app -- test/routes-meals-day.test.tsx`;
    `grep -rnE "<(button|input|textarea)\b" 'apps/app/app/(meals)/meals/page.tsx' 'apps/app/app/(meals)/meals/[date]/page.tsx'` prints no lines (exit 1 is the expected outcome: the upload atom lives on Task 17's editor page, not here)
  - Files: `apps/app/app/(meals)/meals/{layout.tsx,page.tsx,[date]/page.tsx}`, `apps/app/test/meal-day-view.test.tsx`, `apps/app/test/routes-meals-day.test.tsx` (Task 14 creates it; this task keeps it green)
  - Dependencies: Task 14 (creates `meals/page.tsx`; this task only extends it), Task 15.

- [ ] **Task 17: review-correct editor** — *Medium*
  - `entry/[id]/…` + server actions: edit portions, delete/re-add items, save; corrected values
    are the ones persisted. This task owns the **photo door's POST → pre-opened flow** (the BFF
    side): a client-side editor component mounts Task 15's upload `FilePicker` for the image plus
    an **optional hint `Textarea`** (`SPEC-meal-capture-ui.md` §Code Style: hint is steering input,
    never a correction), and the server action reads both from the form data, then posts the bytes
    (+ hint) to Task 13's one path string `POST /api/estimates/photo` — a single call site through
    `lib/meal-api.ts`, no second client, and the hint `Textarea` never doubles as the editor's
    correction field. Success branch: the returned suggestion becomes the editor's starting item
    values, ready to correct-then-save. Failure branch (explicit "could not read" shape, non-2xx,
    timeout): the editor opens in **manual mode — pre-opened and empty**, with no fabricated
    numbers. Includes the **save-as-meal control** — a "Save as meal" action on
    the review editor that posts the current corrected item set to Task 11's
    `POST /api/saved-meals`, making the intent's "correct once, re-log in one
    tap" flow real (the snapshot is created from the editor, not invented). The control is
    composed from `@life/ui` primitives (a `Button`/`Pill` variant), never a raw `<button>`.
  - Acceptance: a corrected portion changes the day total; cropping/removing an item works; the
    photo upload + optional hint posts to `POST /api/estimates/photo` (the one path string Task 13
    owns); a
    failed photo opens manual entry with an empty meal and **no fabricated numbers**; an
    estimated-but-unknown value renders the model's explicit "unknown" affordance — an em dash
    (`—`) from the `@life/nutrition` formatter — and **never a fabricated `0`**
    (`SPEC-meal-capture-ui.md` §Code Style, intent "must never invent numbers"); **clicking
    "Save as meal" calls `POST /api/saved-meals` and creates a saved meal whose items match the
    corrected snapshot** — the fixture Task 18 lists and Task 20's "saved meal re-logs the
    snapshot" assertion consumes.
  - Verify: `npm run test:unit -w apps/app -- test/meal-editor.test.tsx`; `grep -n "api/estimates/photo" apps/app/lib/meal-api.ts` prints the shared path string and exits 0
  - Files: `apps/app/app/(meals)/meals/entry/[id]/{page.tsx,actions.ts}`, `apps/app/lib/meal-api.ts` (Task 14 creates it; this task adds the photo-estimate + save-as-meal calls), `apps/app/test/meal-editor.test.tsx`
  - Dependencies: Task 11 (`POST /api/saved-meals`), Task 13 (`POST /api/estimates/photo`), Task 15 (upload atom), Task 16 (group layout).

- [ ] **Task 18: saved meals UI** — *Small*
  - `saved/…`: list + one-tap re-log (`app/(meals)/meals/saved/page.tsx` renders the list; its
    one-tap re-log composes `GET /api/saved-meals/:id` then `POST /api/entries` through a server
    action in `app/(meals)/meals/actions.ts` — the module's server-actions file per
    `SPEC-meal-capture-ui.md:43` — calling into the BFF client `apps/app/lib/meal-api.ts`
    (Task 14 creates it; this task adds the saved-meal read + entry-create calls). Re-log is
    BFF composition of the Task 11 snapshot — never a fresh Gemini guess.
  - Acceptance: re-logging logs the snapshot values; one tap from the saved list.
  - Verify: `npm run test:unit -w apps/app -- test/meal-saved.test.tsx`
  - Files: `apps/app/app/(meals)/meals/saved/page.tsx`, `apps/app/app/(meals)/meals/actions.ts`, `apps/app/lib/meal-api.ts` (Task 14 creates it; this task adds the saved-meal read + entry-create calls), `apps/app/test/meal-saved.test.tsx`

- [ ] **Task 19: target onboarding UI** — *Small*
  - `target/…`: profile form → derived target, with the derivation explained.
  - Acceptance: submitting the profile shows a derived target; the client never sends kcal.
  - Verify: `npm run test:unit -w apps/app -- test/meal-target.test.tsx`
  - Files: `apps/app/app/(meals)/meals/target/page.tsx`, `apps/app/test/meal-target.test.tsx`

- [ ] **Task 20: E2E spec** — *Medium*
  - `test/e2e/meals.spec.ts` — one `test.describe('meals day view', …)` block covering: three
    doors reachable; photo failure → manual entry with no invented numbers; correct-then-save
    persists the corrected vector; saved meal re-logs the snapshot (the saved-meal fixture is
    created via Task 17's "Save as meal" control, then re-logged in one tap); day total equals
    the sum of confirmed entries. This task also wires the harness so it actually runs
    `meal-service` (all real, runnable): `apps/app/test/e2e/config.ts` gains a `mealPort` in
    `testPorts()` (`E2E_MEAL_PORT ?? 3106`) and in `devPorts()` (`E2E_DEV_MEAL_PORT ?? 3206`);
    `apps/app/test/e2e/stack.ts` gains `StackConfig.mealPort`, a `mealEnv(cfg)` mirroring
    `todoEnv` (harness-scoped `DB_PATH` under the stack state dir, `MEAL_MASTER_KEY` from the
    shared harness constant), the `await build('apps/meal-service')` + spawn block, the `/health`
    wait, and a `MEAL_API_URL` line in `appEnv`. **Both stacks, one task.** Both `global-setup.ts`
    and `global-setup.dev.ts` destructure and pass `mealPort` through their existing `cfg`; the
    two spec readers (`testPorts()`/`devPorts()` call sites) keep working unchanged; the three
    non-meal environments keep working unchanged (no existing harness surface is renamed).
  - Acceptance: the spec passes as a single-spec run with the `-g` filter naming that block's
    exact title (`meals day view`); no frozen selector was changed; the single-spec run reaches
    `meal-service` through the stack-supplied `MEAL_API_URL` (no loopback fallback).
  - Verify: `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/meals.spec.ts -g "meals day view"`; `grep -n "mealPort" apps/app/test/e2e/config.ts apps/app/test/e2e/stack.ts apps/app/test/e2e/global-setup.ts apps/app/test/e2e/global-setup.dev.ts` and `grep -n "MEAL_API_URL" apps/app/test/e2e/stack.ts` print the wiring lines and exit 0
  - Files: `apps/app/test/e2e/meals.spec.ts`, `apps/app/test/e2e/config.ts`, `apps/app/test/e2e/stack.ts`, `apps/app/test/e2e/global-setup.ts`, `apps/app/test/e2e/global-setup.dev.ts` (both setups must destructure and pass `mealPort` through their existing `cfg`, or `StackConfig` typechecking breaks)
  - Dependencies: Task 5 (boots the binary this stack spawns), Task 14 (BFF the spec drives).

### Checkpoint: UI
- [ ] Contract 1 mechanical greps return zero hits in meals code
- [ ] The harness boots `meal-service` before the app: `testPorts()`/`devPorts()` carry `mealPort`,
      `stack.ts`'s `mealEnv` spawns it and `appEnv` sets `MEAL_API_URL` (Task 20's wiring)
- [ ] Single-spec E2E passes

### Phase 6: Wiring and docs

- [ ] **Task 21: dev/prod wiring** — *Small*
  - Root `dev` script runs meal-service on `:3106` (`npm:dev -w apps/meal-service`, with the
    other services' `-n`/`-c` pairs). `.env.development.example` gains `MEAL_API_URL`,
    `MEAL_MASTER_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE`, and the audience-map
    entry — but **no `REDIS_URL`** (dev/e2e runs Redis-free: unset is the direct-DB path;
    `MAP-redis.md:21-23`, `.env.example` "No Redis keys belong here… Leaving it unset in
    dev/e2e").
  - `compose.yaml` gains four things:
    1. the `meal-service` service block — `build.context: .`, `build.dockerfile:
       apps/meal-service/Dockerfile` (the image Task 5 builds; Task 21 only *references* it),
       `env_file: .env`, `PORT: "3106"`, `HOST: 0.0.0.0`, `DB_PATH: /data/meal.db`,
       `IDP_ISSUER`, `MEAL_IDP_JWKS_URL: ${MEAL_IDP_JWKS_URL:-http://idp:3003/jwks}`,
       `MEAL_SERVICE_AUDIENCE: ${MEAL_SERVICE_AUDIENCE:-life-api}`,
       `MEAL_MASTER_KEY: ${MEAL_MASTER_KEY:?...}` (fail-fast, mirroring `NOTE_MASTER_KEY`),
       `GEMINI_API_KEY: ${GEMINI_API_KEY:-}`, `GEMINI_MODEL: ${GEMINI_MODEL:-}`,
       `GEMINI_API_BASE: ${GEMINI_API_BASE:-}`, `REDIS_URL: redis://redis-meal:6379`, the
       `./apps/meal-service/data:/data` volume, `depends_on: redis-meal` (condition
       `service_healthy`), `networks: [life]`, and the readiness healthcheck
       (`/health/ready`, `:3106`) exactly shaped like the note-service block.
    2. the `app` service's `MEAL_API_URL: http://meal-service:3106` environment line, alongside
       `API_URL`/`TAGS_API_URL`/`TODO_API_URL` and `depends_on: meal-service` (condition
       `service_healthy`). Without it `apps/app/lib/meal-api.ts`'s
       `callService(process.env.MEAL_API_URL, …)` falls back to container-local loopback and
       every meal call dies inside the app container (the `compose.yaml:191-193` warning).
    3. the dedicated `redis-meal` instance (image `redis:8-alpine`, `--save "" --appendonly no
       --maxmemory 64mb --maxmemory-policy allkeys-lru`, `life` network, `redis-cli ping`
       healthcheck, `restart: unless-stopped`) — one instance per service (lesson 0011).
    4. an `OIDC_AUDIENCE_MAP` entry `https://meal-service=life-api` in the two places this
       entry actually lives — the `compose.yaml:153` IdP `OIDC_AUDIENCE_MAP` default and the
       tracked env templates (`.env.example:43` and `.env.development.example:83`). There is no
       third, app-side audience config to edit (`grep -rni wif` returns zero hits; the app uses
       the single `OIDC_APP_RESOURCE: ${OIDC_APP_RESOURCE:-https://note-service}` line).
  - Two further **stale enumerations** move with the sixth instance (both files already in this
    task's Files): `compose.yaml`'s Redis-section comment (`compose.yaml:227-231`, "One instance
    per service (app, idp, note, tags, todo)") gains `meal`; `.env.example`'s Redis comment
    (`:83-85`, which enumerates `redis://redis-{app,idp,note,tags,todo}:6379`) gains
    `redis://redis-meal:6379`. A five-instance list beside a sixth instance is the stale map
    lesson 0011 was written about.
  - The per-service master-key enumerations gain the meal key too: `.env.example:63-66` (already
    `# TAGS_MASTER_KEY=` / `# TODO_MASTER_KEY=` under the `openssl rand -base64 32` comment) gains
    `# MEAL_MASTER_KEY=`, and `.env.development.example:28-29` gains the same commented line.
    `.env.example` is the production template the fail-fast
    `MEAL_MASTER_KEY: ${MEAL_MASTER_KEY:?...}` in item 1 reads from; without the documented line
    the operator cannot know the key exists.
  - `REDIS_URL` is the repo's one per-service env-var name (`MAP-redis.md:21`), not a
    `MEAL_`-prefixed variant; at most it may appear **commented** in `.env.development.example`
    as a prod-only knob, mirroring the commented `NOTE_MASTER_KEY` there. In production it is
    **injected in the `meal-service` compose block** (e.g. `REDIS_URL: redis://redis-meal:6379`),
    never read from `.env`.
  - Acceptance: `compose.yaml` defines the `meal-service` block (dockerfile, `:3106`,
    `MEAL_MASTER_KEY`, audience, `depends_on: redis-meal`, network, healthcheck) and the
    `redis-meal` service; the `app` block sets `MEAL_API_URL`; the IdP audience map routes
    `https://meal-service` to `life-api`; `.env.development.example` lists `MEAL_API_URL`,
    `MEAL_MASTER_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE`, and the audience map,
    with **no uncommented `REDIS_URL`**; `.env.example`'s `OIDC_AUDIENCE_MAP` includes
    `https://meal-service=life-api`; **no five-instance Redis list survives** — `compose.yaml`'s
    Redis-section comment and `.env.example`'s Redis comment both name `redis-meal` (six
    instances) — and both master-key blocks carry `# MEAL_MASTER_KEY=` beside the
    `openssl rand -base64 32` comment.
  - Verify: `npm run typecheck`; automated wiring greps — `grep -n "meal-service" compose.yaml`,
    `grep -n "dockerfile: apps/meal-service/Dockerfile" compose.yaml`,
    `grep -n "redis-meal" compose.yaml`, `grep -n "MEAL_API_URL" compose.yaml`,
    `grep -n "GEMINI_API_BASE" .env.development.example`,
    `grep -n "meal-service=life-api" .env.example`,
    `grep -n "redis-meal" .env.example`, and
    `grep -n "MEAL_MASTER_KEY=" .env.example .env.development.example` each print the expected lines and exit 0;
    `grep -nE "^[^#]*REDIS_URL" .env.development.example` prints no lines (exit 1 — expected:
    dev/e2e stays Redis-free). Manual follow-up (not automatic): `npm run dev` from the repo
    root starts meal-service on `:3106` alongside the other services — run by the human, not a
    CI check.
  - Files: `package.json`, `.env.development.example`, `.env.example`, `compose.yaml`
  - Dependencies: Task 5 (the service skeleton and its `apps/meal-service/Dockerfile`, which this
    task references — it does not author it), Task 10 (the `redis-meal` cache wiring this task
    exposes), Task 12 (the Gemini env vars it injects).

- [ ] **Task 22: docs** — *Small*
  - `docs/specs/MAP-meal-nutrition.md` status, `MAP-redis.md` (owned by Task 10, not re-edited here),
    and a README/runbook touching the service. Concretely, `docs/intent/architecture.md`'s
    "Layout" list gains the third service entry — `apps/meal-service` — NestJS REST API on
    `:3106`, SQLite via `@life/db`, owner-scoped (`@life/meal-service`) — so the repo-vision doc
    names the service this chapter ships. The runbook names the service's full env surface,
    including `GEMINI_MODEL` and `GEMINI_API_BASE`. The Gemini model id/schema decision was
    recorded in the map's Decision log at Task 12 — this task reads it back, it does not
    introduce a new file.
  - Acceptance: the map names the shipped modules; the map's Decision log records the model
    id/schema decision; `docs/intent/architecture.md`'s Layout section names `apps/meal-service`;
    the runbook names the service's env vars and start command.
  - Verify: `grep -n "meal-nutrition" docs/specs/MAP-meal-nutrition.md`,
    `grep -n "apps/meal-service" docs/intent/architecture.md`, and
    `grep -n "MEAL_API_URL\|GEMINI_MODEL\|GEMINI_API_BASE" docs/runbooks/deploy-meal-nutrition.md` each print
    the expected lines and exit 0 — the same observable-outcome check style as Task 21's
    wiring grep.
  - Files: `docs/specs/MAP-meal-nutrition.md`, `docs/runbooks/deploy-meal-nutrition.md`, `docs/intent/architecture.md`

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] §7 lifecycle complete; five-lane gate returns N/N PASS

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini guess accuracy is poor | High (product value) | The correction step and saved meals are the mitigation; never skip review |
| Photo of a home kitchen leaks | High (privacy) | Image bytes never persisted/logged; server-side only |
| Unit table drifts between service and UI | High (silent wrong numbers) | One owner: `@life/nutrition`, consumed by both |
| Host-clock "today" wrong for UTC+7 | Medium | Client-zone day via the shared owner `apps/app/lib/today.ts` (`getToday()`); midnight-boundary covered by `apps/app/test/today.test.ts` |
| Cache wired to a shared Redis | Medium | Dedicated `redis-meal`; `MAP-redis.md` updated in the same change |
| Spec silently overwrites a locked decision | Medium | The Governing decisions table is checked by the plan validator |
| Scope creep (barcode, trends, import) | Low | Explicitly out of scope in the intent doc |

## Open Questions

Resolved by the plan's Task 12 doc check rather than guessed here: the exact Gemini model id,
endpoint, image size/MIME limits, and response schema. No user input required.
