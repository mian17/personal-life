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
only — `name + grams + foodId | fdcId` — and no nutrient value transcribes through the model.
Search is **catalog-first, USDA-second**, and the catalog is **written at log time**, never
at estimate time (`docs/intent/meal-food-capture.md` "Amendment 2026-10-04").

## Architecture Decisions

- **`usda-source` lives in `apps/meal-service/src/usda/`**, not a workspace package. One
  consumer today. `ponytail:` the mapping table moves to `packages/usda` when a second
  consumer exists.
- **`usda-source` keeps no cache** — `@life/cache` has no owner-less primitive (keys are
  forced `<service>:<sub>:v<gen>:<rest>`), and **the food catalog is the cache** — USDA is
  consulted once per genuinely new name, zero times for a repeat.
- **Dedup by name is a read, then a log-time write** (amendment 2026-10-04). Resolution
    *searches* our catalog first and consults USDA only when the catalog has no match — the
    tool is `search_food`, returning catalog rows (`id`/`name`/`servingGrams`) and, only
    when needed, USDA candidates (`name`/`fdcId`); it returns **no nutrient amounts** (see
    `SPEC-photo-identity.md § The tool loop`). The catalog row itself is **written at log
    time**, never during the estimate: an estimate is a draft, and creating registry rows
    from a draft litters the catalog with foods the user then edits or abandons — lesson
    `docs/lessons/0009-autosave-inline-tag-orphans.md` gates creation on a user-produced
    confirmation, and the log-meal click is that confirmation (Task 8, Task 11).
  - **Uniqueness runs on a normalized key, not on the stored name** (amendment 2026-10-04):
    trim, collapse internal whitespace, case-fold; the **stored name keeps the user's exact
    spelling**. So `Chicken`/`chicken`/`chicken ` are one food, while `chicken` and
    `chicken breast` are two accepted, distinct foods — no fuzzy merge, no brand logic.
    Two rows naming the same food in one photo produce **one catalog food and two entries**
    (Task 11).
- **`Entry.quantity` stays servings.** `scale()` owns "1 = one serving"; `Entry.quantity` is
  documented "Servings logged". Grams are a *view*: `quantity × servingGrams`. Redefining it
  would reinterpret every existing entry — a migration, and migrations are the human's to run.
- **`Food.servingGrams = 100`** for every food this feature creates. A referenced catalog
  food keeps its own base and the Grams box converts through it.
- **USDA failure logs a zero vector** (`zeroVector()` = "no nutrient data"), which
  `content.ts` already means by that state. No model-invented fallback number.
- **Frozen-surface rename approved 2026-10-04** — `Portions` → `Grams`, conditionally on
  e2e selector updates shipping in the same change.

### The two nouns that are not the same

`ServingInputDto` **portions** (`CreateFoodDto.portions[]`, `foods.service.ts`'s
`normalizePortions`/`replaceServings`) is a *named portion* — label + grams. The editor's
**`Portions`** control is a *quantity multiplier*. Only the latter becomes `Grams`.
A rename driven by grep alone would corrupt the food DTO. `foods.service.ts` is
**out of scope** — nothing in this plan edits it. The tasks that touch the catalog
(Task 8's `findAll` catalog-first tool closure, Task 11's `create` at log time) call
`FoodsService`'s **existing public methods** through the foods module; the file itself
does not change.

### The three estimate-item types — defined once each, never two names for one

| # | Type | Lives in | Shape | Owned by |
|---|---|---|---|---|
| 1 | `PhotoFoodSuggestion` — the **model's** output, `PhotoReadResult`'s items | `apps/meal-service/src/photo/gemini.client.ts` | `{ name: string; grams: number; foodId: string \| null; fdcId: number \| null }` (SPEC-photo-identity lines 37–48) | Task 6 |
| 2 | `PhotoEstimateItem` — the **service's** estimate item, `PhotoService.estimate`'s result | `apps/meal-service/src/photo/photo.service.ts` | `{ name: string; grams: number; foodId: string \| null; fdcId: number \| null; servingGrams: number; nutrients: NutrientVector }` — `nutrients` is the path's vector **after** `completeVector`, at the food's per-serving base, **unscaled** (the editor scales it to grams with its existing `scaleVector`) | Task 6 declares it; Task 8 fills it |
| 3 | `PhotoEstimateItem` — the **BFF wire** item, `PhotoEstimate`'s items | `apps/app/lib/meal-api.ts` | the **same shape as #2**, stated once, not restated field by field | Task 10 declares it alongside the old wire type; Task 9 makes `PhotoEstimate.items` carry it and removes the old type |

`PhotoItemSuggestion` — the pre-rewrite name, at `gemini.client.ts:35` and
`meal-api.ts:107` — **does not survive this plan**. The **service** copy is deleted in
Task 6; the **BFF** copy is deleted in **Task 9** (not Task 10 — Task 10 keeps it because
`editor.tsx`, which it may not edit, still reads `suggestion.dish`/`suggestion.nutrients`
then; Task 9 is the task that switches `onPhoto` to the new item and so owns the removal).
It is never aliased to any of the three. No task defines a fourth name.

`foodId`/`fdcId`/`servingGrams`/`nutrients` exist on #2 and #3 **only**, never on the model
or as a fourth type: #1 is what the model produces, and no number transcribes through it
(locked decision 10). #2 exists because SPEC-photo-identity lines 60–64 promise a resolved
item shows "that food's numbers" / "USDA numbers" — identity alone cannot fill the editor,
and the editor's `isEstimated` (`editor.tsx:106`) can only be derived from a vector that
actually arrived.

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

- [ ] **Task 6: Identity-only schema + prompt, reshaped response, tests updated**
- [ ] **Task 7: The `search_food` tool loop with bounds**
- [ ] **Task 8: Three-path resolution — vector only, no catalog write**

### Checkpoint 2
- [ ] A photo yields separate foods with USDA numbers; USDA-down logs a zero vector
- [ ] No nutrient field exists anywhere in the model's schema
- [ ] An estimate writes **no** `Food` row: repeat names make zero USDA calls, and no
      catalog row exists for a photo the user never logged

### Phase 3 — Grams in the editor (`meal-capture-ui`)

- [ ] **Task 9: `servingGrams` + the `Grams` view, with e2e selector updates**
- [ ] **Task 10: BFF carries `servingGrams` per item**
- [ ] **Task 11: Log-time catalog creation — reuse by normalized key, else create at 100 g**

### Checkpoint 3 — Complete
- [ ] Contract 1 mechanical greps clean
- [ ] `npm run build -w apps/app` succeeds
- [ ] Five-lane verification gate (§7.6) returns N/N PASS

---

## Task 1: Verify USDA field names and the nutrient mapping table

[TASK OBJECTIVE]
Confirm the JSON field names on `AbridgedFoodNutrient`, and every row of the
nutrient-number → key table in `SPEC-usda-source.md`, before any mapper is written.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `docs/specs/SPEC-usda-source.md`,
  `docs/research/usda-fdc-api.md`
- Reference files (read-only): `docs/specs/MAP-meal-nutrition.md`;
  `apps/meal-service/src/foods/content.ts`; `docs/lessons/`
- Strictly prohibited files: every other file — no code, no tests, no other spec

[IMPLEMENTATION REQUIREMENTS]
- Confirm two facts: the JSON field names on `AbridgedFoodNutrient`, and each row of
  the mapping table. The four contested rows (`calories` 208 vs 209, `sugar` 269 vs
  2000, `folateB9` 417 vs 435, `vitaminA` 318 vs 320) are where a confident wrong
  answer would live.
- **Resolve the `AbridgedFoodNutrient` field-name conflict as an explicit deliverable**
  (`SPEC-usda-source.md` `## Open verification` 1): the OpenAPI `required` list names
  `id`/`nutrientNumber`/`unit`, while its `properties` block names
  `number`/`name`/`amount`/`unitName`. The live response settles which pair the mapper
  must read — `nutrientNumber` vs `number` and `unit` vs `unitName` (with `amount` the
  value field) are the competing candidates; state the winning names in
  `SPEC-usda-source.md`, not merely "the field names".
- Flip `SPEC-usda-source.md`'s status line from `PROPOSED` to confirmed, citing the
  source.
