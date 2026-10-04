# Capability Map: meal-nutrition

/ Source: `docs/intent/meal-nutrition.md` (confirmed 2026-10-02).
Status: **shipped** 2026-10-03 — all four modules below are implemented and live in the
codebase: `nutrition-model` → `packages/nutrition`, `meal-service` + `target-onboarding` →
`apps/meal-service` (routes included), `meal-capture-ui` → the meals routes in `apps/app`.
The Decision log below is the record of the two cross-cutting decisions, not a to-do.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `nutrition-model` | The 27-field nutrient vocabulary, units, per-food records, portion/serving model, and pure scaling arithmetic (food × quantity → nutrients). Shared by every other module. | — |
| `meal-service` | The backend service: owner-scoped diary entries, saved meals, targets, photo→Gemini pipeline, cache layering, content at rest. | `nutrition-model` |
| `meal-capture-ui` | The photo entry door (its editor also serves manual entry), the saved-meals toolbar door, the review-correct step, and the day view with total vs target. Consumes `meal-service` through the `apps/app` BFF. | `meal-service` |
| `target-onboarding` | Profile capture (age, sex, height, weight, activity) and the derivation + versioning of the daily calorie/macro target. | `nutrition-model` |
| `usda-source` | The USDA FoodData Central reference provider: keyword search and fetch-by-id, the **nutrient-number → `@life/nutrition` key mapping** with unit normalization to a per-100 g vector, and caching. Owns the API-key handling and the "never let a URL reach a log" rule. | `nutrition-model` |

Build order: `nutrition-model` → `usda-source` → `meal-service` + `target-onboarding` → `meal-capture-ui`

## Revision 2026-10-04 — photo → real foods (`docs/intent/meal-food-capture.md`)

One new module, two extended. Source: the confirmed intent, and
`docs/research/usda-fdc-api.md` for the external contract.

| Module | Change | Depends on |
|---|---|---|
| `usda-source` | **new** — the reference data provider | `nutrition-model` |
| `meal-service` | extended — the photo pipeline becomes **identity-only** (Gemini returns `name + grams + fdcId`, no nutrient fields) and gains a USDA search tool; the foods path gains **dedup-by-name** | `usda-source` |
| `meal-capture-ui` | extended — `Portions` becomes `Grams`; rows are foods | `meal-service` |

Dependency direction is unchanged and acyclic: `nutrition-model` → `usda-source` →
`meal-service` → `meal-capture-ui`. `usda-source` ships **inside**
`apps/meal-service/src/usda/`, following the `target-onboarding` precedent (a module need
not be a workspace). `ponytail:` extract to `packages/usda` only when a second consumer
(food picker, second service) actually exists — the nutrient-mapping table is the piece
that would move.

## Notes on boundaries

- `nutrition-model` is a **workspace package** (`packages/nutrition`), not a service: it is pure
  types plus pure arithmetic, following the `@life/cache` / `@life/crypto` precedent. It exists
  because both the service (scaling a portion, summing a day) and the UI (%DV rendering, unit
  formatting) must agree byte-for-byte on units — a second implementation would drift.
- `meal-service` owns the Gemini call, not the UI. `apps/app` is server-only BFF and must never
  hold the Gemini credential (same rule as `API_URL` in `.env.development.example`).
- `target-onboarding` depends only on the model because the target math (BMR/TDEE → goal delta)
  is pure and independently testable, but it *ships* as routes inside `meal-service`.
- `meal-capture-ui` is the only module that touches `@life/ui`; it must not introduce visual
  language of its own (Contract 1).

## Decision log

- **2026-10-02 — `nutrition-model` ships as `packages/nutrition`, not as code inside
  `meal-service`.** Decided by the Tech Lead under standing autonomy (user asleep,
  intent already confirmed). Rationale: the service sums per-entry nutrients and the UI
  formats them as units and `%DV`; two implementations of the same 27-field unit table
  drift, and drift here is *silently wrong numbers* in the one output the whole app exists
  to produce. Follows the `@life/cache` / `@life/crypto` precedent for pure shared code.
  Cost: one more workspace. Accepted.

