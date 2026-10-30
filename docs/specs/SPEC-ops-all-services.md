# Spec: `@life/ops` all six service modules — capability map + per-module specs

Status: DRAFT for user confirmation. Serves `docs/intent/ops-all-services.md`
(confirmed yes — the user answered "yes" to the cut of `DELETE /api/tags/:id` and
`DELETE /api/lists/:id`). Initiative name: `ops-all-services` (the file name and the
branch). It is **not** one capability: Phase 0 fires and the verdict is DECOMPOSE
(§1, resolved — no open question). The capability map is §1.0 and gates this
document; each module's spec body is the numbered section §1.1.1, §1.1.2, §1.2–§1.6
carries for its module id, scoped to that module's objective, boundaries, and
success.
The package's existing contracts stay as they are (`SPEC.md` core/CLI/MCP surface,
`SPEC-ops-agent-contract` MCP wire and auth/transport seams,
`SPEC-ops-notes-service` for the `notes` module, which is untouched here).

## 1. Objective

Make `@life/ops` cover the whole backend estate from one process: five new service
modules (`todo`, `meal`, `tags`, `focus`, `feedback`) beside the existing `notes`,
plus the two registry capabilities the audit (`/tmp/ops-contract-audit/report.md`)
proved the contract lacks — **a module may export several resources** and **a field
may be an object or an array of objects** — plus comma-separated
`LIFE_OPS_SERVICE` loading with per-service API bases. One CLI process and one MCP
process then serve every loaded service with one token.

### 1.0 Phase 0 scope check — verdict DECOMPOSE (resolved)

The skill's detection fires on all three bullets, and the verdict follows the
skill rather than rationalising it away:

- **Own data and own consumers per module.** `todo`, `meal`, `tags`, `focus`,
  `feedback` each own a database, a base URL, and a route family; none reads
  another's data.
- **Acceptance criteria cluster per module.** §8 splits into per-module parity
  suites by construction (§6), plus the loader and vocabulary suites — six
  independently verifiable groups.
- **Any one module is cuttable without rewriting another.** Dropping `feedback`
  from the map leaves §1.2–§1.5 byte-identical; only §1.7's route tally and §2's
  `LIFE_OPS_SERVICE` line change.

The two registry extensions (E1, E2) are their own capabilities by the same test:
E2 is verifiable in the validator/schema suite with no service module present, and
E1 in the loader suite with a fixture module. The intent calls them out separately
as "two capabilities the registry lacks today".

That cross-cutting property the intent describes (one process, one token, one tool
namespace over all six) does **not** collapse the map: it is the integration
success of the last build step, expressed as `ops-service-loader`'s acceptance
criteria, and it is exercised by a module that composes the others rather than by
every module.

### 1.0.1 Capability map (gates this document)

| Module id | Responsibility | Depends on |
|---|---|---|
| `ops-registry-vocabulary` | `FieldSpec` type set incl. `object`/`object[]` + `properties`; recursive validation with dotted/indexed paths; JSON Schema derivation; wire body assembly; CLI JSON flags (§1.1.1) | — |
| `ops-service-loader` | `ServiceModule.resources[]` union, tool-name uniqueness, comma-separated `LIFE_OPS_SERVICE`, per-service base resolution, MCP union tool list (§1.1.2) | `ops-registry-vocabulary` |
| `ops-notes-service` | The existing `notes` module — 6 routes, untouched (governed by `SPEC-ops-notes-service`) | `ops-service-loader` |
| `ops-service-todo` | `apps/todo-service` — 5 resources, 12 routes (§1.2) | `ops-service-loader` |
| `ops-service-meal` | `apps/meal-service` — 4 resources, 15 routes (§1.3) | `ops-service-loader` |
| `ops-service-tags` | `apps/tags-service` — 2 resources, 4 routes (§1.4) | `ops-service-loader` |
| `ops-service-focus` | `apps/focus-service` — 2 resources, 3 routes (§1.5) | `ops-service-loader` |
| `ops-service-feedback` | `apps/feedback-service` — 1 resource, 2 routes (§1.6) | `ops-service-loader` |

**Build order:** `ops-registry-vocabulary` → `ops-service-loader` → the six
service modules in parallel → the integration acceptance in §8.6–8.8. No cycles:
the vocabulary module knows nothing of loaders or services; the loader knows the
vocabulary only; each service module knows the loader's `ServiceModule` type only.
A service module that needed another service module's descriptors would make them
one module — none does.

**Interfaces live at the boundary.** The vocabulary contract (E2's `FieldSpec`
extension) is owned by `ops-registry-vocabulary` and stated once in §1.1.1; module
sections reference it and never restate it. The loader contract (E1/E3) is owned by
`ops-service-loader` and stated once in §1.1.2; service modules consume it.

**Storage and gating.** The map above is the Phase 0 artifact: it is reviewed
(human gate) before any module spec's content is implemented, and before the plan
is written. Per the repo's `docs/specs/` convention each module id materialises as
`docs/specs/SPEC-<module-id>.md`:

