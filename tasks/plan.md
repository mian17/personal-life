Produced by planning-and-task-breakdown; source spec: docs/specs/MAP-meal-food-management.md,docs/specs/SPEC-food-units.md,docs/specs/SPEC-food-catalog-ui.md,docs/specs/SPEC-manual-log-ui.md
# Implementation Plan: meal-food-management (catalog CRUD + manual log)

## Overview
Add Lose It!-model units to the existing `api/foods` surface (one canonical `g|ml` per food, explicit-amount measures, server-derived vectors), then ship two UI doors on it: `/meals/foods` catalog CRUD behind a nav icon, and a `door=food` manual log via a FAB menu. No new service, no photo-path change, no entry-nutrient editing.

## Architecture Decisions
- Extend `apps/meal-service/src/foods/` in place; DB column `serving.grams` stays (rename is wire-only `amount`, `ponytail:` defer migration).
- `unit` create-whitelist only; immutability is the existing `forbidNonWhitelisted` pipe, asserted by test not code.
- Measure vectors derived server-side with `@life/nutrition` `scale()`; client never sends vectors.
- `quantity = amount / servingGrams` (measure: `count*amount / servingGrams`); snapshot `scale(food, quantity)` client-side before confirm.
- UI composes `@life/ui` only; one upstream gap `FabMenu` lands in `packages/ui` with spec-registry updates in the same change.
- Day-view row meta `× {quantity}` unchanged (frozen); only FAB selector moves link→menu option, photo keeps name `Log meal from photo`.

## Task List
1. Task 1: food-units backend contract (entity + DTOs + service + cache row shape)
2. Task 2: BFF food wire shapes in `apps/app/lib/meal-api.ts`
3. Task 3: food-units behavioural tests (contract proof)
4. Task 4: catalog list + search + nav entry (`/meals/foods`)
5. Task 5: catalog create/edit/delete form + server actions
6. Task 6: upstream `FabMenu` block in `packages/ui`
7. Task 7: manual-log door (FAB menu + picker + editor seeding)
8. Task 8: e2e journeys + frozen-surface / Contract 1+2 mechanical gates

### Checkpoint A: after Tasks 1-3 (contract frozen, both UIs unblocked)
### Checkpoint B: after Task 5 (catalog usable, creates the food Task 7 logs)
### Checkpoint C: after Task 8 (ship gate)

