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
never returns a partial vector.

```ts
type UsdaResult =
  | { ok: true; vector: NutrientVector }
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
2. **A missing USDA row is `0`, and that is this codebase's established meaning of
   absent.** `apps/meal-service/src/foods/content.ts` already owns this rule:
   `zeroVector()` is "no nutrient data for this field", and a vector is whole or absent —
   never partial with holes. USDA foods legitimately lack rows (a food with no measured
   caffeine has no 262), so the mapper fills all 27 and a missing row becomes `0`. If
   *nothing* maps, return `reason: 'unmapped'` rather than an all-zero vector, which would
   read as "verified none" when it means "we found nothing".
3. **`completeVector()` is the completeness rule — the mapper does not restate it.**
   Every vector leaving this module goes through `content.ts`'s `completeVector`: all 27
   fields, finite, non-negative. The mapper's job is to produce 27 numbers;
   `completeVector` is the only code allowed to declare one a valid vector (lesson 0016 —
   one owner per rule).
4. **The mapping runs once.** The catalog stores our mapped per-100 g vector, never the
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
| **Failure mode** | **Fail open.** A `429`, timeout, or parse error must never fail an estimate — the food still logs ("foods USDA can't resolve still log with approximate numbers, never dropped"). The model's approximate vector stands in for the missing reference. |
| **Rate-limit posture** | Read `X-RateLimit-Limit` / `X-RateLimit-Remaining` and back off as `Remaining` approaches 0. Do **not** retry on `429`: an exceed blocks the key for an hour, so a retry storm extends the outage. One `429` → `reason: 'rate-limited'` → fail open. With dedup-by-name, a real key's 1,000 req/hour is ample — the lookups are per-new-food, not per-photo. |
| **Key handling** | Read from env at runtime. Never logged, never in a message, never committed. data.gov deactivates keys found in a repository, and the key rides in the query string, so a logged URL *is* a leaked key. The photo module's existing no-logging rule extends here. |

**On honesty of the fallback.** `Food` has no provenance field and adding one would be a
migration (a human's to run, never an agent's). So "was this USDA-verified?" is **not**
persisted per food. It lives where the feature already carries it: the estimate response
marks each item `isEstimated`, and the editor already renders that. A food created from a
USDA lookup and one created from an approximation look identical in the catalog — and the
user can correct either, which is the mechanism that actually matters.

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
