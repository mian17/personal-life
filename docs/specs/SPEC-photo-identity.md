# Spec: meal-service revision — photo resolves identity, USDA owns numbers

Module id: `meal-service` (map: `docs/specs/MAP-meal-nutrition.md`, revision 2026-10-04).
A revision of `SPEC-meal-service.md`'s Photo → Gemini pipeline, not a new module.
Intent: `docs/intent/meal-food-capture.md`. Provider it consumes:
`docs/specs/SPEC-usda-source.md`.

## Objective

A meal photo logs **real foods**, not dishes — each a catalog food at 100 g with a
USDA-verified nutrient vector, logged by grams. Success = photographing a pot yields
`chicken`, `broth`, `green beans` as separate rows whose numbers came from USDA, never
from a model's recollection of USDA.

## What is wrong today

`photo/gemini.client.ts` asks one `generateContent` call to do two unrelated jobs:

> "For each dish give its name, the ingredients you can see, the portion in grams, and
> all 27 nutrient fields for that portion, each your best numeric estimate."

Recognition is a high-accuracy task; inventing 27 numbers is a low-accuracy one. The
prompt even says *"Never invent a nutrient number"* while the response schema **requires
all 27** (`required: NUTRIENTS.map(({ key }) => key)`) and `completeVector` then insists
they are present — so the schema mandates the very thing the prompt forbids. The model
has no choice but to produce numbers it did not observe.

Separately, the row shape is wrong: `PhotoItemSuggestion { dish, ingredients, portionGrams,
nutrients }` describes a **dish** ("chicken pot"), and a dish is dynamic — every pot is
different. A **food** ("chicken, breast, raw") is stable and is what a catalog can hold.

## The new contract

Identity only. No nutrient field may appear anywhere in the model's response schema.

```ts
interface PhotoFoodSuggestion {
  name: string;      // the food as a catalog name, e.g. "chicken"
  grams: number;     // the quantity to log
  fdcId: number | null;  // the USDA food the model chose, or null
}
```

`fdcId` is an **integer** (USDA's own type), not a string.

### Resolution — three paths, and the one the design had no answer for

The intent says two things that do not obviously fit together: *"Gemini resolves identity
only — values are never transcribed through the model"* and *"foods USDA can't resolve
still log with approximate numbers, never dropped"*. If the model emits no numbers and
USDA fails, where do the approximate numbers come from?

**Decision: there are none. The food is logged with an absent vector and the user supplies
the numbers.** Path by path:

| # | Condition | Vector source | Item shows |
|---|---|---|---|
| 1 | A catalog food is named `name` | the catalog's existing vector | that food's numbers |
| 2 | No catalog food; USDA resolves `fdcId` | `usda-source`'s mapped per-100 g vector, frozen into a new `Food` (`servingGrams: 100`) | USDA numbers |
| 3 | No catalog food; USDA cannot resolve | **none** — the food is created with `zeroVector()` | the unknown affordance |

Rationale for path 3: "never dropped" is a statement about the **food**, not about its
numbers — the row is logged, which is what matters, and `content.ts` already gives an
all-zero vector the meaning "no nutrient data". Inventing a fallback number in the model
would violate the locked decision that values never transcribe through the model, and the
editor already exposes all 27 fields for correction. A model-guessed number is worse than
a blank one, because the blank invites correction and the guess hides behind authority.

This reinterprets the intent's "approximate numbers". It is recorded here rather than
resolved silently; if approximate numbers are wanted from a non-USDA source, that source
needs naming first.

### Dedup by name

Path 1 is the **dedup rule** and it is what makes rate limits a non-issue: a photo saying
`chicken` reuses the catalog food named `chicken` and calls USDA **zero times**. Exact
match on name, no fuzzy matching, no brand logic. Locked in the intent.

## The tool loop

The model is given one function declaration and must call it to see candidates:

```ts
// declared in `tools: [{ functionDeclarations: [...] }]`
usda_search(query: string, dataType?: string[]) -> { foods: { fdcId, description, dataType, score }[] }
```

Turns: photo + prompt → model returns `functionCall` → backend runs the real search
(`usda-source`) → backend sends `functionResponse` with the candidates → model returns the
final JSON, naming one `fdcId` per food. Then the backend, not the model, fetches the
authoritative vector by that `fdcId` and maps it.

Why the model picks rather than the backend taking the top hit: `search "chicken"` returns
"Chicken, broilers or fryers, breast, meat only, raw" alongside "Chicken, nuggets,
frozen, prepared". The score field does not know which one is on the plate. Seeing the
candidates and judging is the one thing the model is genuinely better at here. Cost, stated
plainly: this is a multi-turn call — slower and more tokens than the single call it
replaces.

**The model is given candidate names and ids, never nutrient amounts.** A candidate's
numbers are not in the tool payload, so no number can reach the answer by being echoed
from a tool result.

## Invariants that must survive the rewrite

These come from the current `gemini.client.ts` and are the reason it is trusted:

1. **Every failure is one failure.** A non-2xx, timeout, network error, bad envelope,
   schema violation, the model's own `readable: false`, a tool call that never returns,
   and a `fdcId` that resolves to nothing all collapse to `COULD_NOT_READ`. Exactly one
   failure path reaches the controller.
2. **The key and the image stay in the client.** The Gemini key travels only in
   `x-goog-api-key` — deliberately never in the URL, "which proxies log". The image is
   base64 inside one request body and is then dropped. This module writes nothing to any
   log.
3. **The hint is steering, not correction.** Same turn, labelled as a hint. A correction
   is a confirmed entry the BFF posts later.
4. **Fail closed at construction.** Missing `GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_API_BASE`
   is a deployment error, named without values.
5. **`completeVector` remains the completeness rule** for every vector that reaches a food,
   whichever path produced it.
6. **Transport is injected** (`GeminiTransport = fetch`) so tests never touch the network.

### One security contrast worth naming

The Gemini key goes in a **header**; the USDA key must go in the **query string** (its
`ApiKeyAuth` is `in: query`). The current client's stated reason for avoiding URL keys is
that proxies log them. So the USDA client inherits the strictest version of the no-logging
rule: any logged URL *is* a leaked key, and data.gov deactivates keys it finds published.

## Open verification

1. **The function-calling envelope.** The current single-call shape was verified against
   the Generative Language discovery document (2026-10-03, recorded in `MAP-meal-nutrition.md`).
   The `tools` / `functionDeclarations` / `functionCall` / `functionResponse` shape has had
   **no such verification**, and the exact turn structure (which `role` carries a
   `functionResponse`, how a loop terminates) is precisely where an unverified assumption
   becomes a silent failure. Verify against the discovery document before implementing.
2. **USDA's JSON field names and the mapping table** — see `SPEC-usda-source.md`. Path 2
   is unusable until those are settled.
3. **Loop bounds.** Cap the tool loop (rounds and wall clock). A model that keeps searching
   must terminate as `COULD_NOT_READ`, not hang.

## Non-goals

Dish composition (a photo yields foods; saved meals already model "many foods → one slot"
and are not reworked). Brand capture (a photo cannot read a brand). Storing `fdcId` on
`Food` (provenance needs a migration; migrations are the human's to run). Portion
conversions (we log grams).