---
## Task 1: food-units backend contract (entity + DTOs + service + cache row shape)
[TASK OBJECTIVE] Land the Lose It! unit model on the existing `api/foods` surface with no migration and no new service.
[SCOPE & REPOSITORY CONTEXT] `apps/meal-service/src/foods/`: `food.entity.ts`, `serving.entity.ts` (doc-comment only), `dto/create-food.dto.ts`, `dto/update-food.dto.ts` (unchanged set, verified), `foods.service.ts`, `foods-cache.ts`. Plus the rename-driven fixture touch in `apps/meal-service/test/foods-search.test.ts` (one line: `grams: 50` → `amount: 50` at ~L139 — the `ServingInputDto.grams→amount` wire rename would otherwise 400 under the global `forbidNonWhitelisted` pipe). Consumed by Tasks 2/4/7; nothing else reads these rows.
[IMPLEMENTATION REQUIREMENTS] `Food.unit` column `'g'|'ml'` default `'g'`; `CreateFoodDto.unit` optional with default, `ServingInputDto.grams→amount` (`@Min(1) @Max(GRAMS_MAX)`, doc-comment cites no-g↔ml rule); `UpdateFoodDto` gains nothing; `FoodDto/ServingDto` expose `unit`/`amount` mapped from `grams` column; `servingVector()` unchanged (`scale(base, amount/servingGrams)`); `normalizePortions` keys `label+amount`; `toDto/toCachedFoodRow` carry `unit` plaintext, content stays `enc.v1.`; reads stay `cache.getThrough`, writes `BE→DB→bump`. Cache plan: keys `meal:<sub>:v<gen>:food:<rest>` unchanged, `q` never in key, per-owner isolation; `CachedFoodRow +unit` plaintext, `CachedServingRow.grams` keeps column name; bump on create/update/delete; fail-open. Never: ownerSub from body, client-sent vectors, g↔ml conversion, entry recompute, `@life/nutrition` change.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/meal-service`; unit-test: `npm run test:unit -- foods-search.test.ts` in `apps/meal-service` (regression on the touched foods module — includes the rename-driven fixture touch above, so the suite posts `amount` and proves everything else in the suite; the new behavioural proofs land in Task 3, `foods-units.test.ts`) (max 2 runs). No e2e in this task.
[DEFINITION OF DONE] `POST {unit:'ml',servingGrams:100,nutrients:V,portions:[{label:'1 carton',amount:1000}]}` round-trips `unit/amount` with measure vector `scale(V,10)`; PATCH with `unit` is 400; ml amounts survive verbatim; cache rows sealed except `unit`.

## Task 2: BFF food wire shapes in `apps/app/lib/meal-api.ts`
[TASK OBJECTIVE] Expose the Task 1 contract to the app with one owner per bound.
[SCOPE & REPOSITORY CONTEXT] `apps/app/lib/meal-api.ts` (server-only BFF; browser never calls meal-service) plus the required-field fixture updates: add `unit: 'g'` to the `MealFood` fixtures in `apps/app/test/meal-editor.test.tsx` (object literals at ~L446/486/565/599/635 and the `food()` helper at ~L953), `apps/app/test/meal-day-view.test.tsx` (the `food()` helper at ~L47), and `apps/app/test/meal-saved.test.tsx` (the `food()` helper at ~L76) — fixture values only, no assertion changes. Unblocks Tasks 4/5/7; `food-units` owns the shapes, this task only mirrors them.
[IMPLEMENTATION REQUIREMENTS] `MealFood +unit: 'g'|'ml'` (required — mirrors the wire field, which is always present); `ServingDto.grams→amount`; declare and export bounds `FOOD_NAME_MAX = 120, SERVING_LABEL_MAX = 60, PORTIONS_MAX = 20, AMOUNT_MAX = GRAMS_MAX = 5000` mirroring the service constants' values (`apps/meal-service/src/foods/dto/create-food.dto.ts`) with a doc-comment citing that service owner — the existing `FOOD_ID_MAX` pattern in this same file (lesson 0016: one owner for the value); app code (Task 4) imports the bounds from `meal-api.ts`, no local respell outside `meal-api.ts` and no import edge from `apps/app` to `apps/meal-service`; `listMealFoods(q?)`, `createMealFood({name,servingGrams:100,nutrients,unit,portions})`, `updateMealFood(id,{name,nutrients,portions,expectedVersion})` (no `unit`), `deleteMealFood(id)`; `restoredFoodName` unchanged. Never send `ownerSub` or measure vectors.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/app`; unit-test: `npm run test:unit -- meal-editor.test.tsx` in `apps/app` (imports `@/lib/meal-api`, so it compiles against the mirrored `unit`/`amount` shapes; includes the fixture updates above, so this is the conformance run) (max 2 runs).
[DEFINITION OF DONE] Catalog/manual-log call sites compile against `unit`/`amount` with zero raw fetch to meal-service and the four bounds imported from `meal-api.ts` (the single app-side owner).