- **Confirm the estimated-vs-verified wording** in `SPEC-usda-source.md:147–154` — it
  already states the client-derived mechanism (the estimate response carries **no**
  `isEstimated` field; the editor derives it per item from the resolved vector's `known`
  coverage, `editor.tsx`'s `isEstimated`). Confirm-only: no edit to those lines, just
  verify the two specs agree.
- [ ] `SPEC-usda-source.md:147–154` confirmed to state the client-derived mechanism
  (no `isEstimated` response field); the two specs agree — confirm-only, no edit
- [ ] A real `/v1/foods/search` response shows the actual `foodNutrients[]` field names
- [ ] The `nutrientNumber`/`number` and `unit`/`unitName` (and `amount`) conflict is resolved, with the winning names stated in the spec
- [ ] Every one of the 27 rows is confirmed against USDA's canonical nutrient list or a live response
- [ ] `SPEC-usda-source.md`'s status line reads confirmed, with the source cited

[VERIFICATION & TESTING RULES]
- `curl -s 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=broccoli&dataType=SR%20Legacy&pageSize=1'` returns a food whose `foodNutrients[]` is quoted in the spec
- No code written in this task. No tests. No build. No git commands.
- Max test executions: 0 (verification task; the `curl` is the one external check).

[DEFINITION OF DONE]
- [ ] Every mapping row confirmed and the spec status line flipped.
- [ ] No file outside the allowed scope was modified.
- [ ] No test, build, or git command run.

**Dependencies:** Human provides a networked run or a pasted response.
**Estimated scope:** XS

## Task 2: Verify the Gemini function-calling envelope

[TASK OBJECTIVE]
Confirm the `tools` / `functionDeclarations` / `functionCall` / `functionResponse` shape,
and which `role` carries a tool result, against the Generative Language discovery document.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `docs/specs/SPEC-photo-identity.md`
- Reference files (read-only): `docs/specs/MAP-meal-nutrition.md`;
  `apps/meal-service/src/photo/gemini.client.ts`; `docs/lessons/`
- Strictly prohibited files: every other file — no code, no tests, no other spec

[IMPLEMENTATION REQUIREMENTS]
- The envelope source is the same discovery document the existing single-call shape was
  verified against (2026-10-03). The loop's termination condition must be observable in
  the envelope.
- Quote the tool-declaration and tool-result JSON shapes in `SPEC-photo-identity.md`.
- State how a loop terminates (final text vs further `functionCall`), not inferred.
- Choose the round and wall-clock bounds.
- [ ] The tool-declaration and tool-result JSON shapes are quoted in `SPEC-photo-identity.md`
- [ ] How a loop terminates is stated, not inferred
- [ ] Round and wall-clock bounds are chosen

[VERIFICATION & TESTING RULES]
- `npm run typecheck -w apps/meal-service` (no code change expected)
- No implementation in this task. No tests. No build. No git commands.
- Max test executions: 0.

[DEFINITION OF DONE]
- [ ] Envelope shapes and termination condition quoted in the spec; bounds chosen.
- [ ] No file outside the allowed scope was modified.
- [ ] No test, build, or git command run.

**Dependencies:** Human provides a networked run or a pasted discovery document.
**Estimated scope:** XS

## Task 3: Nutrient mapping + unit normalization

[TASK OBJECTIVE]
Add the pure mapper that turns USDA nutrient rows into a `NutrientVector` — no HTTP, no DI.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/meal-service/src/usda/mapping.ts`,
  `apps/meal-service/test/usda-mapping.test.ts`
- Reference files (read-only): `apps/meal-service/src/foods/content.ts`;
  `docs/specs/SPEC-usda-source.md`; `docs/lessons/`
- Strictly prohibited files: everything else — no other service file, no spec, no other
  test

[IMPLEMENTATION REQUIREMENTS]
- Given rows in, a `NutrientVector` or a typed `unmapped` result out.
- Match each USDA row by nutrient number and **verify by `unitName`**; a unit mismatch
  converts explicitly or yields `unmapped` — never a silent pass-through.
- Missing rows become `0`; *no* row mapping at all yields `reason: 'unmapped'` rather
  than an all-zero vector.
- The result goes through `content.ts`'s `completeVector` — the mapper does not restate
  the completeness rule.
- Code reads as prose (lesson 0026): intention-revealing names, small single-purpose
  functions, top-to-bottom narrative. Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** no cache in this task — it is pure. The food
  catalog (`FoodsCache`) is the cache, per `SPEC-usda-source.md` `## Cache Rules`. No
  new cache, no forked `@life/cache`.
- [ ] Each USDA row is matched by nutrient number and verified by `unitName`
- [ ] Missing rows become `0`; no row mapping yields `reason: 'unmapped'`
- [ ] The result goes through `completeVector`

[VERIFICATION & TESTING RULES]
- Permitted test command: `npm run test:unit -w apps/meal-service -- test/usda-mapping.test.ts --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- One test per contested row of the mapping table.
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Mapper matches by number, verifies unit, and routes through `completeVector`.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Task 1.
**Estimated scope:** S

## Task 4: USDA client — search, fetch-by-id, typed failures

[TASK OBJECTIVE]
Add `usda_search(query, dataType)` and `fetchByFdcId(fdcId)` against
`https://api.nal.usda.gov/fdc`, key from env, returning a typed `UsdaResult`.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/meal-service/src/usda/usda.client.ts`,
  `apps/meal-service/test/usda-client.test.ts`
- Reference files (read-only): `apps/meal-service/src/photo/gemini.client.ts`;
  `docs/specs/SPEC-usda-source.md`; `docs/research/usda-fdc-api.md`; `docs/lessons/`
- Strictly prohibited files: everything else — no other service file, no spec, no other
  test

[IMPLEMENTATION REQUIREMENTS]
- Return `UsdaResult` (`SPEC-usda-source.md`): never a partial vector, never a thrown string.
- Signature: `usda_search(query: string, dataType: readonly ['Foundation', 'SR Legacy'])`
  — the `Foundation` + `SR Legacy` restriction (SPEC-usda-source `## Open verification`
  3; research file "Which `dataType` to search") is a caller-supplied parameter the
  client sends as the FDC `dataType[]` query params, not a hard-coded constant hidden
  in the client body. Task 8's tool closure calls it with exactly `['Foundation', 'SR Legacy']`.
- Key read from `USDA_API_KEY` at runtime; **never** in a log line, message, or error text.
- Read `X-RateLimit-Remaining`; a `429` yields `rate-limited` and is **never retried**.
- Every failure collapses to one typed `reason` — mirroring `gemini.client.ts`'s
  "every failure is one failure".
- Transport injected, as `GeminiTransport` is, so tests never touch the network.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** no cache of its own. The food catalog (`FoodsCache`)
  is the cache; a USDA failure **fails open** (typed reason, never a throw), per
  `SPEC-usda-source.md` `## Cache Rules`.
- [ ] Key never in a log line, message, or error text
- [ ] A `429` yields `rate-limited`, never retried
- [ ] Every failure collapses to one typed `reason`
- [ ] Transport injected

[VERIFICATION & TESTING RULES]
- Permitted test command: `npm run test:unit -w apps/meal-service -- test/usda-client.test.ts --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- A test asserts the key appears in no captured error/log output.
- A test asserts the outgoing request carries the caller's `dataType` pair (`Foundation`,
  `SR Legacy`) as FDC `dataType[]` params.
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Client returns only `UsdaResult`; key absent from every captured output.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Task 3.
**Estimated scope:** S

## Task 5: Wire `usda-source` into meal-service

[TASK OBJECTIVE]
Add the `usda-source` nest module + DI provider so meal-service can depend on the USDA
client, failing closed at construction when unconfigured. The consumer wiring into
`photo.module.ts` is Task 8's — this task creates the standalone module only.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/meal-service/src/usda/usda.module.ts`
- Reference files (read-only): `apps/meal-service/src/photo/gemini.client.ts`;
  `apps/meal-service/src/photo/photo.module.ts`; `apps/meal-service/src/photo/photo.service.ts`;
  `docs/specs/SPEC-usda-source.md`; `docs/lessons/`
- Strictly prohibited files: `apps/meal-service/src/photo/photo.module.ts` (Task 8 owns it)
  and every other file — no service, no spec, no test

[IMPLEMENTATION REQUIREMENTS]
- Fail closed at construction when unconfigured, like `GeminiClient` — but only for the
  lookup path, never for boot.
- Validate `USDA_API_KEY`/`USDA_API_BASE` at construction, naming variables, never values.
- Meal-service boots with USDA unconfigured; only the lookup path degrades.
- **`usda.module.ts` only.** It exports the USDA client provider (a factory behind a DI
  token, mirroring `GEMINI_CLIENT_FACTORY`) so a consumer module can import it. This task
  does **not** edit `photo.module.ts`: importing `UsdaModule` into `PhotoModule` and
  injecting the client into `PhotoService` happens in Task 8, the first task that consumes
  both `FoodsService` and the USDA client in the resolution path (that file appears in
  exactly one task's allowed list — Task 8's).
- No second Redis client, no forked `@life/cache`.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** this task adds no cache. It introduces no second
  Redis client and no forked `@life/cache`; the food catalog (`FoodsCache`) remains the
  only cache, per `SPEC-usda-source.md` `## Cache Rules`.
- [ ] `USDA_API_KEY`/`USDA_API_BASE` validated at construction, naming variables
- [ ] Meal-service boots with USDA unconfigured
- [ ] No second Redis client, no forked `@life/cache`
- [ ] `photo.module.ts` is not edited here (Task 8 owns its wiring)

[VERIFICATION & TESTING RULES]
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- Permitted test command: `npm run test:unit -w apps/meal-service -- test/usda-client.test.ts --runInBand`
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Module/DI wired; boot independent of USDA config; no second cache.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Task 4.
**Estimated scope:** S

## Task 6: Identity-only response schema + prompt, reshaped response, tests updated

[TASK OBJECTIVE]
Make the model return identity only (`name + grams + foodId | fdcId`): replace the schema's
nutrient block, rewrite the prompt, reshape the response type and the fake transport,
and update every test that asserted the old shape. The model's output and the service's
response are two different types — this task declares both (see Architecture Decisions
"The three estimate-item types").

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create:
  - `apps/meal-service/src/photo/gemini.client.ts`
  - `apps/meal-service/src/photo/photo.service.ts`
  - `apps/meal-service/src/photo/photo.controller.ts`
  - `apps/meal-service/test/fake-gemini.ts`
  - `apps/meal-service/test/gemini.client.test.ts`
  - `apps/meal-service/test/photo.e2e-spec.ts`
- Reference files (read-only): `docs/specs/SPEC-photo-identity.md`;
  `apps/meal-service/src/foods/content.ts`; `docs/lessons/`
- Strictly prohibited files: everything else — no other service/test file, no spec, no
  `apps/app` file (Task 9/10 own the editor side)

[IMPLEMENTATION REQUIREMENTS]
- Replace `RESPONSE_SCHEMA`'s nutrient block with identity only; rewrite `PROMPT` so it
  no longer instructs the model to invent numbers. **Delete** the old
  `PhotoItemSuggestion { dish, ingredients, portionGrams, nutrients }`
  (`gemini.client.ts:35`) — that name does not survive this plan. Define the model's
  output once as `PhotoFoodSuggestion { name, grams, foodId, fdcId }` (SPEC-photo-identity
  §"The new contract", lines 37–48); `fdcId` is an integer or null, `foodId` a catalog id
  or null (the catalog-first tool closure picks one; Task 7 runs the loop, Task 8 supplies the tool).
- **Two item types, two owners — stated once.** The model speaks
  `PhotoFoodSuggestion[]`; the service speaks `PhotoEstimateItem[]`. `readPhoto`'s
  `PhotoReadResult` keeps its current contract — `{ readable: true; items:
  PhotoFoodSuggestion[] }` — because the model cannot know `servingGrams` or a resolved
  vector, so **the client must never construct a service-layer item**. `PhotoService.estimate`
  builds the declared `PhotoEstimateItem { name, grams, foodId, fdcId, servingGrams,
  nutrients }` and is the **only** construction site: it maps each `PhotoFoodSuggestion`
  into one item. Because `servingGrams` and `nutrients` are **required** fields, Task 6
  **seeds them itself** so this task typechecks and its tests pass before Task 8 exists —
  `foodId`/`fdcId` pass through from the suggestion, `servingGrams: 100` (locked decision
  2/11), `nutrients: zeroVector()` ("no nutrient data", locked decision 3). Task 8 replaces
  both seeded values with the resolved base and vector. No other task defines, declares, or
  builds an estimate item; `photo.controller.ts` passes the service result through unchanged.
  `nutrients`/`servingGrams` are backend-resolved from the catalog or `usda-source` — never
  transcribed through the model (locked decision 10) — so no nutrient field exists anywhere
  in the model's schema or request body.
- `COULD_NOT_READ` remains the single failure result.
- **Two layers, two shapes.** The **model's** raw payload and `RESPONSE_SCHEMA` are
  identity-only: no nutrient key anywhere in the schema or the request body. The
  **service's** `PhotoService.estimate` result items are `PhotoEstimateItem` (declared here,
  filled by Task 8); `readPhoto`'s `PhotoReadResult` items stay `PhotoFoodSuggestion[]`.
  `fake-gemini.ts` makes the model's raw payload identity-only
  (`gemini.client.test.ts` imports `FakeGemini`, `geminiResponse`, `item`,
  `readablePayload`); update `gemini.client.test.ts` — line 92
  (`items[0].nutrients.calories`) and every assertion on the old fields — to the identity
  model shape.
