# Spec: meal-capture-ui revision — grams, and rows that are foods

Module id: `meal-capture-ui` (map: `docs/specs/MAP-meal-nutrition.md`, revision 2026-10-04).
A revision of `docs/specs/SPEC-meal-capture-ui.md`, whose page contracts still own the
surface. Contract: AGENTS.md Contract 1 (Rule 3 upstream-first, spec-first). Depends on
`docs/specs/SPEC-photo-identity.md` for what an item now is.

## Objective

The editor logs a **food by grams**, not a dish by portions. Success = the row reads like a
food label — a food name and a weight — and every number scales with that weight.

## Root cause: `quantity` is servings, and the row is a dish

Grounded in `packages/nutrition/src/scale.ts` and `apps/meal-service/src/entries/`:

- `scale(food, quantity)` — "1 = one serving, 0.5 = half". `Entry.quantity` is documented
  "**Servings logged**", `CreateEntryDto.quantity` likewise, capped by `QUANTITY_MAX = 100`.
  So `quantity` is a **multiplier on the food's serving**, never a weight.
- `EditorItem` is `{ dish, quantity, nutrients, known }` — a dish with a portion multiplier,
  and it carries **no `servingGrams`**, so today there is nothing to convert a weight from.

This means `Portions → Grams` is **not a label swap**. Displaying grams requires the
item's base weight.

## Behavior

### The item row

The food name stays the row's parent line (`ListItem variant="nested"` title, trash on that
line via `titleAction`). Beneath it, in the `SettingsRow` idiom: **`Grams`**, then
`Calories (kcal)`, `Fat (g)`, `Carbs (g)`, `Protein (g)`, then the existing
`All nutrients (27)` trigger and full-screen modal. Unchanged.

### Grams, not servings

`EditorItem` gains two fields — `servingGrams: number`, defaulting to **100**, and
`foodId: string | null`, the reference the log path reuses (from the estimate when the
catalog matched; `null` otherwise):

```ts
interface EditorItem {
  dish: string;
  foodId: string | null;  // new; a catalog reference from the estimate, or null
  servingGrams: number;   // new; 100 for every food this feature creates
  quantity: number;       // UNCHANGED: servings, as the model and DB already define it
  nutrients: NutrientVector;
  known: readonly Nutrient[];
}
```

The `Grams` box is a **view over `quantity`**, not a new stored field:

- display: `quantity × servingGrams`
- edit: `quantity = grams / servingGrams`, then the existing `setPortion` ratio rescale

`setPortion`'s guard survives unchanged: junk or empty input keeps the last good value and
must never scale a vector to zero, which would silently erase a correction.

**Why `quantity` stays servings.** `scale()` is the single owner of the linear scaling
rule and `Entry.quantity` is persisted. Redefining it as grams would reinterpret every
existing entry — a data migration, and migrations are the human's to run, never an agent's.
Keeping servings and viewing it through `servingGrams` is the zero-migration path the
intent asked for, and it is why `Food.servingGrams = 100` was chosen as the base.

**`servingGrams` must be 100 for new foods**, or a 120 g portion of two foods with
different bases would mean different multipliers while showing the same number. Every food
this feature creates (photo paths 2 and 3, and manual entry) is `servingGrams: 100`. A
**referenced** catalog food (reused by name on log) keeps its own base, so the box converts
through it rather than assuming 100.

### The hint line

