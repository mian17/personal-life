Intent: photo → real foods, verified nutrients, gram tracking

Confirmed 2026-10-04 via interview. Feature intent; builds on
`docs/intent/meal-nutrition.md` (the capture feature), repo-wide vision in
`docs/intent/architecture.md`, content-at-rest in `docs/intent/data-privacy.md`.

## Outcome

A meal photo logs **foods**, not dishes. Snapping a pot yields one row per food
(chicken, broth, green beans), each a catalog food stored at **100 g** with its
own complete 27-nutrient vector, logged by **grams**.

Gemini's job is bounded to **identity**: *which* foods are in the picture and
*how many grams*. It authors **no nutrient number**. Nutrients come from USDA
FoodData Central, resolved by id, and are the numbers that get stored.

## User

Me, daily, single-user in practice. Owner-scoped exactly like
`meal-nutrition` (every row carries the IdP `sub`).

## Why now

Today one invented **dish** name ("chicken pot") carries one blended 27-vector.
The log reads as blur and no number is attributable to a real food. That is the
wrong unit: a dish is dynamic — the same name covers different ingredients,
portions and cooking methods — whereas the **food** is stable.

The current pipeline also asks Gemini to do two very different reliability jobs
at once: *"is this chicken?"* (easy, high accuracy) and *"how much niacin is in
this chicken?"* (hard, invented). Splitting them means 27 numbers stop being
hallucinated per photo.

## Success

- The day reads `chicken · 150 g`, `broth · 200 g`, `green beans · 100 g` under
  its meal slot, each with its own complete vector taken from USDA.
- Those foods now exist in the catalog for reuse.
- Snapping the same pot again adds **no** second "chicken".
- Calories stay approximate — the **identity** of the food matters far more than
  the precision of its numbers.

## How correctness arrives

1. Gemini reads the photo and calls a **USDA search tool** (function calling) to
   resolve each food it sees to an `fdcId`.
2. It returns **name + grams + fdcId** only — no nutrient fields exist in the
   response schema at all.
3. Our backend fetches the authoritative per-100 g vector by `fdcId` and uses
   those numbers. Values are never transcribed through the model: the model
   resolves identity, the source owns the numbers.

The tool is worth its complexity because a bare word is ambiguous — "chicken"
returns dozens of USDA entries (breast/thigh, raw/cooked/roasted). The model
sees the candidates and judges which one matches the picture.

Known cost accepted: the estimate becomes a multi-turn call (photo → tool call →
answer), so "Reading the photo…" takes longer, and USDA lookups need caching
behind the cache contract.

## Decisions

- **Food base = 100 g.** `Food.servingGrams = 100`, base vector per 100 g — the
  nutrition-label convention. Fits the existing schema with **no migration**.
- **`Portions` becomes `Grams`** in the editor; the model supplies the mass (its
  `portionGrams` field is promoted from a side note to the primary quantity).
- **Dedup by name.** A photo-said "chicken" reuses the catalog food named
  `chicken` if one exists, else creates it. No fuzzy matching, no brand logic.
- **Model output is identity-only.** `name + grams + fdcId`; no nutrient fields
  in the Gemini response schema.
- **Saved meals already match the Lose It model** (one saved meal holds many
  frozen foods and re-logs them into one meal slot) and are not reworked.

### Amendment 2026-10-04 — search order, and when the catalog is written

Set by the user after the original confirmation. Two refinements to the flow above.

- **Search order is catalog first, USDA second.** The model's search reaches our
  **own catalog first**; only when nothing matches does it query the USDA API.
  Rationale: a food the user has already corrected is a better answer than a
  fresh USDA guess, and it costs zero API calls. It also makes repeat photos free
  — the second "chicken" resolves against the catalog with no USDA traffic.
  (This narrows the earlier "dedup by name" decision: that rule still governs the
  *write*, this governs the *search*.)
- **The catalog is written at log time, never at estimate time.** A food becomes
  a catalog row only when the user clicks **log meal**. Rationale: an estimate is
  a draft, and creating registry rows from a draft litters the catalog with foods
  the user then edits or throws away — the same failure mode as
  `0009-autosave-inline-tag-orphans`, whose rule is that creation is gated on a
  user-produced confirmation. The confirmation here is the log click.
- **A catalog food is written once, at creation.** The vector stored is the one
  the user actually confirmed — including any correction they typed — un-scaled
  back to the per-100 g base (`effective ÷ quantity`, quantity in servings).
  Later corrections to an entry stay **entry-local**: they do not write back to
  the food. Changing a food is the existing food-edit path, not a side effect of
  logging one. One rule, no surprises.

## Constraint

- Fits the existing `Food` / `Serving` / `Entry` schema — **no DB migration**
  (migrations are the human's to run, never an agent's).
- The USDA API key is a **secret** — the human provisions it. The integration is
  planned and documented as a checklist; the human runs that step.

## Out of scope

- Food browser / search **UI** — the catalog is written and searched by the
  model's tool, but there is no human-facing browse surface here.
- Brand capture (optional in the Lose It form; a photo cannot read a brand).
- Exact precision for foods USDA cannot resolve: those still log, with
  approximate numbers, rather than being dropped.
- Reworking Saved Meals — including choosing the meal slot at re-log time rather
  than the one captured at save time. Say if either is wanted.