| Module id | Spec file | Body of record |
|---|---|---|
| `ops-registry-vocabulary` | `docs/specs/SPEC-ops-registry-vocabulary.md` | §1.1.1 |
| `ops-service-loader` | `docs/specs/SPEC-ops-service-loader.md` | §1.1.2 |
| `ops-notes-service` | `docs/specs/SPEC-ops-notes-service.md` | already exists, untouched |
| `ops-service-todo` | `docs/specs/SPEC-ops-service-todo.md` | §1.2 |
| `ops-service-meal` | `docs/specs/SPEC-ops-service-meal.md` | §1.3 |
| `ops-service-tags` | `docs/specs/SPEC-ops-service-tags.md` | §1.4 |
| `ops-service-focus` | `docs/specs/SPEC-ops-service-focus.md` | §1.5 |
| `ops-service-feedback` | `docs/specs/SPEC-ops-service-feedback.md` | §1.6 |

This document is the map plus the per-module bodies, so each extraction is
verbatim and content-preserving — no requirement is added, weakened, or re-decided
by it, and the shared vocabulary (§1.1.1) is referenced from the provider module's
spec rather than restated per module. The map, not filename guessing, indexes what
exists; the ids above are stable and are never renamed mid-initiative.

### 1.1 Two module specs: `ops-registry-vocabulary` (§1.1.1) and `ops-service-loader` (§1.1.2)

This section holds two module specs from the §1.0.1 map, one per id, because the
two providers own the boundary each other consumes. **§1.1.1 is
`ops-registry-vocabulary`** — the `FieldSpec` vocabulary (E2) and the validator,
JSON Schema, wire, and CLI derivations every service module inherits. **§1.1.2 is
`ops-service-loader`** — the loading contract (E1's `resources[]`, E3's
comma-separated list and per-service bases) and the union tool list. The
dependency runs one way, §1.1.1 ← §1.1.2: the loader consumes the vocabulary and
the vocabulary knows nothing of loaders. Every §1.2–§1.6 module references these
two specs and restates nothing.

#### 1.1.1 `ops-registry-vocabulary` — the field vocabulary (E2)

- **E2 — object and array-of-object fields.** `FieldSpec.type` gains `'object'`
  and `'object[]'`; `FieldSpec` gains `properties?: Record<string, FieldSpec>`,
  required exactly when the type is `object`/`object[]`, forbidden otherwise,
  recursive (an `object[]`'s `properties` describe one element, which may itself
  nest — saved-meal items nest `nutrients` one level down). Derivations:
  validator — `object` is a plain non-null object with no unknown keys (closed key
  set), required properties present, every supplied value checked recursively;
  `object[]` is an array of such objects; failure `field` paths are dotted/indexed
  (`items.0.nutrients.sodium`) and render through the existing canonical shape.
  Wire — nested values pass through as supplied JSON in the request body;
  `object`/`object[]` fields are body-only, legal on `create`/`update` kinds only
  (the query-bearing `list` kind keeps flat closed types). MCP `inputSchema` —
  `object` → `{type: 'object', properties, required, additionalProperties: false}`,
  `object[]` → `{type: 'array', items: <object schema>}`. CLI —
  `--field '<json>'` with `JSON.parse`; a parse failure renders the canonical
  validation message. `null` stays unrepresentable (no null-means-clear, §1.7).

#### 1.1.2 `ops-service-loader` — the loading contract (E1, E3)

- **E1 — multi-resource service modules.** `ServiceModule`
  (`packages/ops/src/cli/run.ts:22-26`) gains `resources?: ResourceRegistry[]`
  beside the existing `registry`. Exactly one of the two must be present; the
  loader errors on both or neither (existing error style). The loaded union is
  `resources ?? [registry]`. `ResourceRegistry = ResourceSpec`
  (`core/types.ts:40`) is unchanged — the win comes from several resources per
  module, each with its own `basePath`, which is exactly what the audit's rank-1b
  unblocks. Tool names `<resource>_<kind>` (`core/schema.ts:61` already derives
  them from resource names) must be unique across the union; the loader asserts
  it and errors on collision naming both resources. `notes` and
  `fixtures/sample.ts` compile unchanged — a regression guard, not a rewrite.

- **E3 — comma-separated loading and per-service bases.** `LIFE_OPS_SERVICE`
  accepts a comma-separated list (whitespace trimmed); each entry resolves as
  today (bare name → the in-package `src/services/<name>`, path-like → a module
  exporting `service`/`registry`). The union of all loaded registries feeds both
  adapters (names unique per E1). Per-call base resolution, in precedence order:
  the module's own `apiBase` (none of these modules sets one) →
  `LIFE_OPS_API_BASE_<NAME>` (NAME = bare service name uppercased) →
  `LIFE_OPS_API_BASE`, but only when exactly one service is loaded. Multiple
  services with a missing per-service variable is an error naming the variable —
  fail closed, never dial one service's data from another's base. A single-value
  `LIFE_OPS_SERVICE` with `LIFE_OPS_API_BASE` behaves byte-identically to today.

