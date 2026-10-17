# Spec: food-catalog-ui

Module id: `food-catalog-ui` (map: `docs/specs/MAP-meal-food-management.md`). Depends on
`food-units` (the wire contract). Touches `@life/ui` only (Contract 1).

## 0. Assumptions (surfaced before the spec)

Carried from the map (items 2, 3, 5, 8, 11 apply). Module-specific:

1. The screen lives at `/meals/foods` inside the existing `(meals)` route group, with
   create/edit as sibling routes (`/meals/foods/new`, `/meals/foods/[id]`) — the same
   full-screen-editor pattern as `/meals/target`.
2. The top-nav icon button is one more `IconLink` in `MealsNav` (`apps/app/app/meals-nav.tsx`),
   with a lucide icon and a frozen accessible name (`Foods`).
3. All 27 nutrient facts are typed fields (pre-filled `0` = "no value"), grouped exactly
   like the entry editor's field groups from `@life/nutrition`; nothing is prefetched
   from the photo estimator, Gemini, or USDA.
4. Delete is the existing soft delete behind a `ConfirmButton`; there is no trash/restore
   screen for foods in this scope.

## 1. Objective

A food-catalog management screen (CRUD) behind a meals top-nav icon button, so a known
staple ("Milk, Brand X") is saved once — per-100 ml label facts, `unit: 'ml'`, a named
measure "1 carton = 1000 ml" — and can be logged daily by `manual-log-ui`.

**User:** the meals-app user who curates a personal food catalog of known staples by
hand — the user the confirmed intent (`docs/intent/meal-food-management.md`) names — on a
phone, occasionally (create/edit) and repeatedly (it is the list `manual-log-ui` picks
from).
**Success:** the intent's success step 1 — "Save 'Milk, Brand X' once with its per-100 ml
label facts and a '1 carton = 1000 ml' measure" — in one sitting, and "edit the food
later without rewriting past entries".

Acceptance criteria:

- AC1 From the day view, the nav has a Foods icon button leading to `/meals/foods`; the
  screen lists the owner's foods with search (`q`, decrypted-name filter).
