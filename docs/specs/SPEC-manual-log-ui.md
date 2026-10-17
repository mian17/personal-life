# Spec: manual-log-ui

Module id: `manual-log-ui` (map: `docs/specs/MAP-meal-food-management.md`). Depends on
`food-units` (the wire contract). Touches `@life/ui` only (Contract 1); the one upstream
need — `FabMenu` — already exists in `packages/ui` (see §4).

## 0. Assumptions (surfaced before the spec)

Carried from the map (items 3, 5–9, 11 apply directly). Module-specific:

1. The FAB dropdown has exactly two options: photo capture (`/meals/entry/new?door=photo`,
   visible name kept verbatim `Log meal from photo`) and the new manual door
   (`/meals/entry/new?door=food`, visible name `Log food`). The trigger icon is lucide
   `Plus` (`label="Log a meal"`) — a camera read as "photo only".
2. The food search **appends one editor item per pick** (multi-add on one screen); the existing
   editor owns meal group, date, review, and save. No bespoke wizard, no second save path.
3. An appended item renders like a restored entry: real numbers everywhere, headline keys
   in `known` (never the estimated fingerprint, never the unknown affordance) — the
   catalog facts are typed label values, not estimates.

## 1. Objective

The manual log flow the intent asks for: search the catalog and log one or more foods →
meal group → date, as one of two FAB dropdown options — the door for daily staples
(1 L milk box) that photo capture is the wrong tool for. It replaces the "dish name
stands in until a food picker exists" gap (`editor.tsx:79`) for this door.

**User:** the meals-app user logging daily staples (e.g. a 1 L milk box, same brand) by hand — the user the confirmed intent (`docs/intent/meal-food-management.md`) names — daily, in a few taps, no photo.
**Success:** the intent's success steps 2–3 — each day log "250 ml" or "1 carton" in a
few taps and see correct nutrients on the day view; editing the food later never rewrites
past entries.

Acceptance criteria:

- AC1 The day view's FAB opens a dropdown with the two options; the photo door and its
  e2e journey work unchanged (`PHOTO_DOOR` name intact).
- AC2 The manual door is search-first and multi-add on one screen. While the search query
  is empty nothing is listed (a catalog can hold 100+ foods); once it reaches the field's
  `minChars` (3) the matching foods appear in the field's popup, and tapping a row — the
  row is the option, there is no per-row `Log` button — appends that food at the default
  amount 100 in the food's **canonical unit**. No amount screen, no unit toggle, no
  conversion — the amount is in the food's own unit.
- AC3 Each row pick appends one editor item at `quantity = 100 / food.servingGrams` (a
  per-100 food: 1) with the confirmed snapshot `scale(food, quantity)`, and the query is
  kept so the next food can be added. The create path saves `POST /api/entries` once per
  item. The amount is then adjusted inline in the item row's `Grams` field
  (`quantity = grams / food.servingGrams`) — e.g. 250 ml of a per-100 ml food logs
  `quantity: 2.5`.
- AC4 The day view shows the entry in the chosen meal group on the chosen date, with the
  nutrients the snapshot carried, summed into the day total.
- AC5 Editing or deleting the food afterwards leaves the logged entry's row and the day
  view numbers unchanged.
- AC6 Empty catalog: the door shows an `EmptyState` linking to `/meals/foods`, never a
  search with no foods.
- AC7 A **new** entry's meal group is preselected from the client's local time, derived
  server-side from the existing `tz` cookie (`getDefaultMealGroup()` in
  `apps/app/lib/today.ts`): breakfast 05:00–10:59, lunch 11:00–14:59, dinner 15:00–19:59,
  snack 20:00–04:59. Editing an existing entry keeps its stored group.

## 2. Commands

```
typecheck:  npm run typecheck -w apps/app        # add -w packages/ui only when a primitive changes
test:unit:  npm run test:unit -w apps/app -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

`max-test-runs: 2` (project profile) — one suite per command, at most two runs.

## 3. Project Structure

```
packages/ui/src/components/fab-menu.tsx   # upstream block (see §4), spec'd in SPEC-ui-blocks.md + MAP-ui-primitives.md
apps/app/
  app/(meals)/meals/day.tsx               # FabMenu with the two doors
  app/(meals)/meals/meal-doors.tsx        # the FabMenu island (icon Plus)
  app/(meals)/meals/entry/[id]/editor.tsx # door=food append path (multi-add; no photo section on this door)
  app/(meals)/meals/entry/[id]/food-picker.tsx  # NEW client step: search-first food search, append on pick
  lib/meal-api.ts                         # listMealFoods(q?) shared with food-catalog-ui (food-units owns shapes)
  test/meal-log.test.tsx                  # search-first append → quantity/snapshot maths (jest)
  test/meal-editor.test.tsx               # + door=food cases (existing file)
  test/meal-time-group.test.ts            # local hour → meal group (jest)
  test/e2e/meals.spec.ts                  # + the manual-log journey (-g target)
