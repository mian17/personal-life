# Spec: meal-capture-ui revision — all 27 nutrients per item

Module id: `meal-capture-ui` (map: `docs/specs/MAP-meal-nutrition.md`). This is a
revision of the existing `meal-capture-ui` spec, not a new module: the page contracts
are owned by `docs/specs/SPEC-meal-capture-ui.md`; this file records the change, the
root cause, and the primitive it consumes. Contract: AGENTS.md Contract 1 — Rule 3
upstream-first, spec-first.

## Objective

Make the meal entry editor's per-item form **label every field and expose the full 27
nutrients**, with the four headline nutrients inline and the remaining set folded behind
one collapsible `All nutrients (27)` region, grouped. Success = a person logging a meal
can see what each box is, and can inspect/correct the micronutrients the photo estimate
already produced — instead of those numbers being silently discarded.

## Root cause this fixes

Two defects, one symptom: the per-item form is a row of unlabeled inputs.

1. **The fields have no visible label.** `entry/[id]/editor.tsx` renders dish, portions,
   and the four headline nutrients as bare `Input`s; their only name is an `aria-label`
   (which a sighted user never sees). The user reported exactly this: "boxes, but I
   don't know what to put." An accessible name is not a visible label (lesson 0014).
2. **The editor shows only the 4-field headline, but Gemini reads all 27.** The photo
   pipeline (`apps/meal-service/src/photo/gemini.client.ts`) asks for and validates a
   **complete 27-nutrient vector** — its `responseSchema` is generated from
   `@life/nutrition` with all 27 `required`, and `completeVector` rejects any partial
   answer. So micro estimates (sodium, vitamins, minerals…) already exist in the data;
   the editor's `HEADLINE` (`entry/[id]/page.tsx`) renders only calories/fat/carbs/protein
   and marks only those `known`, so the rest are present-but-invisible and unreachable.

## Scope check (recorded)

This expands a surface the intent explicitly deferred: `docs/intent/meal-nutrition.md`
lists "Micronutrient fields outside the agreed 27" as out of scope. That line scopes out
**tracking new micronutrients**; surfacing the **already-stored, already-estimated 27**
for optional inspection/correction is a **recorded deviation**, not a new capability —
no new field, no schema change, no new nutrient. The deviation and its rationale are
recorded in the intent doc in this change (lesson 0012 — a spec rationalization must be
written down, not silent).

## Behavior

### The item form (collapsed)

Per item: **the dish input is the row's parent line** (a `ListItem variant="nested"` title),
then its nutrients indented beneath it — `Portions`, `Calories (kcal)`, `Fat (g)`,
`Carbs (g)`, `Protein (g)` — every label **visible on the left of its control**, the
`SettingsRow` idiom already used by `/meals/target`. There is **no redundant `Item N`
header line**: the dish is the row identity. Below the fields, one **`All nutrients (27)`
trigger button**:

- It reads `All nutrients (27)` — and, when the item came from a photo estimate,
  `All nutrients (27) · 23 estimated` (the count of the non-headline nutrients the
  estimate produced). A manually-entered item shows the plain label, no hint.
- It **opens the full-screen nutrients modal** (below), it does not expand inline — a
  third nesting level inside the row was the wrong shape.
- One short hint line under the `Items` section explains the two things the boxes don't:
  portions multiply the numbers below; a blank value means unknown, not zero.

### The nutrients modal (full screen)

The trigger opens a **`Dialog size="full"`** — a full-screen sheet (`100dvh`, edge-to-edge,
square corners) titled `All nutrients`, holding all 27 nutrients, each exactly once, in
groups — every group a labelled sub-heading, every field a visible label with its unit:

| Group | Fields |
|---|---|
| Macros | Calories, Fat, Carbohydrates, Protein |
| Fat breakdown | Monounsaturated Fat, Polyunsaturated Fat, Saturated Fat, Trans Fat |
| Cholesterol & sodium | Cholesterol, Sodium |
| Carb breakdown | Fiber, Sugar |
| Vitamins | Vitamin A, Vitamin C, Thiamin (B1), Riboflavin (B2), Niacin (B3), Folate (B9), Vitamin B6, Vitamin B12 |
| Minerals | Calcium, Iron, Magnesium, Phosphorus, Potassium, Zinc |
| Other | Caffeine |

