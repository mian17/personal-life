# Spec: usda-source

Module id: `usda-source` (map: `docs/specs/MAP-meal-nutrition.md`, revision 2026-10-04).
External contract: `docs/research/usda-fdc-api.md`. Intent:
`docs/intent/meal-food-capture.md`. Contracts: AGENTS.md **Contract 2** (data-layer
layering, `## Cache Rules` below) and the hard line that secrets are never agent-written.

## Objective

Give the photo pipeline an authoritative nutrient reference: turn a USDA FoodData Central
food into **our** per-100 g `NutrientVector`, in **our** 27 keys and **our** units. Success
= when the model says "chicken breast, 120 g", the numbers that reach the diary are
USDA's, and nothing about them has passed through a language model's own text.

## Why this is its own module

It has an external contract with its own failure modes (rate limits, a 1-hour block, an
API key that must never be logged) and it is the piece a future food picker would reuse.
Its one consumer today is the photo pipeline. `ponytail:` it stays inside
`apps/meal-service/src/usda/` — the mapping table is what moves to `packages/usda` when a
second consumer actually exists, not before.

## Contract boundary

**Owns** — FDC HTTP calls, the API key, response parsing, the nutrient-number → key
mapping, unit normalization, per-100 g vectors, lookup caching.

**Does not own** — food identity decisions (that is the model's job),
catalog creation or dedup (that is `meal-service`'s), any nutrient arithmetic (that is
`nutrition-model`'s `scale()`), and any presentation.

**Exports exactly one thing to the pipeline**: given an `fdcId`, return a complete
`NutrientVector` per 100 g — already through `completeVector` — or a typed failure. It
never returns a partial vector. The pipeline resolves a whole photo with **one batch
fetch** (`GET /v1/foods?fdcIds=`, one request per 20 ids) rather than one fetch per food;
each batch entry shares the fetch-by-id row shape, so the mapping below is unchanged
(`usda.client.ts` `fetchByFdcIds`; `fetchByFdcId` is its one-id convenience).

```ts
type UsdaResult =
  | { ok: true; vector: NutrientVector }
  | { ok: false; reason: 'not-found' | 'unmapped' | 'rate-limited' | 'unavailable' };
```

A typed failure is the whole point: the caller decides what "USDA could not resolve this"
means for a logged food. It is never a thrown string, never a zero-filled vector.

## The mapping — the one place this silently breaks

USDA identifies nutrients by **number** (a string on the wire). We identify them by
**key**. This table is the join, and it is where "USDA-verified" becomes "silently
wrong" if one row is off.

| our key | our unit | USDA no. | USDA id | USDA nutrient name | USDA `unitName` | conversion |
|---|---|---|---|---|---|---|
| `calories` | kcal | 208 | 1008 | Energy | KCAL | none |
| `fat` | g | 204 | 1004 | Total lipid (fat) | G | none |
| `monounsaturatedFat` | g | 645 | 1292 | Fatty acids, total monounsaturated | G | none |
| `polyunsaturatedFat` | g | 646 | 1293 | Fatty acids, total polyunsaturated | G | none |
| `saturatedFat` | g | 606 | 1258 | Fatty acids, total saturated | G | none |
| `transFat` | g | 605 | 1257 | Fatty acids, total trans | G | none |
| `cholesterol` | mg | 601 | 1253 | Cholesterol | MG | none |
| `sodium` | mg | 307 | 1093 | Sodium, Na | MG | none |
| `carbohydrates` | g | 205 | 1005 | Carbohydrate, by difference | G | none |
| `fiber` | g | 291 | 1079 | Fiber, total dietary | G | none |
| `sugar` | g | 269 | 2000 | Total Sugars | G | none |
| `protein` | g | 203 | 1003 | Protein | G | none |
| `vitaminA` | mcg | 320 | 1106 | Vitamin A, RAE | UG | none |
| `vitaminC` | mg | 401 | 1162 | Vitamin C, total ascorbic acid | MG | none |
| `thiaminB1` | mg | 404 | 1165 | Thiamin | MG | none |
| `riboflavinB2` | mg | 405 | 1166 | Riboflavin | MG | none |
| `niacinB3` | mg | 406 | 1167 | Niacin | MG | none |
| `folateB9` | mcg | 417 | 1177 | Folate, total | UG | none |
| `vitaminB6` | mg | 415 | 1175 | Vitamin B-6 | MG | none |
| `vitaminB12` | mcg | 418 | 1178 | Vitamin B-12 | UG | none |
| `calcium` | mg | 301 | 1087 | Calcium, Ca | MG | none |
| `iron` | mg | 303 | 1089 | Iron, Fe | MG | none |
| `magnesium` | mg | 304 | 1090 | Magnesium, Mg | MG | none |
| `phosphorus` | mg | 305 | 1091 | Phosphorus, P | MG | none |
| `potassium` | mg | 306 | 1092 | Potassium, K | MG | none |
| `zinc` | mg | 309 | 1095 | Zinc, Zn | MG | none |
| `caffeine` | mg | 262 | 1057 | Caffeine | MG | none |

**Status: CONFIRMED against live responses** — `GET /v1/foods/search` and
`GET /v1/food/{fdcId}`, fetched 2026-10-05 (samples retained at
`/tmp/opencode/usda-search.json` and `/tmp/opencode/usda-food.json`). Every row
above appears in the live payload with the listed number, id, name, and unit.
The mapper keys on the **number** (a string, e.g. `"269"`); the `nutrientId`
column is a cross-check only.

Four rows had a competing candidate. Two of the plan's premises were wrong; all
four are settled below as explicit corrections, so nobody "fixes" them back:

| our key | chosen | competing | resolution |
|---|---|---|---|
| `calories` | **208** | 209 | 208 = **Energy** (`KCAL`); 209 = **Starch** (`G`) — a carbohydrate, not an energy value. There was never a real contest. (268 = Energy in `kJ`, also rejected — see "no numeric conversion".) |
| `sugar` | **269** | 2000 | 269 = **Total Sugars** with `nutrientId` **2000**. The two are the *same* nutrient — the plan confused an FDC `nutrientId` with a `nutrientNumber`. No phantom row. |
| `folateB9` | **417** (total) | 435 (DFE) | 435 = "Folate, DFE" (`UG`), a bioavailability-adjusted derived measure (DFE = natural folate + 1.7 × folic acid). Our key is "Folate (B9)" and the vector stores the observed quantity, so the table takes the total. One row, one source, consistent with the other 26. |
| `vitaminA` | **320** | 318 | **The plan's labels were reversed.** 318 = **Vitamin A, IU** (`IU`); 320 = **Vitamin A, RAE** (`UG`). Our `vitaminA` unit is `mcg`, so 320 needs no conversion. 318 is rejected: IU→RAE is form-dependent (1 IU = 0.3 mcg retinol, but carotenoids differ) and cannot be done correctly from an amount alone. |

### Which endpoint the mapper reads — and which it never touches

Resolution fetches in **batch**: `GET /v1/foods?fdcIds=`, one request per estimate for
as many as 20 ids, chunked per 20 beyond that — never one request per food. The batch
list entries carry the **same nested rows** as the fetch-by-id body (the research note
confirms it live: identical keys and row counts), so the mapper still reads only that
one fetched row shape — `foodNutrients[].nutrient.number` + `.nutrient.unitName` +
`.amount`, through `readNutrientRows` — whether the read was a batch or a single
fetch. Invalid ids the list omits hold no vector (`null`, the absent vector downstream —
never a throw, never a missing key), as does a failed chunk.

The two search-vs-fetch endpoints return **different shapes**. Only the fetch
(path above) supplies a nutrient vector. The mapper reads
`foodNutrients[].nutrient.number` + `.nutrient.unitName` + `.amount` — nothing else.

`GET /v1/foods/search` → `foods[].foodNutrients[]` rows are **flat**:
```json
{ "nutrientId": 1292, "nutrientName": "Fatty acids, total monounsaturated",
  "nutrientNumber": "645", "unitName": "G", "value": 0.031,
  "derivationCode": "NC", "derivationDescription": "Calculated", "derivationId": 49,
  "foodNutrientSourceId": 2, "foodNutrientSourceCode": "4",
  "foodNutrientSourceDescription": "Calculated or imputed", "rank": 11400,
  "indentLevel": 1, "foodNutrientId": 1518787, "dataPoints": 0 }
```
Winning names here: `nutrientNumber` (**string**), `nutrientName`, `nutrientId`
(number), `unitName` — and the value is **`value`**.

`GET /v1/food/{fdcId}` → `foodNutrients[]` rows are **nested**:
```json
{ "nutrient": { "id": 1008, "number": "208", "name": "Energy", "rank": 500, "unitName": "kcal" },
  "amount": 34.0, "type": "FoodNutrient", "id": 1518841,
  "dataPoints": 49, "min": 22.0, "max": 44.0,
  "foodNutrientDerivation": { "id": 43, "code": "JO", "description": "..." } }
```
Winning names here: `nutrient.number` (**string**), `nutrient.name`,
`nutrient.id` (number), `nutrient.unitName` — and the value is **`amount`** at the
row's top level, not `value`. The plan's competing value-field candidates were
both wrong: the answer is `value` on search, `amount` on fetch-by-id.
`nutrientNumber` wins over `number` on search; `number` wins (nested under
`nutrient`) on fetch-by-id. `unitName` wins over `unit` on both.

The search shape is **never mapped**: the `search_food` tool uses only
`foods[].description` (the name) and `foods[].fdcId`, and its result deliberately
carries **no** nutrient amounts (`SPEC-photo-identity.md` §"The tool loop").
Map the wrong shape and the join reads the wrong fields — state this once, here,
so it stays stated.

### Rules the mapper must hold

1. **Match by number, verify by normalised unit.** A row is accepted only when its
   **normalised unit** equals the unit our key declares. Normalisation is **spelling
   only — there is no numeric conversion anywhere**, because every one of the 27 keys'
   USDA rows reports a unit that is a spelling variant of our unit:

   | USDA spelling | our unit |
   |---|---|
   | `g` \| `G` | `g` |
   | `mg` \| `MG` | `mg` |
   | `mcg` \| `µg` \| `UG` \| `ug` | `mcg` |
   | `kcal` \| `KCAL` | `kcal` |

   Unit spelling differs by endpoint — search returns `G`, `MG`, `UG`, `KCAL`, `IU`,
   `kJ`; fetch-by-id returns `g`, `mg`, `µg`, `kcal`, `IU`. Our vocabulary
   (`packages/nutrition/src/nutrients.ts`) uses `mcg`, ASCII, never `µg`. A row whose
   **normalised** unit does not equal the key's expected unit yields `unmapped` —
   **never** a silent pass-through and **never** an invented conversion factor. In
   particular an `IU` row (e.g. `318` "Vitamin A, IU", or a `kJ` energy row `268`) is
   never mapped to a `mcg`/`mg`/`g`/`kcal` key; `unmapped` is the correct outcome.
2. **Skip group rows structurally.** `GET /v1/food/{fdcId}` mixes in group rows, e.g.
   `{ "nutrient": { "id": 2045, "number": "951", "name": "Proximates", "rank": 50, "unitName": "g" }, "type": "FoodNutrient" }`
   — these carry **no `amount`**. Observed group numbers: `951` Proximates, `950`,
   `952`, `956`, `300`, `500`. The robust rule is structural, not a hard-coded group
   list: **skip any row where `amount` is not a number**. (A missing nutrient row is
   still `0` per rule 3 below; a group row is skipped, not treated as a nutrient.)
3. **A missing USDA row is `0`, and that is this codebase's established meaning of
   absent.** `apps/meal-service/src/foods/content.ts` already owns this rule:
   `zeroVector()` is "no nutrient data for this field", and a vector is whole or absent —
   never partial with holes. USDA foods legitimately lack rows (a food with no measured
   caffeine has no 262), so the mapper fills all 27 and a missing row becomes `0`. If
   *nothing* maps, return `reason: 'unmapped'` rather than an all-zero vector, which would
   read as "verified none" when it means "we found nothing".
4. **`completeVector()` is the completeness rule — the mapper does not restate it.**
   Every vector leaving this module goes through `content.ts`'s `completeVector`: all 27
   fields, finite, non-negative. The mapper's job is to produce 27 numbers;
   `completeVector` is the only code allowed to declare one a valid vector (lesson 0016 —
   one owner per rule).
5. **The mapping runs once.** The catalog stores our mapped per-100 g vector, never the
   raw USDA payload; it is sealed via `foodNutrientsAad` on the way in like any other
   food field.

## Cache Rules

**`usda-source` has no cache of its own. The food catalog is the cache.**

Grounded in `packages/cache/src/index.ts` and `apps/meal-service/src/foods/foods-cache.ts`:
`@life/cache` exposes only `getThrough(sub, rest, loader, …)` and `bumpGeneration(sub)` —
keys are forced to `<service>:<sub>:v<gen>:<rest>`, and `CacheClient` deliberately has no
`DEL`. There is no owner-less primitive: a USDA lookup cache would need a synthetic `sub`
and a generation nobody bumps. That is machinery in search of a problem, because the
decision this feature already locked — **dedup by name** — absorbs the repeat lookups:

- A photo says `chicken`. If the catalog already has a food named `chicken`, reuse it and
  **call USDA zero times**.
- USDA is consulted **once per genuinely new name**, and the result is frozen into the new
  `Food` (`servingGrams: 100`, vector via `foodNutrientsAad`).

So the cached shape, key composition, invalidation, and failure mode are already specified
by `SPEC-meal-service`'s Cache Rules and owned by `FoodsCache` — the same one adapter, the
same `meal:<sub>:v<gen>:food:<rest>` keys, the same ciphertext discipline. Nothing is
added here. Contract 2 Rule 4 is satisfied by that delegation; this section exists to say
so rather than to invent a second cache (lessons 0011, 0016 — one owner per rule).

| Rule | Value |
|---|---|
| **Cached shapes** | None in this module. The catalog `Food` row (frozen at creation) is the durable copy. |
| **Key composition** | n/a — delegated to `FoodsCache`. |
| **Invalidation** | The catalog's per-owner generation counter, unchanged. A `Food`'s vector is immutable-by-design; a correction is a food edit, which already bumps the owner. |
| **Failure mode** | **Fail open.** A `429`, timeout, or parse error must never fail an estimate — the food still logs ("foods USDA can't resolve still log with approximate numbers, never dropped"). The model supplies no vector — identity only — so "never dropped" is a statement about the food, not its numbers: the item carries the absent vector (`zeroVector()`, "no nutrient data") and the caller fills the numbers by hand, exactly as `SPEC-photo-identity.md` records when it reinterprets this intent line. An unconfigured client (no `USDA_API_KEY`) is the same failure. |
| **Rate-limit posture** | Read `X-RateLimit-Limit` / `X-RateLimit-Remaining` and back off as `Remaining` approaches 0. Do **not** retry on `429`: an exceed blocks the key for an hour, so a retry storm extends the outage. One `429` → `reason: 'rate-limited'` → fail open. With dedup-by-name, a real key's 1,000 req/hour is ample — the lookups are per-new-food, not per-photo. |
| **Key handling** | Read from env at runtime. Never logged, never in a message, never committed. data.gov deactivates keys found in a repository, and the key rides in the query string, so a logged URL *is* a leaked key. The photo module's existing no-logging rule extends here. |

**On honesty of the fallback.** `Food` has no provenance field and adding one would be a
migration (a human's to run, never an agent's). So "was this USDA-verified?" is **not**
persisted per food, and the estimate response carries **no `isEstimated` field**:
estimated-vs-verified is **client-derived** — the editor derives it per item from the
resolved vector's `known` coverage (`editor.tsx`'s `isEstimated`), and a food whose vector
could not be resolved renders the existing unknown affordance. A food created from a
USDA lookup and one created from an approximation look identical in the catalog — and the
user can correct either, which is the mechanism that actually matters.

## Open verification — gates the mapping implementation

**All items below are resolved as of 2026-10-05**, against live `/v1/foods/search` and
`/v1/food/{fdcId}` responses (samples at `/tmp/opencode/usda-search.json`,
`/tmp/opencode/usda-food.json`). The mapping table at the top of this file is
**CONFIRMED**; the mapper is unblocked.

1. ~~**JSON field names for `AbridgedFoodNutrient`.**~~ **Resolved — there are TWO shapes,
   one per endpoint.** `GET /v1/foods/search`: flat rows — `nutrientNumber` (**string**),
   `nutrientName`, `nutrientId` (number), `unitName`, value is **`value`**.
   `GET /v1/food/{fdcId}`: nested rows — `nutrient.number` (**string**), `nutrient.name`,
   `nutrient.id` (number), `nutrient.unitName`, value is **`amount`** at the row's top
   level. `unitName` wins over `unit` on both. Only `fetchByFdcId`'s shape is mapped — see
   "Which endpoint the mapper reads" above.
2. ~~**The mapping table above.**~~ **Resolved** — all 27 rows confirmed against the live
   responses; see the table and the four contested-row corrections above.
3. **`dataType` selection** — restrict search to `Foundation` + `SR Legacy`, so the model
   matches whole ingredients rather than packaged products. (Task 4's `usda_search` takes
   this pair as a caller-supplied parameter; it stays the caller's choice, not a fact this
   verification settles.)

## Non-goals

Branded foods (per-serving basis, brand capture — a photo cannot read a brand). Portion
conversions (we log grams). Storing `fdcId` on `Food` (the vector is copied at creation;
no migration, and provenance is not in scope). A food picker UI (future consumer of this
module).
