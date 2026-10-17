# Spec: manual-log-ui

Module id: `manual-log-ui` (map: `docs/specs/MAP-meal-food-management.md`). Depends on
`food-units` (the wire contract). Touches `@life/ui` only (Contract 1); one upstream
`packages/ui` addition (below).

## 0. Assumptions (surfaced before the spec)

Carried from the map (items 3, 5–9, 11 apply directly). Module-specific:

1. The FAB dropdown has exactly two options: photo capture (`/meals/entry/new?door=photo`,
   visible name kept verbatim `Log meal from photo`) and the new manual door
   (`/meals/entry/new?door=food`, visible name `Log food`).
2. The picker seeds **one** editor item; the existing editor owns meal group, date,
   review, and save. No bespoke wizard, no second save path.
3. A seeded item renders like a restored entry: real numbers everywhere, headline keys
   in `known` (never the estimated fingerprint, never the unknown affordance) — the
   catalog facts are typed label values, not estimates.

## 1. Objective

The manual log flow the intent asks for: pick catalog food × amount → meal group → date,
as one of two FAB dropdown options — the door for daily staples (1 L milk box) that photo
capture is the wrong tool for. It replaces the "dish name stands in until a food picker
exists" gap (`editor.tsx:79`) for this door.

**User:** the meals-app user logging daily staples (e.g. a 1 L milk box, same brand) by hand — the user the confirmed intent (`docs/intent/meal-food-management.md`) names — daily, in a few taps, no photo.
**Success:** the intent's success steps 2–3 — each day log "250 ml" or "1 carton" in a
few taps and see correct nutrients on the day view; editing the food later never rewrites
past entries.

Acceptance criteria:

- AC1 The day view's FAB opens a dropdown with the two options; the photo door and its
  e2e journey work unchanged (`PHOTO_DOOR` name intact).
- AC2 The manual door lists the owner's catalog foods (searchable) and offers the amount
  as a number in the food's **canonical unit** (default 100) **or** one of its named
  measures with a count (default 1). No unit toggle, no conversion — the amount picker
  shows the food's own unit.
- AC3 Confirming seeds one editor item and saves `POST /api/entries` with
  `quantity = amount / food.servingGrams` and the confirmed snapshot `scale(food,
  quantity)` — e.g. 250 ml of a per-100 ml food logs `quantity: 2.5`, "1 carton" (1000)
  logs `quantity: 10`.
- AC4 The day view shows the entry in the chosen meal group on the chosen date, with the
  nutrients the snapshot carried, summed into the day total.
- AC5 Editing or deleting the food afterwards leaves the logged entry's row and the day
  view numbers unchanged.
- AC6 Empty catalog: the door shows an `EmptyState` linking to `/meals/foods`, never a
  picker with no foods.

## 2. Commands

```
typecheck:  npm run typecheck -w apps/app        # and -w packages/ui when the FabMenu lands
test:unit:  npm run test:unit -w apps/app -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

`max-test-runs: 2` (project profile) — one suite per command, at most two runs.

## 3. Project Structure

```
packages/ui/src/components/fab-menu.tsx   # NEW upstream block (see §4), spec'd in SPEC-ui-blocks.md + MAP-ui-primitives.md in the same change
apps/app/
  app/(meals)/meals/day.tsx               # FabLink → FabMenu with the two doors
  app/(meals)/meals/entry/[id]/editor.tsx # door=food seeding path (replaces the dish stand-in for this door)
  app/(meals)/meals/entry/[id]/food-picker.tsx  # NEW client step: food list + amount/measure
  lib/meal-api.ts                         # listMealFoods(q?) shared with food-catalog-ui (food-units owns shapes)
  test/meal-log.test.tsx                  # picker → quantity/snapshot maths + seeding (jest)
  test/meal-editor.test.tsx               # + door=food cases (existing file)
  test/e2e/meals.spec.ts                  # + the manual-log journey (-g target)