- AC2 Create: name, unit (`g`/`ml`, chosen once), per-100 facts (27 typed fields), and
  zero or more named measures (label + amount in the food's unit, `PORTIONS_MAX` 20).
  Saving posts one `POST /api/foods` with `servingGrams: 100`.
- AC3 The form never calls `estimatePhoto`, Gemini, or USDA — facts are hand-typed; a
  partial fact set is fine (missing = `0`, the stored semantics).
- AC4 Edit: everything except `unit` is editable; the unit renders read-only; the form
  resubmits `PATCH /api/foods/:id` with `expectedVersion`.
- AC5 Delete: confirm → `DELETE /api/foods/:id` → the food leaves the list; past entries
  and day totals are untouched.
- AC6 Every visual element composes `@life/ui` primitives; no raw HTML form controls.

## 2. Commands

```
typecheck:  npm run typecheck -w apps/app
test:unit:  npm run test:unit -w apps/app -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

`max-test-runs: 2` (project profile) — one suite per command, at most two runs.

## 3. Project Structure

```
apps/app/
  app/meals-nav.tsx                    # + IconLink to /meals/foods (frozen name "Foods")
  app/(meals)/meals/foods/page.tsx     # manager list + search + create entry point
  app/(meals)/meals/foods/new/page.tsx # create form (full-screen editor)
  app/(meals)/meals/foods/[id]/page.tsx# edit + delete form
  app/(meals)/meals/foods/food-form.tsx# the shared create/edit form (client)
  app/(meals)/meals/actions.ts         # + createFood/updateFood/deleteFood server actions
  lib/meal-api.ts                      # listMealFoods(q?), createMealFood/updateMealFood/deleteMealFood inputs (food-units owns the shapes)
  test/meal-foods.test.tsx             # route + form behaviour (jest, existing stub pattern)
  test/e2e/meals.spec.ts               # + a foods journey (-g target)
```

## 4. Code Style

Compose, never hand-roll (Contract 1): the page is `ManagerBlock`, rows are `ListItem`,
search is `SearchField`, facts are `Input`s grouped by the editor's field groups,
measures are `Row`s of `Input` + `IconButton` remove, actions are `Button`/`IconButton`,
errors are `AlertBanner`, the empty list is `EmptyState`.

```tsx
// Illustrative — every element is a primitive; no raw <button>/<input>/<div className>.
<ManagerBlock title="Foods" backHref="/meals">
  <SearchField label="Search foods" onQuery={setQ} />
  <List>
    {foods.map((food) => (
      <ListItem
        key={food.id}
        title={food.name}
        meta={`per 100 ${food.unit} · ${format('calories', food.nutrients.calories)}`}
      />
    ))}
  </List>
</ManagerBlock>
```

Nutrient display strings come from `@life/nutrition`'s formatter — no app-local unit or
`%DV` formatting. Bounds (`FOOD_NAME_MAX`, `SERVING_LABEL_MAX`, `PORTIONS_MAX`,
`AMOUNT_MAX`) are imported from `lib/meal-api.ts` (one owner for the value, lesson 0016),
never re-spelled locally.

## 5. Testing Strategy

Jest + React Testing Library in `apps/app/test/` (the `meal-*.test.tsx` stub pattern),
Playwright e2e on the frozen selector surface.

| Concern | Test level | Why |
|---|---|---|
| Nav icon → `/meals/foods` reachable (role + name) | unit + e2e | the promised entry point |
| Create "Milk, Brand X" (ml, per-100 facts, 1 measure) persists | e2e | the intent's success step 1 |
| Unit read-only on edit; PATCH carries no `unit` | unit | creation-only unit rule |
| Measure rows add/remove within `PORTIONS_MAX` | unit | form bounds |
| No model fill: the create path never calls the photo/USDA clients | unit (grep-level assertion in test) | "typed by hand (no model fill)" |
| Delete removes the food; a logged day's entries and totals unchanged | unit + e2e | history immutability (AC5) |
| Contract 1 greps (raw elements, `next/link`, raw colours) | review-time mechanical checks | frozen contract |

## 6. Boundaries

- **Always:** compose `@life/ui` primitives; route data through `lib/meal-api.ts` (the
  browser never calls `meal-service`); mirror the service's DTO bounds from the exported
  constants; keep `unit` settable only in the create form; show `0` as the food's real
  "no value" (the stored semantics) — never the unknown affordance, these facts are
  typed, not estimated.
- **Ask first:** changing the frozen e2e selector surface beyond the FAB change the map
  enumerates; any new `packages/ui` primitive (goes upstream first per Rule 3); adding a
  route outside `(meals)`; a trash/restore flow for foods.
- **Never:** raw `<button>`/`<input>`/`<select>`/`<a>`/`<label>` or styled `<div>` in UI
  code (Contract 1 Rule 1); inline `style=` or raw colours/lengths; calling
  `estimatePhoto`/Gemini/USDA from the catalog form; a per-app copy of a `packages/ui`
  component; sending `ownerSub` or a measure's nutrients anywhere; deleting an entry as
  a side effect of deleting a food.

## 7. Success Criteria

1. From the day view, one tap on the Foods icon (accessible name `Foods`) opens
   `/meals/foods`; an e2e run proves the path.
2. An e2e run creates "Milk, Brand X" with `unit: 'ml'`, 27 typed per-100 facts, and
   measure "1 carton" = 1000 ml; the list shows it; `GET /api/foods/:id` returns exactly
   those values.
3. Opening it for edit shows the unit read-only; saving a name change returns
   `version + 1` and does not send `unit` (asserted in the unit test's request stub).
4. Deleting it (after `manual-log-ui` has logged one entry, or with a seeded entry)
   leaves that day's entries and totals byte-identical.
5. `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
   and the other Contract 1 mechanical checks show zero new hits in these files.
6. `npm run typecheck -w apps/app` zero errors; the prescribed jest suite and one e2e
   `-g` run pass within `max-test-runs: 2`.

## 8. Open Questions

- Whether the create/edit form renders all 27 facts inline or behind a collapsed
  "more nutrients" region (the editor's `extraCount` pattern). Cosmetic; decide at
  implementation time from `frontend-ui-engineering`.
- Whether the list should show measures on the row summary (name + per-100 calories
  today). Not required by the intent.
