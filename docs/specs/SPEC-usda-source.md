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
`NutrientVector` per 100 g — or a typed failure. It never returns a partial vector.

```ts
type UsdaResult =
  | { ok: true; vector: NutrientVector; source: 'usda' }
  | { ok: false; reason: 'not-found' | 'unmapped' | 'rate-limited' | 'unavailable' };
```

A typed failure is the whole point: the caller decides what "USDA could not resolve this"
means for a logged food. It is never a thrown string, never a zero-filled vector.

## The mapping — the one place this silently breaks

USDA identifies nutrients by **number**. We identify them by **key**. This table is the
join, and it is where "USDA-verified" becomes "silently wrong" if one row is off.

| our key | our unit | USDA no. | USDA nutrient name | USDA `unitName` |
|---|---|---|---|---|
| `calories` | kcal | 208 | Energy (Atwater General Factors) | kcal |
| `fat` | g | 204 | Total lipid (fat) | g |
| `monounsaturatedFat` | g | 645 | Fatty acids, total monounsaturated | g |
| `polyunsaturatedFat` | g | 646 | Fatty acids, total polyunsaturated | g |
| `saturatedFat` | g | 606 | Fatty acids, total saturated | g |
| `transFat` | g | 605 | Fatty acids, total trans | g |
| `cholesterol` | mg | 601 | Cholesterol | mg |
| `sodium` | mg | 307 | Sodium, Na | mg |
| `carbohydrates` | g | 205 | Carbohydrate, by difference | g |
| `fiber` | g | 291 | Fiber, total dietary | g |
| `sugar` | g | 269 | Sugars, total including NLEA | g |
| `protein` | g | 203 | Protein | g |
| `vitaminA` | mcg | 318 | Vitamin A, RAE | mcg |
| `vitaminC` | mg | 401 | Vitamin C, total ascorbic acid | mg |
| `thiaminB1` | mg | 404 | Thiamin | mg |
| `riboflavinB2` | mg | 405 | Riboflavin | mg |
| `niacinB3` | mg | 406 | Niacin | mg |
| `folateB9` | mcg | 417 | Folate, total | mcg |
| `vitaminB6` | mg | 415 | Vitamin B-6 | mg |
| `vitaminB12` | mcg | 418 | Vitamin B-12 | mcg |
| `calcium` | mg | 301 | Calcium, Ca | mg |
| `iron` | mg | 303 | Iron, Fe | mg |
| `magnesium` | mg | 304 | Magnesium, Mg | mg |
| `phosphorus` | mg | 305 | Phosphorus, P | mg |
| `potassium` | mg | 306 | Potassium, K | mg |
| `zinc` | mg | 309 | Zinc, Zn | mg |
| `caffeine` | mg | 262 | Caffeine | mg |

**Status: PROPOSED. Not yet verified against a live response or USDA's canonical nutrient
list.** Implementation of the mapping is gated on that verification (see below). The
numbers are the standard USDA nutrient numbers, but "standard" is not "checked", and this
table is exactly where a confident wrong answer would live.

Four rows have a competing candidate that would change the number, not just its name:

| our key | chosen | competing | why it matters |
|---|---|---|---|
| `calories` | 208 | 209 (Atwater Specific Factors) | different energy factors → different kcal |
| `sugar` | 269 | 2000 (Sugars, total) | not always both present in SR Legacy |
| `folateB9` | 417 (total) | 435 (DFE) | DFE is a different basis than raw folate |
| `vitaminA` | 318 (RAE) | 320 (IU) | IU ≠ mcg; only RAE matches our unit |

### Rules the mapper must hold

1. **Match by number, verify by `unitName`.** A nutrient is accepted only when its
   `unitName` equals the unit our key declares. Where a unit genuinely differs in the
   source (`kJ` → `kcal`), convert explicitly and record that it converted. Anything else
   is `reason: 'unmapped'` — **never** a silent pass-through of a foreign unit.
2. **Absence is not zero.** USDA foods legitimately lack rows (a food with no measured
   caffeine has no 262). A missing row becomes `0` **only** for nutrients where absence
   is unambiguous (caffeine, trans fat); elsewhere the food is `reason: 'unmapped'` rather
   than a fabricated `0` that reads as "verified none".
3. **The vector is complete or absent.** `NutrientVector` is `Record<Nutrient, number>` —
   total by type. A food that maps to 24 of 27 does not return a 24-field object.
4. **The mapping runs once.** What is cached and what the catalog stores is our mapped
   per-100 g vector, never the raw USDA payload.

## Cache Rules

External reference data, not owner-scoped domain data — so this is the documented
deviation from the per-owner generation counter, with its rationale:

| Rule | Value |
|---|---|
| **Cached shapes** | (a) `fdcId` → our mapped per-100 g `NutrientVector`; (b) search query → candidate list (`fdcId`, `description`, `dataType`, `score`). Raw USDA payloads are **not** persisted — only mapped results. |
| **Key composition** | `usda:fdc:v1:<fdcId>` and `usda:search:v1:<hash(query,dataType)>`. No owner component — the reference is global. The `v1` prefix is the mapping's version, so a corrected mapping table invalidates by bumping it. |
| **Invalidation** | **TTL only; no generation counter** — there is no owner whose write should invalidate global reference data, and USDA publishes on its own release cadence. TTL is long: our `Food` freezes its vector at creation, so the cache serves the estimate, not the diary. A mapping-table change bumps `v1`. |
| **Failure mode** | **Fail open.** A `429`, timeout, or parse error must never fail an estimate — the food still logs. But the fallback **may not write an unverified vector into the catalog as if USDA-sourced**: the food is created marked approximate. This is the intent's rule ("foods USDA can't resolve still log with approximate numbers, never dropped") with the honesty preserved. |
| **Rate-limit posture** | Read `X-RateLimit-Limit` / `X-RateLimit-Remaining` on every response and back off as `Remaining` approaches 0. Do **not** retry on `429`: an exceed blocks the key for an hour, so a retry storm extends the outage. One `429` → `reason: 'rate-limited'` → fail open. |
| **Key handling** | Read from env at runtime. Never logged, never in a message, never committed. data.gov deactivates keys found in a repository, and the key rides in the query string, so a logged URL *is* a leaked key. The photo module's existing no-logging rule extends here. |

## Open verification — gates the mapping implementation

1. **JSON field names for `AbridgedFoodNutrient`.** The OpenAPI block declares
   `required: [id, nutrientNumber, unit]` while its `properties` show `number`, `name`,
   `amount`, `unitName`. Unresolved: live calls to `api.nal.usda.gov` return
   `403 Approval required` from this sandbox's egress policy (not from USDA), and `sbx` is
   not installed here. Settle with one call and read `foodNutrients[]`:
   ```sh
   curl -s 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=broccoli&dataType=SR%20Legacy&pageSize=1'
   ```
2. **The mapping table above** — verify against USDA's canonical nutrient list or a live
   response before the mapper is written. Gate, not a suggestion.
3. **`dataType` selection** — restrict search to `Foundation` + `SR Legacy`, so the model
   matches whole ingredients rather than packaged products.

## Non-goals

Branded foods (per-serving basis, brand capture — a photo cannot read a brand). Portion
conversions (we log grams). Storing `fdcId` on `Food` (the vector is copied at creation;
no migration, and provenance is not in scope). A food picker UI (future consumer of this
module).
