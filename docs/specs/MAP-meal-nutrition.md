# Capability Map: meal-nutrition

/ Source: `docs/intent/meal-nutrition.md` (confirmed 2026-10-02).

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

## Deliberately absent modules

- No sharing module, no barcode module, no trends/history module, no import module — all
  out of scope in the intent doc. Ownership isolation is a *property* of `meal-service`'s
  schema, not a module.
