# Spec: nutrition-model

Module id: `nutrition-model` (see `MAP-meal-nutrition.md`). Depends on: nothing.

## Objective

Own the nutrient vocabulary, its units, the food/portion model, and the pure arithmetic that
turns `food × quantity` into a nutrient vector — shared byte-for-byte by the service that sums
a day and the UI that formats it.

The failure this module exists to prevent: the service and the UI each implementing the unit
table, drifting, and displaying a number that does not match the stored one. It is also the
single place where the unit decisions from `docs/research/nutrients-loseit.md` §0.1 become
code instead of prose.

**User:** the two internal consumers only (`meal-service`, `meal-capture-ui`). No end user
interacts with this module directly.

**Success:** a food and a quantity produce identical nutrient vectors whether computed in the
service's day-sum or in a UI test, and the 27 nutrients are declared exactly once.

## Tech Stack

- TypeScript 5.7, ESM-in-workspace like the other `packages/*` (consumed via `main`/`types`
  pointing at `src/index.ts` as `@life/ui` does, or `dist` as `@life/db` does — follow
  `packages/cache` since this package is a small pure library).
- Jest 29 + ts-jest (`testRegex: \.test\.ts$`, `testEnvironment: node`) — identical to
  `packages/cache`'s config.
- No runtime dependencies. No NestJS, no TypeORM, no React. Pure TS.

## Commands

Run from `packages/nutrition` (or root with `-w @life/nutrition`):

```
typecheck: npm run typecheck -w @life/nutrition     # tsc --noEmit -p tsconfig.json
test:unit: npm run test:unit -w @life/nutrition     # jest
```

Root-level, workspace-aware (per the project profile):

```
npm run typecheck                    # all workspaces
```

## Project Structure

```
packages/nutrition/
  package.json          # name @life/nutrition, scripts typecheck + test:unit
  tsconfig.json         # extends repo base, noEmit typecheck
  tsconfig.build.json   # emit to dist/ (mirror packages/cache)
  src/
    index.ts            # the public surface; nothing else is imported directly
    nutrients.ts        # the 27-field vocabulary + units + storage/display rules
    food.ts             # Food, Serving, Portion types
    scale.ts            # portion scaling: food × quantity → NutrientVector
    sum.ts              # day totals: NutrientVector[] → NutrientVector
    format.ts           # unit + %DV rendering helpers (UI-facing)
  test/
    nutrients.test.ts   # vocabulary invariants (count, units, no duplicates)
    scale.test.ts       # scaling arithmetic incl. zero/unknown cases
    sum.test.ts         # additive totals, missing-value semantics
    format.test.ts      # %DV derivation, mcg/mg/g/kcal rendering
```

## Code Style

Follow the repo's existing package style: named exports from `src/index.ts`, JSDoc on the
module's *why* (not the *what*), explicit return types on exported functions, and no default
exports.

```ts
/**
 * The 27 nutrients in the exact order agreed in
 * `docs/research/nutrients-loseit.md` §0.1. Order is part of the contract: the UI
 * renders columns from this array, so it must never be sorted alphabetically.
 */
export const NUTRIENTS = [
  'calories',
  'fat',
  'monounsaturatedFat',
  // ...
] as const;

export type Nutrient = (typeof NUTRIENTS)[number];

/** A nutrient vector is total, never partial: every nutrient is present. */
export type NutrientVector = Record<Nutrient, number>;
```

Key conventions:

- Nutrient keys are **camelCase identifiers**, mapped 1:1 to the display labels and units in
  `nutrients.ts`. The pasted Lose It! labels ("Monounsaturated Fat", "Thiamin (B1)") live in a
  `label` map, not in the identifiers.
- Units are a closed union: `'kcal' | 'g' | 'mg' | 'mcg' | 'ml'`.
- **Storage is absolute mass**; `%DV` is never stored and never returned by `scale`/`sum`.
  It is derived in `format.ts` from a reference-value table.
- `mcg` is ASCII; never `µg`.

## Testing Strategy

Jest, unit tests only, in `packages/nutrition/test/*.test.ts`. No e2e — this module has no I/O.
Coverage expectation: every exported function has at least one test; the invariants below are
tested rather than assumed.

| Concern | Test level | Why |
|---|---|---|
| Vocabulary count/units/order | unit | a 28th nutrient or a reordered array is a silent contract break |
| Scaling arithmetic | unit | the correctness core; must handle 0, fractional, and unknown-portion |
| Day summation | unit | must be exactly additive and total |
| `%DV` derivation | unit | display correctness; must not leak into stored shape |

## Boundaries

- **Always:** export everything through `src/index.ts`; keep functions pure (no I/O, no clocks,
  no randomness); declare a unit for every nutrient; test invariants rather than restating them.
- **Ask first:** adding a 28th nutrient; changing a unit; changing the order of `NUTRIENTS`.
- **Never:** depend on NestJS/TypeORM/React; store `%DV`; hit the network or a DB; duplicate the
  unit table outside `nutrients.ts`; use `any` in the public surface.

## Success Criteria

1. `NUTRIENTS` contains exactly the 27 agreed fields, in the agreed order, each with a unit from
   the closed union, and a test asserts that count/order/uniqueness.
2. `scale(food, quantity)` returns a complete `NutrientVector`, and is exactly linear in
   quantity (tested at 0×, 0.5×, 2×).
3. `sum(vectors)` is exactly additive and returns a complete vector for an empty input
   (all zeroes).
4. `format` renders the unit and, for the eight `%DV`-eligible micronutrients, a `%DV` derived
   from the reference table — with a test proving `scale`/`sum` output never contains `%DV`.
5. `npm run typecheck -w @life/nutrition` passes with zero errors; `npm run test:unit -w
   @life/nutrition` passes.

## Open Questions

None. The unit table is locked (`docs/research/nutrients-loseit.md` §0.1). Unknown-portion
handling is specified in `SPEC-meal-service.md` (the entry stores what the user confirmed; the
model scales whatever number it is given and never invents one).