- `photo.e2e-spec.ts` line 120 asserts `items[0].dish`; update it to the new shape:
  `name`/`grams`/`foodId`/`fdcId` as identity fields here, `servingGrams`/`nutrients`
  populated by Task 8 — this task asserts only what it implements (identity + shape), not
  Task 8's resolved vector.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- Canary: search for any other assertion on the old fields across `apps/meal-service/test`
  and update it in this same task.
- **Cache plan (Contract 2 Rule 4):** **no cache in this task.** Photo estimates are
  **never cached** — already a Cache Rule in `SPEC-meal-service.md:126–127` ("Photo
  estimates are never cached. A Gemini result is per-request, transient, and unconfirmed;
  only a *confirmed* entry is persisted"), and a resolved estimate is the same kind of
  value. This task declares the response **shape only**: it neither reads through nor
  writes to any cache, adds no `@life/cache` read-through entry, and adds no cache key.
  The catalog the estimate later resolves against is `FoodsService`'s existing cached
  list, unchanged here. The first task that touches a food **write** is Task 11
  (log-time catalog creation), which bumps the owner's generation counter
  (Contract 2 Rule 3) — the estimate flow writes no food at all.
- [ ] The model's schema, prompt, and fake payload are identity-only — no nutrient key
- [ ] `readPhoto`'s `PhotoReadResult.items` stay `PhotoFoodSuggestion[]`; `PhotoService.estimate` returns `PhotoEstimateItem[]` and is its only construction site (seeded `servingGrams: 100`, `zeroVector()`)
- [ ] `fdcId` is an integer or null
- [ ] `gemini.client.test.ts` and `photo.e2e-spec.ts` assert the new shapes, not `dish`/old `nutrients`
- [ ] `COULD_NOT_READ` remains the single failure result

[VERIFICATION & TESTING RULES]
- Permitted test commands:
  - `npm run test:unit -w apps/meal-service -- test/gemini.client.test.ts --runInBand`
  - `npm run test:unit -w apps/meal-service -- test/photo.e2e-spec.ts --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- **The no-nutrient-key assertion is split, one side per layer:**
  - **schema side** (`gemini.client.test.ts`): the serialised request body carries no
    nutrient key — assert `RESPONSE_SCHEMA`'s item `properties` and `required` name only
    `name`/`grams`/`foodId`/`fdcId`, and the serialised body contains none of the 27
    `NUTRIENTS` keys. This is the client's contract (the model cannot answer a field the
    schema does not ask for).
  - **response side** (`photo.e2e-spec.ts`): `PhotoService.estimate`'s `PhotoEstimateItem` results **do**
    carry `nutrients`/`servingGrams`, so the test must **not** assert those keys are absent —
    it asserts the identity fields plus, once Task 8 fills them, the resolved
    `nutrients`/`servingGrams`. (This task pins shape only; Task 8 pins the resolved
    values.) Until Task 8, those required fields carry this task's own seed values —
    `servingGrams: 100` and `nutrients: zeroVector()` — pinned by the test as the shape.
- NO full suites; the two named files only. Max test executions: 2 total — one run per named file.

[DEFINITION OF DONE]
- [ ] Schema, prompt, and model payload are identity-only; the service response type is `PhotoEstimateItem`; fake transport and both tests updated.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Task 2.
**Estimated scope:** M

## Task 7: The `search_food` tool loop with bounds

[TASK OBJECTIVE]
Declare `search_food(query)` and run the turn loop — model `functionCall` → tool result →
`functionResponse` → final JSON — with hard bounds. The tool itself arrives as a
caller-supplied function argument; this task owns no DI.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/meal-service/src/photo/gemini.client.ts`,
  `apps/meal-service/test/photo-toolloop.test.ts`
- Reference files (read-only): `apps/meal-service/src/photo/photo.service.ts` (Task 8
  builds the tool closure and passes it in); `docs/specs/SPEC-photo-identity.md`;
  `docs/lessons/`
- Strictly prohibited files: everything else — no `photo.service.ts`, no `photo.module.ts`,
  no service, no spec, no other test

[IMPLEMENTATION REQUIREMENTS]
- **`readPhoto` takes the tool as an optional function argument** — `readPhoto(image, hint?,
  searchTool?: SearchFood)` — so the loop never sees `FoodsService` or the USDA client, and
  `GeminiClient`'s constructor stays `(env, transport, timeoutMs)` exactly as it is.
  Optional is deliberate: Task 6's `photo.service.ts` caller (two args) still compiles in
  this task's tree; tool turns run only when a tool is supplied, otherwise the single-shot
  identity parse (Task 6 behavior). The `photo.module.ts` factory
  `() => new GeminiClient(process.env)` is untouched; this task changes no DI.
- Declare the tool's types here, once, matching `SPEC-photo-identity.md:109–115`:

  ```ts
  export interface SearchFoodResult {
    catalog: { id: string; name: string; servingGrams: number }[];
    usda: { name: string; fdcId: number }[];
  }
  export type SearchFood = (query: string) => Promise<SearchFoodResult>;
  ```

  Task 8 constructs the closure over its injected services; this task only declares the
  shape and calls it per `functionCall`.
- The tool declaration the model sees is `search_food(query: string)` per
  `SPEC-photo-identity.md § The tool loop`; its `functionResponse` payload carries catalog
  rows (`id`/`name`/`servingGrams`) and USDA candidates (`name`/`fdcId`) — **names and
  ids only, never nutrient amounts** (`servingGrams` is a base weight, not numbers).
- The loop is bounded in rounds and wall clock; exceeding either is `COULD_NOT_READ`.
- A tool call that throws (a USDA 429/timeout, a catalog error) collapses to the same
  typed `COULD_NOT_READ`, not a hang — `SPEC-photo-identity.md` invariant 1 (every failure
  is one failure).
- The final answer names a catalog `id` or an `fdcId` per food — Task 6's
  `PhotoFoodSuggestion` (same file); the loop validates that shape and admits no nutrient
  field anywhere.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** this task adds no cache and owns no lookup — the
  catalog-first/USDA-second lookup lives in Task 8's closure (through `FoodsService.findAll`,
  the `FoodsCache` read-through). A tool failure **fails open** to the caller's typed
  result, per `SPEC-usda-source.md` `## Cache Rules`.
