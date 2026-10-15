# USDA FoodData Central API — reference

**Source:** the FDC OpenAPI 3.0 spec, pasted by the user 2026-10-04 while scoping
`docs/intent/meal-food-capture.md`. **Canonical copy:** `GET https://api.nal.usda.gov/fdc/v1/yaml-spec`
(also `/v1/json-spec`). **Version:** 1.0.1. **License:** CC0 1.0 Universal —
public domain, fine to integrate and to copy data from.

This file is source material for the "photo → real foods, USDA-verified nutrients"
work. The pasted spec was **elided** (it carried `... (repeats N lines ...)` markers),
so schema field names/types below are faithful but some examples are trimmed. Fetch
the canonical spec if a complete reading is ever needed.

---

## Facts that bind the integration

| Fact | Value | Why it matters |
|---|---|---|
| Auth | **API key in the query string** — `?api_key=…` (`ApiKeyAuth: { in: query, name: api_key }`) | Not a header. The key travels in the URL, so it must never reach a log line or an error message. `photo.module` already emits no logs; the USDA client must keep that rule. |
| Base URL | `https://api.nal.usda.gov/fdc` | |
| License | CC0 1.0 | Public domain — no legal attribution duty. They do **ask** for it: `U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.` Costless to honour; cite in the about/credits surface when the catalog is shown. |
| **Key handling** | data.gov keys found "online, such as in a code repository, will be deactivated to prevent malicious use" | The vendor actively scans for leaked keys and kills them. The key is therefore an env var read at runtime and **never** logged, never in a URL that reaches a log, never committed. This upgrades the hard line from hygiene to a real outage risk. |
| `fdcId` | **integer** | Not a string. Decide the type before it reaches the Gemini tool schema. |
| `nutrients` query filter | max **25** values | We track **27** nutrients, so the response cannot be narrowed to exactly our set in one call. |
| Search returns nutrients | `SearchResultFood.foodNutrients` rows are **flat**: `nutrientNumber` (string), `nutrientName`, `nutrientId` (number), `unitName`, value in **`value`** — verified live 2026-10-05 | A single `/v1/foods/search` call yields candidates **and** their numbers — no second fetch needed to show a match. But these rows are **never mapped**: `search_food` uses only `description` + `fdcId` and carries no amounts. Only `GET /v1/food/{fdcId}` rows are mapped. |
| `pageSize` | default 50, max 200 | |
| **Rate limit — real key** | **1,000 req/hour per IP**; exceed → `429` and the key is **blocked for 1 hour** | A retry storm after a 429 is not just futile, it extends the block. One `429` must fail open to the fallback path, not queue. |
| **Rate limit — `DEMO_KEY`** | **30 req/hour, 50 req/day per IP** | Dev/exploration only. Usable for a smoke test; far too low to develop against casually, which makes **caching mandatory from the first line** rather than a later optimisation. |
| **Rate-limit headers** | `X-RateLimit-Limit`, `X-RateLimit-Remaining` on **every** response | Read them. Back off as `Remaining` approaches 0 instead of discovering the wall via a `429`. |
| `DEMO_KEY` | `?api_key=DEMO_KEY` | Documented public key for exploring the API before signup. Not a stand-in for production. |
| `dataType` filter | `Branded` \| `Foundation` \| `Survey (FNDDS)` \| `SR Legacy` | For "what is this food", **Foundation** and **SR Legacy** are the generic-whole-food types. Branded is packaged goods — wrong shape for "chicken". |

---

## Endpoints

### `GET /v1/foods/search` — keyword search

Params: `query` (required, supports search operators), `dataType` (the spec writes the
param as `dataType[]`, but the live API answers that array style with a `400`
`{"error":"Bad Request","message":"Invalid request. Please try again."}` — send
plain `dataType`, repeated once per value or comma-separated in one value; both
return `200`, verified 2026-10-05), `pageSize` (max
200), `pageNumber`, `sortBy` (`dataType.keyword` \| `lowercaseDescription.keyword` \| `fdcId`
\| `publishedDate`), `sortOrder` (`asc` \| `desc`), `brandOwner`.

→ `SearchResult` = `{ ...FoodSearchCriteria, totalHits, currentPage, totalPages, foods: SearchResultFood[] }`

Errors: `400` bad input parameter.

