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
| `meal-capture-ui` | The three entry doors (saved meal / manual / photo+hint), the review-correct step, and the day view with total vs target. Consumes `meal-service` through the `apps/app` BFF. | `meal-service` |
| `target-onboarding` | Profile capture (age, sex, height, weight, activity) and the derivation + versioning of the daily calorie/macro target. | `nutrition-model` |

Build order: `nutrition-model` → `meal-service` + `target-onboarding` → `meal-capture-ui`

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

## Deliberately absent modules

- No sharing module, no barcode module, no trends/history module, no import module — all
  out of scope in the intent doc. Ownership isolation is a *property* of `meal-service`'s
  schema, not a module.