## Task 3: food-units behavioural tests (contract proof)
[TASK OBJECTIVE] Prove AC1-AC5 of SPEC-food-units so UI tasks build on a frozen contract.
[SCOPE & REPOSITORY CONTEXT] `apps/meal-service/test/foods-units.test.ts` (new, follows `foods-search.test.ts`) and `apps/meal-service/test/foods-cache.e2e-spec.ts` (new foods cache suite; mirrors `entries-cache.e2e-spec.ts` and `apps/note-service/test/notes-cache.e2e-spec.ts`). Touches tests only; no production file changes.
[IMPLEMENTATION REQUIREMENTS] `foods-units.test.ts` covers: `unit` round-trip + default `'g'`; PATCH `unit`→400 and PATCH name/facts/measures keeps `unit` byte-identical; measure vector `= scale(base, amount/servingGrams)` exactly; verbatim amounts; post-edit food leaves `entry` rows byte-identical. `foods-cache.e2e-spec.ts` covers the SPEC-food-units SC4 cache assertion: cached rows contain `enc.v1.` for `name`/`label`/`nutrients` and no known plaintext, with `unit` present and plaintext by design. Two suites, no new harness: both reuse the existing patterns (`test/fake-redis.ts`, repository fake, `@life/crypto` DEK over a spy `KeysService`) — `foods-cache.e2e-spec.ts` is the `entries-cache.e2e-spec.ts` shape applied to `FoodsCache`/`toCachedFoodRow`/`isCiphertextFoodRow`, which exist in `apps/meal-service/src/foods/foods-cache.ts` today.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/meal-service`; unit-test (two runs, within `max-test-runs: 2`): run 1 `npm run test:unit -- foods-units.test.ts`, run 2 `npm run test:unit -- foods-cache.e2e-spec.ts`, both in `apps/meal-service`.
[DEFINITION OF DONE] Both prescribed runs green within budget (`foods-units.test.ts` contract proofs + `foods-cache.e2e-spec.ts` cached-row ciphertext assertion, SC4); all SPEC-food-units Success Criteria 1-5 met; failures cite the contract, not the UI.

## Task 4: catalog list + search + nav entry (`/meals/foods`)
[TASK OBJECTIVE] Reachable read door: nav Foods icon → searchable owner catalog.
[SCOPE & REPOSITORY CONTEXT] `apps/app/app/meals-nav.tsx` (+`IconLink` Foods), `apps/app/app/(meals)/meals/foods/page.tsx` (new), `apps/app/test/meal-foods.test.tsx` (new — nav link role+name, list renders, search filters), reuses `lib/meal-api.ts` Task 2. `apps/app/test/e2e/**` is outside this task's blast radius — Task 8 owns all e2e. Primitive reuse plan: `ManagerBlock` page, `SearchField` (q, post-decrypt in-memory), `List/ListItem` (title=name, meta=`per 100 {unit} · {format calories}`), `EmptyState`, `ButtonLink` to `new`, `AlertBanner` on error.
[IMPLEMENTATION REQUIREMENTS] Route in `(meals)` group; server component fetches `listMealFoods(q)`; frozen accessible name `Foods`; nutrient strings via `@life/nutrition` `format`; bounds imported from `meal-api.ts`; no `estimatePhoto`/Gemini/USDA import; no raw elements/`next/link`/inline style/raw colour.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/app`; unit-test: `npm run test:unit -- meal-foods.test.tsx` in `apps/app` (nav link role+name, list renders, search filters) (max 2 runs).
[DEFINITION OF DONE] One tap on Foods opens `/meals/foods`; list shows owner foods with search; Contract 1 greps zero hits in these files. Proof level for this task is unit-only: the browser journey over these flows is Task 8's definition of done — never write or run Playwright here, and never demand browser proof in this task's verification.

## Task 5: catalog create/edit/delete form + server actions
[TASK OBJECTIVE] Hand-typed per-100 facts + explicit-amount measures CRUD; edit/delete never rewrites history.
[SCOPE & REPOSITORY CONTEXT] `apps/app/app/(meals)/meals/foods/new/page.tsx`, `apps/app/app/(meals)/meals/foods/[id]/page.tsx`, `apps/app/app/(meals)/meals/foods/food-form.tsx` (shared client form), `apps/app/app/(meals)/meals/actions.ts` (+create/update/delete), extends `test/meal-foods.test.tsx`. `apps/app/test/e2e/**` is outside this task's blast radius — Task 8 owns all e2e. Primitive reuse plan: `EditorChrome/EditorToolbar` frame, `Input`s grouped by editor field groups (pre-filled `0`), unit as `Select g/ml` on create / `StatusText` read-only on edit, measures as `Row`s of `Input+IconButton` remove capped at `PORTIONS_MAX`, `ConfirmButton` delete, `AlertBanner`/`EmptyState`.
[IMPLEMENTATION REQUIREMENTS] Create posts one `POST` with `servingGrams:100`, typed 27-field vector (missing=0 stored semantics, `completeVector` rule server-side), zero+ measures; edit PATCHes `{name,nutrients,portions,expectedVersion}` with no `unit`; delete confirm→`DELETE`→list; actions revalidate `/meals/foods` (+day after delete irrelevant); never model-fill, never send measure vectors/`ownerSub`/computed fields.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/app`; unit-test: `npm run test:unit -- meal-foods.test.tsx` in `apps/app` (unit read-only, PATCH stub carries no `unit`, measure add/remove bounds, no-model-fill grep assertion, delete leaves fixture day totals identical) (max 2 runs).
[DEFINITION OF DONE] "Milk, Brand X" ml + per-100 facts + "1 carton"=1000 persists and reads back identical; edit bumps `version+1` without `unit`; delete removes row with entries/totals byte-identical — each proven in the unit suite at fixture/service level (mocked BFF boundary is acceptable proof here); the browser proof of these flows is Task 8's Run 2 and never this task's obligation.

## Task 6: upstream `FabMenu` block in `packages/ui`
[TASK OBJECTIVE] Fill the one primitive gap upstream (never hand-rolled in app): FAB trigger visuals + link-option panel.
[SCOPE & REPOSITORY CONTEXT] `packages/ui/src/components/fab-menu.tsx` (new), `packages/ui/src/styles/blocks.css` (`.ui-fab-menu` reusing fab/menu idioms), `packages/ui/src/index.ts` (barrel), `packages/ui/test/fab-menu.test.tsx`, plus same-change registry `docs/specs/SPEC-ui-blocks.md` + `docs/specs/MAP-ui-primitives.md`. Primitive reuse plan: `FabLink` trigger visuals + `Menu` open/Escape/outside-click semantics; options are app `IconLink`-equivalent anchors, not new visuals.
[IMPLEMENTATION REQUIREMENTS] Controlled `open/onOpenChange`, trigger `aria-label`, panel `role=menu` with link options, Escape/outside-click close, focus-visible parity with `FabLink`; tokens only, no raw colours; register in MAP + block spec table in same commit.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `packages/ui`; unit-test: `npm run test:unit -- fab-menu.test.tsx` in `packages/ui` (open/close, Escape, two options render as links) (max 2 runs).
[DEFINITION OF DONE] `FabMenu` exported, styled by tokens, tested, and registered in both spec docs; app Task 7 composes it with zero app-local FAB CSS.

## Task 7: manual-log door (FAB menu + picker + editor seeding)
[TASK OBJECTIVE] Few-tap staple log: pick food × amount → seeded editor → group+date → confirmed snapshot; photo door untouched.
[SCOPE & REPOSITORY CONTEXT] `apps/app/app/(meals)/meals/day.tsx` (`FabLink`→`FabMenu`), `apps/app/app/(meals)/meals/entry/[id]/food-picker.tsx` (new client step), `apps/app/app/(meals)/meals/entry/[id]/editor.tsx` (`door=food` seeding), `apps/app/app/(meals)/meals/entry/[id]/page.tsx` (pass `door`), `apps/app/test/meal-log.test.tsx` (new — 250ml→2.5, carton 1000×1→10, 0.5/1/2 linearity, seeded `known`, empty-catalog EmptyState), `lib/meal-api.ts` read path only. Primitive reuse plan: `FabMenu` (Task 6) with `Log meal from photo` + `Log food`; picker `SearchField+List/ListItem`; amount `Input` (own-unit `StatusText`) + measures `PillGroup` (`Pill as=button`); group/date existing editor controls (`getToday()` default); confirm via `EditorScreen/EditorToolbar+Button/PageActions`; empty→`EmptyState`+`ButtonLink /meals/foods`.
[IMPLEMENTATION REQUIREMENTS] `loggedQuantity = (measure? count*measure.amount : value)/food.servingGrams`; snapshot `scale(food,quantity)` via `@life/nutrition` only; seed exactly one `EditorItem` (`foodId`, real numbers, headline+all `known`, never estimated fingerprint/unknown affordance); keep review-before-save, single `POST /api/entries {date,mealGroup,foodId,quantity,nutrients}`; no unit toggle/conversion, no second save path, no `estimatePhoto`/Gemini/USDA, no `× quantity` meta-text change, photo selector text verbatim.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in `apps/app` (and `packages/ui` if touched); unit-test (two runs, within `max-test-runs: 2`): run 1 `npm run test:unit -- meal-log.test.tsx`, run 2 `npm run test:unit -- meal-editor.test.tsx`, both in `apps/app` (250ml→2.5, carton 1000×1→10, 0.5/1/2 linearity, seeded `known`, empty-catalog EmptyState).
[DEFINITION OF DONE] FAB opens two doors with photo name intact; picker logs `quantity`+`scale` snapshot correctly; seeded item reviews/saves through the existing path; history preserved on later food edit/delete. Proof level for this task is unit-only: the browser journey over these flows is Task 8's definition of done — never write or run Playwright here, and never demand browser proof in this task's verification.

## Task 8: e2e journeys + frozen-surface / Contract 1+2 mechanical gates
[TASK OBJECTIVE] Prove the intent's success steps end-to-end and lock the frozen/contract surfaces.
[SCOPE & REPOSITORY CONTEXT] `apps/app/test/e2e/meals.spec.ts` (+foods journey, +manual-log journey, FAB selector update only) and review-time greps. Depends on Tasks 4/5/7 (needs a created food to log).
[IMPLEMENTATION REQUIREMENTS] e2e: Foods icon→`/meals/foods` path; create "Milk, Brand X" ml+facts+carton and read back `GET /api/foods/:id`; log 250ml into breakfast/today and assert entry `quantity:2.5` + day total includes `scale(V,2.5)`; edit/delete food leaves logged entry+totals byte-identical. Name the two new journeys exactly `the foods catalog door adds, edits, and deletes a staple` and `the manual log door records a catalog staple in a few taps`, both inside `apps/app/test/e2e/meals.spec.ts`, so the verification below targets them by `-g`. Mechanical: `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'` zero new hits; `grep -rn "next/link" apps` zero; raw colour grep hits only `tokens.css`; `grep -riE "note|trash|tag-chip" packages/ui/src` zero in code; Contract 2: `grep -rln "getThrough" apps/*/src` shows the read path through the cache, ciphertext cache assertion green (`foods-cache.e2e-spec.ts`), `grep -rn "## Cache Rules" docs/specs/SPEC-*.md` shows one section per backend service spec (`SPEC-food-units.md` does), and no content matching in SQL over encrypted columns — the `q` filter runs in memory post-decrypt (the `likeMatch`/`content-match.ts` pattern over decrypted names, `foods-search.test.ts` pattern): executable-code gate `grep -rnE "Like\(|%q%" apps/meal-service/src/foods` is zero (doc comments mentioning `LIKE` and the `likeMatch` helper name itself are out of gate scope). Out-of-scope guard: no photo-behaviour, saved-meal, target, or entry-nutrient-edit change.
[VERIFICATION & TESTING RULES] typecheck: `npm run typecheck` in touched workspaces (`apps/app`, `apps/meal-service`, `packages/ui` as touched); unit-test: rerun only if e2e exposes a regression, naming the cache-ciphertext suite `npm run test:unit -- foods-cache.e2e-spec.ts` in `apps/meal-service` (conditional, so within `max-test-runs: 2`); e2e (allowed, one suite per command, `max-test-runs: 2` — exactly two `-g` runs below, no third):
  - Run 1 — existing photo journey: `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/meals.spec.ts -g "meals day view|the entry doors are reachable|an unreadable photo opens manual entry|a corrected meal saves|a saved meal re-logs|the day total"`. The alternation covers the whole existing `meals day view` describe (`apps/app/test/e2e/meals.spec.ts:82`) — all five photo-door tests, every one of which opens the door through the moved FAB selector — so this single run proves "photo journey green with only the FAB selector moved".
  - Run 2 — both new journeys in one invocation: `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/meals.spec.ts -g "the foods catalog door adds, edits, and deletes a staple|the manual log door records a catalog staple in a few taps"`.
  Dev mode swaps `--config apps/app/playwright.config.ts` for `apps/app/playwright.dev.config.ts`. Both green outcomes are covered by the two runs above within `max-test-runs: 2`.
[DEFINITION OF DONE] Run 1 green: the existing photo journey (all five `meals day view` tests) passes with only the FAB selector moved. Run 2 green: both new intent journeys pass on frozen selectors. History-immutability asserted; all mechanical greps clean, including the Contract 2 `## Cache Rules` check and the post-decrypt-filter check; typecheck zero errors.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Wire rename `grams→amount` misses a reader | Med | Task 1 maps at DTO boundary; Task 2/8 read-back asserts |
| `FabMenu` a11y drift from `FabLink`/`Menu` | Low | Task 6 ports both semantics verbatim + unit test |
| e2e flake (photo bytes/service spawn) | Med | Own fixtures per test, two `-g` runs (photo journey, new journeys), 2-run budget |
| Scope creep into photo/saved/targets | Med | Task 8 out-of-scope guard; map assumption 5/9 enforced |