- **2026-10-03 — Gemini request/response contract verified against the API's own discovery
  document; model id and API base stay env-driven.** Decided by the Tech Lead under standing
  autonomy (`SPEC-meal-service` Open Questions deferred this exact decision to implementation
  time via `source-driven-development`).

  The public docs site (`ai.google.dev`) and web search were unreachable from the build
  environment (HTTP 403 on every fetch), so the verification source is the API's first-party
  discovery document, fetched live: `https://generativelanguage.googleapis.com/$discovery/
  rest?version=v1beta` (2026-10-03). Facts taken from it:
  - **Method + path:** `models.generateContent`, `POST v1beta/{+model}:generateContent`,
    `baseUrl https://generativelanguage.googleapis.com/`. The client therefore addresses
    `<GEMINI_API_BASE>/models/<GEMINI_MODEL>:generateContent` — the base is a coordinate, never
    a hardcoded host, so a proxy or a different version moves without a code change.
  - **Auth:** key in an `x-goog-api-key` header, never in the URL. Confirmed live and
    first-party: an unauthenticated `GET /v1beta/models` returns
    `403 PERMISSION_DENIED — "Method doesn't allow unregistered callers … Please use API Key"`.
  - **Request:** `contents[].parts[]` carrying `{ text }` and `{ inlineData: { mimeType, data } }`
    (raw bytes base64 in `Blob.data`); `generationConfig.{ responseMimeType: "application/json",
    responseSchema }`. The schema vocabulary is `Schema.type ∈ STRING|NUMBER|INTEGER|BOOLEAN|
    ARRAY|OBJECT` with `properties`/`required`/`items`. (`GenerationConfig` also exposes
    `responseFormat`; the long-standing `responseSchema` pair is kept.)
  - **Image MIME types:** `image/png`, `jpeg`, `jpg`, `webp`, `heic`, `heif`, `gif`, `avif`
    (per `Blob.mimeType`). Byte-size limits are a request concern, left to the endpoint DTO.
  - **Response envelope:** `candidates[].content.parts[].text`, where `text` is the model's
    JSON string.

  **Model id is not decided here:** `GEMINI_MODEL` is env-supplied, exactly as the spec
  requires, so the choice of a concrete model stays an environment/ops decision rather than a
  constant in code.

  **Failure shape:** the model is asked for `{ readable: boolean, items: PhotoItemSuggestion[] }`.
  `readable: false` maps to the same "could not read" result as a non-2xx, a timeout, a
  network error, a non-envelope body, or a schema violation — the client resolves exactly one
  failure value and never returns a partial or invented nutrient. The 27 vector fields are
  generated from `@life/nutrition` and validated by `completeVector`, the existing single owner
  of the completeness rule (lesson 0016) — one vocabulary, not a second copy.

  **Assumption on record:** because the docs site was unreachable, the model-id families and any
  doc-only guidance (e.g. per-model image byte limits) could not be read from prose; only the
  structural contract above was verified first-party. A later live smoke check against the
  configured model remains the human-run validation (spec's "one optional manual smoke check").

- **2026-10-04 — Gemini is identity-only; nutrient values never transcribe through the
  model.** Decided by the Tech Lead under standing autonomy (intent confirmed). The model
  returns `name + grams + fdcId` and the backend fetches the authoritative vector by id.
  Rationale: asking one call to both *recognise* food and *invent 27 numbers* mixes a
  high-accuracy task with a low-accuracy one, and the invented half is the half the whole
  app exists to produce. A number copied through the model's own text can drift from its
  source even when the source is correct. Cost accepted: the estimate becomes a multi-turn
  call (photo → tool call → answer), so it is slower, and USDA lookups need caching.

- **2026-10-04 — `usda-source` ships inside `apps/meal-service/src/usda/`, not as a
  workspace package.** `ponytail:` extraction ceiling — the nutrient-number → key mapping
  table is the piece that moves to `packages/usda` if a second consumer (a food picker, a
  second service) appears. Rationale: `nutrition-model` earned a workspace because two
  consumers *already existed* (the service sums, the UI formats). `usda-source` has one
  today. Building the package now would be scaffolding for a consumer that does not exist.

- **2026-10-04 — Food base is 100 g.** `Food.servingGrams = 100` with the base vector
  per-100 g, matching the nutrition-label convention and USDA's own reporting basis for
  Foundation / SR Legacy. Fits the existing `Food`/`Serving`/`Entry` schema with **no
  migration**.

## Deliberately absent modules

- No sharing module, no barcode module, no trends/history module, no import module — all
  out of scope in the intent doc. Ownership isolation is a *property* of `meal-service`'s
  schema, not a module.