Auth is unchanged: one token per process (`login`/`logout` as today,
`LIFE_OPS_CLIENT_ID=dev`, no new OAuth client). Every service takes the owner from
the verified token and accepts the `life-api` audience
(`packages/service-kit/src/auth/jwt-verifier.ts:49`), so
`LIFE_OPS_RESOURCE=https://life-ops` (IdP-mapped to `life-api`) serves all six.

### 1.2 Module `ops-service-todo` — `apps/todo-service` (12 routes, 5 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `todos` (`/api/todos`) | `create` | `title`* string; `note` string; `dueDate` string (ISO datetime, `ISO_DUE`); `repeat` string enum `TODO_REPEATS`; `repeatDays` number[]; `listId` string; `important` boolean; `tagIds` number[] | `POST /api/todos` |
| | `list` | `q` string; `listId` string; `tagId` number; `done` boolean; `important` boolean; `dueBefore` string; `dueAfter` string; `limit` number; `cursor` string | `GET /api/todos` (supplied fields as query params, `cursor` opaque) |
| | `get` | `id`* string | `GET /api/todos/:id` |
| | `update` | `id`* string; `title` string; `note` string; `done` boolean; `dueDate` string; `repeat` string enum; `repeatDays` number[]; `listId` string; `important` boolean; `tagIds` number[]; `expectedVersion` number | `PATCH /api/todos/:id` |
| | `delete` | `id`* string | `DELETE /api/todos/:id` (soft delete) |
| | `restore` | `id`* string | `POST /api/todos/:id/restore` |
| `todos-tags` (`/api/todos/tags`) | `list` | — | `GET /api/todos/tags` |
| `todos-trash` (`/api/todos/trash`) | `list` | `limit` number; `cursor` string | `GET /api/todos/trash` |
| `todos-completions` (`/api/todos/completions`) | `list` | `limit` number; `cursor` string | `GET /api/todos/completions` |
| `lists` (`/api/lists`) | `create` | `name`* string; `importantDefault` boolean | `POST /api/lists` |
| | `list` | — | `GET /api/lists` |
| | `update` | `id`* string; `name`* string; `importantDefault` boolean; `expectedVersion` number | `PATCH /api/lists/:id` |

Fields mirror `apps/todo-service/src/todos/dto/*` and `lists/dto/*` one-for-one.
`tagIds`/`ids` arrays are `number[]` (`@IsInt({each: true})`, no conversion).
Null-clear is gone (§1.7): `note`, `dueDate`, `listId`, `repeat`, `repeatDays`,
`important` on todo `update`, and `importantDefault` on list `update`, carry plain
values only. `DELETE /api/lists/:id` is absent (policy, §1.7). No `push` resource
is declared — all three push routes are cut browser plumbing (§1.7), so the
intent's `push` grouping has no surviving route.

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

### 1.4 Module `ops-service-tags` — `apps/tags-service` (4 routes, 2 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `tags` (`/api/tags`) | `create` | `name`* string | `POST /api/tags` (create-or-get; the dual 201/200 never reaches rendering — executor returns the body) |
| | `list` | — | `GET /api/tags` |
| | `update` | `id`* number; `name`* string; `expectedVersion` number | `PATCH /api/tags/:id` (numeric id stringified by `wire.ts:57`) |
| `tags-resolve` (`/api/tags/resolve`) | `create` | `ids`* number[] | `POST /api/tags/resolve` |

`tags-resolve` is a pure read mislabelled `create` by the closed kind set (the
kind names the wire shape, not the semantics), so it carries the one
`isDestructive: false` override in this run (Assumption 8). `DELETE /api/tags/:id`
is absent (policy, §1.7).

### 1.5 Module `ops-service-focus` — `apps/focus-service` (3 routes, 2 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `goal` (`/api/goal`) | `list` | — | `GET /api/goal` |
| `sessions` (`/api/sessions`) | `create` | `date`* string (`YYYY-MM-DD`); `minutes`* number | `POST /api/sessions` |
| | `list` | `from`* string; `to`* string | `GET /api/sessions` |

`PUT /api/goal` is absent (no `PUT`, §1.7); the goal is read-only through ops.

### 1.6 Module `ops-service-feedback` — `apps/feedback-service` (2 routes, 1 resource)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `feedback` (`/api/feedback`) | `list` | — | `GET /api/feedback` |
| | `update` | `id`* string (UUIDv4, server-parsed); `status`* string enum `FEEDBACK_STATUS_VALUES` (`open`\|`in_progress`\|`done`\|`wont_do`) | `PATCH /api/feedback/:id` |

`POST /api/feedback` is absent (§1.7, Open Question 10.1).