Replaces the current text ("Portions multiply the numbers below; a blank value means
unknown, not zero."). The first clause described the multiplier the user can no longer see;
the second is still true and still load-bearing. New text carries only what remains true.

## The log-time create path

A `Food` row is created **only when the user clicks log meal** — never during estimation
(amendment 2026-10-04; see `SPEC-photo-identity.md § Resolution`). The estimate draft
carries a resolved vector; the catalog write is gated on the user's confirmation, the log
click, for the reason `docs/lessons/0009-autosave-inline-tag-orphans.md` records: a
registry row created from a draft is an orphan the user then edits or abandons. This is the
path that closes the estimate → review → log flow:

1. **Estimate** — identity-only model output → catalog-first `search_food` → resolve the
   vector (catalog / USDA / `zeroVector()`) → `PhotoEstimateItem` (identity + resolved
   vector + `servingGrams`). **No catalog write.**
2. **Review** — the user corrects identity, grams, and numbers in the editor; corrections
   are draft state.
3. **Log** — on the confirmed item:
   - **reference an existing catalog food** (the item carries a catalog `foodId`): reuse
     it, no new row, no USDA call;
   - **else create the food** — `CreateFoodDto { name: <user's exact spelling>,
     servingGrams: 100, nutrients: <vector un-scaled back to the per-100 g base> }`, via
     `FoodsService.create` (reached through the BFF over `POST /api/foods`, mirroring
     `FoodsService.findAll`; `foods.service.ts` itself is not edited);
   - **then log the entry** — `CreateEntryDto { foodId, quantity, nutrients }`, where
     `quantity` is the servings multiplier and `foodId` is the reused or newly created
     food's id (a durable id, no longer the dish-name stand-in the old editor used).

**The wire shape forces this ordering.** `CreateEntryDto.foodId` is required
(`apps/meal-service/src/entries/dto/create-entry.dto.ts`), so a logged item whose estimate
carried a `null` food reference must have its food created **before** the entry posts — the
create returns the id the entry then carries. The null is resolved at save time, in the log
path; it is never a null on the wire.

**What vector the create stores — stated once.** The stored base is the confirmed
**effective** vector **un-scaled by `quantity`**: `effective ÷ quantity`, `quantity` in
servings (intent "A catalog food is written once, at creation"). On the wire,
`PhotoEstimateItem.nutrients` is the food's **per-serving base, unscaled** — the editor
scales it to grams with its existing `scaleVector` — so the log path names which of the two
it is writing and cannot disagree: it takes the confirmed effective vector and divides by
`quantity` to recover the per-100 g base before `create`. No nutrient number is invented and
none is rounded away. Later corrections to a logged entry stay **entry-local**; they never
write back to the food — changing a food is the existing food-edit path.

## The normalized name key

Uniqueness is compared on a **normalized key** — trim, collapse internal whitespace,
case-fold — while the **stored name keeps the user's exact spelling**. So `Chicken`,
`chicken`, and `chicken ` are one food; `chicken` and `chicken breast` are two real
differences, accepted as distinct foods, never fuzzy-merged. A log containing two rows that
normalize to the same key (two portions of `chicken`) yields **one `Food` and two
`Entry`s** — the create path checks the key once per key, not once per row.

## Frozen surface — **APPROVED 2026-10-04**

The e2e selector surface is frozen (project profile `frozen-surfaces`): roles, **visible
text**, and **aria-labels**. Changing `Portions` to `Grams` changes both —
`label="Portions"` and `aria-label={`Portions for ${subject}`}` in
`apps/app/app/(meals)/meals/entry/[id]/editor.tsx`, plus the hint line's visible text.

**Approved by the user 2026-10-04**, with the condition that **the e2e specs referencing
the old selectors are updated in the same change** — not deferred to a follow-up. So this
spec is binding on the rename, and any e2e spec matching on `Portions`, the old
`Portions for …` aria-label, or the old hint text ships its update in the same commit.

The label is renamed because the alternative is worse: keeping `Portions` over a value
that is now a weight would make the label lie. A frozen surface protects selectors from
casual churn; it does not protect a label that has become false.

## Contract 1 conformance

No new visual language. The `Grams` row is the same `SettingsRow` + `Input` pair the
`Portions` row already uses, so the change is a label and a value transform. `ListItem`
`titleAction` is reused as-is. Mechanical checks (raw-element grep, `next/link` grep, hex
grep, `note|trash|tag-chip` grep) run unchanged at review.

## Open verification

1. **Frozen-surface approval** for the label, aria-label, and hint text (above).
2. **Does the estimate response carry `servingGrams`?** The pre-rewrite
   `PhotoItemSuggestion` and the BFF wire type do not today. Path 1 (a referenced catalog
   food) needs the *existing* food's base, so the service must return it per item and the
   BFF must forward it. Confirm the shape before implementing.
3. **`addItem()`** currently seeds `{ dish: '', quantity: 1, nutrients: nutrition.empty }` —
   a manual row. It seeds `servingGrams: 100` from here on.

## Non-goals

Portion labels and portion pickers (we log grams). Converting existing entries' stored
`quantity` (it already means servings and stays correct). Any change to `scale()` or to
`Entry`.