Group sizes sum to 27 (4 + 4 + 2 + 2 + 8 + 6 + 1). **`Other` holds exactly `Caffeine`** —
the one field with no home group (`@life/nutrition`'s set is flat and Caffeine fits none);
it is listed rather than dropped. Labels, units (`kcal`/`g`/`mg`/`mcg`), and `unknown`
(em dash) all come from `@life/nutrition` — **no app-local nutrient or unit table**
(lesson 0016; one owner per rule).

The four headline fields **repeat** inside the `Macros` group: the modal is "all
nutrients", not "the extras" — it is the complete picture.

## Data flow

- `entry/[id]/page.tsx` (server, the only `@life/nutrition` consumer — the client may
  not import it) passes, via the existing `NutritionFields` prop:
  - `fields` — the 4 headline fields (inline rows), unchanged;
  - **new** `groups` — the seven groups above, each `{ title, fields: { key, label, unit }[] }`,
    derived from `@life/nutrition`'s `NUTRIENTS`/`NUTRIENT_LABELS` (grouping is a display
    choice, owned in the app; the package stays flat);
  - **new** `extraCount` — the number of non-headline nutrients (23), for the summary hint;
  - `unit` per field — so inline headline rows also show `kcal`/`g` (today they show none);
  - `unknown`, `empty`, `totalUnit` — unchanged.
- `entry/[id]/editor.tsx`: an item's `known` set is seeded for **all 27** keys on a photo
  estimate (today it is seeded from the 4-field `fields`), so an estimate's real micro
  numbers render when expanded rather than the `—` placeholder. Manual items start with an
  empty `known` set (unchanged).
- The `Dialog` is the `@life/ui` modal (native `<dialog>`, controlled `open`/`onOpenChange`);
  the editor is already `'use client'`, so it composes it client-side. No new server round-trip.

## Commands

```
typecheck:  npm run typecheck -w apps/app
test:unit:  npm run test:unit -w apps/app -- <file> --runInBand
test:ui:    npm run test:unit -w packages/ui -- <file> --runInBand
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/meals.spec.ts -g "meals day view"
```

## Testing Strategy

| Concern | Test level | Why |
|---|---|---|
| Every inline headline field shows a visible label + unit | unit (apps/app) | the reported symptom |
| The `All nutrients (27)` trigger opens a full-screen `Dialog size="full"` | unit (apps/app) | the new surface |
| Expanded region contains all 27 labels, each exactly once, grouped | unit (apps/app) | "grouped but never drop a nutrient" |
| `· 23 estimated` hint shows for a photo item, absent for a manual item | unit (apps/app) | the hint's condition |
| A photo estimate's micro value renders its number, not `—` | unit (apps/app) | the point: estimates must land, not be discarded |
| Day-total and existing e2e concerns still pass | e2e (single spec) | no regression to the number the app exists to show |

## Boundaries

- **Always:** compose `@life/ui` (`Dialog`, `SettingsRow`, `Input`, `ListItem variant="nested"`);
  route units and labels through `@life/nutrition`; keep the four headline fields inline and
  the full 27 behind the modal trigger.
- **Ask first:** changing the frozen e2e selector surface; any further `packages/ui`
  primitive; opening the modal on first render.
- **Never:** a raw `<details>`/`<summary>`/`<input>` in `apps/*` (Contract 1 Rule 1); an
  app-local unit or nutrient-label table; fabricating `0` for unknown; a second nutrient
  list that can drift from `@life/nutrition`.

## Success Criteria

1. Every field in the item form has a visible label; the headline rows show their unit.
2. An `All nutrients (27)` trigger opens a full-screen `Dialog size="full"`; the modal shows
   all 27 fields exactly once across the seven groups; `Caffeine` listed under `Other`.
3. A photo-estimated item marks all 27 `known` and shows real micro numbers; a manual
   item shows `—` and no `estimated` hint.
4. `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
   and `grep -rn "next/link" apps --include='*.tsx'` return zero hits (Contract 1).
5. The named unit tests pass; the single-spec `meals day view` e2e run passes.
