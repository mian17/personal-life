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
  name: string;          // the food as a catalog name, e.g. "chicken"
  grams: number;         // the quantity to log
  foodId: string | null;  // the catalog food the model chose, or null
  fdcId: number | null;   // the USDA food the model chose, or null
  searchQuery: string | null; // the search_food query that offered the id, or null
}
```

`fdcId` is an **integer** (USDA's own type), not a string. `foodId` is a reference to
one of our own catalog foods; the tool result is catalog-first (below), so the model
picks either a catalog `foodId` (reuse — zero USDA calls) or a USDA `fdcId`, or neither.
Both are identity, not numbers; no nutrient field exists here. `searchQuery` is the
`search_food` query whose result carried the chosen id — the binding that keeps one
food's id from resolving onto another food (below).

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
| 2 | No catalog food; USDA resolves `fdcId` | `usda-source`'s mapped per-100 g vector (stored when the food is created at log time, `servingGrams: 100`) | USDA numbers |
| 3 | No catalog food; USDA cannot resolve | **none** — the food is created with `zeroVector()` | the unknown affordance |

Path 2 is **batched across the whole photo**: resolution gathers the distinct `fdcId`s
the answers carry — each only when the query it names actually offered it, and only
when the catalog did not already supply the food — and fetches them in **one** request
per 20 ids (`usda.client.ts` `fetchByFdcIds`), not one per food. An id any answer could
not vouch for never enters the batch, and an id the batch returns nothing for (an
invalid id, a failed request) takes `zeroVector()` exactly as path 3 states.

**Nothing here is written at estimate time.** All three paths resolve an on-the-wire
vector only — no `Food` row is created during the estimate. The backend resolves the
*vector* (reuse the catalog's stored vector on path 1, call `usda-source` on path 2,
`zeroVector()` on path 3) and returns a `PhotoEstimateItem` (identity + resolved vector +
`servingGrams`). The catalog row itself is written **at log time** (amendment 2026-10-04):
the estimate is a draft, and creating registry rows from a draft litters the catalog with
foods the user then edits or abandons — the same failure mode as
`docs/lessons/0009-autosave-inline-tag-orphans.md`, whose rule is that creation is gated on
a user-produced confirmation. The confirmation here is the log-meal click. (The **log-time
create path** — reuse-existing / create-at-100 g / un-scaling the per-100 g base — lives in
`SPEC-meal-capture-grams.md §"The log-time create path"`, not here.)

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

**The normalized key.** Uniqueness is compared on a **normalized key** — trim, collapse
internal whitespace, case-fold — while the **stored name keeps the user's exact spelling**.
So `Chicken` / `chicken` / `chicken ` are **one** food; `chicken` and `chicken breast` are
**two**. The first is typographic and would otherwise pollute the catalog with one food per
capitalisation; the second is a real semantic difference and is **accepted as its own food**,
not fuzzy-merged. Semantic variation is allowed; typographic variation is not.

**Two rows naming the same food** (two portions of `chicken` in one photo) produce **one
catalog food and two entries** — two logged portions, not a duplicate.

## The tool loop

The model is given one function declaration and must call it to see candidates:

```ts
// declared in `tools: [{ functionDeclarations: [...] }]`
search_food(query: string) -> {
  catalog: { id: string; name: string; servingGrams: number }[];
  usda: { name: string; fdcId: number }[];   // empty unless the catalog had no match
}
```

**Search order is catalog first, USDA second.** The tool queries our **own catalog first**
(`FoodsService.findAll`), and only when nothing matches does it query the USDA API
(`usda-source`). The result carries **no nutrient amounts** — catalog rows expose
`id`/`name`/`servingGrams`, USDA candidates expose `name`/`fdcId` — so no number can reach
the answer by being echoed from a tool result. Rationale: a food the user already corrected
is a better answer than a fresh USDA guess, and it costs **zero API calls**. It also makes
repeat photos free — the second `chicken` resolves against the catalog with no USDA traffic
(intent "Amendment 2026-10-04 — search order"; `usda-source` keeps no cache of its own, the
catalog *is* the cache).

Turns: photo + prompt → model returns `functionCall` → backend runs the catalog-first search
→ backend sends `functionResponse` with the candidates → model returns the final JSON,
naming one catalog `id` per food when it matched the catalog, else one `fdcId`. Then the
backend, not the model, resolves the vector by that id (an existing catalog food reuses its
stored vector; else `usda-source` fetches the authoritative vector by `fdcId` and maps it).

Why the model picks rather than the backend taking the top hit: for USDA, `search "chicken"`
returns "Chicken, broilers or fryers, breast, meat only, raw" alongside "Chicken, nuggets,
frozen, prepared". The score field does not know which one is on the plate. Seeing the
candidates and judging is the one thing the model is genuinely better at here. Cost, stated
plainly: this is a multi-turn call — slower and more tokens than the single call it
replaces; a catalog hit spends none of it on USDA.

**Enforcement is two-sided.** The loop's first turn is forced (`functionCallingConfig.mode:
"ANY"`, §"The verified envelope"), so the model cannot answer before the tool has shown it
candidates; later turns relax to `AUTO` so it can answer once it has them. And the backend
trusts only an id that the query the answer names as its `searchQuery` actually offered: an
answer's `foodId` or `fdcId` that the named query did not return is not resolved — the item
keeps its name and grams and takes the absent vector (path 3), and the person fills the
numbers by hand. Naming an id is therefore a **reference, not a claim**: the model selects
from what it was shown and names the search that showed it, and anything else is treated as
no id at all. The gate covers both id kinds — a guessed catalog id could collide with a real
row and attach another food's stored vector, exactly as a guessed `fdcId` could. It never
gates `name` or `grams`: the model names foods by sight, the person can edit them, and
neither carries a number.

Residual limitation: the gate binds an id to a query, not to a food, so a model that
deliberately reports a wrong-but-offered query-and-id pair can still cross-wire one food's
vector onto another; the id is at least one the model was shown, not invented.

### The verified envelope (discovery document, 2026-10-05)

Verified against the same source as the single call — the Generative Language discovery
document (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`),
fetched 2026-10-05 (the docs host returns 403 from this environment; the API host serves
the document). Every shape below is quoted from it, not inferred.

