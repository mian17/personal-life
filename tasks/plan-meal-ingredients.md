# Implementation Plan: meal-ingredients — photo → real foods, USDA-verified, logged by grams

Branch `feat/meal-ingredients`. Intent: `docs/intent/meal-food-capture.md`. Specs:
`SPEC-usda-source.md`, `SPEC-photo-identity.md`, `SPEC-meal-capture-grams.md`. Map:
`docs/specs/MAP-meal-nutrition.md` (revision 2026-10-04). Research:
`docs/research/usda-fdc-api.md`.

Task list convention: this repo records plans as `tasks/plan-<slug>.md` with
`tasks/five-lane-<slug>.md` alongside — not `tasks/plan.md`/`tasks/todo.md`. No in-flight
plan collides with this work (checked 2026-10-04).

## Overview

A meal photo logs **real foods** (chicken / broth / green beans), each a catalog food at
100 g with its own USDA-verified nutrient vector, logged by grams. Gemini resolves identity
only — `name + grams + fdcId` — and no nutrient value transcribes through the model.

## Architecture Decisions

- **`usda-source` lives in `apps/meal-service/src/usda/`**, not a workspace package. One
  consumer today. `ponytail:` the mapping table moves to `packages/usda` when a second
  consumer exists.
- **`usda-source` keeps no cache.** `@life/cache` has no owner-less primitive (keys are
  forced `<service>:<sub>:v<gen>:<rest>`), and **dedup-by-name makes the food catalog the
  cache** — USDA is called once per genuinely new name, zero times for a repeat.
- **`Entry.quantity` stays servings.** `scale()` owns "1 = one serving"; `Entry.quantity` is
  documented "Servings logged". Grams are a *view*: `quantity × servingGrams`. Redefining it
  would reinterpret every existing entry — a migration, and migrations are the human's to run.
- **`Food.servingGrams = 100`** for every food this feature creates. A reused catalog food
  keeps its own base and the Grams box converts through it.
- **USDA failure logs a zero vector** (`zeroVector()` = "no nutrient data"), which
  `content.ts` already means by that state. No model-invented fallback number.
- **Frozen-surface rename approved 2026-10-04** — `Portions` → `Grams`, conditionally on
  e2e selector updates shipping in the same change.

### The two nouns that are not the same

`ServingInputDto` **portions** (`CreateFoodDto.portions[]`, `foods.service.ts`'s
`normalizePortions`/`replaceServings`) is a *named portion* — label + grams. The editor's
**`Portions`** control is a *quantity multiplier*. Only the latter becomes `Grams`.
A rename driven by grep alone would corrupt the food DTO. `foods.service.ts` is
**out of scope**.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mapping table is wrong (208 vs 209, 269 vs 2000, 417 vs 435, 318 vs 320) | **High** — silently wrong "verified" numbers | Task 1 verifies before any mapper code. Marked `PROPOSED` until then. |
| Function-calling envelope unverified | **High** — the tool loop is the whole new pipeline | Task 2 verifies against the discovery document first. |
| A logged URL leaks the USDA key | **High** — data.gov deactivates published keys | No logging in the USDA client; key only in env. Covered by review checklist. |
| `429` retry storm extends a 1-hour key block | **Med** — an outage | One `429` → `rate-limited` → fail open. Never retry. |
| Loop never terminates | **Med** — hangs the estimate | Task 7 caps rounds and wall clock. |
| Rename breaks e2e selectors | **Med** — frozen surface | Task 9 ships `meals.spec.ts` + `meal-editor.test.tsx` updates in the same change. |
| USDA unreachable at runtime | **Low** — by design | Fail open: food still logs with a zero vector. Never dropped. |

## Open Questions

- **The USDA API key is a secret — a human provisions it.** Not an agent task, not written
  to any file. Checklist below.
- Network egress to `api.nal.usda.gov` is blocked in this sandbox (403, `sbx` unavailable),
  so Tasks 1–2 need either a pasted response or a run from a networked machine.

### Human checklist — USDA API key (hard line: the human runs this)

1. Sign up at data.gov for a FoodData Central key.
2. Set it in meal-service's environment as `USDA_API_KEY`. Do not commit it.
3. Confirm the deployment never logs request URLs (the key rides in the query string).
4. Expect `X-RateLimit-Limit: 1000` per hour per IP; do not share the key.

---

## Task List

### Phase 0 — Verification gates (fail fast)

