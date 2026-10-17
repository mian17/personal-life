# Spec: food-units

Module id: `food-units` (map: `docs/specs/MAP-meal-food-management.md`). Extends the
shipped `meal-service` module (`apps/meal-service/src/foods/`). Consumed by
`food-catalog-ui` and `manual-log-ui`.

## 0. Assumptions (surfaced before the spec)

Carried from the map (items 2–6, 10, 11 apply directly). Module-specific:

1. The base vector stays per `servingGrams`; the manual-create path always sends
   `servingGrams: 100`, so "per-100 facts" is the base vector with no schema change.
2. `UpdateFoodDto` never gains `unit` — immutability is the existing whitelist, asserted
   by a test, not new code.
3. The serving wire field `grams` is renamed `amount`; the TypeORM column stays `grams`
   with a mapping comment (no migration). `@life/nutrition` is untouched.

## 1. Objective

Give every catalog food the Lose It! unit model on the **existing** `api/foods` surface,
so a known staple can be created by hand and logged without a photo:

- one canonical unit per food (`'g' | 'ml'`), chosen at creation, immutable after;
- the food's nutrient vector is the per-100 (of that unit) label facts, typed by hand —
  no model fill anywhere in the contract;
- optional named measures ("1 carton", "1 tbsp"), each carrying an explicit amount **in
  the food's own unit** — there is no g↔ml conversion anywhere, and no density data is
  stored, requested, or implied;
- measure vectors are derived server-side from the base vector with the model's
  `scale()`, exactly as servings are today, so a client can never disagree with a stored
  number.

**User:** the meals-app user logging daily staples (1 L milk box, same brand) that photo capture is the wrong tool for — the user the confirmed intent (`docs/intent/meal-food-management.md`) names; reached through `food-catalog-ui`/`manual-log-ui`.
**Success:** `POST /api/foods` with `{ unit: 'ml', nutrients: <per-100 ml facts>,
portions: [{ label: '1 carton', amount: 1000 }] }` round-trips exactly, its measure
vector is `scale(base, 10)`, and a later edit of the food rewrites no past entry.

Acceptance criteria:

- AC1 A food is created with `unit: 'ml'`, per-100 facts, and one measure
  `"1 carton" = 1000` (amount in ml); the response carries `unit: 'ml'` and
  `amount: 1000`.
- AC2 A PATCH carrying `unit` is rejected (400) — the unit is chosen once.
- AC3 A measure's returned vector equals `scale(base, amount / servingGrams)` exactly.
- AC4 Editing name/facts/measures re-derives measure vectors and rewrites no entry row.
- AC5 The log-amount → quantity semantics are fixed here and documented: `quantity`
  is the multiple of the food's base (`amount / servingGrams`), the number the entry's
  confirmed snapshot is scaled by.

## 2. Commands

```
typecheck:  npm run typecheck -w apps/meal-service     # also npm run typecheck -w apps/app (meal-api types)
test:unit:  npm run test:unit -w apps/meal-service -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

Root-wide `npm run typecheck` is workspace-aware; run it in the touched workspaces.
`max-test-runs: 2` (project profile) — one suite per command, at most two runs.

## 3. Project Structure

```
apps/meal-service/src/foods/
  food.entity.ts        # + `unit` column ('g'|'ml', default 'g')
  serving.entity.ts     # column `grams` kept; doc-comment: amount in the food's unit
  dto/create-food.dto.ts  # + `unit`; ServingInputDto.grams → amount
  dto/update-food.dto.ts  # unchanged field set (unit absent ⇒ immutable)
  foods.service.ts      # FoodDto + `unit`; ServingDto.grams → amount; servingVector() unchanged
  foods-cache.ts        # CachedFoodRow + `unit` (plaintext, like servingGrams)
  content.ts            # completeVector() 27-field rule unchanged
apps/meal-service/test/
  foods-units.test.ts   # unit semantics, amount derivation, PATCH rejection
  foods-search.test.ts  # untouched
apps/app/lib/meal-api.ts  # MealFood + `unit`; ServingDto.grams → amount; bounds exported (FOOD_NAME_MAX, SERVING_LABEL_MAX, PORTIONS_MAX, AMOUNT_MAX)
```

Docs: this spec and the map only. No `@life/nutrition`, no new workspace, no new service.

## 4. Code Style

The repo's DTO style stands: a doc-comment stating the *why* (the contract), bounds as
exported constants, class-validator on the wire, the derived-never-sent rule spelled out.

```ts
/**
 * One pickable measure of a food ("1 carton", "1 tbsp") and how much of the food's
 * canonical unit it is. The amount is explicit at creation — there is no g↔ml
 * conversion anywhere (`docs/intent/meal-food-management.md`): an ml food's measures
 * carry ml, a g food's measures carry g. Its nutrient vector is NOT client input — it
 * is derived from the food's base vector with `scale()` (`SPEC-meal-service` Nutrient
 * semantics), so a client can never disagree with the stored numbers.
 */