### 1.7 Route accounting and the cuts

The five new modules cover **36 routes**: todo 12 + meal 15 + tags 4 + focus 3 +
feedback 2 — the audit's post-cut live surface (§5.4: 24 as-is + 5 second-resource
+ 7 vocabulary-extension). The `notes` module keeps its 6 routes unchanged, so a
fully loaded process exposes 42 ops over 15 resources. Eleven routes are cut, ten
by the intent's constraint/policy and one by the audit's tally:

| cut route | reason |
|---|---|
| `PUT /api/goal`, `PUT /api/target/profile` | no `PUT` support (no upserts) |
| `DELETE /api/push/subscribe` | no body-on-`DELETE` |
| `GET /api/push/key`, `POST /api/push/subscribe` | browser plumbing, no domain meaning |
| `DELETE /api/todos/trash`, `DELETE /api/todos/:id/permanent` | bulk and permanent deletes are human-only (mirroring the notes exclusions) |
| `POST /api/estimates/photo` | each call spends a Gemini request |
| `DELETE /api/tags/:id`, `DELETE /api/lists/:id` | ecosystem-wide destructive (shared tag vocabulary; `todo.listId` `SET NULL` detaches rows across apps) |
| `POST /api/feedback` | client-generated UUIDv4 `id` the registry cannot constrain; the audit's 11th cut (see 10.1) |

Also dropped: every null-means-clear path (the two todo `PATCH` routes' null
fields — §1.2). Nothing out of the intent's out-of-scope list is specified: no
MCP gateway fan-out, no per-service OAuth clients, no new endpoints in any
service, no frontend work.

### 1.8 User stories

- Terminal: `LIFE_OPS_SERVICE=todo,meal,notes npm run ops -- todos create --title "ship" --tagIds 3 --tagIds 7`,
  `… -- entries create --date 2026-02-01 --mealGroup lunch --foodId f1 --quantity 2 --nutrients '{"calories":400,…}'`,
  `… -- goal list` — every call routes to its own service's base from one process.
- AI agent (MCP): one stdio server lists the union — `todos_create`, `lists_update`,
  `entries_create`, `foods_update`, `saved-meals_create`, `target_list`,
  `tags_resolve`→`tags-resolve_create`, `goal_list`, `sessions_create`,
  `feedback_update`, `notes_*` … — and `tools/call` runs the same executor the CLI
  runs, rendering the same canonical shape.

## 2. Tech Stack

- Unchanged: Node 22 + TypeScript ~5.7.3, tsc, jest 29.7.0, ts-jest 29.2.6,
  `testEnvironment: node`; `packages/ops` keeps **zero runtime dependencies**
  (test-only devDeps as present; no new dependency of any kind).
- Consumed read-only: `apps/todo-service`, `apps/meal-service`, `apps/tags-service`,
  `apps/focus-service`, `apps/feedback-service` (NestJS ^11, `@life/service-kit`
  auth). Their HTTP contracts are consumed as-is: `Authorization: Bearer <JWT>`,
  owner-scoped (`@Principal()`, never body), `401` unauthenticated, `404`
  byte-identical for foreign/missing ids, `409` on stale `expectedVersion`,
  cursor pagination. Domain bounds (`TODO_TITLE_MAX`, `PORTIONS_MAX` 20,
  `QUANTITY_MAX` 100, `MINUTES_RANGE` 1–180, …) stay server-enforced.
- `@life/nutrition` is referenced by comment only (§1.3) — no import, no dep.
- Env surface (dev): `scripts/setup-dev-env.sh` gains every new variable in this
  same change: `LIFE_OPS_SERVICE=notes,todo,meal,tags,focus,feedback`;
  `LIFE_OPS_API_BASE_NOTES=http://127.0.0.1:3101`, `LIFE_OPS_API_BASE_TAGS=…:3104`,
  `LIFE_OPS_API_BASE_TODO=…:3105`, `LIFE_OPS_API_BASE_MEAL=…:3106`,
  `LIFE_OPS_API_BASE_FOCUS=…:3107`, `LIFE_OPS_API_BASE_FEEDBACK=…:3108`;
  `LIFE_OPS_RESOURCE=https://life-ops` with `OIDC_AUDIENCE_MAP` gaining
  `https://life-ops=life-api`; `LIFE_OPS_API_BASE` and `LIFE_OPS_CLIENT_ID=dev`
  stay. Service ports, data directories, and secrets are untouched hard lines.

## 3. Commands