- [ ] **Task 1: Verify USDA field names and the nutrient mapping table**
- [ ] **Task 2: Verify the Gemini function-calling envelope**

### Checkpoint 0
- [ ] Both contracts confirmed against a real source; mapping table flipped from
      `PROPOSED` to confirmed in `SPEC-usda-source.md`
- [ ] Blocked-on-human items recorded if either cannot be verified

### Phase 1 — Foundation (`usda-source`)

- [ ] **Task 3: Nutrient mapping + unit normalization** (pure, no HTTP)
- [ ] **Task 4: USDA client — search, fetch-by-id, typed failures**
- [ ] **Task 5: Wire `usda-source` into meal-service (env, DI)**

### Checkpoint 1
- [ ] `npm run typecheck -w apps/meal-service` clean
- [ ] Mapping tests pass; a mapped vector satisfies `completeVector`

### Phase 2 — Photo resolves identity (`meal-service`)

- [ ] **Task 6: Identity-only response schema + prompt**
- [ ] **Task 7: The `usda_search` tool loop with bounds**
- [ ] **Task 8: Three-path resolution + dedup by name**

### Checkpoint 2
- [ ] A photo yields separate foods with USDA numbers; USDA-down logs a zero vector
- [ ] No nutrient field exists anywhere in the model's schema

### Phase 3 — Grams in the editor (`meal-capture-ui`)

- [ ] **Task 9: `servingGrams` + the `Grams` view, with e2e selector updates**
- [ ] **Task 10: BFF carries `servingGrams` per item**

### Checkpoint 3 — Complete
- [ ] Contract 1 mechanical greps clean
- [ ] `npm run build -w apps/app` succeeds
- [ ] Five-lane verification gate (§7.6) returns N/N PASS

---

## Task 1: Verify USDA field names and the nutrient mapping table

**Description:** Confirm two facts before any mapper is written: the JSON field names on
`AbridgedFoodNutrient`, and each row of the nutrient-number → key table in
`SPEC-usda-source.md`. The four contested rows (`calories` 208 vs 209, `sugar` 269 vs 2000,
`folateB9` 417 vs 435, `vitaminA` 318 vs 320) are where a confident wrong answer would live.

**Acceptance criteria:**
- [ ] A real `/v1/foods/search` response shows the actual `foodNutrients[]` field names
- [ ] Every one of the 27 rows is confirmed against USDA's canonical nutrient list or a live response
- [ ] `SPEC-usda-source.md`'s status line reads confirmed, with the source cited

**Verification:**
- [ ] `curl -s 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=broccoli&dataType=SR%20Legacy&pageSize=1'` returns a food whose `foodNutrients[]` is quoted in the spec
- [ ] No code written in this task

**Dependencies:** Human provides a networked run or a pasted response.

**Files likely touched:**
- `docs/specs/SPEC-usda-source.md`
- `docs/research/usda-fdc-api.md`

**Estimated scope:** XS

## Task 2: Verify the Gemini function-calling envelope

**Description:** Confirm the `tools` / `functionDeclarations` / `functionCall` /
`functionResponse` shape and which `role` carries a tool result, against the Generative
Language discovery document — the same source the existing single-call shape was verified
against (2026-10-03). The loop's termination condition must be observable in the envelope.

**Acceptance criteria:**
- [ ] The tool-declaration and tool-result JSON shapes are quoted in `SPEC-photo-identity.md`
- [ ] How a loop terminates (final text vs further `functionCall`) is stated, not inferred
- [ ] Round and wall-clock bounds are chosen

**Verification:**
- [ ] `npm run typecheck -w apps/meal-service` (no code change expected)
- [ ] No implementation in this task

**Dependencies:** Human provides a networked run or a pasted discovery document.

**Files likely touched:**
- `docs/specs/SPEC-photo-identity.md`

**Estimated scope:** XS

## Task 3: Nutrient mapping + unit normalization

**Description:** `apps/meal-service/src/usda/mapping.ts` — the pure table and the mapper
that turns USDA nutrient rows into a `NutrientVector`. No HTTP, no DI: given rows in, a
vector or a typed `unmapped` result out.

**Acceptance criteria:**
- [ ] Each USDA row is matched by nutrient number and **verified by `unitName`**; a unit
      mismatch converts explicitly or yields `unmapped` — never a silent pass-through
- [ ] Missing rows become `0`; *no* row mapping at all yields `reason: 'unmapped'` rather
      than an all-zero vector
- [ ] The result goes through `content.ts`'s `completeVector` — the mapper does not
      restate the completeness rule