**Request envelope** (`GenerateContentRequest`): `model` (required, `models/{model}`),
`contents` (required, `Content[]`), plus optional `tools` (`Tool[]`), `toolConfig`
(`ToolConfig`), `generationConfig` (`GenerationConfig`), `systemInstruction` (`Content`).

**Tool declaration** — a `Tool` in `tools[]`. `Tool` also carries `googleSearch`,
`fileSearch`, `codeExecution`, `urlContext`, `googleMaps`, `computerUse`, `mcpServers`,
`googleSearchRetrieval`; only `functionDeclarations` is named here:

```json
{ "functionDeclarations": [
    { "name": "search_food",              // string, REQUIRED
      "description": "...",               // string, REQUIRED
      "parameters": { ...Schema }         // optional, OpenAPI 3.03 Parameter Object
    } ] }
```

`FunctionDeclaration` additionally offers `response` / `parametersJsonSchema` /
`responseJsonSchema`; we use `parameters` only.

**Tool call** — a `Part` in a `Content` the model returns:

```json
{ "functionCall": { "name": "search_food", "args": { "query": "..." }, "id": "..." } }
```

`name` is required, `args` an optional JSON object, `id` an optional "unique identifier
of the function call".

**Tool result** — the `Part` the client sends back in the next request's `contents`:

```json
{ "functionResponse": { "name": "search_food", "id": "...", "response": { ... } } }
```

`name` and `response` are required — `response` is "the function response in JSON object
format. Callers can use any keys of their choice" — and `id` is optional, matching the
corresponding `functionCall.id`. Our `response` payload is the `search_food` result
above: catalog `id`/`name`/`servingGrams`, USDA `name`/`fdcId` — names and ids only.
The model never carries nutrient values — identity only, per §"The new contract".

**`role` is optional; the tool-result turn carries `role: "user"`.** `Content` is
`{ role?: 'user' | 'model'; parts: Part[] }`, and the discovery document says of `role`:
"The producer of the content. Must be either 'user' or 'model'. Useful to set for
multi-turn conversations, otherwise **can be left blank or unset**." This was the open
question (§"Open verification" 1) and the source answers it: a tool result needs no
terminating role, and the convention is `role: "user"` on the turn carrying the
`functionResponse`. (The `Tool.functionDeclarations` prose mentions a role "function";
the `Content` schema permits only 'user'/'model' — the schema wins.)

**`functionCallingConfig.mode`: `ANY` first, `AUTO` after.** `ToolConfig.functionCallingConfig`
takes `mode` ∈ `MODE_UNSPECIFIED | AUTO | ANY | NONE | VALIDATED`, plus optional
`allowedFunctionNames: string[]`. The loop's **first** request sends `ANY`, which forbids a
terminal text turn: the model must call `search_food` before it can answer, so an answer can
never be given without candidates. Every **later** request sends `AUTO`, the default, so the
model may answer with the final JSON once it has them. `ANY` cannot be held for the whole
loop — it forces a call on the final turn too, so the loop could never terminate on text;
`VALIDATED` buys constrained decoding one function does not need.

**Schema and tools coexist in one request.** `GenerationConfig` carries `responseSchema`,
`responseMimeType`, `responseJsonSchema`, `thinkingConfig` — so the identity JSON schema
and the `search_food` declaration ride in the same `GenerateContentRequest`. The
consequence: `responseSchema` constrains the **final text turn**, while a tool call
arrives as a `functionCall` part, not as schema-constrained text.

**Termination, stated from the shape, not inferred.** A turn ends when the candidate's
`parts` contain **no** `functionCall`. A `functionCall` part means the loop continues —
the client executes it and sends a `functionResponse` part in the next request. The
terminal turn is the one whose part is `text`, which is what `responseSchema` shapes.