- [ ] The tool enters as an optional `SearchFood` function argument; `GeminiClient`'s constructor
  and the `photo.module.ts` factory are untouched
- [ ] Tool declaration is `search_food(query)`; payload carries names and ids only, no
  nutrient amounts
- [ ] Loop bounded in rounds and wall clock; exceeding either is `COULD_NOT_READ`
- [ ] A throwing tool call is a typed failure, not a hang

[VERIFICATION & TESTING RULES]
- Permitted test command: `npm run test:unit -w apps/meal-service -- test/photo-toolloop.test.ts --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- Tests drive the loop through a fake `SearchFood` and a fake transport: one test drives
  an over-running loop to `COULD_NOT_READ`; one asserts a throwing tool lands on
  `COULD_NOT_READ`; one asserts the request body's function declaration names no nutrient
  field.
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Tool loop bounded, payload identity-only, failures typed; the tool is a parameter,
  DI untouched.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Task 6.
**Estimated scope:** M

## Task 8: Three-path resolution — vector only, no catalog write

[TASK OBJECTIVE]
For each identity-only suggestion: resolve the vector from the catalog's stored vector
(zero search calls), or from `usda-source`'s mapped vector by `fdcId`, or else resolve no
vector (`zeroVector()`). The estimate writes **nothing**: no `Food` row is created in this
task — catalog creation is Task 11's (log time).

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/meal-service/src/photo/photo.service.ts`,
  `apps/meal-service/src/photo/photo.module.ts`,
  `apps/meal-service/src/photo/photo.controller.ts`,
  `apps/meal-service/src/foods/foods.module.ts` (exactly one change: add `exports: [FoodsService]`),
  `apps/meal-service/test/photo-resolve.test.ts`
- Reference files (read-only): `apps/meal-service/src/foods/foods-cache.ts`;
  `apps/meal-service/src/foods/content.ts`;
  `apps/meal-service/src/foods/foods.service.ts` (read-only — its **existing public**
  `findAll(sub, q)` and `findOne(sub, id)` are called, the file is not edited);
  `apps/meal-service/src/usda/usda.client.ts`; `apps/meal-service/src/usda/usda.module.ts`;
  `apps/meal-service/src/photo/gemini.client.ts` (read-only — Task 7's `SearchFood`/
  `SearchFoodResult` types and its `readPhoto(image, hint, searchTool)` signature, which
  this task fills; the file is not edited);
  `docs/specs/SPEC-usda-source.md`; `docs/specs/SPEC-photo-identity.md`; `docs/lessons/`
- Strictly prohibited files: every file other than the five above — no `gemini.client.ts`
  edit (Task 7 owns the loop), no `foods.service.ts` edit, no spec, no other test.
  **In particular, no `FoodsService.create` call**: catalog creation left the estimate
  (amendment 2026-10-04).

[IMPLEMENTATION REQUIREMENTS]
- **This task owns the photo pipeline's DI wiring** — it is the first consumer of both
  `FoodsService` (path 1) and the USDA client (path 2), so
  `photo.module.ts` is edited **here and nowhere else** (Task 5 creates `usda.module.ts`
  but does not import it into `PhotoModule`). `photo.service.ts`'s constructor gains
  `FoodsService` and the USDA client; `photo.module.ts` imports `FoodsModule` and
  Task 5's `UsdaModule`, leaving the existing `GEMINI_CLIENT_FACTORY`
  provider untouched. `FoodsModule` provides `FoodsService` but **does not export it**
  today (`foods.module.ts` has no `exports` array), so this task also adds
  `exports: [FoodsService]` to `foods.module.ts` — that one line is what makes the
  import injectable; without it Nest resolves `PhotoService`'s constructor and fails.
  Without this task's imports, path 1 has no catalog read and path 2 no USDA client.
- **This task constructs the catalog-first `search_food` closure and passes it to
  Task 7's `readPhoto(image, hint, searchTool)`.** `GeminiClient` receives no
  `FoodsService` — its constructor stays `(env, transport, timeoutMs)` (locked decision:
  the constructor signature is frozen) — and the closure honors `SPEC-photo-identity.md § The tool loop`:
  `searchTool(query)` runs `FoodsService.findAll(sub, query)` first and calls Task 4's
  `usda_search(query, ['Foundation', 'SR Legacy'])` **only when the catalog result is
  empty**, returning `{ catalog, usda }` (Task 7's `SearchFoodResult`) with names and ids
  only — never a nutrient amount. The closure binds `sub`, which this task carries from
  the controller into `estimate(sub, imageBase64, mimeType, hint?)`.
- Trust the `foodId`/`fdcId` the model's identity answer carries (Task 6/7's
  `PhotoFoodSuggestion`): resolution does **not** re-search by name. The tool loop already
  matched our catalog (foodId) or USDA (fdcId); the name is used only for what it has
  always been — the row label the editor displays.
  - A non-null `foodId` on the suggestion reads that catalog row's own stored vector via
    **`FoodsService.findOne(sub, foodId)`** — the existing public method
    (`foods.service.ts:211`), whose `where` predicate carries `ownerSub`, so a foreign or
    missing id is the same `NotFoundException` a direct read would give. The tool-loop
    payload carries only `id`/`name`/`servingGrams`, **never the vector**, so the row is
    read here: the read-through cache key `meal:<sub>:v<gen>:food:one:<id>` is what makes
    it cheap, and it is the same cache this task's `search_food` closure used. **No USDA call.**
    A `findOne` `NotFoundException` collapses to path 3 (`zeroVector()`), so a stale
    `foodId` fails open rather than failing the whole estimate.
  - A null `foodId` with a non-null `fdcId` *fetches* `usda-source`'s mapped per-100 g
    vector by that `fdcId` via Task 4's `fetchByFdcId(fdcId)` — for the **wire item only**,
    never for a new `Food`.
  - Both null resolves `zeroVector()` (USDA failure → "no nutrient data"; locked decision 3).
- Every vector passes `completeVector`.
- **Each returned item is the Task 6 `PhotoEstimateItem` — identity plus the resolved
  vector and base.** `photo.service.ts` maps the path result onto
  `{ name, grams, foodId, fdcId, servingGrams, nutrients }`: `nutrients` is the path's
  vector **after** `completeVector` (the referenced catalog food's vector, the `usda-source`
  mapped vector, or `zeroVector()`); `servingGrams` is the food's base — the referenced
  catalog food's **existing** base (never forced to 100), `100` otherwise. **Path 1's
  `nutrients` and `servingGrams` come from the same catalog row and share one base:**
  `findOne` returns a `FoodDto` whose `nutrients` is expressed per its own `servingGrams`
  (`foods.service.ts` `toDto` returns `row.servingGrams` beside the stored base vector), so
  the item reports that row's `servingGrams` and that same per-base vector — the two can
  never disagree, and path 1 is neither assumed per-100 g nor re-derived. Task 6's seeded
  `servingGrams: 100` / `zeroVector()` placeholders are replaced here, not carried through. This is what
  SPEC-photo-identity lines 60–64 require ("that food's numbers" / "USDA numbers") and what
  the editor's client-derived `isEstimated` (`editor.tsx:106`) reads: only a received vector
  lets it distinguish verified numbers from the path-3 unknown affordance. `nutrients`
  here is backend-resolved, never transcribed through the model (locked decision 10).
- **`PhotoService.estimate` takes `sub` and `PhotoController` passes it.** The current
  `estimate(imageBase64, mimeType, hint?)` (`photo.service.ts:57`) cannot reach
  `FoodsService.findOne(sub, …)`, `findAll(sub, …)`, or the per-owner closure, so this
  task changes the signature to `estimate(sub, imageBase64, mimeType, hint?)` and updates
  `photo.controller.ts:29` to forward `estimate(owner.sub, dto.imageBase64, dto.mimeType,
  dto.hint)`; the `_owner` param is renamed to `owner`. The estimate writes no entry and
  persists no byte, but it is a per-owner read — `@Principal()` is the caller proof,
  exactly as the module header already states.
- **Estimated-vs-verified is conveyed by the response, not a field.** No `isEstimated`
  field is added to the wire: the editor's `isEstimated` is client-derived from `known`
  coverage (`apps/app/app/(meals)/meals/entry/[id]/editor.tsx` line 106), and a path-3
  food's `zeroVector()` renders the existing unknown affordance. The response carries
  identity (`name + grams + foodId + fdcId`) **plus the resolved `servingGrams` and
  `nutrients`** — not identity only.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** this task makes **no cache change**. Path 1 reads the
  row through `FoodsService.findOne`, whose loader is the **existing** read-through
  (`FoodsCache.one`, key `meal:<sub>:v<gen>:food:one:<id>`) — no new read path is added
  here, and the cached value stays rows-as-persisted (ciphertext), with decryption only in
  the request path as `foods.service.ts` already does. The `search_food` closure's catalog
  half reads through `FoodsService.findAll` (the same read-through, key
  `meal:<sub>:v<gen>:food:list`) — a catalog hit is zero USDA calls, the catalog *is* the
  cache (`SPEC-usda-source.md` `## Cache Rules`). This task never calls `FoodsCache.bump`:
  the generation bump follows mutation, and mutation is Task 11's (log time) — the first
  write after the estimate flow.