```

## 4. Code Style

Primitive reuse plan (element by element, Contract 1):

- **FAB dropdown** — gap. `FabLink` is a single link and `Menu` is a row menu; neither
  fits. Fixed **upstream**: a `FabMenu` block in `packages/ui` (FabLink's trigger visuals
  + a panel of link options, `Menu`'s open/Escape/outside-click semantics), spec'd in
  `SPEC-ui-blocks.md` and registered in `MAP-ui-primitives.md` in the same change. Never
  hand-rolled in `apps/app`.
- **Food picker** — `SearchField` + `List`/`ListItem` (name + per-100 calories meta).
- **Amount** — `Input` (number) with the food's unit as adjacent `StatusText`; measures
  as `PillGroup` (one `Pill as="button"` per measure, e.g. "1 carton").
- **Meal group + date** — the existing editor's controls (unchanged); date defaults to
  `getToday()` (`apps/app/lib/today.ts`, the single owner).
- **Confirm/save** — the existing `EditorScreen`/`EditorToolbar` + `Button`/`PageActions`.
- **Empty/error** — `EmptyState` (with a `ButtonLink` to `/meals/foods`), `AlertBanner`.

```ts
/**
 * Log amount → entry quantity (`SPEC-food-units` semantics): a quantity is the
 * multiple of the food's base — the number the confirmed snapshot is scaled by.
 * The amount is in the food's own unit or a measure's stored amount; there is no
 * unit conversion anywhere (`docs/intent/meal-food-management.md`).
 */
function loggedQuantity(food: MealFood, amount: Amount): number {
  const inUnit = amount.kind === 'measure' ? amount.count * amount.measure.amount : amount.value;
  return inUnit / food.servingGrams; // 100 for every manually created food
}
```

The snapshot itself is computed with `@life/nutrition`'s `scale()` — one owner for the
arithmetic (lesson 0016); no local maths beyond the ratio above.

## 5. Testing Strategy

Jest + RTL (`apps/app/test/`, existing stub pattern) for the maths and seeding; one
Playwright `-g` journey on the frozen selector surface.

| Concern | Test level | Why |
|---|---|---|
| FAB exposes two options; `Log meal from photo` name unchanged | unit + e2e | frozen surface change, must stay minimal |
| 250 ml → `quantity: 2.5`, snapshot `scale(food, 2.5)` | unit | the correctness core (AC3) |
| "1 carton" (1000) × 1 → `quantity: 10`, snapshot `scale(food, 10)` | unit | the measure path |
| Measure count scales linearly (0.5×, 1×, 2×) | unit | `scale()` linearity relied upon |
| Seed → editor item carries foodId, real numbers, non-estimated `known` | unit | the seeding contract (assumption 3) |
| Manual log journey: pick → amount → save → correct day-view nutrients | e2e | the product's promise |
| Food edited/deleted after logging leaves the entry + totals unchanged | e2e | history immutability (AC5) |
| Empty catalog → EmptyState with link to `/meals/foods` | unit | AC6 |

## 6. Boundaries

- **Always:** compose `@life/ui` primitives; keep the review step before any save; route
  data through `lib/meal-api.ts`; derive "today" from `getToday()`; compute the snapshot
  with `scale()`; show the amount picker in the food's own unit only.
- **Ask first:** changing frozen e2e selectors beyond the enumerated FAB change; any new
  `packages/ui` primitive/prop (upstream first — the `FabMenu` here is already approved
  by the confirmed intent); changing the day-view row meta text; editing an entry's
  nutrients (out of scope).
- **Never:** raw HTML form controls or styled wrappers (Contract 1 Rule 1); a g↔ml
  conversion or a log-time unit toggle; a second save path bypassing `CreateEntryDto`'s
  confirmed snapshot; recomputing an entry's nutrients from the food on read; calling
  `estimatePhoto`/Gemini/USDA in this flow; touching the photo door's behaviour or its
  `Log meal from photo` selector.

## 7. Success Criteria

1. Day view FAB opens two options; selecting `Log meal from photo` runs the existing
   photo journey unchanged (e2e green with only the FAB selector updated).
2. An e2e run logs "Milk, Brand X" × 250 ml into breakfast on today: the entry appears
   with `quantity: 2.5`, and the day's calories equal the sum including
   `scale(V, 2.5).calories` (asserted against the rendered total).
3. A unit test proves the measure path: "1 carton" × 1 → `quantity: 10` and snapshot
   `scale(V, 10)`, and the linearity table (0.5/1/2).
4. After editing the food's facts (or deleting it), the logged entry's stored
   `nutrients` and the day view numbers are byte-identical (unit test on the request
   stub + e2e).
5. The empty-catalog door shows the `EmptyState` linking to `/meals/foods`.
6. `npm run typecheck` (touched workspaces) zero errors; the prescribed jest suites and
   one e2e `-g` run pass within `max-test-runs: 2`.

## 8. Open Questions

- Day-view amount rendering: `× 2.5` (current frozen meta) vs "250 ml"/"1 carton".
  Deferred (map §3) — any change needs its own explicit frozen-surface approval.
- Whether the photo-failure manual item (the `editor.tsx:79` stand-in) should also gain
  the picker; adjacent to the out-of-scope photo path (map §3).
- Default meal group: keep the editor's current default vs. suggest by client hour. Not
  required by the intent; decide at implementation time.
