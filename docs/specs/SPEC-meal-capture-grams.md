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

`EditorItem` gains one field — `servingGrams: number`, defaulting to **100**:

```ts
interface EditorItem {
  dish: string;
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
**reused** catalog food (dedup by name) keeps its own base, so the box converts through it
rather than assuming 100.

### The hint line

Replaces the current text ("Portions multiply the numbers below; a blank value means
unknown, not zero."). The first clause described the multiplier the user can no longer see;
the second is still true and still load-bearing. New text carries only what remains true.

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
2. **Does the estimate response carry `servingGrams`?** `PhotoItemSuggestion` and the BFF
   wire type do not today. Path 1 (reused catalog food) needs the *existing* food's base,
   so the BFF must return it per item. Confirm the shape before implementing.
3. **`addItem()`** currently seeds `{ dish: '', quantity: 1, nutrients: nutrition.empty }` —
   a manual row. It seeds `servingGrams: 100` from here on.

## Non-goals

Portion labels and portion pickers (we log grams). Converting existing entries' stored
`quantity` (it already means servings and stays correct). Any change to `scale()` or to
`Entry`.
