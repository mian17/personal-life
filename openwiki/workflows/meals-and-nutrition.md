---
type: 'Reference'
title: 'Meals and nutrition'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-15c932dc314c1e82628cd781
    resource: repo://apps/app/app/(meals)/meals/entry/%5Bid%5D/editor.tsx
  - id: openwiki-source-e5796363b34cd8fb5eaee48b
    resource: repo://apps/meal-service/src/entries/entry.entity.ts
  - id: openwiki-source-432576f731304eace3d4b049
    resource: repo://apps/meal-service/src/foods/food.entity.ts
  - id: openwiki-source-529adad5b98db00ca5c3989c
    resource: repo://apps/meal-service/src/meal-todo.controller.ts
  - id: openwiki-source-0986856b474a5963bb3e00b0
    resource: repo://apps/meal-service/src/photo/gemini.client.ts
  - id: openwiki-source-a2888c44620d3b48dbdcdce1
    resource: repo://apps/meal-service/src/usda/mapping.ts
  - id: openwiki-source-343d3c003121391e9998aa26
    resource: repo://apps/meal-service/src/usda/usda.client.ts
  - id: openwiki-source-b3109f2a2e00083e2d96c75c
    resource: repo://packages/nutrition/src/index.ts
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Meals and nutrition

`meal-service` owns foods, meal entries, daily targets, saved meals, the USDA
lookup and the photo estimate; `@life/nutrition` owns the math. Cached rows and
content columns follow the shared at-rest contract — see
[Data layer](../architecture/data-layer.md) and
[Crypto at rest](../architecture/crypto-at-rest.md); this page is the domain
shape.

## The domain, in five parts

**Foods** (`foods/`) — a registry of reusable foods with nutrient profiles;
content columns encrypted, `food.unit` carries a `text NOT NULL DEFAULT 'g'`.
**Entries** (`entries/`) — a logged meal item: quantity, a food reference, and
a **scaled, confirmed nutrient snapshot** stored as one `enc.v1.` JSON envelope
(`entry.entity.ts`). The snapshot is the point: re-logging a meal does not
re-query anything, and a later change to a food cannot rewrite history.
**Targets** (`targets/`) — daily goals the UI measures entries against.
**Saved meals** (`saved-meals/`) — reusable meals (a set of items) with the same
snapshot discipline.
**Batch** (`batch/`) — batch entry operations through the shared batch runner.

## External integrations

**USDA lookup** (`usda/`) — `usda_search` lists candidate foods by name
(names and USDA ids only), `usda_client.ts` is the domain's only HTTP boundary
to FoodData Central, and `mapping.ts` translates the USDA nutrient shape to the
repo's vector. No SQL over anything external; the mapping is pure.

**Photo estimate** (`photo/`) — the domain's only Gemini call
(`gemini.client.ts`, a plain `fetch` against the Generative Language API, no
SDK): the photo pipeline answers with an estimated nutrient vector, and
failures are named by their owner — `COULD_NOT_READ` (the photo's fault:
unsupported mime, malformed body, schema-violating model answer) versus the
model's own errors. The estimate **seeds** the entry; the user confirms and
corrects it.

## Estimation is a derived view, not a stored flag

`isEstimated` is **not a wire field** and not a column. It is derived in the
app's entry editor (`apps/app/app/(meals)/meals/entry/[id]/editor.tsx`) from
the item's `known` nutrient-key set: a photo estimate seeds all 27 nutrient
fields, so an item whose `known` set covers every non-headline nutrient is the
fingerprint of an estimate. A manual item (empty set) or a restored entry
(headline nutrients only) is never "estimated". Do not look for it in a network
payload.

## Math lives in `@life/nutrition`

`packages/nutrition` exports exactly five modules — `nutrients` (the vector
shape), `food`, `scale` (quantity scaling), `sum` (aggregation over items),
`format` (display). Nothing else imports its internals; the package does no I/O
and holds no state, so the same math serves the service, the BFF and the UI.

## The meal → todo bridge

Turning a meal into a todo (e.g. "eat this") rides the transactional outbox and
the BFF drain — see
[Todos and the transactional outbox](todos-and-outbox.md). That is the flow
that shipped dead in v0.2.1 when `MEAL_TODOS_API_URL` was missing from the
deployed env.

## See also

- [Data layer](../architecture/data-layer.md) — how entries are cached
  (`entries-cache.ts` is one of the adapter patterns).
- [Testing strategy](../testing/strategy.md) — `entries-cache.e2e-spec.ts`
  asserts the snapshot structurally.