export class ServingInputDto {
  @IsString()
  @MaxLength(SERVING_LABEL_MAX)
  label: string;

  /** Amount in the food's canonical unit (`Food.unit`). */
  @IsNumber()
  @Min(1)
  @Max(GRAMS_MAX)
  amount: number;
}
```

Other rules (unchanged, restated because this module edits the same files):
`ownerSub` only from `@Principal()`; content fields stay `enc.v1.` envelopes with
byte-exact AAD; writes go BE → DB → `bumpGeneration(sub)`; reads only via
`cache.getThrough`; the cached row is the row as persisted.

## 5. Testing Strategy

Jest in `apps/meal-service/test/`, following `foods-search.test.ts` (pure) and the
e2e-spec pattern for service-level behavior.

| Concern | Test level | Why |
|---|---|---|
| `unit` round-trip; default `'g'` for bodies without it | unit/e2e | the contract's anchor field |
| PATCH carrying `unit` → 400 (whitelist) | e2e | immutability is enforced by the pipe, must stay so |
| Measure vector = `scale(base, amount / servingGrams)` exactly | unit | the one derivation; drift here is wrong numbers |
| Amounts stored verbatim (no conversion) | unit | the "no g↔ml anywhere" rule |
| Cached food rows keep `enc.v1.` for name/label/nutrients, `unit` plaintext | e2e (extend foods cache suite) | Contract 2 ciphertext test |
| Editing a food rewrites no entry row | unit | history immutability (AC4) |

Coverage expectation: every new/changed exported shape has a test; no test run exceeds
the 2-run budget.

## Cache Rules

Required by Contract 2, Rule 4 — this module changes the cached row shape.

- **Cached shapes:** food rows (list/all) as persisted — `name`, `nutrients`, and each
  serving's `label`/`nutrients` stay `enc.v1.` envelopes. `unit` joins `servingGrams` as
  a plaintext non-secret column (a unit literal is not content). `CachedServingRow.grams`
  keeps its name at the cache layer (it is the persisted column).
- **Key composition:** unchanged — `meal:<sub>:v<gen>:food:<rest>` with per-owner
  isolation; generation counter `meal:gen:<sub>`. Filters (`q`) and pagination never
  enter the key; name search runs post-decrypt, in memory.
- **Invalidation:** unchanged — bump the owner's generation on every successful food
  write (create, update, delete); TTL is a backstop only.
- **Failure mode:** unchanged — fail open; Redis down ⇒ loader runs directly; no cache
  error may cause unavailability or write plaintext on the fallback path.

## 6. Boundaries

- **Always:** owner-scope every query; derive measure vectors with `scale()` server-side;
  keep the complete-or-absent (`completeVector()`) rule; validate DTOs; keep `unit` out
  of `UpdateFoodDto`; run the cache ciphertext test after touching row shapes.
- **Ask first:** renaming the `grams` column (a migration); changing `GRAMS_MAX`/bounds;
  letting `unit` change after creation; making any serving vector client-sent.
- **Never:** accept `ownerSub` from a body; perform or store any g↔ml conversion or
  density; let a client send a measure's nutrient vector; recompute an entry's nutrients
  from a live food row; add a new entity or service (out of scope); fork `@life/cache` or
  `@life/crypto`; change `@life/nutrition`.

## 7. Success Criteria

1. A test creates `{ unit: 'ml', servingGrams: 100, nutrients: V, portions: [{ label:
   '1 carton', amount: 1000 }] }` and asserts the response carries `unit: 'ml'`,
   `amount: 1000`, and a measure vector exactly `scale(V, 10)`.
2. `PATCH /api/foods/:id` with `unit` in the body returns 400; a PATCH of name/facts/
   measures succeeds and the food's `unit` is byte-identical before and after.
3. A test asserts an ml food's amounts survive create → read unchanged (no factor
   applied anywhere).
4. The foods cache suite asserts cached rows contain `enc.v1.` for `name`/`label`/
   `nutrients` and no known plaintext; `unit` is present and plaintext by design.
5. A test asserts a post-edit food row leaves `entry` rows (nutrients, quantity) byte-
   identical (AC4).
6. `npm run typecheck` (both touched workspaces) reports zero errors; the prescribed
   jest suites pass within `max-test-runs: 2`.

## 8. Open Questions

- Whether `GRAMS_MAX` (5000) should be renamed/bounded per unit (a 20 L measure would
  exceed it). Not needed for the intent's "1 carton = 1000 ml"; left as-is.
- Legacy foods with non-100 `servingGrams` (if any exist) keep working through
  `amount / servingGrams`; the manual flow always creates 100. If the catalog should
  force per-100 on edit, that is a follow-up.