```

## 4. Code Style

Primitive reuse plan (element by element, Contract 1):

- **FAB dropdown** — the upstream `FabMenu` block (already in `packages/ui`; FabLink's
  trigger visuals + a panel of link options, `Menu`'s open/Escape/outside-click
  semantics, spec'd in `SPEC-ui-blocks.md` and registered in `MAP-ui-primitives.md`).
  Composed in `meal-doors.tsx`; never hand-rolled in `apps/app`.
- **Food search** — the upstream `Autosuggest` block (`SPEC-ui-autosuggest.md`), one
  option per matching food (name as `label`, per-100 calories as `meta`); a row carries
  no nested control and the row tap is the pick. `clearOnSelect={false}` keeps the query
  and popup for multi-add; nothing renders until the query reaches `minChars` (3).
- **Amount** — no separate amount picker: the pick applies the default
  (`100 / food.servingGrams`), and the item row's inline `Grams` `Input` adjusts it
  (`quantity = grams / servingGrams`).
- **Meal group + date** — the existing editor's controls; date defaults to `getToday()`
  and a new entry's group to `getDefaultMealGroup()` (`apps/app/lib/today.ts`, the single
  owner — AC7).
- **Confirm/save** — the existing `EditorScreen`/`EditorToolbar` + `Button`/`PageActions`.
- **Empty/error** — `EmptyState` (with a `ButtonLink` to `/meals/foods`), `AlertBanner`.

```ts
/**
 * Log amount → entry quantity (`SPEC-food-units` semantics): a quantity is the
 * multiple of the food's base — the number the confirmed snapshot is scaled by.
 * A pick logs the default 100 in the food's own unit (one serving for the
 * canonical per-100 food); the inline `Grams` field then adjusts it the same
 * way. There is no unit conversion anywhere (`docs/intent/meal-food-management.md`).
 */
const DEFAULT_UNIT_AMOUNT = 100;   // quantity on pick = DEFAULT_UNIT_AMOUNT / food.servingGrams
// inline adjustment: quantity = grams / food.servingGrams
```

The snapshot itself is computed with `@life/nutrition`'s `scale()` — one owner for the
arithmetic (lesson 0016); no local maths beyond the ratio above.

## 5. Testing Strategy

Jest + RTL (`apps/app/test/`, existing stub pattern) for the maths and appending; one
Playwright `-g` journey on the frozen selector surface.

| Concern | Test level | Why |
|---|---|---|
| FAB exposes two options; `Log meal from photo` name unchanged | unit + e2e | frozen surface change, must stay minimal |
| Search lists nothing while the query is empty; a non-empty query narrows in memory | unit | the search-first rule (AC2) |
| Default pick of a per-100 food appends `quantity: 1`, snapshot `scale(food, 1)` | unit | the append contract (AC3) |
| Inline `Grams` 250 → `quantity: 2.5`, snapshot `scale(food, 2.5)` | unit | the correctness core (AC3) |
| Amount scales linearly (0.5×, 1×, 2×) | unit | `scale()` linearity relied upon |
| Pick → appended editor item carries foodId, real numbers, non-estimated `known` | unit | the append contract (assumption 3) |
| A new entry's group comes from the client's local hour; editing keeps the stored one | unit | the meal-group decision (AC7) |
| Manual log journey: search → pick → grams → save → correct day-view nutrients | e2e | the product's promise |
| Food edited/deleted after logging leaves the entry + totals unchanged | e2e | history immutability (AC5) |
| Empty catalog → EmptyState with link to `/meals/foods` | unit | AC6 |

## 6. Boundaries

- **Always:** compose `@life/ui` primitives; keep the review step before any save; route
  data through `lib/meal-api.ts`; derive "today" from `getToday()` and a new entry's meal
  group from `getDefaultMealGroup()`; compute the snapshot with `scale()`; keep the amount
  in the food's own unit only.
- **Ask first:** changing frozen e2e selectors beyond the enumerated FAB change; any new
  `packages/ui` primitive/prop (upstream first — the `FabMenu` here is already approved
  by the confirmed intent); changing the day-view row meta text; editing an entry's
  nutrients (out of scope).
- **Never:** raw HTML form controls or styled wrappers (Contract 1 Rule 1); a g↔ml
  conversion or a log-time unit toggle; a second save path bypassing `CreateEntryDto`'s
  confirmed snapshot; recomputing an entry's nutrients from the food on read; calling
  `estimatePhoto`/Gemini/USDA in this flow; touching the photo door's behaviour or its
  `Log meal from photo` selector; rendering the `Add from photo` section on the manual door
  (`door !== 'food'` gates it).

## 7. Success Criteria

1. Day view FAB opens two options; selecting `Log meal from photo` runs the existing
   photo journey unchanged (e2e green with only the FAB selector updated).
2. An e2e run searches "Milk, Brand X", taps `Log`, sets `Grams` to 250, and saves into
   breakfast on today: the entry appears with `quantity: 2.5`, and the day's calories
   equal the sum including `scale(V, 2.5).calories` (asserted against the rendered total).
3. A unit test proves the append default (a per-100 food's pick → `quantity: 1`) and the
   inline amount (250 → `quantity: 2.5`), plus the linearity table (0.5/1/2).
4. After editing the food's facts (or deleting it), the logged entry's stored
   `nutrients` and the day view numbers are byte-identical (unit test on the request
   stub + e2e).
5. The empty-catalog door shows the `EmptyState` linking to `/meals/foods`.
6. `npm run typecheck` (touched workspaces) zero errors; the prescribed jest suites and
   one e2e `-g` run pass within `max-test-runs: 2`.
7. A new entry's meal group arrives preselected from the client's local hour
   (`getDefaultMealGroup` unit test, AC7); editing an existing entry keeps its stored
   group.

## 8. Open Questions

- Day-view amount rendering: `× 2.5` (current frozen meta) vs "250 ml"/"1 carton".
  Deferred (map §3) — any change needs its own explicit frozen-surface approval.
- Whether the photo-failure manual item (the `editor.tsx:79` stand-in) should also gain
  the catalog search; adjacent to the out-of-scope photo path (map §3).
- Default meal group (resolved, AC7): a new entry is preselected from the client's local
  hour, server-derived from the `tz` cookie — breakfast 05:00–10:59, lunch 11:00–14:59,
  dinner 15:00–19:59, snack 20:00–04:59; editing an existing entry keeps its stored group.