- [ ] Each item resolves through its carried `foodId`/`fdcId`; names are display labels only
- [ ] A catalog `foodId` reads its stored vector via `FoodsService.findOne(sub, foodId)` (existing read-through; **no USDA call**)
- [ ] A bare `fdcId` resolves `usda-source`'s post-`completeVector` vector via `fetchByFdcId`, written nowhere
- [ ] Both null resolves `zeroVector()`
- [ ] Every vector passes `completeVector`
- [ ] Each returned item carries `servingGrams` — a referenced catalog food reports its **existing** base, not 100 — and the resolved post-`completeVector` `nutrients`, both from the same catalog row
- [ ] `photo.service.ts` injects `FoodsService` + the USDA client; `photo.module.ts` imports `FoodsModule` + `UsdaModule` here and here only
- [ ] `foods.module.ts` gains `exports: [FoodsService]` and nothing else (the current file has no `exports`, so `FoodsService` is not injectable into `PhotoModule` until this lands)
- [ ] The `search_food` closure is catalog-first (`findAll(sub, query)`), calls `usda_search(query, ['Foundation', 'SR Legacy'])` only on a catalog miss, returns names/ids only, and is passed into `readPhoto(image, hint, searchTool)` — `GeminiClient`'s constructor stays `(env, transport, timeoutMs)`
- [ ] `PhotoService.estimate` takes `sub` and `photo.controller.ts` forwards `owner.sub`
- [ ] `FoodsService.create` is called nowhere in this task; `foods.service.ts` is not modified
  (no name-search, no new reuse path here — Task 7 owns the loop; this task owns the closure's catalog-first body)

[VERIFICATION & TESTING RULES]
- Permitted test command: `npm run test:unit -w apps/meal-service -- test/photo-resolve.test.ts --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/meal-service`
- A test asserts the estimate creates no `Food`: after resolving, the catalog list is
  unchanged (no `create` call, no new row). A test asserts a referenced catalog food
  resolves through `FoodsService.findOne` and makes **zero USDA calls**. A test asserts
  the closure is catalog-first: a catalog hit reaches `usda_search` zero times, a catalog
  miss reaches it exactly once with `['Foundation', 'SR Legacy']`, and the tool result the
  service hands `readPhoto` carries names/ids only.
- Tests call `photo.estimate(VALID_SUB, IMAGE_B64, MIME, HINT)` directly (no HTTP —
  this task changes the signature).
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Three paths resolve the vector correctly; no catalog row is written; a catalog `foodId` reads its vector via `FoodsService.findOne` with no USDA call; `foods.service.ts` untouched; `photo.module.ts` wiring exists only here.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Tasks 5, 7.
**Estimated scope:** M

## Task 9: `servingGrams` + the `Grams` view, with e2e selector updates

[TASK OBJECTIVE]
Give `EditorItem` a `servingGrams` (default 100), show/edit grams as a view over
`quantity`, rename the `Portions` control to `Grams`, and ship the e2e + unit spec updates
in the same change.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create:
  - `apps/app/app/(meals)/meals/entry/[id]/editor.tsx`
  - `apps/app/test/meal-editor.test.tsx`
  - `apps/app/test/e2e/meals.spec.ts`
  - `apps/app/lib/meal-api.ts` (one change only: remove the pre-rewrite
    `PhotoItemSuggestion` interface and flip `PhotoEstimate.items` to `PhotoEstimateItem[]`,
    now that `editor.tsx` no longer reads the old shape)
- Reference files (read-only): `docs/specs/SPEC-meal-capture-grams.md`;
  `packages/ui` (`ListItem`, `SettingsRow`, `Input`, `IconButton`); `docs/lessons/`
- Strictly prohibited files: everything else — no `packages/ui` edit, no `apps/meal-service`
  edit, no other app file

[IMPLEMENTATION REQUIREMENTS]
- `EditorItem` gains `servingGrams: number`, defaulting to **100**, and a
  `foodId: string | null` carrying a reference to an existing catalog food (null when the
  estimate resolved a bare `fdcId` or nothing — Task 8). The `foodId` is what Task 11's
  log path reuses; it is **not** persisted on the entry write here.
- The `Grams` box displays `quantity × servingGrams` and edits
  `quantity = grams / servingGrams`, then the existing `setPortion` ratio rescale.
- `setPortion`'s guard is unchanged for junk/empty input: it keeps the last good value and
  must never scale a vector to zero. But its guard accepts `0` (`editor.tsx:246`), and
  `canSave` (`editor.tsx:197`) checks only `caloriesKnown` and a non-empty `dish`. **Add a
  zero-quantity guard that agrees with Task 11:** `canSave` additionally requires
  `items.every((item) => item.quantity > 0)`, so a zero-quantity item blocks save. Task 11
  divides the confirmed effective vector by `quantity` to recover the per-100 g base; a
  `quantity <= 0` would divide by zero and yield `NaN`/`Infinity`. Because the editor
  blocks save on any `quantity <= 0`, an item with `quantity <= 0` is **never sent down the
  create path** (Task 11 states the same guard and the same reasoning).
- Rename the label, aria-label, and hint text: `label="Grams"`,
  `aria-label={`Grams for ${subject}`}`; hint text no longer says Portions.
- `quantity` remains servings; `scale()` and `Entry` are untouched.
- **Seed `servingGrams` (and `foodId: null`) at every `EditorItem` construction site in
  this file** — now that the fields are required, every one must set them
  (SPEC-meal-capture-grams.md:37–50 — the `EditorItem` fields — and :158–159 — `addItem()`
  seeds `servingGrams: 100`):
  - the initial new-meal item (`editor.tsx:180`) → `servingGrams: 100`, `foodId: null`;
  - a restored entry's item (`editor.tsx:170–178`) → `servingGrams: 100`,
    `foodId: null`. Every pre-feature entry's `foodId` is the dish-name stand-in
    (`actions.ts:75` posts `foodId: item.dish`) and this plan runs no migration, so the
    stored value is never a catalog reference — seeding it would violate
    `EditorItem.foodId: string | null` ("a catalog reference from the estimate, or
    null", `SPEC-meal-capture-grams.md:44`). The entry stores no base, so
    `servingGrams: 100` (locked decision 1). The recovery path is Task 11's
    normalized-key lookup, which runs **before** any create: a restored entry's `dish`
    is the food's stored exact spelling, so the key matches and the existing food is
    reused, not duplicated. Task 11 states the same recovery path.
  - `addItem()` (`editor.tsx:255–259`) → `servingGrams: 100`, `foodId: null`;
  - the photo-failure and unreadable-photo resets (`editor.tsx:287, 291`) →
    `servingGrams: 100`, `foodId: null`;
  - the test's typed `EditorItem` literal in `meal-editor.test.tsx:620–625`
    (the "keeps EditorItem raw vectors scaled and serialisable" fixture — fields
    `dish`/`quantity`/`nutrients`/`known` only) → add `servingGrams: 100`,
    `foodId: null`, or the suite stops compiling under the new required fields.
  After editing, re-scan both app code and tests to prove the list is complete:
  `grep -rnE "\{[^{}]*dish:" apps/app/app apps/app/test` returns **seven** matches:
  - **Four `EditorItem` construction sites**, all seeded above — the initial new-meal item
    (`editor.tsx:180`), `addItem()` (`editor.tsx:258`), and the two resets
    (`editor.tsx:287`, `editor.tsx:291`).
  - **One old-shape wire fixture** — the suggestion the photo-door test returns
    (`meal-editor.test.tsx:225`), already listed above as the pre-rewrite shape this task
    updates to the new wire item.
  - **Two expected non-seed matches that must be left unedited**:
    - `editor.tsx:384` — `updateItem(index, { dish: event.target.value })`, a
      `Partial<EditorItem>` **patch**, not a whole-item seed; it carries no `servingGrams`/
      `foodId` and must not be edited.
    - `actions.ts:64` — `items: Array<{ dish: string; … }>`, the **server action's input
      type** (Task 10's file), a wire element, not an `EditorItem`; it must not be edited
      by this task.
  Two construction sites the grep does **not** match (both span multiple lines, so the
  `\{[^{}]*dish:` pattern cannot see them) are still covered by the explicit list above:
  the restored-entry item (`editor.tsx:170–178`) and the test's typed `EditorItem`
  literal (`meal-editor.test.tsx:620–625`).
- **Map the estimate item to `EditorItem` in `onPhoto`** (`editor.tsx:277–284`): the
  response item is Task 6/8's `PhotoEstimateItem`/wire `PhotoEstimateItem`
  (`{ name, grams, foodId, fdcId, servingGrams, nutrients }`), not the old
  `{ dish, ingredients, portionGrams, nutrients }`. Per item:
  `dish: suggestion.name`,
  `foodId: suggestion.foodId`,
  `servingGrams: suggestion.servingGrams`,
  `quantity: suggestion.servingGrams > 0 ? suggestion.grams / suggestion.servingGrams : 1`
  (grams → servings through the item's own base, so a 120 g item at `servingGrams: 100`
  is `quantity: 1.2` and a referenced food keeps its real base),
  `nutrients: scaleVector(suggestion.nutrients, quantity)` — `EditorItem.nutrients` is the
  **effective** vector (scaled to the logged weight), and the service returns it at the
  per-serving base unscaled, so scale it by the same `quantity` (`scaleVector` already
  exists in this file, line 137: the model's linear rule). A path-3 `zeroVector()` stays
  all-zero under any factor.
  `known: isZeroVector(item.nutrients) ? [] : estimatedKeys(nutrition)` — here `item` is the
  `EditorItem` being built in this map, so `item.nutrients` is the `scaleVector(...)` value
  just above; `known` must be
  derived from whether the vector actually resolved, never seeded unconditionally: the
  `known` set is the only switch `isEstimated` (`editor.tsx:106`) reads, so seeding all 27
  keys for a path-3 item would render `String(round2(0))` = `'0'` in every field
  (`editor.tsx:355`) — a fabricated `0`, exactly the number `SPEC-photo-identity.md`
  path 3 ("the unknown affordance") and `SPEC-usda-source.md:147–154` forbid. A path-3
  `zeroVector()` item carries an empty `known`: every field renders the `UNKNOWN` em dash
  (`placeholder={nutrition.unknown}`, `editor.tsx:354`), and `isEstimated` returns false.
  `isZeroVector(next)` — a small local helper over `Object.values(next).every((v) => v === 0)`
  — must exist before `onPhoto` uses it. Path 1/2 (a resolved vector) keeps all 27 keys
  known and renders the real numbers.
  `save()` serialises `{ foodId, dish, quantity, nutrients }` — `foodId` is the optional
  field Task 10 (this task's dependency, ordered before it) added to `saveEntryAction`'s
  `items[]` element; this task is the first caller to set it, Task 11 is the consumer that
  reads it for the log path (reuse an existing food or create one). Task 10 declares the
  field `foodId?: string | null` precisely so `EditorItem.foodId` (`string | null`)
  passes **verbatim** — under `strict` (`tsconfig.base.json:7`) a `string | undefined`
  field would reject the item's `null` with TS2322; Task 11 only truthy-checks the field,
  so `null` and `undefined` are equivalent to it. Grams are a view, never persisted
  (locked decision 1); `servingGrams` is **not** added to the write.
- **This task owns the `PhotoItemSuggestion` removal and wire flip.** Task 10 declared
  `PhotoEstimateItem` **alongside** the kept `PhotoItemSuggestion` (kept because
  `editor.tsx` still read `suggestion.dish`/`suggestion.nutrients`). Now that `onPhoto`
  maps the new shape, this task deletes `PhotoItemSuggestion` (`meal-api.ts:106–113`)
  and flips `PhotoEstimate.items` to `PhotoEstimateItem[]`, in the same change — the two
  names meet only across the Task 10 → Task 9 boundary, never inside one tree past this
  task. The per-file DoD grep is `grep -rn "PhotoItemSuggestion"
  apps/app/app/\(\(meals\)\)/meals/entry/\[id\]/editor.tsx apps/app/lib/meal-api.ts`
  → zero hits.
- **Primitive reuse plan (Contract 1):** the row is `ListItem variant="nested"` with the
  food name as title and trash via `ListItem titleAction` (`IconButton`). The `Grams`
  control is the **same `SettingsRow` + `Input` pair the `Portions` row already uses** —
  a label and a value transform, no new visual language (SPEC-meal-capture-grams.md:144–149,
  "Contract 1 conformance"). No raw HTML, no app CSS, no inline style, tokens only.
- **Frozen surface with recomputed values:** update `meals.spec.ts:139–150`
  (`Portions for Rice bowl`) and `meal-editor.test.tsx:444,599` in the same change.
  The e2e fixture is a manual item (`quantity: 1`, `servingGrams: 100`, calories filled
  as `450`): under the `Grams` box the fill is a weight, so `fill('200')` → `quantity =
  200 / 100 = 2` → `450 × 2 = 900`. The spec fills `Grams for Rice bowl` with `'200'`
  (not `'2'` — `'2'` would be 2 g → `quantity 0.02` → `'9'`); the `Calories for Rice
  bowl` expectation stays `toHaveValue('900')`, the day view still reads `900 kcal`,
  and `listedEntryCalories` still contains `900`. Lines 146–150 are unchanged apart
  from the selector rename.
- **Update the app tests that assert the pre-rewrite item shape.** In
  `meal-editor.test.tsx`, both photo-door fixtures seed the old shape
  (`{ dish, ingredients, portionGrams, nutrients }`) and the editor no longer consumes
  it — rewrite them to the wire shape
  (`{ name, grams, foodId, fdcId, servingGrams, nutrients }`):
  - lines 220–255 (the "posts the image … seeds the suggestion" test) — seeds
    `dish: 'Omelette'` → `name: 'Omelette'`, drops `ingredients`/`portionGrams`, adds
    `grams`/`foodId`/`fdcId`/`servingGrams`. The mapping scales `nutrients` by
    `grams / servingGrams`, so seed `grams: 100, servingGrams: 100` (factor 1) to keep
    the existing assertions on `Dish for item 1` / `Calories for Omelette` = 250.
  - lines 514–560 (the real-micros / estimated-hint test) — same shape change and same
    factor-1 seeding; the seeded `vector({ calories: 250, sodium: 480, caffeine: 12 })`
    keeps its displayed values.
  - **Add one test for the path-3 `known` rule** in the same file (no new test file, no
    extra test-run budget): seed a photo estimate whose `nutrients` is the all-zero
    vector (`vector()`, the harness's own helper at `meal-editor.test.tsx:42–47`), then
    assert a non-headline field's `props.placeholder` is `UNKNOWN` and its
    `props.value` is `''`, and that the `All nutrients (27)` trigger does **not** carry
    `· 23 estimated` (so `isEstimated` is false). That single test is what proves the
    `isZeroVector` branch, because a `known` seeded with all 27 keys would render `'0'`.
  Canary: `grep -rn "portionGrams\|suggestion.nutrients" apps/app/test` → zero hits after.
  A grep for the old field names does **not** catch a bare `EditorItem` literal with none
  of them — that is why `meal-editor.test.tsx:620–625` is listed explicitly above and why
  the re-scan grep is required before DoD.
- `foods.service.ts`'s `portions` (`ServingInputDto`) is **not** touched.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- [ ] `label="Grams"`, `aria-label={`Grams for ${subject}`}`, hint text no longer says Portions
- [ ] `setPortion`'s guard unchanged
- [ ] `quantity` remains servings; `scale()` and `Entry` untouched
- [ ] every `EditorItem` seed sets `servingGrams` and `foodId` (init, restored entry with
      `foodId: null`, `addItem`, photo-failure/empty reset)
- [ ] `canSave` requires every item's `quantity > 0` (zero-quantity guard, agreeing with Task 11)
- [ ] a new `meal-editor.test.tsx` test proves the path-3 `zeroVector` item renders the
      `UNKNOWN` affordance (placeholder `UNKNOWN`, empty value, no `· 23 estimated`)
- [ ] `onPhoto` maps the wire item `{ name, grams, foodId, fdcId, servingGrams, nutrients }` to `EditorItem` (`grams / servingGrams` → `quantity`), and `foodId` is carried on the item
- [ ] `meals.spec.ts:139` (fill `Grams for Rice bowl` with `'200'` → `quantity 2` → `450 ×
      2 = 900`) and `meal-editor.test.tsx:444,599` updated in the same commit; the
      `toHaveValue('900')` / `900 kcal` / `listedEntryCalories` assertions recomputed
      and still `900`
- [ ] `meal-editor.test.tsx` lines 220–255 and 514–560 assert the new wire shape, plus the new path-3 test
- [ ] `foods.service.ts`'s `portions` not touched
- [ ] `PhotoItemSuggestion` removed from `editor.tsx` and `meal-api.ts`; `PhotoEstimate.items` is `PhotoEstimateItem[]`

[VERIFICATION & TESTING RULES]
- Permitted unit command: `npm run test:unit -w apps/app -- test/meal-editor.test.tsx --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/app`
- **One budgeted E2E run** (this task modifies an E2E spec):
  `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/meals.spec.ts -g "a corrected meal saves"`
- `grep -rn "Portions for" apps` → zero hits; `grep -rn "normalizePortions" apps/meal-service` → unchanged.
- NO full suites. Max test executions: 2 (the one E2E run is inside this budget).

[DEFINITION OF DONE]
- [ ] `Grams` view works over `quantity`; primitives reused; no new visual language.
- [ ] e2e and unit specs updated in the same change.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests and the single E2E run pass.
- [ ] `grep -rn "PhotoItemSuggestion" apps/app` → zero hits (this task removed the last
      uses: the `onPhoto` mapping no longer reads `.dish`/`.nutrients`, and the old
      interface is gone from `meal-api.ts`); wire `PhotoEstimateItem` has exactly one
      definition.

**Dependencies:** Task 10 (needs `servingGrams` on the wire).
**Estimated scope:** M

## Task 10: BFF declares the wire type that carries `servingGrams` per item

[TASK OBJECTIVE]
Additively declare the BFF wire type `PhotoEstimateItem` mirroring Task 6/8's resolved
service item (`{ name, grams, foodId, fdcId, servingGrams, nutrients }`), and add the
optional `foodId` to `saveEntryAction`'s input, so Task 9 can switch `editor.tsx` to it and
convert grams through the food's real base. This task declares and forwards only —
`servingGrams`/`nutrients` are computed by Task 8, the `PhotoEstimate` union is flipped to
the new item by Task 9 (this task cannot: `editor.tsx` still reads the old shape and is
prohibited here).

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create: `apps/app/lib/meal-api.ts`,
  `apps/app/app/(meals)/meals/entry/[id]/actions.ts`
- Reference files (read-only): `apps/app/app/(meals)/meals/entry/[id]/editor.tsx`;
  `apps/meal-service/src/photo/photo.service.ts`;
  `docs/specs/SPEC-meal-capture-grams.md`; `docs/lessons/`
- Strictly prohibited files: everything else — no `editor.tsx` edit (Task 9 owns it), no
  service edit, no spec

[IMPLEMENTATION REQUIREMENTS]
- **One name, one shape — additive in this task.** `apps/app/lib/meal-api.ts:106–113`'s
  pre-rewrite `PhotoItemSuggestion { dish, ingredients, portionGrams, nutrients }` is
  **kept** here: `editor.tsx` (prohibited in this task) still reads `suggestion.dish`
  (`editor.tsx:279`) and `suggestion.nutrients` (`editor.tsx:281`), so deleting it now
  would break `apps/app`'s typecheck in this task alone. This task instead **adds** the
  BFF wire type `PhotoEstimateItem`, whose shape is **the same as the service's**
  (`{ name, grams, foodId, fdcId, servingGrams, nutrients }`, filled by Task 8), stated
  once here — do not redefine a second shape and do not re-derive the service type.
- **Keep the old wire type alive alongside the new one.** `PhotoEstimate` stays
  `{ readable: true; items: PhotoItemSuggestion[] } | { readable: false; reason }`
  unchanged, so `editor.tsx` and `actions.ts` still typecheck. `PhotoItemSuggestion` is
  **removed by Task 9** — the task that owns `editor.tsx` and switches its `onPhoto`
  mapping to `PhotoEstimateItem` — not here. In that same change Task 9 flips
  `PhotoEstimate.items` to `PhotoEstimateItem[]` and deletes the old interface, so the two
  names briefly coexist only across Task 10 → Task 9, never within one tree past Task 9.
  The `PhotoEstimate` result stays available for Task 9 to reshape.
- **`servingGrams` and `nutrients` are consumed, not computed.** The BFF forwards what
  the service resolved — a referenced catalog food already reports its existing base, a
  food this feature creates reports 100 (Task 11, at log time) — and `nutrients` arrives
  intact from that resolved vector, never recomputed in the BFF. This task adds no
  grams→servings math; that is Task 9's editor mapping.
- **Editor-side `servingGrams` seeding is Task 9's, not this task's.** `addItem()`, the
  initial item, the restored-entry item, and the photo-failure resets live in
  `editor.tsx`, which is prohibited here; Task 9 owns them (SPEC-meal-capture-grams lines
  104–105). This task owns the wire type only.
- `estimatePhotoAction` and its `estimatePhoto` call in `actions.ts` are forwarded
  verbatim; only `saveEntryAction`'s item type changes in that file (below). `actions.ts`
  imports `PhotoEstimate` from `meal-api.ts`, so the reshaped wire type flows through
  without a second declaration.
- **This task owns the `saveEntryAction` input change.** `saveEntryAction`'s
  `input.items[]` element type (`actions.ts:64`) gains an **optional** `foodId?: string |
  null` beside `dish`/`quantity`/`nutrients`, and the per-item POST forwards it. The
  nullable spelling is what Task 9's verbatim spread requires: `EditorItem.foodId` is
  `string | null`, and under `strict` (`tsconfig.base.json:7`) a `string | undefined`
  field would reject the item's `null` with TS2322. **Task 9** (dependent, ordered after
  this task) starts setting it, and **Task 11** is the one consumer that reads it, by a
  truthy check only, so `null` and `undefined` are equivalent to it. `saveAsMealAction`'s
  item type (`actions.ts:102`) already carries `foodId?: string` — untouched here (its
  sender slices `dish`, never `null`, so the narrower spelling suffices), no change
  needed there. Declaring the field optional is deliberate: this task's own caller
  (`editor.tsx`, prohibited here) still passes the old shape, so the field stays additive
  and `apps/app` typechecks in this task alone.
- The pre-rewrite wire type's `NutrientVector` import stays — `PhotoEstimateItem` still
  carries one. `PhotoItemSuggestion` stays too: Task 9 removes it when it switches the
  `onPhoto` mapping to the new item shape.
- **Cache plan (Contract 2 Rule 4):** this task makes **no cache change**. It reshapes no
  key and adds no read path: `estimatePhotoAction` forwards the service response verbatim
  (`FoodsService.findAll`/`findOne` still serve the read-through their existing keys
  inherit, already Task 8's); `saveEntryAction` writes only entries (the same POSTs that
  already exist, just with one optional field added — no `Food` row touched). The single
  `FoodsCache.bump(sub)` write path stays with `FoodsService.create`, whose first call is
  Task 11's (log time) — this task bumps nothing, per Contract 2 Rule 3.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- [ ] `meal-api.ts` declares `PhotoEstimateItem` once, shaped like the service's, **alongside** the kept `PhotoItemSuggestion`; `PhotoEstimate.items` still `PhotoItemSuggestion[]` in this task
- [ ] `servingGrams`/`nutrients` forwarded from the service response, not recomputed here
- [ ] `saveEntryAction`'s `items[]` element gains optional `foodId?: string | null`, forwarded per item; `saveAsMealAction` already had `foodId?: string` and is unchanged
- [ ] no `editor.tsx` seeding added here (Task 9 owns `addItem`/init/reset)

[VERIFICATION & TESTING RULES]
- Permitted unit command: `npm run test:unit -w apps/app -- test/meal-editor.test.tsx --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/app`
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Code meets all implementation requirements.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.
- [ ] `grep -rn "PhotoItemSuggestion" apps/app` → still present (Task 9 removes it); wire `PhotoEstimateItem`
      has exactly one definition; `actions.ts`'s `saveEntryAction` item type carries
      the optional `foodId?: string | null`.

**Dependencies:** Task 8.
**Estimated scope:** S

## Task 11: Log-time catalog creation — reuse by normalized key, else create at 100 g

[TASK OBJECTIVE]
Create or reuse the catalog `Food` **at log time** (when the user confirms), never at
estimate time: reference an existing catalog food when the item carries one, else create
the food at `servingGrams: 100` with the confirmed vector un-scaled back to the per-100 g
base; uniqueness is compared on a **normalized key**, not the stored name.

[SCOPE & REPOSITORY CONTEXT]
- Allowed files to edit/create:
  - `apps/app/app/(meals)/meals/entry/[id]/actions.ts`
  - `apps/app/lib/meal-api.ts`
  - `apps/app/test/meal-editor.test.tsx`
  - `apps/app/app/(meals)/meals/entry/[id]/page.tsx`
  - `apps/app/app/(meals)/meals/entry/[id]/editor.tsx` — **restore-seed only**: the line
    that seeds a restored entry's `dish` (the `dish: entry.foodId` seed, editor.tsx:201).
    The rest of the editor is Task 9's and stays out of bounds here.
- Reference files (read-only): `apps/meal-service/src/foods/foods.service.ts` (its
  **existing public** `findAll`/`create` are called; the file is not edited);
  `apps/meal-service/src/foods/dto/create-food.dto.ts`;
  `apps/meal-service/src/entries/dto/create-entry.dto.ts`;
  `docs/specs/SPEC-meal-capture-grams.md § The log-time create path`;
  `docs/lessons/`
- Strictly prohibited files: `apps/meal-service/src/foods/foods.service.ts` (no new
  method, no `portions`/`normalizePortions` touch), `foods.controller.ts`,
  `create-food.dto.ts`, `editor.tsx` **outside its restore-seed line** (the rest of the
  editor is Task 9's), the estimate path in `apps/meal-service/src/photo/`, and every
  other file — no service edit, no spec.

[IMPLEMENTATION REQUIREMENTS]
- **A `Food` row is created only at log time.** The estimate path creates none (Task 8);
  this BFF log path (the server action `saveEntryAction`) does. Grounded in
  `SPEC-meal-capture-grams.md § The log-time create path` and intent amendment 2026-10-04:
  the estimate is a draft, and creating registry rows from a draft litters the catalog
  with foods the user abandons (`docs/lessons/0009-autosave-inline-tag-orphans.md` gates
  creation on a user-produced confirmation — here, the log click).
- **Reuse first, create else.** For each confirmed item:
  - **an item that carries a `foodId`** (Task 9's `EditorItem.foodId`, set from the
    estimate when the catalog matched) reuses that food: log the entry with that
    `foodId`, **no new `Food`, no USDA call**.
  - **an item with `foodId: null`** (a bare `fdcId`/zero-vector estimate, a renamed
    review row, a **restored entry**, or a manual item) is matched **by normalized key**
    against the catalog (names already decrypted — the catalog is single-user and small, so
    one list beats a per-name round trip): a match reuses that food's id; **only a miss
    creates one** — and the entry then logs with the returned id. A **restored entry**
    (Task 9 seeds it `foodId: null`) carries its `dish` as the food's stored exact
    spelling, so its normalized key matches the existing food and that food is **reused,
    not duplicated** — the same recovery path Task 9 names, agreed here. Neither BFF helper exists yet (today
    `apps/app/lib/meal-api.ts` has no `/api/foods` reference — its exports stop at
    `deleteSavedMeal`), so this task **adds both as NEW exports** in that file,
    mirroring `FoodsService.findAll`'s call shape:
    - `export function listMealFoods(): Promise<MealFood[]>` → `call<MealFood[]>('/api/foods')`
    - `export function createMealFood(input: { name: string; servingGrams: number;
      nutrients: NutrientVector }): Promise<MealFood>` → `call<MealFood>('/api/foods',
      { method: 'POST', body: JSON.stringify(input) })`
    - the wire type `export interface MealFood`, mirroring `FoodsService.FoodDto`
      (`apps/meal-service/src/foods/foods.service.ts:42–51` — `FoodDto`, line 42 through
      its closing brace at line 51):
      `{ id: string; name: string; servingGrams: number; nutrients: NutrientVector;
      servings: ServingDto[]; version: number; createdAt: string; updatedAt: string }`
      — `ServingDto` mirrored as `{ id: string; label: string; grams: number;
      nutrients: NutrientVector }`. `foods.service.ts` is not edited.
- **Name matching happens post-decrypt, never in SQL** — the same rule `FoodsService`
  already follows for its `q` filter. The normalized-key comparison runs in the BFF on the
  decrypted names `GET /api/foods` returns; no ciphertext is matched.
- **The create's vector is the confirmed effective vector un-scaled by `quantity`.**
  `EditorItem.nutrients` is the effective vector (already scaled by `quantity`; Task 9);
  the food's stored base is `effective ÷ quantity`, `quantity` in servings (intent "A
  catalog food is written once, at creation"). **Zero-quantity guard, agreeing with
  Task 9:** the editor's `canSave` requires every item's `quantity > 0`, so an item with
  `quantity <= 0` never reaches the create path; the log path divides only positive
  `quantity`, never by zero (`effective ÷ 0` would yield `NaN`/`Infinity`). An item with
  `quantity <= 0` is **never sent down the create path** — Task 9 states the same guard
  and the same limit. This is the **one place** the wire-vs-stored
  vector is stated: the estimate returns `PhotoEstimateItem.nutrients` at the food's
  per-serving base **unscaled**, the editor scales it to grams via `scaleVector`, and this
  path divides the confirmed effective vector back to the base before `create`. No nutrient
  number is invented; none is rounded away.
- **`CreateEntryDto.foodId` is required** (`apps/meal-service/src/entries/dto/
  create-entry.dto.ts:44–47`), so a `null`-food item's create runs **before** its entry
  POST; the create returns the id the entry then carries. The null is resolved here, never
  on the wire.
- **The Task 10 dish-name fallback is removed.** Task 10 left
  `foodId: item.foodId || item.dish` in `saveEntryAction` as the transitional stand-in
  (needed until Task 9's editor sets `foodId`); with this task's resolution in place the
  `|| item.dish` half is **deleted** — the entry POST carries the resolved catalog id
  only: the reused food's id, or the newly created food's id. `EditorItem.dish` is the
  food's **name**, never an id, so it is never written into `foodId`; from this task on,
  `foodId` is never sent a dish name again.
- **Uniqueness is compared on a normalized key** (amendment 2026-10-04; SPEC-meal-capture-
  grams § The normalized name key): trim, collapse internal whitespace, case-fold — the
  **stored name keeps the user's exact spelling**. `Chicken`/`chicken`/`chicken ` are one
  food; `chicken` and `chicken breast` are two accepted, distinct foods (no fuzzy merge).
  Within one log, two items whose names normalize to the same key produce **one `Food` and
  two `Entry`s** — the log path keys its pending creates by the normalized key, so the
  second row reuses the first row's created id instead of creating a second food (the
  estimate already reused a pre-existing match; this closes the create-twice case).
- **The existing-entry (`PATCH`) path writes no food.** Editing an entry the user already
  logged updates the entry's snapshot only (`PATCH /api/entries/:id`) — a later entry
  correction stays **entry-local** and never writes back to the food (locked decision:
  "a catalog food is written once, at creation"). Food creation in this task happens only
  on the new-meal (`id === null`) branch, where each confirmed item has no entry yet.
- **Each new `EditorItem.dish` (name) is the stored name**, exactly as the user typed it;
  the normalized key exists only for comparison, never as the stored name.
- **A restored entry's display name is resolved from the catalog, never from `foodId`
  directly.** From this task on `foodId` carries a resolved catalog id, so the Task 9
  restore seed (`dish: entry.foodId`, editor.tsx:201) would render a raw id as the name —
  and worse, the log path would then normalize that id, match no food, and create a new
  food named after an id. The restore seed instead looks the entry's `foodId` up in the
  foods list this task already adds (`listMealFoods()`) and uses that food's `name` as
  `dish`; an entry whose `foodId` matches no catalog food is a pre-feature row whose
  `foodId` *is* the dish name, so it falls back to `entry.foodId` as the name — an
  unmatched id is never rendered as a label. `MealEntry` gains **no** name field, and
  `apps/meal-service` is **not** edited (the service's `EntryDto`,
  `apps/meal-service/src/entries/entries.service.ts:30–40`, mirrors the shape and would
  need a service-side join — out of scope and prohibited here). `EditorItem.foodId`
  stays `null` for restored entries exactly as Task 9 seeds it — the name resolution
  must not start feeding `foodId`.
- **Primitive reuse plan (Contract 1):** **no UI change** — this task edits server
  actions and the BFF client only, so no `@life/ui` primitive is involved and no raw HTML
  is written. The editor surface is Task 9's, untouched here.
- Code reads as prose (lesson 0026). Invoke the `code-as-prose` skill before editing.
- **Cache plan (Contract 2 Rule 4):** the create goes `FoodsService.create` → DB →
  `FoodsCache.bump(sub)` — the existing write path, unchanged; the foods write bumps the
  same per-owner generation every read key embeds. The read-through (Task 8's catalog-first
  tool closure) is not touched here.
- [ ] A `Food` is created only on the log path, never at estimate time
- [ ] An item carrying a `foodId` reuses it; `foodId: null` creates first, then logs the entry
- [ ] The Task 10 `foodId: item.foodId || item.dish` fallback is gone (`grep -n "item.foodId || item.dish"` over `apps/app` returns zero); no entry POST carries a dish name in `foodId`
- [ ] The stored base is the confirmed effective vector ÷ `quantity` (servings); a `quantity <= 0` item is never sent down the create path (the editor's `canSave` guard in Task 9 blocks save, so the log path divides only positive `quantity`)
- [ ] Uniqueness compares the normalized key (trim/collapse/case-fold); the stored name keeps the user's spelling
- [ ] A restored entry (`foodId: null`, `dish` = the food's stored exact spelling) matches by normalized key and its food is reused, not duplicated
- [ ] Two same-normalized-key items yield one `Food` and two `Entry`s; the `PATCH` branch writes no food
- [ ] `meal-api.ts` gains `listMealFoods`/`createMealFood` and the `MealFood`/`ServingDto` wire types as new exports; `foods.service.ts` and `create-food.dto.ts` are not modified
- [ ] A restored entry logged after this feature shows the food's **name**, not its catalog id
- [ ] A restored **pre-feature** entry still shows the dish name (the `entry.foodId` fallback), and re-logging it reuses the existing food instead of creating one named after an id

[VERIFICATION & TESTING RULES]
- Permitted unit command: `npm run test:unit -w apps/app -- test/meal-editor.test.tsx --runInBand`
- Permitted typecheck: `npm run typecheck -w apps/app`
- New test: logging a `foodId: null` item issues `POST /api/foods` (at `servingGrams: 100`,
  base = effective ÷ quantity) **before** `POST /api/entries` with the returned id; logging
  an item with a `foodId` issues no `POST /api/foods`.
- Restore-name assertions in the same `test/meal-editor.test.tsx`: a restored entry whose
  `foodId` is a catalog id renders the food's **name**; a restored entry whose `foodId`
  matches no catalog food renders `foodId` itself (the pre-feature fallback).
- NO full suites, NO E2E. Max test executions: 2.

[DEFINITION OF DONE]
- [ ] Log-time create path works; reuse avoids a create; the base is un-scaled correctly; the normalized key gates creation.
- [ ] No files outside the allowed scope were modified.
- [ ] Typecheck passes with zero errors.
- [ ] Prescribed targeted tests pass.

**Dependencies:** Tasks 9, 10.
**Estimated scope:** M

---

## Verification commands (project profile)

| Gate | Command |
|---|---|
| typecheck | `npm run typecheck -w <ws>` |
| unit | `npm run test:unit -w <ws> -- <file> --runInBand` |
| build | `npm run build -w apps/app` |
| e2e | `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"` |

`max-test-runs: 2` per verification, across all named files a task names (Task 6, the only
task with two named test files, budgets **2 total — one run per file**). No full suites. E2E
only for the single budgeted spec run (Task 9, inside its 2).
Workspaces in play: `packages/nutrition`, `apps/meal-service`, `apps/app`.

## Delegation notes (§5)

Every task above is rendered in the §5 five-section template — `[TASK OBJECTIVE]`,
`[SCOPE & REPOSITORY CONTEXT]`, `[IMPLEMENTATION REQUIREMENTS]`,
`[VERIFICATION & TESTING RULES]`, `[DEFINITION OF DONE]` — and each states its
max test executions and its per-task reference/prohibited files. Every delegated coding
task **must instruct the subagent to invoke the `code-as-prose` skill before writing or
editing code** (lesson 0026). Each task's blast radius is its own file list;
`docs/lessons/` is read-only context; nothing outside the list may change.

## Human-owned, never agent-run

- Provisioning and placing the USDA API key.
- Any DB migration. There is **none** in this plan by design.
- Merging to `master`.
