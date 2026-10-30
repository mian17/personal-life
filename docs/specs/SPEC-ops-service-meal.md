# SPEC-ops-service-meal — module id `ops-service-meal`, body extracted verbatim from frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.3

### 1.3 Module `ops-service-meal` — `apps/meal-service` (15 routes, 4 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `entries` (`/api/entries`) | `create` | `date`* string; `mealGroup`* string enum `MEAL_GROUPS`; `foodId`* string; `quantity`* number; `nutrients`* object (E2) | `POST /api/entries` |
| | `list` | `date`* string; `meal` string enum `MEAL_GROUPS` | `GET /api/entries` |
| | `get` | `id`* string | `GET /api/entries/:id` |
| | `update` | `id`* string; `date` string; `mealGroup` string enum; `quantity` number; `nutrients` object (E2); `expectedVersion` number | `PATCH /api/entries/:id` |
| | `delete` | `id`* string | `DELETE /api/entries/:id` |
| `foods` (`/api/foods`) | `create` | `name`* string; `unit` string enum `FOOD_UNITS` (`g`\|`ml`); `servingGrams` number; `portions` object[] (E2: `label`* string, `amount`* number); `nutrients` object (E2) | `POST /api/foods` |
| | `list` | `q` string; `includeDeleted` boolean | `GET /api/foods` |
| | `get` | `id`* string | `GET /api/foods/:id` |
| | `update` | `id`* string; `name` string; `servingGrams` number; `portions` object[]; `nutrients` object; `expectedVersion` number | `PATCH /api/foods/:id` |
| | `delete` | `id`* string | `DELETE /api/foods/:id` (soft delete) |
| `saved-meals` (`/api/saved-meals`) | `create` | `name`* string; `mealGroup`* string enum; `items`* object[] (E2: `foodId` string, `quantity`* number, `nutrients`* object) | `POST /api/saved-meals` |
| | `list` | — | `GET /api/saved-meals` |
| | `get` | `id`* string | `GET /api/saved-meals/:id` |
| | `delete` | `id`* string | `DELETE /api/saved-meals/:id` (soft delete) |
| `target` (`/api/target`) | `list` | `date`* string | `GET /api/target?date=` (the service 400s on a missing date — never defaults) |

`nutrients` on `entries`, `foods`, `saved-meals` items is the 27-key
`Record<Nutrient, number>`: `object` with the 27 property names declared literally
in `number` properties, in `NUTRIENTS` order (`packages/nutrition/src/nutrients.ts:55-91`),
all optional at the property level — the service owns vector completeness
(`foods/content.ts`), ops owns shape. The module imports nothing from
`@life/nutrition` (zero runtime dependencies); the key list is mirrored with a
citing comment and a drift assertion in the suite (§6).