**Verification:**
- [ ] `npm run test:unit -w apps/meal-service -- test/usda-mapping.spec.ts --runInBand`
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] One test per contested row of the mapping table

**Dependencies:** Task 1.

**Files likely touched:**
- `apps/meal-service/src/usda/mapping.ts`
- `apps/meal-service/test/usda-mapping.spec.ts`

**Estimated scope:** S

## Task 4: USDA client — search, fetch-by-id, typed failures

**Description:** `apps/meal-service/src/usda/usda.client.ts` — `usda_search(query)` and
`fetchByFdcId(fdcId)` against `https://api.nal.usda.gov/fdc`, key from env. Returns
`UsdaResult` (`SPEC-usda-source.md`): never a partial vector, never a thrown string.

**Acceptance criteria:**
- [ ] Key read from `USDA_API_KEY` at runtime; **never** in a log line, message, or error text
- [ ] `X-RateLimit-Remaining` read; a `429` yields `rate-limited` and is **never retried**
- [ ] Every failure collapses to one typed `reason` — mirroring `gemini.client.ts`'s
      "every failure is one failure"
- [ ] Transport injected, as `GeminiTransport` is, so tests never touch the network

**Verification:**
- [ ] `npm run test:unit -w apps/meal-service -- test/usda-client.spec.ts --runInBand`
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] A test asserts the key appears in no captured error/log output

**Dependencies:** Task 3.

**Files likely touched:**
- `apps/meal-service/src/usda/usda.client.ts`
- `apps/meal-service/test/usda-client.spec.ts`

**Estimated scope:** S

## Task 5: Wire `usda-source` into meal-service

**Description:** Nest module + DI token so the photo pipeline can depend on the client.
Fails closed at construction when unconfigured, like `GeminiClient` — but only for the
lookup path, never for boot.

**Acceptance criteria:**
- [ ] `USDA_API_KEY`/`USDA_API_BASE` validated at construction, naming variables, never values
- [ ] Meal-service boots with USDA unconfigured; only the lookup path degrades
- [ ] No second Redis client, no forked `@life/cache`

**Verification:**
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] `npm run test:unit -w apps/meal-service -- test/usda-client.spec.ts --runInBand`

**Dependencies:** Task 4.

**Files likely touched:**
- `apps/meal-service/src/usda/usda.module.ts`
- `apps/meal-service/src/photo/photo.module.ts`

**Estimated scope:** S

## Task 6: Identity-only response schema + prompt

**Description:** Replace `RESPONSE_SCHEMA`'s nutrient block with identity only, and rewrite
`PROMPT` so it no longer instructs the model to invent numbers. `PhotoItemSuggestion`
becomes `{ name, grams, fdcId }`.

**Acceptance criteria:**
- [ ] No nutrient field exists anywhere in the model's schema — `NUTRIENTS` is no longer
      referenced by the request body
- [ ] The prompt no longer contains "each your best numeric estimate"
- [ ] `fdcId` is an integer or null
- [ ] `COULD_NOT_READ` remains the single failure result

**Verification:**
- [ ] `npm run test:unit -w apps/meal-service -- test/fake-gemini.spec.ts --runInBand`
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] Assert the request body serialised to the API contains no nutrient key

**Dependencies:** Task 2.

**Files likely touched:**
- `apps/meal-service/src/photo/gemini.client.ts`
- `apps/meal-service/test/fake-gemini.ts`
- `apps/meal-service/test/fake-gemini.spec.ts`

**Estimated scope:** M

## Task 7: The `usda_search` tool loop with bounds

**Description:** Declare `usda_search(query, dataType?)`, run the turn loop — model
`functionCall` → backend search → `functionResponse` → final JSON — with hard bounds.

**Acceptance criteria:**
- [ ] The tool payload carries **candidate names and ids only**, never nutrient amounts
- [ ] The loop is bounded in rounds and wall clock; exceeding either is `COULD_NOT_READ`
- [ ] Search is restricted to `Foundation` + `SR Legacy`
- [ ] A tool call that fails is a typed failure, not a hang

**Verification:**
- [ ] `npm run test:unit -w apps/meal-service -- test/photo-toolloop.spec.ts --runInBand`
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] One test drives an over-running loop to `COULD_NOT_READ`

**Dependencies:** Tasks 5, 6.

**Files likely touched:**
- `apps/meal-service/src/photo/gemini.client.ts`
- `apps/meal-service/test/photo-toolloop.spec.ts`

