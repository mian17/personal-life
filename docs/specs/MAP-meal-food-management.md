# Capability Map: meal-food-management

/ Source: `docs/intent/meal-food-management.md` (confirmed 2026-10-16).
Status: **spec phase** — the map and the three module specs below are this run's
specification artifacts; the implementation plan (`tasks/plan.md`) is written from them.

**User (canonical, defined once here):** the meals-app user logging daily staples — the
1 L milk box, same brand, that photo capture is the wrong tool for. Every module spec's §1
Objective states this user outright (per its own words) rather than deferring to this line;
the definition lives here so the spec set has a single, citable source.

## 0. Assumptions this run proceeds on

Correct me now or the specs below stand on them.

1. **Scope check (honest):** the ask bundles two independently testable capabilities —
   a food-catalog management screen and a manual log flow — plus the shared data
   contract both sit on. Acceptance criteria cluster per screen and either screen could
   ship (or be cut) without rewriting the other's requirements. So: a capability map and
   one spec per module, per `spec-driven-development` Phase 0.
2. **Storage:** the repo already has a specification system (`docs/specs/MAP-*.md` +
   `SPEC-<module>.md`, 55 files, grep-pinned by `AGENTS.md` mechanical checks). The skill
   defers to an existing system's storage conventions over a root `SPEC.md` duplicate, so
   the map and specs live in `docs/specs/`.
3. **Base facts stay keyed to `servingGrams`.** A manually created food is
   `servingGrams: 100` with its vector = the per-100 facts (the photo path already
   creates foods this way — `entry/[id]/actions.ts:164`). No new per-100 column.
4. **`Food.unit` is one new field** (`'g' | 'ml'`, default `'g'`), settable at creation
   only. Immutability falls out of the existing global `forbidNonWhitelisted` pipe: the
   field is in the create whitelist and absent from `UpdateFoodDto`, so a PATCH carrying
   it is already a 400.
5. **Wire rename `grams` → `amount`** on serving shapes (it carries ml for an ml food;
   a field named `grams` is exactly the confusion the intent bans). The DB column stays
   `grams` — `ponytail:` rename with the next migration. The photo flow sends no
   portions and is untouched (out of scope).
6. **Entry contract unchanged.** `CreateEntryDto` keeps `quantity` ("the number the
   snapshot was scaled by"). A manual amount `a` (food's unit) logs
   `quantity = a / food.servingGrams` — the manual door picks at the default 100
   (one serving) and adjusts it inline in the item row's `Grams` field, so no separate
   amount or named-measure step exists there. The snapshot is computed client-side with
   `@life/nutrition`'s `scale()` before confirm, exactly as today.
7. **Day-view row meta stays `× {quantity}`** — visible text is the frozen e2e selector
   surface. Richer amount labels ("250 ml", "1 carton") are deferred to an open
   question, not silently changed.
8. **The FAB becomes a two-option dropdown** (`FabMenu`, trigger icon lucide `Plus` —
   a camera read as "photo only"). This changes frozen selectors; the confirmed intent is
   the explicit approval for exactly this change. Both option names stay verbatim —
   `Log meal from photo` (e2e `PHOTO_DOOR`) and `Log food` — so only the FAB's own
   selector/icon moves, never the option names.
9. **The manual door reuses the existing entry editor** (`/meals/entry/new?door=food`),
   search-first and multi-add: each catalog pick appends one editor item on the same
   screen, and the existing review/confirm/save path runs unchanged
   (`SPEC-meal-capture-ui`: "keep the review step before any save"). No bespoke wizard.
10. **`@life/nutrition` is untouched** — its arithmetic is unit-agnostic numbers; the
    `g`/`ml` literal is display data carried on the food.
11. **Deleting a food is the existing soft delete.** Entries and their confirmed
    snapshots are never rewritten, recomputed, or cascaded (the day's history survives
    by construction of `CreateEntryDto.nutrients`).

## 1. Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `food-units` | The Lose It! unit contract on the **existing** `api/foods` surface: one canonical unit per food (`g`/`ml`) chosen at creation, per-100 base facts, named measures carrying explicit amounts in the food's unit (no g↔ml conversion anywhere), server-derived measure vectors via `scale()`, and the log-amount → entry-quantity semantics. Extends `apps/meal-service/src/foods/` + `apps/app/lib/meal-api.ts` types. No new backend service. | (extends `meal-service`, shipped) |
| `food-catalog-ui` | The food-catalog management screen — list/search, create, edit, delete — behind a meals top-nav icon button, with per-100 facts typed by hand (never model-filled). | `food-units` |
| `manual-log-ui` | The manual log door: the day-view FAB becomes a two-option dropdown (photo capture / log food), and "log food" runs search-first multi-add over the catalog → appends editor items → meal group + date → confirmed snapshot. | `food-units` |

Build order: `food-units` → `food-catalog-ui` + `manual-log-ui` (the two UI modules are
independent after the contract lands; end-to-end verification of `manual-log-ui` naturally
runs after `food-catalog-ui` has created a food to log).

Dependency direction is one-way and acyclic. The interface between the modules is the
wire contract owned by `SPEC-food-units.md` (`unit`, `amount`, base-per-`servingGrams`,
quantity semantics) — the UI specs consume it and never redefine it.

## 2. Notes on boundaries

- Both UI modules touch `@life/ui` and introduce no visual language of their own
  (Contract 1). The one real gap — a FAB with a dropdown of actions — was fixed upstream
  in `packages/ui` (`FabMenu`, registered in `MAP-ui-primitives.md` and spec'd in
  `SPEC-ui-blocks.md`), never hand-rolled in the app.
- `food-units` touches a backend service, so `SPEC-food-units.md` carries the mandatory
  `## Cache Rules` section (Contract 2, Rule 4) even though it adds no new cache: the
  cached food row shape gains the `unit` column.
- Frozen surfaces: the only selector changes are the ones assumption 8 enumerates.
  `button.trash-delete`, token values, and PWA constants are untouched.
- Photo capture, saved meals, targets, model-generated nutrition, import/barcode,
  cross-unit logging, and new backend services are out of scope — nothing in the module
  specs may require them.

## 3. Open questions (cross-module)

- Day-view amount rendering ("250 ml" / "1 carton" instead of `× 2.5`): deferred, see
  assumption 7; needs its own explicit frozen-surface approval.
- Deleted-food display label on the day view (falls back to the raw id today,
  `day.tsx:116` comment): name snapshot on the entry vs. deleted-row name resolution —
  deferred; nutrient history is preserved either way.
- Whether the photo-failure manual item (the `editor.tsx:79` dish-name stand-in) should
  also gain the catalog search: motivated by the intent's "why now" but adjacent to the
  photo-capture path the intent keeps out of scope. Left open.
