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
| Search returns nutrients | `SearchResultFood.foodNutrients: AbridgedFoodNutrient[]` | A single `/v1/foods/search` call yields candidates **and** their numbers — no second fetch needed to show a match. |
| `pageSize` | default 50, max 200 | |
| **Rate limit — real key** | **1,000 req/hour per IP**; exceed → `429` and the key is **blocked for 1 hour** | A retry storm after a 429 is not just futile, it extends the block. One `429` must fail open to the fallback path, not queue. |
| **Rate limit — `DEMO_KEY`** | **30 req/hour, 50 req/day per IP** | Dev/exploration only. Usable for a smoke test; far too low to develop against casually, which makes **caching mandatory from the first line** rather than a later optimisation. |
| **Rate-limit headers** | `X-RateLimit-Limit`, `X-RateLimit-Remaining` on **every** response | Read them. Back off as `Remaining` approaches 0 instead of discovering the wall via a `429`. |
| `DEMO_KEY` | `?api_key=DEMO_KEY` | Documented public key for exploring the API before signup. Not a stand-in for production. |
| `dataType` filter | `Branded` \| `Foundation` \| `Survey (FNDDS)` \| `SR Legacy` | For "what is this food", **Foundation** and **SR Legacy** are the generic-whole-food types. Branded is packaged goods — wrong shape for "chicken". |

---

## Endpoints

### `GET /v1/foods/search` — keyword search

Params: `query` (required, supports search operators), `dataType[]`, `pageSize` (max
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

### `GET /v1/foods/list` — paged listing (abridged)

`dataType[]`, `pageSize` (max 200), `pageNumber`, `sortBy`, `sortOrder`.

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

### `AbridgedFoodNutrient`

| Field | Type | Example |
|---|---|---|
| `number` | integer | `303` — the USDA **nutrient number** |
| `name` | string | `Iron, Fe` |
| `amount` | float | `0.53` |
| `unitName` | string | `mg` |
| `derivationCode` | string | `LCCD` |
| `derivationDescription` | string | |

Note: the OpenAPI block lists `required: [id, nutrientNumber, unit]` while the
`properties` show `number` / `name` / `amount` / `unitName`. The property names are
what the API actually returns; treat the `required` list as spec sloppiness.

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

1. **Nutrient-number → `@life/nutrition` key mapping.** Our 27 keys are
   (`packages/nutrition/src/nutrients.ts`): `calories`, `fat`, `monounsaturatedFat`,
   `polyunsaturatedFat`, `saturatedFat`, `transFat`, `cholesterol`, `sodium`,
   `carbohydrates`, `fiber`, `sugar`, `protein`, `vitaminA`, `vitaminC`, `thiaminB1`,
   `riboflavinB2`, `niacinB3`, `folateB9`, `vitaminB6`, `vitaminB12`, `calcium`,
   `iron`, `magnesium`, `phosphorus`, `potassium`, `zinc`, `caffeine`.
   This mapping table is the single place where "correct nutrients" can silently
   become wrong, so it gets its own spec section and its own tests.
2. **Unit normalization.** USDA reports `unitName`; our vocabulary is
   `kcal | g | mg | mcg | ml` (with `mcg`, never `µg`). Any mismatch is a conversion
   or a rejection — never a silent pass-through.
3. **Per-100 g basis.** USDA's `amount` is per 100 g for Foundation/SR Legacy. Our
   decision is `Food.servingGrams = 100`, so those match directly. Branded foods
   report per serving — out of scope for now.
4. **Which `dataType` to search.** Restrict to `Foundation` + `SR Legacy` so the
   model matches whole ingredients, not packaged products.
5. ~~**Rate limits.**~~ **Settled** (FDC API guide, pasted 2026-10-04): 1,000 req/hour
   per IP on a real key with a 1-hour block on exceed; `DEMO_KEY` is 30/hour, 50/day.
   `X-RateLimit-Limit` / `X-RateLimit-Remaining` come back on every response, so the
   client backs off on the header rather than waiting for a `429`. See the facts table.

---

## Verification status (2026-10-04)

The **live field-name question is still open** — specifically whether
`AbridgedFoodNutrient` returns `number` / `amount` / `unitName` (its `properties`, which
this file assumes) or `nutrientNumber` / `unit` (its `required` list). Two attempts to
settle it against the live API failed for environment reasons, not API reasons:

- `curl https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&…` → HTTP 403 with
  body `Approval required for api.nal.usda.gov:443`. That is the **sandbox egress
  policy**, not USDA refusing the key.
- The same call through the fetch tool → the same 403.

`sbx` is not on this machine's `PATH`, so the block cannot be cleared from here. To settle
it, run the call from a machine with egress and paste the response:

```sh
curl -s 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=broccoli&dataType=SR%20Legacy&pageSize=1'
```

One `foods` entry's `foodNutrients[]` settles it. **Do not write the mapping table against
the assumption** — the spec's `required`/`properties` disagreement is exactly the kind of
detail that turns "USDA-verified" into "silently wrong".