**Estimated scope:** M

## Task 8: Three-path resolution + dedup by name

**Description:** For each suggested food: reuse a catalog food of that name (USDA called
zero times), else create one from `usda-source`'s vector at 100 g, else create one with
`zeroVector()`.

**Acceptance criteria:**
- [ ] Exact name match reuses the existing food and makes **no** USDA call
- [ ] Path 2 creates `Food { servingGrams: 100 }` with the USDA vector, sealed via
      `foodNutrientsAad`
- [ ] Path 3 creates the food with a zero vector and the item is `isEstimated`
- [ ] Every vector passes `completeVector`

**Verification:**
- [ ] `npm run test:unit -w apps/meal-service -- test/photo-resolve.spec.ts --runInBand`
- [ ] `npm run typecheck -w apps/meal-service`
- [ ] A test asserts a repeat name performs zero USDA calls

**Dependencies:** Tasks 5, 7.

**Files likely touched:**
- `apps/meal-service/src/photo/photo.service.ts`
- `apps/meal-service/src/foods/foods.service.ts`
- `apps/meal-service/test/photo-resolve.spec.ts`

**Estimated scope:** M

## Task 9: `servingGrams` + the `Grams` view, with e2e selector updates

**Description:** `EditorItem` gains `servingGrams` (default 100). The `Grams` box displays
`quantity × servingGrams` and edits `quantity = grams / servingGrams`. Rename the label,
aria-label, and hint text. Update the e2e and unit specs in the **same change**.

**Acceptance criteria:**
- [ ] `label="Grams"`, `aria-label={`Grams for ${subject}`}`, and hint text no longer say Portions
- [ ] `setPortion`'s guard is unchanged: junk input keeps the last good value and never
      scales a vector to zero
- [ ] `quantity` remains servings; `scale()` and `Entry` are untouched
- [ ] `meals.spec.ts:139` and `meal-editor.test.tsx:444,599` updated in the same commit
- [ ] `foods.service.ts`'s `portions` (`ServingInputDto`) is **not** touched

**Verification:**
- [ ] `npm run test:unit -w apps/app -- test/meal-editor.test.tsx --runInBand`
- [ ] `npm run typecheck -w apps/app`
- [ ] `grep -rn "Portions for" apps` → zero hits; `grep -rn "normalizePortions" apps/meal-service` → unchanged

**Dependencies:** Task 10 (needs `servingGrams` on the wire).

**Files likely touched:**
- `apps/app/app/(meals)/meals/entry/[id]/editor.tsx`
- `apps/app/test/meal-editor.test.tsx`
- `apps/app/test/e2e/meals.spec.ts`

**Estimated scope:** M

## Task 10: BFF carries `servingGrams` per item

**Description:** The estimate response and the BFF wire type carry each item's
`servingGrams`, so the editor can convert grams through the food's real base — including a
reused catalog food whose base may not be 100.

**Acceptance criteria:**
- [ ] `PhotoItemSuggestion`'s wire type includes `servingGrams`
- [ ] A reused catalog food reports its **existing** base, not 100
- [ ] Manual `addItem()` seeds `servingGrams: 100`

**Verification:**
- [ ] `npm run test:unit -w apps/app -- test/meal-editor.test.tsx --runInBand`
- [ ] `npm run typecheck -w apps/app`

**Dependencies:** Task 8.

**Files likely touched:**
- `apps/app/lib/meal-api.ts`
- `apps/app/app/(meals)/meals/entry/[id]/actions.ts`

**Estimated scope:** S

---

## Verification commands (project profile)

| Gate | Command |
|---|---|
| typecheck | `npm run typecheck -w <ws>` |
| unit | `npm run test:unit -w <ws> -- <file> --runInBand` |
| build | `npm run build -w apps/app` |
| e2e | `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"` |

`max-test-runs: 2` per file. No full suites. E2E only for the single budgeted spec run.
Workspaces in play: `packages/nutrition`, `apps/meal-service`, `apps/app`.

## Delegation notes (§5)

Every delegated coding task below carries the mandatory template and **must instruct the
subagent to invoke the `code-as-prose` skill before writing or editing code** (lesson 0026).
Each task's blast radius is the file list above; `docs/lessons/` is read-only context;
nothing outside the list may change.

## Human-owned, never agent-run

- Provisioning and placing the USDA API key.
- Any DB migration. There is **none** in this plan by design.
- Merging to `master`.
