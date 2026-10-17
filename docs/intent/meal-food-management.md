# Intent: meal food management + manual logging

- Outcome: Meals app gets (1) a food-catalog management screen (CRUD) behind a top-nav icon button, and (2) a manual log flow — pick catalog food × amount → meal group → date — as one of two FAB dropdown options alongside photo capture.
- User: The user, logging daily staples (1 L milk box, same brand) that photo capture is the wrong tool for.
- Why now: Foods currently only enter the catalog through photo-estimate; there is no way to add a known food yourself or log one directly (`editor.tsx:79`: "the dish name stands in until a food picker exists").
- Success: Save "Milk, Brand X" once with its per-100 ml label facts and a "1 carton = 1000 ml" measure; each day log 250 ml or "1 carton" in a few taps, no photo, correct nutrients on the day view; edit the food later without rewriting past entries.
- Constraint: Lose It! model — one canonical unit per food (g or ml) chosen at creation, per-100 facts typed by hand (no model fill), optional named measures each carrying an explicit amount in the food's unit (no g↔ml conversion anywhere); log amount is in the food's canonical unit or × a measure; entries stay confirmed immutable snapshots, so editing/deleting a food keeps history; UI from `@life/ui` only; foods owner-scoped through existing `api/foods`.
- Out of scope: Photo-capture changes, saved meals, targets, editing past entries' nutrients, model-generated nutrition, import/barcode, cross-unit logging, new backend services.

## Confirmation
Confirmed: yes — the user explicitly answered "yes" to the six-line restate above (2026-10-16) and chose option 1 (save intent + full spec → plan → implementation pipeline). Approved to proceed.

## Design notes (from the interview)
- Unit model follows Lose It!/MyFitnessPal/Cronometer convention: a food has exactly one canonical unit (the one its per-100 label facts are in); named measures ("1 carton = 1000 ml") store their explicit amount in that unit at creation; no implicit g↔ml conversion and no log-time unit toggle — the amount picker shows the food's own unit.
- Rationale for rejecting log-time unit choice: foods are ml-based or g-based by identity; cross-unit logging implies density data no tracker stores (Cronometer logs grams only; Lose It!/MFP render the picker in the food's unit).
- Nutrients are typed from the package label (per 100 g or 100 ml), never model-filled — precision for a fixed daily staple is the point; `completeVector()` in `foods/content.ts` owns the 27-field completeness rule.
- Rejected alternative: repurposing/overloading the photo-estimate flow. Capture stays untouched; manual create is a second door.
- History immutability: entries carry confirmed snapshots (`CreateEntryDto.nutrients`), so food edits/deletes never rewrite logged days; the day view already falls back to the stored dish name for a deleted catalog food (`day.tsx:116`).
- Existing backend surface (`api/foods` owner-scoped CRUD, `serving` entity with explicit `grams`, entries = foodId × quantity × mealGroup × date) is the foundation; servings' per-serving vectors are currently model-derived via `scale()` and never client-sent — a manual create flow must either derive measure vectors server-side via the same `scale()` or extend the DTO contract deliberately in the spec.