## Open Questions (deferred per specs, not planned)
- Day-view amount rendering (`× 2.5` vs `250 ml`) — needs its own frozen-surface approval.
- Deleted-food display label resolution — nutrients preserved either way.
- Photo-failure manual item gaining the picker — adjacent to out-of-scope photo path.

---

### Repair round 5 — findings resolved

1. **Task 1 (wire-rename breaks the regression suite).** Scope now includes the rename-driven fixture touch (`grams: 50` → `amount: 50` at `foods-search.test.ts:~L139`); the false "must not break it" framing is dropped — the regression run includes the touch and proves everything else in the suite.
2. **Task 8 (unexecutable LIKE gate).** Gate is now executable-code-only (`grep -rnE "Like\(|%q%" apps/meal-service/src/foods` zero); doc comments mentioning `LIKE` and the `likeMatch` helper name are out of gate scope; the post-decrypt `likeMatch`-over-decrypted-names assertion stands as the positive proof.
3. **Placeholders (unwritten test files).** `test/meal-foods.test.tsx (new)` is marked in Task 4's scope (Task 5 extends it) and `test/meal-log.test.tsx (new)` in Task 7's, matching Task 3's `(new)` marking convention — no `jest --passWithNoTests` vacuous green remains.
4. **Task 7 (ambiguous two-suites-one-command form).** Two runs spelled explicitly (run 1 `meal-log.test.tsx`, run 2 `meal-editor.test.tsx`, both in `apps/app`), at the `max-test-runs: 2` budget, matching Task 3's enumerated form.
5. **Task 2 (required `unit` vs no-test-touches).** Scope now includes the fixture updates (`unit: 'g'` on the `MealFood` fixtures in `meal-editor.test.tsx`, `meal-day-view.test.tsx`, `meal-saved.test.tsx`); `unit` stays required, mirroring the always-present wire field; the "touches no test file" claim is dropped.

No spec defect found; all five findings were plan errors, not spec gaps. Spec left untouched; intent Outcome coverage unchanged; no work added that Out of scope forbids.

### Amendment (user-directed, 2026-10-16)

Proof-level boundary made explicit in Tasks 4/5/7: browser/e2e proof of the specs' Success Criteria is exclusively Task 8's definition of done (its Run 2). Tasks 4/5/7 prove at unit/fixture level and may not write, run, or demand Playwright evidence. No task scope, ordering, or requirement changed; the spec is untouched.