### `GET /v1/food/{fdcId}` — one food

Params: `fdcId` (path, required, **string**), `format` (`abridged` \| `full`, default `full`),
`nutrients` (repeatable / comma-separated, max 25).

→ one of `AbridgedFoodItem` \| `BrandedFoodItem` \| `FoundationFoodItem` \| `SRLegacyFoodItem` \| `SurveyFoodItem`

Errors: `400`, `404`.

### `GET /v1/foods` — batch by ids (max 20)

`fdcIds` (required, comma-separated or repeated, max 20). Invalid/missing ids are
omitted; empty set when nothing matches. Optional `format`, `nutrients`.

Also `POST /v1/foods` (`FoodsCriteria`: `fdcIds`, `format`, `nutrients`).

#### Batch by ids — confirmed live 2026-10-05

`GET /v1/foods?fdcIds=747447,170379&api_key=…` → **200**, a JSON **list** of two
foods; `POST /v1/foods` with body `{"fdcIds":[…]}` returns the same list (200). The
list entries' `foodNutrients[]` rows are the **identical nested shape**
`GET /v1/food/{fdcId}` returns — row keys `['nutrient', 'type']`, `nutrient` keys
`['id', 'name', 'number', 'rank', 'unitName']`, `amount` on the row. The same id
yields the same row count either way (747447 → 113 rows). So `mapUsdaNutrients`
applies to a batch entry unchanged: the batch endpoint is the same read, once per
20 ids instead of once per id.

**Max 20 `fdcIds` per request.** An invalid or unknown id is **silently omitted**
from the list (never a 404, never a throw) — the caller maps the absent id to its
own "no vector" outcome. `format` and `nutrients` are optional, as on the single
fetch.

**Why batching is the fetch path, and not the search path.** There is **no batch
search**: `GET /v1/foods/search` accepts repeated `query` params, but returns one
**blended** `foods` list with **no per-query attribution**, and
`GET /v1/foods?query=x&query=y` is a `400`. Search rows also cannot replace a
fetch: `/v1/foods/search` returns 22 `foodNutrients` rows for a chicken breast that
map only **15 of our 27** keys (no calories, no vitamins), while the fetch returns
26 rows that map fully. So a photo's nutrient vectors come from **one batch fetch
per estimate**, chunked at 20 ids — never from search, and never one fetch per food.

### `GET /v1/foods/list` — paged listing (abridged)

`dataType` (same live wire shape as the search endpoint — repeated plain `dataType`,
never the `dataType[]` the spec writes), `pageSize` (max 200), `pageNumber`, `sortBy`, `sortOrder`.

---

## Schemas the integration touches

### `SearchResultFood`

| Field | Type | Notes |
|---|---|---|
| `fdcId` | integer | e.g. `45001529` |
| `dataType` | string | `Branded` \| `Foundation` \| `Survey` \| `SR Legacy` \| `Sample` |
| `description` | string | e.g. `BROCCOLI` — this is the food name |
| `foodCode` | string | FNDDS only |
| `publicationDate` | string | `4/1/2019` |
| `scientificName` | string | |
| `brandOwner` | string | Branded only |
| `gtinUpc` | string | Branded only |
| `ingredients` | string | Branded only, label text |
| `ndbNumber` | integer | Foundation / SR Legacy only |
| `additionalDescriptions` | string | e.g. `Coon; sharp cheese; Tillamook; …` |
| `allHighlightFields` | string | |
| `score` | float | how well it matched the query |
| `foodNutrients` | `AbridgedFoodNutrient[]` | **the numbers, already here** |

### Nutrient-row shapes — confirmed live 2026-10-05

**There are TWO shapes, one per endpoint — not one `AbridgedFoodNutrient`.** The earlier
mismatch (the OpenAPI block's `required: [id, nutrientNumber, unit]` against its
`properties` showing `number` / `name` / `amount` / `unitName`) was the schema conflating
the two endpoints. Verified against live responses; samples retained at
`/tmp/opencode/usda-search.json` and `/tmp/opencode/usda-food.json`.

#### `GET /v1/foods/search` — `foods[].foodNutrients[]` rows are **flat**