```text
Typecheck: npm run typecheck              # run in packages/ops (workspace-aware)
Unit test: npm run test:unit -- <file>    # from packages/ops, one suite per command
E2E:       npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

- Testing policy: **at most 2 runs** (`max-test-runs: 2`), each targeted at the
  file(s) that prove the change — never the whole workspace speculatively.
- The e2e command is in the repo profile but is not used here (no UI is touched;
  parity is proven in jest against stub APIs).
- No build step: the repo profile declares no build command, so none is written.
  Do not widen any command beyond these.

## 4. Project Structure

```text
packages/ops/src/services/todo.ts       → NEW: todo module (5 resources, 12 routes)
packages/ops/src/services/meal.ts       → NEW: meal module (4 resources, 15 routes)
packages/ops/src/services/tags.ts       → NEW: tags module (2 resources, 4 routes)
packages/ops/src/services/focus.ts      → NEW: focus module (2 resources, 3 routes)
packages/ops/src/services/feedback.ts   → NEW: feedback module (1 resource, 2 routes)
packages/ops/src/services/notes.ts      → untouched (SPEC-ops-notes-service governs it)
packages/ops/src/core/types.ts          → extended (E1 lives in cli/run.ts; E2: FieldSpec 'object' | 'object[]' + properties)
packages/ops/src/core/wire.ts           → extended (E2: recursive body assembly)
packages/ops/src/core/validate.ts       → extended (E2: recursive object/object[] checks, dotted paths)
packages/ops/src/core/schema.ts         → extended (E2: object/array-of-object schemas)
packages/ops/src/core/registry.ts       → extended, amended from `untouched` at the spec gate (§1.1.1: `normalizeField` normalises nested `properties`; kinds and destructiveness defaults unchanged — §10.3, amendment recorded in `tasks/plan-ops-all-services.md` Task 1 spec-gate note and Open Question 6.4)
packages/ops/src/cli/parse.ts           → extended (E2: JSON flags for object/object[])
packages/ops/src/cli/run.ts             → extended (E1: resources[]; E3: comma list + per-service base resolution)
packages/ops/src/mcp/server.ts          → extended (E1/E3: union tool list, per-call base)
packages/ops/src/fixtures/sample.ts     → untouched; still the contract-proof stand-in
packages/ops/test/                      → suites (§6); stubs stay in test/support/ (node:http)
scripts/setup-dev-env.sh                → extended (§2 env surface, same change)
docs/specs/SPEC-ops-all-services.md     → this document: the capability map (§1.0.1) + the module spec bodies
docs/specs/SPEC-<module-id>.md           → one per id in the §1.0.1 map (eight ids; notes already exists)
docs/intent/ops-all-services.md         → confirmed intent (read-only input)
apps/                                   → NOT TOUCHED
```

No module declares `apiBase` — ports are repo hard lines and are never compiled
into the package; every base comes from the environment (§1.1.2 E3).

## 5. Code Style

Spec-referencing block comments, exported typed contracts, single quotes, no
`any` in exported signatures. One real snippet (the shape the DRY rule demands —
the module defines nothing the core derives):

```ts
/**
 * The `meal` service module (SPEC-ops-all-services §1.3): four resources on one
 * service. Validation, JSON Schema, and the wire mapping derive from these
 * descriptors in core — a module that restated any of them would be a bug
 * (SPEC.md §3, DRY rule).
 */
import { defineResource } from '../core/registry';
import type { ServiceModule } from '../cli/run';

/** The 27 NutrientVector keys in NUTRIENTS order (packages/nutrition/src/nutrients.ts:55). */
const NUTRIENT_KEYS = ['calories', 'fat', /* … 25 more … */ 'magnesium'] as const;
const nutrientProperties = Object.fromEntries(
  NUTRIENT_KEYS.map((key) => [key, { type: 'number' as const, description: `Amount of ${key}` }]),
);

