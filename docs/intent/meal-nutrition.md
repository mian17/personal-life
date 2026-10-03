# Intent: meal photo → nutrition tracking

Confirmed 2026-10-02 via interview. Feature intent; repo-wide vision lives in
`docs/intent/architecture.md`, content-at-rest contract in `docs/intent/data-privacy.md`.
Supporting research: `docs/research/nutrition-tracking-*.md`, `docs/research/nutrients-*.md`.

## Outcome

A meal-tracking feature in `personal-life` where I log food three ways — pick a saved
meal, type it by hand, or send a photo to Gemini (with an optional text hint) — then
review and correct the guess before it becomes a diary entry. The day view shows a
calorie running total against a target.

## User

Me, daily, single-user in practice. **Private per-user isolation is baked into the schema
from day one** (every row owner-scoped by IdP `sub`, no sharing surface, no household
model), so adding a second user later is a config change, not a rewrite.

## Why now

Manual food logging — search, weigh, pick a portion — is the friction that makes calorie
apps get abandoned. Research on MyFitnessPal and Lose It! shows the same thing twice:
photo capture alone does not fix it, because the AI guess is routinely wrong, and neither
app lets the guess skip a review step. So the photo is the *front door*, the correction
step is where accuracy is recovered, and a saved meal is where that correction work finally
pays rent instead of being retyped every day.

## Success

- Next morning I open the feature and see yesterday as `1,850 / 2,000, 150 left`.
- A meal I corrected once can be re-logged in one tap from Saved Meals, with the corrected
  numbers — not re-guessed.
- I am never blocked from logging: if the photo fails to read, I still have manual entry.

## Constraint

- **New app in the monorepo**, following the existing shape exactly: a new
  `apps/meal-service` (NestJS + TypeORM + `@life/db` + `@life/cache` + `@life/crypto`)
  and new pages/routes inside the existing `apps/app` Next BFF — not a separate frontend.
- Reuses `@life/ui` primitives and tokens (Contract 1), the OIDC/IdP auth path, the
  BE → cache → DB layering (Contract 2), and the `@life/crypto` envelope for content at rest.
- **Gemini is the only AI provider** for the photo → ingredients/portion/dish guess.
- Day boundary is **midnight-to-midnight** clock time.
- The calorie/macro **target is derived at onboarding** from a profile (age, sex, height,
  weight, activity level) plus a weight goal — not a number I type arbitrarily. Stored
  versioned by date so today's target is reproducible from history.
- **Diary entry = food × quantity, in a meal group, on a date.** Daily totals are summed on
  read, which is what makes an edit or delete move the day's number.
- **Saved meal = frozen snapshot** of the corrected values. Later food edits do not
  retroactively change a saved meal or a past diary entry.
- **Tracked nutrients are exactly the 27-field Lose It! list** I enumerated from the app,
  not MyFitnessPal's 17 and not a union. Units are stored as **absolute mass**
  (kcal / g / mg / mcg per `docs/research/nutrients-loseit.md` §0.1); `%DV` is a display
  derivation, never a stored value.
- Third door is always a *choice*, not a fallback chain: saved meal, manual, photo are all
  available every time.
- Optional text hint on the photo door is sent **before** the guess (steering input), which
  is a different thing from correcting the guess afterwards.
- On photo failure (blurry, non-food, Gemini down) the app says so and drops me into manual
  entry pre-opened. It must never invent numbers it is unsure of — a wrong number silently
  corrupts the day's total, which is worse than no answer.

## Out of scope (this step)

- Sharing, household meals, any cross-user visibility.
- Barcode scanning.
- Trends, streaks, and history views beyond the day.
- Wearables / exercise-calorie offsets.
- Importing from MyFitnessPal or Lose It!
- Added sugars and net carbs (MFP-only fields; derivable later without a data migration.
- Micronutrient fields outside the agreed 27 (Vitamin D/E/K, B5, selenium, copper,
  manganese, iodine).

**Clarification (2026-10-04).** The editor exposing the **full agreed 27** for inspection
and correction is *in scope* and matches the 27-field rule above — the earlier revision of
the form showed only the 4 headline nutrients, which under-delivered on it. What stays out
of scope is *tracking new micronutrients beyond the 27* (the line above), which this does
not add. No new field, no schema change: the 27 already exist and the photo estimate already
populates them; this surfaces what was stored. See
`docs/specs/SPEC-meal-capture-nutrients.md`.
- Billing/paywall tiers — everything is free and single-tier.