```json
{ "nutrientId": 1292, "nutrientName": "Fatty acids, total monounsaturated",
  "nutrientNumber": "645", "unitName": "G", "value": 0.031,
  "derivationCode": "NC", "derivationDescription": "Calculated", "derivationId": 49,
  "foodNutrientSourceId": 2, "foodNutrientSourceCode": "4",
  "foodNutrientSourceDescription": "Calculated or imputed", "rank": 11400,
  "indentLevel": 1, "foodNutrientId": 1518787, "dataPoints": 0 }
```

Winning names here: `nutrientNumber` (**string**, e.g. `"645"` — wins over `number`),
`nutrientName`, `nutrientId` (number), `unitName` (wins over `unit` on both endpoints),
and the value is **`value`**. Other fields observed: `derivationCode` (`NC`),
`derivationDescription`, `derivationId`, `foodNutrientSourceId`/`Code`/`Description`,
`rank`, `indentLevel`, `foodNutrientId`, `dataPoints`, sometimes `min`/`max`.

#### `GET /v1/food/{fdcId}` — `foodNutrients[]` rows are **nested**

```json
{ "nutrient": { "id": 1008, "number": "208", "name": "Energy", "rank": 500, "unitName": "kcal" },
  "amount": 34.0, "type": "FoodNutrient", "id": 1518841,
  "dataPoints": 49, "min": 22.0, "max": 44.0,
  "foodNutrientDerivation": { "id": 43, "code": "JO", "description": "..." } }
```

Winning names here: `nutrient.number` (**string**), `nutrient.name`, `nutrient.id`
(number), `nutrient.unitName`; and the value is **`amount`** at the row's top level — **not**
`value`. The competing value-field candidates were both wrong: the answer is `value` on
search and `amount` on fetch-by-id.

#### Which one the mapper reads

Only `GET /v1/food/{fdcId}` supplies a nutrient vector (`fetchByFdcId`): the mapper reads
`foodNutrients[].nutrient.number` + `.nutrient.unitName` + `.amount` — nothing else. The
search shape is **never mapped**: `search_food` uses only `foods[].description` (the name)
and `foods[].fdcId`, and its result deliberately carries no amounts
(`SPEC-photo-identity.md` §"The tool loop").

#### Group rows — skip structurally

`/v1/food/{fdcId}` mixes in group rows carrying **no `amount`**:

```json
{ "nutrient": { "id": 2045, "number": "951", "name": "Proximates", "rank": 50, "unitName": "g" },
  "type": "FoodNutrient" }
```

Observed group numbers: `951` Proximates, `950` Lipids, `952` Vitamins and Other
Components, `956` Carbohydrates, `300` Minerals, `500` Amino acids. The rule is
**structural, not a hard-coded group list: skip any row where `amount` is not a number.**

#### Unit spelling — normalise, never convert

Unit spelling differs by endpoint: search returns `G`, `MG`, `UG`, `KCAL`, `IU`, `kJ`;
fetch-by-id returns `g`, `mg`, `µg`, `kcal`, `IU`. Our vocabulary
(`packages/nutrition/src/nutrients.ts`) is `kcal | g | mg | mcg | ml` with `mcg` ASCII,
never `µg`. Normalisation is **spelling only — there is no numeric conversion anywhere**,
because every mapped key's USDA row reports a spelling variant of our unit:

| USDA spelling | our unit |
|---|---|
| `g`, `G` | `g` |
| `mg`, `MG` | `mg` |
| `mcg`, `µg`, `UG`, `ug` | `mcg` |
| `kcal`, `KCAL` | `kcal` |

A row whose **normalised** unit does not equal its key's expected unit yields `unmapped` —
never a silent pass-through, never an invented factor. An `IU` row (e.g. `318`
"Vitamin A, IU") or a `kJ` row (`268` Energy in kJ) is never mapped to a
`mcg`/`mg`/`g`/`kcal` key; `unmapped` is the correct outcome.

### `FoodNutrient` (full format)

`id`, `amount`, `dataPoints`, `min`, `max`, `median`, `type`, plus nested
`nutrient` (see below), `foodNutrientDerivation`, `foodNutrientSource`,
`nutrientAnalysisDetails`, `nutrientAcquisitionDetails`.

### `Nutrient` (referenced by `FoodNutrient`)

Carries the USDA **nutrient number** (`number`, e.g. `303`), `name`, `unitName`
(`mg`, `g`, `mcg`, `kcal`, …). This is the id we map onto `@life/nutrition`'s keys.