**Bounds: 5 tool rounds, 45 s wall clock.** A meal photo holds a handful of distinct
foods, so a model still searching after 5 rounds is looping, not reading; 45 s is 3 ×
the client's existing 15 s per-request timeout (`gemini.client.ts`) — an estimate cannot
sit for minutes while a diner waits. The wall clock is a hard stop: the turn at hand is
treated as the model's final answer, and if no usable JSON arrived, the result is
`COULD_NOT_READ`. The round cap **degrades instead of discarding**: when the model
returns a `functionCall` with the budget spent, the loop does **not** run the tool — it
answers the outstanding call with an empty result (`{ catalog: [], usda: [] }`, which
offers no id) and allows **exactly one** further turn for the model to answer with the
foods it already found. A second over-cap `functionCall` ends the loop as before. So the
foods a model could not search take `zeroVector()` through path 3, and a photo that
merely needed more searches still returns its foods — never `could-not-read` for that
reason alone. The overflow turn runs no tool, so it costs no USDA call
(`gemini.client.ts` `readWithSearch`).

## Failure reasons

A photo estimate that cannot produce foods resolves — it never throws — with
`reason` from one closed set, carried unchanged from `GeminiClient` through
`PhotoService`, the controller, and `lib/meal-api.ts` to the editor
(`PhotoFailureReason` on both sides of the wire):

| `reason` | Who owns the problem | What the user should do | Where it is classified |
|---|---|---|---|
| `could-not-read` | the photo — the model could not read it, or its answer was unusable | send a better photo, or type the meal by hand | `gemini.client.ts`: an unsupported mime, a body that is not the documented envelope, a schema violation, the model's own `readable: false`, a tool loop past its bound |
| `service-unavailable` | the service — Gemini could not answer | retry later; the operator reads the server log | `gemini.client.ts`: a non-2xx (402, 403, 404, 429, 5xx), a transport throw, a timeout/raced expiry; the BFF when the call to `meal-service` itself fails |
| `no-image` | the request — there was no photo | attach a photo | the BFF (`actions.ts`): no `File`, or `File.size === 0` |

The distinction is the point: before this set, a 402 `RESOURCE_EXHAUSTED` (the
account out of credit) collapsed into `could-not-read`, and the banner sent the
user to re-photograph a meal when the real problem was a service account. Each
failure is logged once, server-side, with its class and the API's HTTP status
when the API answered — never the prompt, the body, the image, or the key. The
editor renders the frozen `could-not-read` banner for the photo's own failures
and a distinct outage banner for `service-unavailable`; either way it opens one
empty row and leaves manual entry usable.

## Invariants that must survive the rewrite

These come from the current `gemini.client.ts` and are the reason it is trusted:

1. **Two failures, named by their owner.** A non-2xx, timeout, and network error are the
   service's (`SERVICE_UNAVAILABLE`); a bad envelope, a schema violation, the model's own
   `readable: false`, a tool call that never returns, and a `fdcId` that resolves to nothing
   are the photo's (`COULD_NOT_READ`). See § Failure reasons for the full classification.
   Exactly one typed failure path reaches the controller, and it carries the reason.
2. **The key and the image stay in the client.** The Gemini key travels only in
   `x-goog-api-key` — deliberately never in the URL, "which proxies log". The image is
   base64 inside one request body and is then dropped. This module logs a failure's class
   and the API's HTTP status only — never the key, the image bytes, the prompt, or the body.
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

1. **The function-calling envelope.** **Resolved 2026-10-05** — see §"The tool loop" →
   *The verified envelope*. The `tools` / `functionDeclarations` / `functionCall` /
   `functionResponse` shapes were verified against the Generative Language discovery
   document; the open question of which `role` carries a `functionResponse` is answered
   there (it is optional, conventionally `role: "user"`).
2. **USDA's JSON field names and the mapping table** — **Resolved 2026-10-05**, and the
   fetch path is **batched**: one `GET /v1/foods?fdcIds=` request per estimate (chunked
   at 20 ids) supplies every food's vector, and its list entries share the fetch-by-id
   row shape, so one mapper reads both. See `SPEC-usda-source.md`.
3. **Loop bounds.** **Chosen 2026-10-05** — 5 tool rounds and 45 s wall clock, recorded in
   §"The tool loop" → *The verified envelope*. The wall clock is a hard stop (`COULD_NOT_READ`
   if no usable JSON followed); the round cap **degrades** — the outstanding call is
   answered empty, one further turn is allowed, and the foods already found still return.
   `gemini.client.ts` enforces both.

## Non-goals

Dish composition (a photo yields foods; saved meals already model "many foods → one slot"
and are not reworked). Brand capture (a photo cannot read a brand). Storing `fdcId` on
`Food` (provenance needs a migration; migrations are the human's to run). Portion
conversions (we log grams).