export const service: ServiceModule = {
  resources: [
    defineResource({
      name: 'entries',
      basePath: '/api/entries',
      ops: [
        {
          kind: 'create',
          fields: {
            date: { type: 'string', required: true, description: 'Day the entry belongs to (YYYY-MM-DD)' },
            mealGroup: { type: 'string', required: true, enum: MEAL_GROUPS, description: 'Meal the entry belongs to' },
            foodId: { type: 'string', required: true, description: 'Identifier of the food logged' },
            quantity: { type: 'number', required: true, description: 'Amount in the food\'s unit' },
            nutrients: {
              type: 'object',
              required: true,
              properties: nutrientProperties,
              description: 'Nutrient vector for the logged amount (27 known keys)',
            },
          },
        },
        // list, get, update, delete per the §1.3 table
      ],
    }),
    // foods, saved-meals, target per the §1.3 table
  ],
};
```

Conventions: intention-revealing names; comments state the contract and cite the
spec section; enums mirror the service vocabulary literally (`MEAL_GROUPS`,
`FOOD_UNITS`, `TODO_REPEATS`, `FEEDBACK_STATUS_VALUES`); the registries are
request-shaped only.

## 6. Testing Strategy

- Framework: jest + ts-jest, `testEnvironment: node`, suites at
  `packages/ops/test/*.test.ts`. All fakes are `node:http` in `test/support/`;
  no test contacts a real service or the real IdP.
- Levels:
  - **Parity (centerpiece), one suite per module** — `todo-parity.test.ts`,
    `meal-parity.test.ts`, `tags-parity.test.ts`, `focus-parity.test.ts`,
    `feedback-parity.test.ts`, mirroring `notes-parity.test.ts`: every op of the
    module's §1.x tables driven through the CLI adapter and MCP `tools/call`
    against identically seeded stub APIs; recorded HTTP requests (method, path,
    query, JSON body) and normalized outputs byte-identical; error parity as
    strings (validator failure, `401`, `404`, `409`).
  - **Multi-service suite** (`multi-service.test.ts`): one CLI run and one MCP
    server over `LIFE_OPS_SERVICE=todo,meal,notes` with three stub bases — every
    call lands on its owning service's base; base precedence (per-service var wins,
    single-service fallback, multi-service missing-var error naming the variable).
  - **Wire/registry suite** (extends `wire.test.ts`): the §1.2–1.6 tables asserted
    op by op (36 routes), plus the regression table proving every existing kind
    compiles to exactly its current request against the untouched sample and
    notes registries; the 11 cut routes and the null-clear paths asserted absent.
  - **Validation/schema suite** (extends `validation-schema.test.ts`): the shared
    accept/reject case table passing identically in the core validator and against
    the MCP `inputSchema`, extended with `object`/`object[]` — 27-key vector
    accepted; unknown key rejected (`nutrients.sodiumX`); required property
    missing rejected; two-level nesting validated (`items.0.nutrients.sodium`);
    non-object array element rejected; CLI `--nutrients '<json>'` producing the
    identical wire body to the MCP object input.
  - **Loader suite** (extends `loader.test.ts`): comma list resolution, unknown
    name error listing known services, tool-name collision error, both/neither
    `registry`/`resources` error, path-like external modules unchanged.
  - **Drift assertion:** the module's 27 `nutrients` property names equal
    `NUTRIENTS`' keys (test-side import of `@life/nutrition`; test-only, no
    `package.json` change — `dependencies` stays empty).
  - **Env suite** (extends `dev-env.test.ts`): `scripts/setup-dev-env.sh` carries
    every §2 variable (`LIFE_OPS_API_BASE_<SERVICE>` ×6, the `LIFE_OPS_RESOURCE`
    audience mapping, the comma list).
- Coverage expectations: every one of the 36 routes exercised through both
  adapters; every `FieldSpec` type including `object`/`object[]` in the case
  table; every resource name asserted as a CLI command and an MCP tool prefix.
- Policy: targeted runs only — `npm run test:unit -- <file>` from `packages/ops`,
  one suite per command, at most 2 runs.

## 7. Boundaries

- **Always do:** keep the DRY rule — adapters render the registry and never
  restate validation, schema derivation, or wire mapping; derive method and path
  in `wire.ts` only; validate in core before any network call; keep every
  existing op's compiled request byte-identical (sample + notes registries);
  mirror each service's DTO fields one-for-one; keep registries request-shaped
  only; land every new environment variable in `scripts/setup-dev-env.sh` in the
  same change; resolve bases from the environment only; tests targeted and green
  before commit; cite spec sections in contract comments.
- **Ask first:** any npm dependency (runtime or dev); anything under `apps/`
  (including editing a service's DTOs); widening the closed `FieldSpec` type set
  beyond `object`/`object[]` or the op set beyond its six kinds; per-operation
  `path`/`method` overrides; `PUT` support, body-on-`DELETE`, or any
  null-means-clear semantics; `isDestructive` overrides beyond the single
  `tags-resolve` one (§1.4); touching `services/notes.ts` or
  `SPEC-ops-notes-service`; adding routes beyond the 36 (§1.7); changing the
  token-store path/format or auth flow; widening the Commands in §3; renaming
  the initiative name `ops-all-services`; declaring `apiBase` in any module.
- **Never do:** expose any of the 11 cut routes (§1.7) or the human-only notes
  routes (`DELETE /api/notes/:id/permanent`, `DELETE /api/notes/trash`,
  `GET /api/notes/trash`); send `null` on any field; edit anything under `apps/`
  or change any service's HTTP API; add a new OAuth client or new UI work; add
  any runtime dependency; hardcode service ports, URLs, or credentials in
  `packages/ops`; let one service's call reach another service's base; duplicate
  validation/schema/wire/auth/transport/error shape in an adapter or fork
  core per module; rename a module id in the §1.0.1 map, or write a module spec
  that no id in that map names.

## 8. Success Criteria

1. `npm run typecheck` in `packages/ops` exits 0.
2. Regression: the sample and notes registries compile unchanged and every
   existing kind compiles to exactly the request it compiles to today (asserted
   table in the wire suite).
3. Every route of the §1.2–1.6 tables compiles to exactly its wire request,
   asserted op by op (36 routes); none of the 11 cut routes and no null-clear
   path appears in any registry or wire output (asserted absence).
4. Parity per module in one jest run each: for every op the stub-API request
   recorded from the CLI adapter equals the one from the MCP adapter and the
   normalized outputs are byte-identical; validator failure, `401`, `404`, `409`
   render byte-identical messages through both adapters.
5. Object case table green in both validator and `inputSchema`: the 27-key vector
   accepted; unknown key, missing required property, and non-object array element
   rejected with dotted/indexed field paths; the saved-meal `items[].nutrients`
   two-level shape validated; `--nutrients '<json>'` and the MCP object input
   produce the identical wire body.
6. `LIFE_OPS_SERVICE=todo,meal,notes` yields one CLI process and one MCP process
   exposing exactly those three modules' resources (10 resources, tool names
   `<resource>_<kind>`), and every call hits its owning service's stub base.
7. Base resolution: `LIFE_OPS_API_BASE_TODO` (etc.) wins over the fallback; one
   service plus `LIFE_OPS_API_BASE` behaves byte-identically to today; two or
   more services with a missing per-service variable fail with an error naming
   `LIFE_OPS_API_BASE_<NAME>`.
8. One `login` token with `LIFE_OPS_RESOURCE=https://life-ops` (audience
   `life-api`) authenticates calls to every loaded service (stub-verified), with
   no new OAuth client.
9. `npm run test:unit -- dev-env.test.ts` green: `scripts/setup-dev-env.sh`
   contains every §2 variable (six `LIFE_OPS_API_BASE_<SERVICE>`, the
   `https://life-ops=life-api` audience mapping, the comma list).
10. `git diff --name-only HEAD` shows zero paths under `apps/`;
    `grep -rln "@life/ops\|life-ops" apps` returns zero hits; and
    `packages/ops/package.json` keeps an empty (or absent) `dependencies` block.
11. Every module id in the §1.0.1 map traces to exactly one module spec — the
    eight ids `ops-registry-vocabulary`, `ops-service-loader`, `ops-notes-service`,
    `ops-service-todo`, `ops-service-meal`, `ops-service-tags`,
    `ops-service-focus`, `ops-service-feedback` — each with its row in the §1.0.1
    storage table and its own `docs/specs/SPEC-<module-id>.md`, and no requirement
    in any of them belongs to a module absent from the map (checked by diffing the
    map's ids against the `docs/specs/SPEC-*.md` set).

## 9. Assumptions

1. **The request decomposes; the map in §1.0.1 is the Phase 0 artifact** and this
document is the map plus the per-module spec bodies. Initiative name and file:
`ops-all-services`, stored at `docs/specs/SPEC-ops-all-services.md`; the map's
module ids are the stable handles and are never renamed. Verdict resolved in §1.0
— it is not an open question.
2. **The 36 routes are the five new modules' post-cut surface** — todo 12, meal
   15, tags 4, focus 3, feedback 2 — matching the audit's §5.4 tally
   (24 + 5 + 7). `notes` keeps its existing 6 unchanged, so a fully loaded
   process exposes 42 ops. The intent's phrase "36 routes across them" is read as
   the audit's number (it counts only the five services audited).
3. **`POST /api/feedback` is out**, making feedback 2 routes. The intent's
   constraint list does not name it, but the intent's own total (36) equals the
   audit's tally only with it cut, and the audit flags its client-generated
   UUIDv4 `id`. Reversible at **10.1** — it is expressible as `create` with
   `id`/`app`/`type`/`title`/`description`.
4. **No `push` resource** despite the intent naming `todos`/`lists`/`push`: all
   three push routes are cut browser plumbing, and a resource with zero ops does
   not exist. If push routes ever return, `push` is the resource name reserved
   for them.
5. **E1 is additive:** `registry` keeps working (notes and fixtures compile
   untouched); `resources` is the multi-resource form; exactly one of the two per
   module. The alternative (replacing `registry` and rewriting notes) buys
   nothing and breaks the external-module loading contract.
6. **`nutrients` properties are the 27 keys literally**, `number` each, optional
   at the property level, unknown keys rejected — ops owns shape, the service
   owns vector completeness. No `@life/nutrition` import (zero-dependency rule).
7. **Null-clear is gone, not degraded:** the two todo `PATCH` null paths (§1.2)
   are dropped; fields carry plain values. Clearing a field needs the service API
   directly — a human action.
8. **`tags-resolve` `create` gets `isDestructive: false`** — it is a pure read
   (`tags.service.ts:234-249`) and the kind name reflects wire shape only. This
   is the single override in the run; it is argued at **10.2**.
9. **Base precedence** is module `apiBase` → `LIFE_OPS_API_BASE_<NAME>` →
   `LIFE_OPS_API_BASE` (single-service only), failing closed with the missing
   variable named. `<NAME>` is the bare service name uppercased
   (`LIFE_OPS_API_BASE_TODO` for `todo`).
10. **Resource names are the CLI command and tool-name prefix**: `notes`,
    `todos`, `todos-tags`, `todos-trash`, `todos-completions`, `lists`, `entries`,
    `foods`, `saved-meals`, `target`, `tags`, `tags-resolve`, `goal`, `sessions`,
    `feedback` — kebab-case, unique across the union (loader-asserted).
11. **`tags` `update` addresses a `number` id** (`ParseIntPipe`);
    `wire.ts:57` stringifies it to `/api/tags/7` (audit-verified). All other
    addressing fields are `string`.
12. **One audience, one token:** `LIFE_OPS_RESOURCE=https://life-ops` with the
    `OIDC_AUDIENCE_MAP` entry `https://life-ops=life-api`; every service accepts
    `life-api` (`jwt-verifier.ts:49`), so no per-service resource is requested.
13. **Shape-level local validation only:** enum vocabularies are mirrored
    literally; `repeatDays` stays `number[]` (core enums are string-only) with
    the service enforcing `1..7`; numeric bounds, lengths, UUID/`ISO_DUE`
    formats remain server-enforced. The registries declare what the service
    accepts, nothing stricter.
14. **`notes` gains nothing** — `GET /api/notes/trash` stays excluded
    (`SPEC-ops-notes-service` §9.7) and the module file is untouched.

## 10. Open Questions

Unresolved decisions that need human input. §9 records the reading this spec
proceeds on; the questions below record where that reading can still be
overruled. None blocks implementation — the spec ships on the stated defaults and
each answer changes a later revision, not this one. The map-vs-split question is
not here: it was Phase 0's, and §1.0/§1.0.1 resolve it before this document
exists.

### 10.1 `POST /api/feedback` in or out (36 vs 37 routes)

Excluded here (§9.3) to match the audit's tally and the intent's total. The
intent's constraint list does not name it, and it is expressible today
(verdict-1 apart from the UUIDv4 `id` the registry cannot constrain — the server
400s a bad id, ops cannot). Ruling it back in makes feedback 3 routes and the
surface 37.

- **Owner:** the human. **Default if unanswered:** out (§9.3); the feedback
  module covers list + status update only.
- **What an answer changes:** one `create` op on the `feedback` resource
  (`id`, `app`, `type`, `title`, `description`) and the §8.3 count.

### 10.2 `tags-resolve` destructiveness — argued, confirmable

The spec sets `isDestructive: false` on `tags-resolve` `create` (§9.8) because the
call is a pure read. The counter-reading is the kind default (`create` →
destructive, human approval before every resolve) which would make agent tag
resolution unusable in practice. The override is the only one in the run and it
is a one-line registry change either way.

- **Owner:** the human. **Default if unanswered:** `isDestructive: false` stands.
- **What an answer changes:** one field in the `tags-resolve` registry and one
  assertion in the registry suite.

### 10.3 Does a module-declared nested `properties` map survive `defineResource`?

§4 pins `core/registry.ts` untouched while §1.1.1 has `FieldSpec` carry
`properties` recursively, and `normalizeField` rebuilt each field key by key —
`type`, `required`, `description`, optional `enum` — so a nested table declared by
a module would have been reduced to a type-only descriptor, and the shape guard
would then refuse it as an `object` without `properties`. The two readings were
(a) a spec edit allowing one `properties`-carrying line in `normalizeField`, the
file then no longer byte-untouched, or (b) nested declarations reaching the
adapters without `properties`.

**Shipped as (a), pending the human's ruling — and recorded as an amendment, not as an established reading.** Implementation took option (a) because (b) does not build: the shape guard in `core/validate.ts` refuses a nested type that carries no `properties`, and all six modules declare their tables through `defineResource`, so an un-normalised registry fails every `meal` op before a request exists. §4's row is therefore amended from `untouched` to `extended`, scoped to one line in `normalizeField`; that amendment and its reason are recorded in `tasks/plan-ops-all-services.md` (Task 1 spec-gate note, Open Question 6.4), so the validated plan and this spec agree rather than the spec following the code. Concretely:
`normalizeField` normalises nested `properties` recursively through the same
`normalizeFields` walk, so a nested table reaches validation, the MCP `inputSchema`,
and the wire body intact, and every module declares its tables through
`defineResource` — `meal` included. §4's `core/registry.ts` row was amended from `untouched` to
`extended` for that one line; the rest of what the row protected still holds — the op
kinds and their destructiveness defaults are unchanged, no kind was added, removed, or
re-defaulted, and no route override appeared. The registry
every adapter reads is frozen and default-filled for all six modules, so `meal` is no
longer the exception.

This is the option the run shipped, not a human decision: the plan reserved 6.4 as a
spec-gate item for the human, so the ruling stays open and (b) remains available.

- **Owner:** the human. **Default if unanswered:** (a), as shipped.
- **What an answer changes:** (b) would instead revert `normalizeField` and let
  `meal` keep a plain, un-normalised table — the mutable, un-`isDestructive` shape
  the parity suite would then have to assert as intent.