### `AbridgedFoodItem`

`fdcId` (integer), `dataType`, `description`, `foodNutrients[]`, `publicationDate`,
`brandOwner`, `gtinUpc`, `ndbNumber`, `foodCode`.

### `FoundationFoodItem` / `SRLegacyFoodItem`

Adds `foodClass`, `foodCategory`, `foodPortions[]`, `foodComponents[]`,
`inputFoods[]`, `nutrientConversionFactors[]`, `scientificName`, `ndbNumber`,
`footNote`, `isHistoricalReference`. `SRLegacyFoodItem` is the same shape.

`FoodPortion`: `id`, `gramWeight`, `portionCode`, `portionDescription`
(e.g. `1 tablespoon`), `measureUnit` (`MeasureUnit`: `id`, `abbreviation`, `name`).

### `BrandedFoodItem`

`brandOwner`, `gtinUpc`, `ingredients` (label text), `servingSize`, `servingSizeUnit`,
`householdServingFullText`, `foodClass`, `dataSource`, `availableDate`, `brandedDate`,
`tradeChannels[]`, `foodNutrients[]`. Not the shape we want for whole ingredients.

---

## Still to derive before implementation

1. **Nutrient-number → `@life/nutrition` key mapping.** **Resolved 2026-10-05** — the
   confirmed 27-row table lives in `docs/specs/SPEC-usda-source.md` §"The mapping"
   (keyed on the **string** `nutrientNumber`; `nutrientId` recorded as a cross-check). Our
   27 keys are (`packages/nutrition/src/nutrients.ts`): `calories`, `fat`,
   `monounsaturatedFat`, `polyunsaturatedFat`, `saturatedFat`, `transFat`, `cholesterol`,
   `sodium`, `carbohydrates`, `fiber`, `sugar`, `protein`, `vitaminA`, `vitaminC`,
   `thiaminB1`, `riboflavinB2`, `niacinB3`, `folateB9`, `vitaminB6`, `vitaminB12`,
   `calcium`, `iron`, `magnesium`, `phosphorus`, `potassium`, `zinc`, `caffeine`.
   The table is the single place where "correct nutrients" can silently become wrong, so
   it gets its own spec section and its own tests.
2. **Unit normalization.** **Resolved 2026-10-05** — spelling only, no numeric conversion;
   see "Unit spelling" above. USDA reports `unitName` (per endpoint, see the two shapes);
   our vocabulary is `kcal | g | mg | mcg | ml` (with `mcg`, never `µg`). A normalised-unit
   mismatch is `unmapped` — never a silent pass-through, never an invented factor.
3. **Per-100 g basis.** USDA's `amount` is per 100 g for Foundation/SR Legacy (the live
   SR Legacy sample confirms it: broccoli raw = 34 kcal / 100 g). Our decision is
   `Food.servingGrams = 100`, so those match directly. Branded foods report per serving —
   out of scope for now.
4. **Which `dataType` to search.** Restrict to `Foundation` + `SR Legacy` so the
   model matches whole ingredients, not packaged products.
5. ~~**Rate limits.**~~ **Settled** (FDC API guide, pasted 2026-10-04): 1,000 req/hour
   per IP on a real key with a 1-hour block on exceed; `DEMO_KEY` is 30/hour, 50/day.
   `X-RateLimit-Limit` / `X-RateLimit-Remaining` come back on every response, so the
   client backs off on the header rather than waiting for a `429`. See the facts table.

---

## Verification status (2026-10-05)

**The live field-name question is settled.** `GET /v1/foods/search` and
`GET /v1/food/{fdcId}` were both reached and their `foodNutrients[]` shapes are the two
documented above — flat (search, `nutrientNumber`/`unitName`/`value`) and nested
(fetch-by-id, `nutrient.number`/`nutrient.unitName`/`amount`). Samples retained at
`/tmp/opencode/usda-search.json` and `/tmp/opencode/usda-food.json`. The 27-row mapping
table in `SPEC-usda-source.md` is confirmed against them and its status line reads
confirmed. This supersedes the 2026-10-04 note that the question was blocked by the
sandbox egress policy (HTTP 403 `Approval required for api.nal.usda.gov:443`) — the API
was reachable for the 2026-10-05 verification.
