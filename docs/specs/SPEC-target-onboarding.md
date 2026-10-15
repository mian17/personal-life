# Spec: target-onboarding

Module id: `target-onboarding` (see `MAP-meal-nutrition.md`). Depends on: `nutrition-model`.

## Objective

Turn a small profile into a daily calorie target plus a macro split, and keep that target
**reproducible per date** so "yesterday's 2,000" can still be recomputed after the profile
changes.

The failure this prevents: a single mutable `target` column. If the user's weight changes in
March, every past day silently re-renders against the new target and the history becomes a lie.

**User:** me, at first-run and whenever a body-change goal is reached.
**Success:** every stored day resolves to the target that was in effect on that date, and
changing the profile never rewrites a past day.

## Tech Stack

- Pure math in `@life/nutrition`-adjacent TS; no external service, no AI.
- Ships as NestJS routes inside `meal-service` (per the capability map), but the derivation
  itself is a pure function so it is testable without a server.
- No third-party BMR library — the Mifflin-St Jeor formula is four terms; a dependency is not
  warranted.

## Commands

```
typecheck: npm run typecheck -w apps/meal-service
test:unit: npm run test:unit -w apps/meal-service -- test/target.test.ts
```

## Project Structure

```
apps/meal-service/src/
  targets/
    target.ts             # pure: profile + goal → Target (BMR, TDEE, kcal, macro split)
    target-calculator.ts  # pure: the formula and activity multipliers, named constants
    target.entity.ts      # ownerSub, validFrom, profile inputs, computed values
    target.controller.ts  # GET /api/target (today's), PUT /api/target/profile
    target.service.ts     # versioned read/write, "which row applies to date D"
    target.module.ts
    dto/update-profile.dto.ts
test/
  target.test.ts          # pure formula cases, boundary activity levels
  target-versioning.test.ts # row-per-change, date resolution
```

## Code Style

Pure function first, entity second. The formula takes a plain struct and returns a plain struct:

```ts
/** Mifflin-St Jeor. Returns kcal/day at rest, before any activity multiplier. */
export function basalMetabolicRate(profile: Profile): number { /* ... */ }

/** Activity multipliers are fixed named constants — not user-typed numbers. */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
} as const;
```

- Inputs are validated with `class-validator` at the DTO boundary (`forbidNonWhitelisted: true`
  is already global — do not relax it).
- Sex is an enum, not a boolean.
- The stored row keeps **both** the inputs (so it is reproducible) and the computed outputs (so
  a read is cheap). Recompute is never required to serve a day.
- Macro split defaults to protein/carbs/fat with fat at a floor and protein at a floor
  (grams/kg), not a fixed percentage — percentages alone produce unsafe protein on low
  calories. The chosen constants are documented in the code with their rationale.

## Testing Strategy

| Concern | Test level | Why |
|---|---|---|
| BMR/TDEE formula | unit | an off-by-multiplier here silently changes every day's target |
| Activity factors and enum completeness | unit | a missing level must be a type error, not a runtime default |
| Date → applicable row | unit | the whole reason this module is versioned |
| History immutability | unit | changing the profile must not alter a prior date's target |

## Boundaries

- **Always:** store profile inputs alongside computed outputs; version by `validFrom`; resolve a
  date to exactly one row; keep the math in a pure function.
- **Ask first:** changing the macro-split policy; adding a gender option beyond the enum; adding
  a new activity level.
- **Never:** mutate an existing target row; serve a day using "latest" rather than "applicable";
  let the client send computed kcal (it is always derived server-side); use a floating
  percentage-only macro split with no gram floors.

## Success Criteria

1. `PUT /api/target/profile` creates a new versioned row; prior rows are untouched (asserted by
   test).
2. `GET /api/target?date=YYYY-MM-DD` returns the row applicable to that date, falling back to
   the oldest row for dates before the first profile.
3. Changing the profile and re-reading a past date returns the *old* target.
4. Macro grams are consistent with the calorie target within rounding (tested).
5. Zero typecheck errors; the two prescribed test files pass.

## Open Questions

None requiring the user. The intent doc fixes "profile-derived, versioned by date"; the specific
formula constants are an implementation detail recorded in code comments.
