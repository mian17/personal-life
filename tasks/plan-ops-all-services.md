# Implementation Plan: all six `@life/ops` service modules (`ops-all-services`)

Produced by planning-and-task-breakdown; source spec: `docs/specs/SPEC-ops-all-services.md`;
confirmed intent: `docs/intent/ops-all-services.md`.

## Overview

Take `@life/ops` from one proved service shape (`notes`: one resource, flat fields, 6 routes) to
the whole backend estate: five new service modules (`todo`, `meal`, `tags`, `focus`, `feedback`,
36 routes) beside `notes`, on top of the two registry capabilities the spec's §1.1 adds — a module
may export several resources (E1) and a field may be an object or an array of objects (E2) — plus
comma-separated `LIFE_OPS_SERVICE` with per-service API bases (E3). One CLI process and one MCP
process then serve every loaded service with one token. Build order is the spec's §1.0.1:
vocabulary (E2) → loader (E1, E3) → the five modules + their parity suites → integration → env
surface. `apps/` is never touched (spec §7); `packages/ops` gains no dependency.

## Decisions that bind every task

1. **Spec §1.7 is the route boundary, not a suggestion.** Exactly 36 routes across the five new
   modules; the 11 cut routes and every null-clear path are asserted *absent*. No `PUT`, no
   body-on-`DELETE`, no `null` on any field, no route outside the §1.2–§1.6 tables.
2. **The core stays the single owner of every derivation.** Validation, JSON Schema, wire
   mapping, flag parsing and tool naming all derive from the `FieldSpec` table; a module that
   restates any of it is a bug (spec §5, §7 "Always do"). Modules are request-shaped data only:
   no `apiBase` declared (spec §4 last line), no per-op `path`/`method`, no `isDestructive`
   override except the single `tags-resolve` one (spec §9.8).
3. **E1 is additive.** `registry` keeps working untouched so `services/notes.ts` and
   `fixtures/sample.ts` compile byte-identically (spec §9.5). `resources[]` is the second form;
   exactly one of the two per module, both/neither is a loader error.
4. **E2 owns shape, services own semantics.** `object`/`object[]` are body-only and legal on
   `create`/`update` only; `list` keeps flat closed types. 27 `nutrients` keys are mirrored
   literally with a citing comment plus a test-side drift assertion — no `@life/nutrition` import
   (spec §1.3, §9.6). Numeric bounds, lengths, UUID formats and `repeatDays` `1..7` stay
   server-enforced (spec §9.13).
5. **Bases come from the environment only**, precedence module `apiBase` →
   `LIFE_OPS_API_BASE_<NAME>` → `LIFE_OPS_API_BASE` (single service only), failing closed with the
   missing variable named (spec §1.1.2 E3, §9.9). No port is ever compiled in.
6. **Tests are targeted, one suite per command, at most 2 runs** (spec §3, repo profile
   `max-test-runs: 2`). No build step exists in this repo profile, and no e2e applies — no UI is
   touched — so the E2E slot states that rather than inventing a command. The Manual check slot
   is filled in every task with a concrete inspection, never dropped.
7. **Task list target for this run is this file.** `tasks/plan.md` + `tasks/todo.md` hold a
   different, incomplete plan (the shadcn/ui primitive migration, 40 unchecked boxes). Per the
   skill's never-overwrite rule they are left exactly as they are; tasks and checkpoints are
   recorded in the `## Task List` section below. Mirroring into `tasks/todo.md` is a human call
   (Open Question 6.2).

## Task List

### Phase 1: Vocabulary and loader (E2, E1, E3)
- [ ] Task 1: `object`/`object[]` field types with recursive validation (E2)
- [ ] Task 2: Nested body assembly and JSON Schema derivation for object fields (E2)
- [ ] Task 3: CLI JSON flags for object and object[] fields (E2)
- [ ] Task 4: `resources[]` on `ServiceModule` with a unique tool-name union (E1)
- [ ] Task 5: Comma-separated `LIFE_OPS_SERVICE`, six bare names, per-service base resolution (E1, E3)
- [ ] Task 6: MCP union tool list over every loaded registry

### Checkpoint: After Tasks 1-6
- [ ] The untouched `notes` and `sample` registries still compile and compile to their current requests
- [ ] One MCP server over two stub modules lists both modules' tools

### Phase 2: The five service modules
- [ ] Task 7: `todo` service module (12 routes, 5 resources) with its parity suite
- [ ] Task 8: `meal` service module (15 routes, 4 resources) with its parity suite
- [ ] Task 9: `tags` service module (4 routes, 2 resources) with its parity suite
- [ ] Task 10: `focus` service module (3 routes, 2 resources) with its parity suite
- [ ] Task 11: `feedback` service module (2 routes, 1 resource) with its parity suite

### Checkpoint: After Tasks 7-11
- [ ] All 36 routes exercised through CLI and MCP against stubs, parity green per module
- [ ] No cut route and no null-clear path reachable from any registry

### Phase 3: Integration, env surface, spec storage
- [ ] Task 12: 36-route wire/registry table plus the cuts-absent regression
- [ ] Task 13: Multi-service integration suite (one CLI, one MCP, one token, base precedence)
- [ ] Task 14: Dev env surface in `scripts/setup-dev-env.sh`
- [ ] Task 15: Per-module spec files for the §1.0.1 capability map

### Checkpoint: Complete
- [ ] Spec §8 criteria 1-11 all satisfied
- [ ] `git diff --name-only HEAD` shows zero paths under `apps/`; `packages/ops/package.json` has no `dependencies`
- [ ] Ready for review

## Task 1: `object`/`object[]` field types with recursive validation (E2)

**Description:** Teach the shared vocabulary the two nested types the meal module needs (spec §1.1.1), strictly inside the files §4 marks extended. `FieldSpec.type` gains `'object'` and `'object[]'` in `core/types.ts`; `FieldSpec` gains `properties?: Record<string, FieldSpec>`, legal exactly when the type is nested and forbidden otherwise, recursively (an `object[]`'s `properties` describe one element, which may nest again — the saved-meal `items[].nutrients` case). `core/validate.ts` gains the recursive check and the shape guard both derivations share: `object` is a plain non-null object with no unknown keys and every required property present; `object[]` is an array of such objects; every supplied value is checked recursively and failures carry dotted/indexed paths (`items.0.nutrients.sodium`) that render through the existing canonical shape. The shape guard (exported from `validate.ts`) rejects a nested field with no `properties` and a flat field carrying `properties`, naming the field; it runs on the descriptor table an adapter is about to derive from, so a malformed declaration fails before any request or schema exists. No wire, schema, or CLI change in this task.

**Spec-gate note (§4 vs §1.1.1, Open Question 6.4 — resolved to option (a), and recorded here rather than only in the spec):** `normalizeField` (`registry.ts:52-59`) built each `FieldSpec` key by key, which dropped `properties`, so `defineResource` stripped every nested table a module declared. Option (b) was measured and does not build: `core/validate.ts`'s shape guard refuses a nested type carrying no `properties` (`<path>: <type> without properties`), and all six modules declare their tables through `defineResource`, so an un-normalised registry fails every `meal` op before a request exists. §4's `core/registry.ts` row is therefore amended from `untouched` to `extended`, scoped to one line: `normalizeField` normalises nested `properties` through the same `normalizeFields` walk. Nothing else in the file moves — no kind added, removed, or re-defaulted, no `isDestructive` override, no route change. The human still owns the 6.4 ruling; choosing (b) later reverts that one line and `meal` to an un-normalised table.

**Acceptance criteria:**
- [ ] The type set is `'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'object' | 'object[]'`, and `properties` is accepted only on the two nested types.
- [ ] The shape guard rejects a nested field with no `properties` and a flat field carrying `properties`, naming the field, on the descriptor table handed to it.
- [ ] `validateInput` accepts a 27-key `nutrients` object, rejects an unknown key (`nutrients.sodiumX`), rejects an omitted required property, rejects a non-object element of `object[]` (`portions.0`), and reports a two-level failure at `items.0.nutrients.sodium`.
- [ ] The existing sample and notes accept/reject cases in `test/validation-schema.test.ts` are unchanged.
- [ ] `core/registry.ts` diff is the single `normalizeField` normalisation §4 amends — verify with `git diff -- packages/ops/src/core/registry.ts`: exactly one changed line, inside `normalizeField`, recursing into `properties`; `kindIsDestructive`/`DESTRUCTIVE_KINDS` byte-identical to HEAD; no kind added, removed, or re-defaulted; no `isDestructive` override; no route change.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/validation-schema.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `git diff -- packages/ops/src/core/registry.ts` — the only change is `normalizeField` recursing into `properties` (§4 amendment recorded in Task 1's spec-gate note); `core/validate.ts` holds one recursive walk shared by `validateInput` and the shape guard — no second nested-shape implementation.

**Dependencies:** None

**Files likely touched:**
- `packages/ops/src/core/types.ts`
- `packages/ops/src/core/validate.ts`
- `packages/ops/test/validation-schema.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 2: Nested body assembly and JSON Schema derivation for object fields (E2)

**Description:** Complete E2's two remaining derivations so both adapters stay passive (spec §1.1.1). `wire.ts` passes nested values through into the request body exactly as supplied JSON — no key filtering, no renaming — and `object`/`object[]` remain body-only and legal on `create`/`update` (they must never be emitted as a `list` query parameter). `schema.ts` derives `object` → `{type: 'object', properties, required, additionalProperties: false}` and `object[]` → `{type: 'array', items: <object schema>}`, recursively, so the MCP `inputSchema` advertises the same accepted shape the validator enforces. `JsonSchemaProperty` widens to describe the nested object form; the derived tool schema and the validator remain one table, and the drift guard in the schema suite is what proves it.

**Acceptance criteria:**
- [ ] `wireFor` on a `create`/`update` op carrying a nested field emits the value unchanged inside `body`, including two-level nesting.
- [ ] nested field on `list` op rejected by Task 1's shape guard on the descriptor table handed to derivation (the query-bearing kind keeps flat closed types); no `defineResource`-time enforcement added beyond the `normalizeField` normalisation §4 amends (spec §4, Open Question 6.4 option (a)).
- [ ] `deriveInputSchema` emits the nested object schema with `additionalProperties: false` and its own `required` list for `object`, and wraps it in `{type: 'array', items: …}` for `object[]`.
- [ ] Every sample, notes, and new nested accept/reject case yields the same verdict from `validateInput` and from the derived schema.
- [ ] No change to methods, paths, or query composition for any existing op.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/wire.test.ts (at most 2 run(s) for this task)
- [ ] Focused unit tests pass: npm run test:unit -- test/validation-schema.test.ts (second and final run for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/core/schema.ts` for a nested-shape description written outside the single derivation from the field table (DRY rule, spec §7).

**Dependencies:** Task 1

**Files likely touched:**
- `packages/ops/src/core/wire.ts`
- `packages/ops/src/core/schema.ts`
- `packages/ops/test/wire.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 3: CLI JSON flags for object and object[] fields (E2)

**Description:** Make the CLI able to express what the MCP adapter can already express (spec §1.1.1 CLI bullet). `parse.ts` gains `--field '<json>'` handling for `object`/`object[]` fields: `JSON.parse` the value, and on a parse failure surface the canonical validation message rather than a raw `SyntaxError`, so a bad flag and a bad value render identically to the MCP path. Repeated-flag and kebab-case behaviour for every existing type stays exactly as it is. `--nutrients '{"calories":400,…}'` must produce the same wire body the MCP object input produces.

**Acceptance criteria:**
- [ ] `--nutrients '<json object>'` parses to the object value and reaches the wire body unchanged.
- [ ] `--portions '<json array of objects>'` parses to the array form and reaches the wire body unchanged.
- [ ] Malformed JSON renders the canonical validation failure shape (no `SyntaxError`, no stack), and a non-object JSON literal is rejected by the validator.
- [ ] Every existing flag conversion (`--tagIds 3 --tagIds 7`, `--expected-version`, booleans, kebab and camel spelling) is unchanged.
- [ ] The CLI and MCP inputs for one nested op produce identical recorded requests.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/validation-schema.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: run the CLI by hand with `--nutrients '{"calories":400}'` and with `--nutrients 'not-json'`; the second prints the canonical validation shape with no `SyntaxError` and no stack.

**Dependencies:** Task 1

**Files likely touched:**
- `packages/ops/src/cli/parse.ts`
- `packages/ops/test/validation-schema.test.ts`

**Estimated scope:** Small: 2 files

## Task 4: `resources[]` on `ServiceModule` with a unique tool-name union (E1)

**Description:** Add the multi-resource module form (spec §1.1.2 E1). `ServiceModule` gains `resources?: ResourceRegistry[]` beside `registry`; exactly one must be present and the loader errors on both or neither in the existing error style. The loaded union is `resources ?? [registry]`; `ResourceRegistry`/`ResourceSpec` are unchanged, and the win is several resources per module, each with its own `basePath`. Tool names (`<resource>_<kind>`, already derived from resource names) must be unique across the union — the loader asserts it and errors naming both colliding resources. `services/notes.ts` and `fixtures/sample.ts` compile untouched; that is the regression guard.

**Acceptance criteria:**
- [ ] `ServiceModule` accepts exactly one of `registry` or `resources`; a module with both, or with neither, is rejected with a message naming the cause.
- [ ] A module exporting `resources: [todos, lists]` yields both registries to the adapters, each keeping its own `basePath`.
- [ ] Two resources with the same `name` across the loaded union fail with an error naming both.
- [ ] `services/notes.ts`, `fixtures/sample.ts`, and `test/support/service-module.ts` are unedited and still load.
- [ ] `test/validation-schema.test.ts`'s sample/notes verdicts and `test/parity.test.ts` stay green without edits.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/loader.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: `git diff --stat` shows no lines in `src/services/notes.ts` or `src/fixtures/sample.ts`, and in `packages/ops/src/core/registry.ts` only the `normalizeField` line §4 amends (spec §9.5, Open Question 6.4 option (a)).

**Dependencies:** Task 1

**Files likely touched:**
- `packages/ops/src/cli/run.ts`
- `packages/ops/test/loader.test.ts`

**Estimated scope:** Small: 2 files

## Task 5: Comma-separated `LIFE_OPS_SERVICE`, six bare names, per-service base resolution (E1, E3)

**Description:** Load several services in one process and stop one variable from dialling the wrong host (spec §1.1.2 E3). `LIFE_OPS_SERVICE` accepts a comma-separated list with whitespace trimmed; each entry resolves as today (bare name → in-package `src/services/<name>`, path-like → a module exporting `service`/`registry`). `IN_PACKAGE_SERVICE_NAMES` grows to `notes, todo, meal, tags, focus, feedback` and the unknown-name error lists all six. Base resolution becomes per call, in precedence order: the module's own `apiBase` (none of these modules sets one) → `LIFE_OPS_API_BASE_<NAME>` (NAME = bare service name uppercased) → `LIFE_OPS_API_BASE`, but only when exactly one service is loaded. The precedence helper and the per-call resolution stay in `cli/run.ts` — §4 marks no other loader file extended, so no new module is created for it. A multi-service config missing a per-service variable fails with an error naming that variable — fail closed, never dial one service's data from another's base. A single-value `LIFE_OPS_SERVICE` with `LIFE_OPS_API_BASE` behaves byte-identically to today.

**Acceptance criteria:**
- [ ] `LIFE_OPS_SERVICE=todo,meal,notes` loads three modules and exposes the union of their resources in declaration order.
- [ ] `LIFE_OPS_SERVICE='  notes , todo '` resolves the same two modules, whitespace trimmed.
- [ ] An unknown entry fails naming that entry and lists all six known services.
- [ ] `LIFE_OPS_API_BASE_TODO` wins over `LIFE_OPS_API_BASE`; a single loaded service with only `LIFE_OPS_API_BASE` resolves exactly as today; two loaded services with a missing per-service variable fail with an error naming `LIFE_OPS_API_BASE_<NAME>`.
- [ ] Every base is read from the environment only — no port literal appears under `packages/ops/src`.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/loader.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: `grep -rnE "localhost:|:31[0-9][0-9]" packages/ops/src` returns nothing, and `cli/run.ts` resolves the base per call rather than capturing it at module scope.

**Dependencies:** Task 4

**Files likely touched:**
- `packages/ops/src/cli/run.ts`
- `packages/ops/test/loader.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 6: MCP union tool list over every loaded registry

**Description:** Make the MCP adapter serve the same union the CLI serves (spec §1.1.2, §1.8). `McpServerOptions.registry` becomes the union of loaded registries, `listTools`/`findTool` operate across it, and each `tools/call` resolves the owning resource's base through the Task 5 precedence instead of one session-wide base. The handshake, protocol versions, JSON-RPC error replies, and canonical rendering are untouched — `tools/call` runs the same executor and render the CLI runs, so parity stays a string comparison. Tool names stay `<resource>_<kind>`; uniqueness is already loader-asserted.

**Acceptance criteria:**
- [ ] One server over `LIFE_OPS_SERVICE=todo,meal,notes` lists the union of the three modules' tools, in loaded-module order then registry order.
- [ ] `tools/call` on a tool of each module reaches that module's own base (recorded request host asserted).
- [ ] An unknown tool name and a validation failure render byte-identically to the CLI for the same input.
- [ ] The `initialize`/`ping`/notification handshake and the `serverInfo.version` pin are unchanged (`test/mcp-lifecycle.test.ts` green untouched).
- [ ] A single-service module still works with the same call path as today.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/mcp-lifecycle.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/mcp/tools.ts` for a tool-name or base-resolution rule restated outside the registry and Task 5's precedence helper.

**Dependencies:** Task 5

**Files likely touched:**
- `packages/ops/src/mcp/server.ts`
- `packages/ops/src/mcp/tools.ts`
- `packages/ops/test/mcp-lifecycle.test.ts`

**Estimated scope:** Medium: 3 files

## Task 7: `todo` service module (12 routes, 5 resources) with its parity suite

**Description:** Ship `packages/ops/src/services/todo.ts` exactly as spec §1.2 tables it: resources `todos`, `todos-tags`, `todos-trash`, `todos-completions`, `lists` — 12 ops mirroring `apps/todo-service/src/todos/dto/*` and `lists/dto/*` one for one. `tagIds`/`ids` stay `number[]`; `repeat` mirrors `TODO_REPEATS`; `dueDate` documents `ISO_DUE`. Null-clear is absent (`note`, `dueDate`, `listId`, `repeat`, `repeatDays`, `important` on update, `importantDefault` on list update carry plain values only), `DELETE /api/lists/:id` is absent, and no `push` resource exists (spec §9.4, §9.7, §9.13). The parity suite mirrors `notes-parity.test.ts`: every op driven through the CLI adapter and MCP `tools/call` against identically seeded `node:http` stubs, recorded requests (method, path, query, JSON body) equal, normalized outputs byte-identical, and validator failure/`401`/`404`/`409` equal as strings.

**Acceptance criteria:**
- [ ] The module exports `resources` with the five resources and their §1.2 `basePath`s, 12 ops total, and the file declares no `apiBase` and no `isDestructive` override.
- [ ] Every op compiles to the method and path in the §1.2 table; `list` sends each supplied field as a query parameter and `cursor` passes through untouched.
- [ ] No null-clear path exists: an empty/absent field is simply not sent, and no field accepts `null`.
- [ ] `DELETE /api/lists/:id`, `todos` `trash`/`permanent` deletes, and any `push` resource are absent from the registry.
- [ ] CLI and MCP recorded requests and normalized outputs are byte-identical for all 12 ops, and the four error classes render identical strings through both.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/todo-parity.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/services/todo.ts` for restated validation, schema, or wire logic, and for any field accepting `null` (DRY rule, spec §7).

**Dependencies:** Task 3, Task 6

**Files likely touched:**
- `packages/ops/src/services/todo.ts`
- `packages/ops/test/todo-parity.test.ts`
- `packages/ops/test/support/stub-api.ts` (seed helpers only)

**Estimated scope:** Medium: 3 files

## Task 8: `meal` service module (15 routes, 4 resources) with its parity suite

**Description:** Ship `packages/ops/src/services/meal.ts` as spec §1.3 tables it: `entries`, `foods`, `saved-meals`, `target` — 15 ops. This is the module that exercises E2 in production shape: `nutrients` is the 27-key vector declared literally in `object` properties in `NUTRIENTS` order with a citing comment (no `@life/nutrition` import), `portions` is `object[]` of `{label, amount}`, saved-meal `items` is `object[]` whose elements nest `nutrients` one level down. `target` `list` requires `date` (the service 400s on a missing date, so the registry never defaults it). The parity suite mirrors the notes suite and adds the drift assertion: the module's 27 property names equal `NUTRIENTS`' keys, imported test-side only.

**Acceptance criteria:**
- [ ] The module exports `resources` with the four §1.3 resources, 15 ops total, no `apiBase`, no `isDestructive` override.
- [ ] `nutrients` declares exactly the 27 keys in `NUTRIENTS` order, each `number`, optional at the property level, in all three places it appears; the drift assertion fails if `@life/nutrition` gains or renames a key.
- [ ] `portions` is `object[]` of required `label` + `amount`; saved-meal `items` is `object[]` with required `quantity` + `nutrients` nesting a second level; both validate and reach the wire unchanged.
- [ ] `entries` `create`/`list` and `target` `list` carry the required fields in the table (`date`, `mealGroup`, `foodId`, `quantity`, `nutrients`; `date` for target) and `foods` `update` omits `unit` as tabled.
- [ ] CLI and MCP recorded requests and normalized outputs are byte-identical for all 15 ops, including the nested bodies; `packages/ops/package.json` still declares no `dependencies`.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/meal-parity.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/services/meal.ts` and check that the `nutrients` comment cites its source and that the three declarations list the 27 keys in the same `NUTRIENTS` order.

**Dependencies:** Task 3, Task 6

**Files likely touched:**
- `packages/ops/src/services/meal.ts`
- `packages/ops/test/meal-parity.test.ts`
- `packages/ops/test/support/stub-api.ts` (seed helpers only)

**Estimated scope:** Medium: 3 files

## Task 9: `tags` service module (4 routes, 2 resources) with its parity suite

**Description:** Ship `packages/ops/src/services/tags.ts` as spec §1.4 tables it: `tags` (`create`/`list`/`update`) and `tags-resolve` (`create`) — 4 ops. `tags` `update` addresses a numeric `id` that `wire.ts` stringifies to `/api/tags/7`; `tags` `create` is create-or-get and the executor returns the body regardless of the 201/200 split. `tags-resolve` is a pure read expressed through the `create` kind because the kind names the wire shape, so it carries the run's single `isDestructive: false` override (spec §9.8). `DELETE /api/tags/:id` is absent (policy, spec §1.7).

**Acceptance criteria:**
- [ ] The module exports `resources` with `tags` (`/api/tags`, 3 ops) and `tags-resolve` (`/api/tags/resolve`, 1 op), 4 ops total.
- [ ] `tags` `update` sends `PATCH /api/tags/<id>` with the id stringified from a `number` field, and the body carries `name`/`expectedVersion` only.
- [ ] `tags-resolve` `create` carries `isDestructive: false` and `ids` as required `number[]`; no other op in the package carries an override.
- [ ] `DELETE /api/tags/:id` is absent from the registry and from the derived tool list.
- [ ] CLI and MCP recorded requests and normalized outputs are byte-identical for all 4 ops.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/tags-parity.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: `grep -rn "isDestructive" packages/ops/src/services` shows exactly one hit, in `tags.ts` on `tags-resolve` `create` (spec §9.8).

**Dependencies:** Task 6

**Files likely touched:**
- `packages/ops/src/services/tags.ts`
- `packages/ops/test/tags-parity.test.ts`
- `packages/ops/test/support/stub-api.ts` (seed helpers only)

**Estimated scope:** Medium: 3-5 files

## Task 10: `focus` service module (3 routes, 2 resources) with its parity suite

**Description:** Ship `packages/ops/src/services/focus.ts` as spec §1.5 tables it: `goal` (`list`) and `sessions` (`create`, `list`) — 3 ops. `PUT /api/goal` is absent: the goal is read-only through ops because there is no `PUT` support (spec §1.7). `sessions` `list` requires both `from` and `to`; `sessions` `create` requires `date` (`YYYY-MM-DD`) and `minutes`, with the 1–180 bound left server-enforced (spec §9.13).

**Acceptance criteria:**
- [ ] The module exports `resources` with `goal` (`/api/goal`, 1 op) and `sessions` (`/api/sessions`, 2 ops), 3 ops total.
- [ ] `goal` exposes `list` only — no `create`, `update`, `delete`, or any `PUT`-shaped op.
- [ ] `sessions` `list` sends `from` and `to` as required query parameters; `sessions` `create` sends `date`/`minutes` in the body.
- [ ] CLI and MCP recorded requests and normalized outputs are byte-identical for all 3 ops, and a `401` renders the same string through both.
- [ ] No local numeric bound is declared for `minutes` (server-enforced).

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/focus-parity.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/services/focus.ts` for any `PUT`-shaped op on `goal` and for a local `minutes` bound (both absent).

**Dependencies:** Task 6

**Files likely touched:**
- `packages/ops/src/services/focus.ts`
- `packages/ops/test/focus-parity.test.ts`

**Estimated scope:** Small: 2 files

## Task 11: `feedback` service module (2 routes, 1 resource) with its parity suite

**Description:** Ship `packages/ops/src/services/feedback.ts` as spec §1.6 tables it: one `feedback` resource with `list` and `update` — 2 ops. `POST /api/feedback` is out (spec §9.3, Open Question 10.1): its client-generated UUIDv4 `id` is not expressible in the closed vocabulary, and the intent's 36-route total only holds with it cut. `update` requires the server-parsed UUID `id` and `status` mirroring `FEEDBACK_STATUS_VALUES` literally.

**Acceptance criteria:**
- [ ] The module exports one resource `feedback` (`/api/feedback`) with exactly `list` and `update` — 2 ops, no `create`.
- [ ] `update` requires `id` (string, UUID documented in the description) and a required `status` enum equal to `FEEDBACK_STATUS_VALUES` in the service's order (`open`, `in_progress`, `done`, `wont_do`).
- [ ] CLI and MCP recorded requests and normalized outputs are byte-identical for both ops; a stale/`404` case renders the same string through both.
- [ ] No local UUID format validation is declared beyond the description (server-enforced).

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/feedback-parity.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/src/services/feedback.ts` and confirm `create` is absent and the four `status` values appear in `FEEDBACK_STATUS_VALUES` order.

**Dependencies:** Task 6

**Files likely touched:**
- `packages/ops/src/services/feedback.ts`
- `packages/ops/test/feedback-parity.test.ts`

**Estimated scope:** Small: 2 files

## Task 12: 36-route wire/registry table plus the cuts-absent regression

**Description:** Pin the whole route surface in one table-driven suite (spec §8.3) and keep the untouched-registry guard (spec §8.2, §6). Extend `test/wire.test.ts` with an op-by-op table over the five new modules: 36 routes, each asserted as method + path + query + body from a fully supplied input, plus the resource name asserted as the CLI command and the MCP tool prefix. Add the absence assertions — all 11 cut routes and every null-clear path — and the regression table proving the sample and notes registries compile to exactly the requests they compile to today.

**Acceptance criteria:**
- [ ] The table covers 36 routes: todo 12, meal 15, tags 4, focus 3, feedback 2, and every row matches its spec §1.x table.
- [ ] Absence assertions: none of `PUT /api/goal`, `PUT /api/target/profile`, `DELETE /api/push/subscribe`, `GET /api/push/key`, `POST /api/push/subscribe`, `DELETE /api/todos/trash`, `DELETE /api/todos/:id/permanent`, `POST /api/estimates/photo`, `DELETE /api/tags/:id`, `DELETE /api/lists/:id`, `POST /api/feedback` is producible, and no op accepts `null`.
- [ ] The regression table asserts every pre-existing sample and notes op compiles unchanged.
- [ ] Every resource name appears as a CLI command and as an MCP tool prefix in the same suite.
- [ ] The suite passes without editing `src/services/notes.ts` or `src/fixtures/sample.ts`.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/wire.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: count the table rows — 36 — and confirm each of the 11 cut routes appears in the absence list rather than only in prose.

**Dependencies:** Task 7, Task 8, Task 9, Task 10, Task 11

**Files likely touched:**
- `packages/ops/test/wire.test.ts`

**Estimated scope:** Small: 1 file

## Task 13: Multi-service integration suite (one CLI, one MCP, one token, base precedence)

**Description:** Prove the integration success the intent describes (spec §8.6-§8.8). One new suite runs one CLI invocation and one MCP server over `LIFE_OPS_SERVICE=todo,meal,notes` against three separately seeded `node:http` stub bases: every call lands on its owning service's base and nowhere else; the MCP tool list is the union of the three modules' resources with no name collision; base precedence is asserted (per-service variable wins, single-service `LIFE_OPS_API_BASE` fallback byte-identical to today, two-or-more services with a missing per-service variable failing with the variable named); and one `login` token issued for `LIFE_OPS_RESOURCE=https://life-ops` (audience `life-api`) authenticates calls to all three stubs, with no new OAuth client involved.

**Acceptance criteria:**
- [ ] One CLI process over `todo,meal,notes` exposes exactly those three modules' resources (10 resources) and every call records a request on the owning stub base only.
- [ ] One MCP server over the same variable lists the union of tools, each named `<resource>_<kind>`, with no duplicate names.
- [ ] `LIFE_OPS_API_BASE_TODO` wins over `LIFE_OPS_API_BASE`; a single service with only `LIFE_OPS_API_BASE` resolves as today; two services with a missing per-service variable fail with an error naming `LIFE_OPS_API_BASE_<NAME>`.
- [ ] One stub-IdP token with audience `life-api` is accepted by all three stub services, and no per-service resource or client id is requested.
- [ ] No test contacts a real service, the real IdP, or a real Redis/Postgres.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/multi-service.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read `packages/ops/test/multi-service.test.ts` for any real host, real IdP, or Redis/Postgres address, and for seed state shared between suites.

**Dependencies:** Task 12

**Files likely touched:**
- `packages/ops/test/multi-service.test.ts`
- `packages/ops/test/support/stub-api.ts`
- `packages/ops/test/support/stub-idp.ts`

**Estimated scope:** Medium: 3 files

## Task 14: Dev env surface in `scripts/setup-dev-env.sh`

**Description:** Land every new environment variable in the generator in the same change (spec §2, §7 "Always do"): the comma-separated `LIFE_OPS_SERVICE=notes,todo,meal,tags,focus,feedback`, the six `LIFE_OPS_API_BASE_<SERVICE>` entries on the existing dev ports (`NOTES` 3101, `TAGS` 3104, `TODO` 3105, `MEAL` 3106, `FOCUS` 3107, `FEEDBACK` 3108), and `LIFE_OPS_RESOURCE=https://life-ops` with `OIDC_AUDIENCE_MAP` gaining `https://life-ops=life-api`. `LIFE_OPS_API_BASE` and `LIFE_OPS_CLIENT_ID=dev` stay. The comment block above the block is updated to describe the list and the per-service bases. `test/dev-env.test.ts` grows the new keys in `GENERATED_KEYS` so the source-derived scan stays the guard, and asserts the generated file carries them.

**Acceptance criteria:**
- [ ] `scripts/setup-dev-env.sh` emits `LIFE_OPS_SERVICE=notes,todo,meal,tags,focus,feedback`, all six `LIFE_OPS_API_BASE_<SERVICE>` variables, `LIFE_OPS_RESOURCE=https://life-ops`, and the `https://life-ops=life-api` audience mapping, keeping `LIFE_OPS_API_BASE` and `LIFE_OPS_CLIENT_ID=dev`.
- [ ] The source-derived env scan finds every `env.*` key read under `packages/ops/src` and no key is unaccounted for.
- [ ] No service port, data directory, secret, or other service's variable is added or changed by this task.
- [ ] Running the generator twice leaves the file idempotent (no duplicated lines).
- [ ] `test/dev-env.test.ts` asserts each §2 variable is present in the generated output.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/dev-env.test.ts (at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: `git diff -- scripts/setup-dev-env.sh` touches only the `LIFE_OPS_*` keys of spec §2; the six dev ports are unchanged and no secrets line moves.

**Dependencies:** Task 5

**Files likely touched:**
- `scripts/setup-dev-env.sh`
- `packages/ops/test/dev-env.test.ts`

**Estimated scope:** Small: 2 files

## Task 15: Per-module spec files for the §1.0.1 capability map

**Description:** Satisfy spec §8.11 and the §1.0.1 storage table: each module id materialises as `docs/specs/SPEC-<module-id>.md`, extracted verbatim and content-preserving from the frozen map document, so each module has its own body of record and no requirement is added, weakened, or re-decided by the extraction. Eight ids are expected; `SPEC-ops-notes-service.md` already exists and is untouched. The map's ids are diffed against the `docs/specs/SPEC-*.md` set as the check. Nothing under `packages/` changes in this task — it is the provenance artifact the review reads, and it must not reopen the spec gate.

**Acceptance criteria:**
- [ ] Seven new files exist — `SPEC-ops-registry-vocabulary.md`, `SPEC-ops-service-loader.md`, `SPEC-ops-service-todo.md`, `SPEC-ops-service-meal.md`, `SPEC-ops-service-tags.md`, `SPEC-ops-service-focus.md`, `SPEC-ops-service-feedback.md` — plus the existing notes spec untouched.
- [ ] Each file's body is the corresponding §1.1.1/§1.1.2/§1.2–§1.6 section verbatim, with a one-line header naming the module id and the frozen map it came from.
- [ ] No requirement appears in a module spec that the map's §1.0.1 rows do not name.
- [ ] Diffing the map's eight ids against the `docs/specs/SPEC-*.md` set yields no missing and no extra id.
- [ ] No file under `packages/` or `apps/` is touched by this task.

**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -- test/wire.test.ts (no new test is added by this task; the run confirms the extraction changed nothing in `packages/`; at most 2 run(s) for this task)
- [ ] E2E passes where this task needs an end-to-end check: not applicable — no UI is touched (spec §3)
- [ ] Manual check: read each extracted `docs/specs/SPEC-<module-id>.md` against the capability map's §1.x section and confirm no requirement was added or dropped.

**Dependencies:** None

**Files likely touched:**
- `docs/specs/SPEC-ops-registry-vocabulary.md`
- `docs/specs/SPEC-ops-service-loader.md`
- `docs/specs/SPEC-ops-service-todo.md`
- `docs/specs/SPEC-ops-service-meal.md`
- `docs/specs/SPEC-ops-service-tags.md`
- `docs/specs/SPEC-ops-service-focus.md`
- `docs/specs/SPEC-ops-service-feedback.md`

**Estimated scope:** Large: 7 files (prose extraction only)

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| E2 widens the closed type set beyond `object`/`object[]` (a "just one more type" temptation from a service DTO) | Medium | Task 1 fixes the set and Task 12's table asserts every declared type maps to one derivation; spec §7 lists widening under "Ask first". |
| A module restates validation, schema, or wire logic instead of declaring descriptors | Medium | Parity suites drive both adapters against one recorded stub, so a restated mapping diverges; the manual check on each module task reads the file for logic. |
| Per-service base resolution silently falls back to one host for a multi-service config | High impact, low likelihood | Task 5 fails closed and names the missing variable; Task 13 asserts three distinct hosts and no cross-service hit. |
| `meal`'s mirrored 27 nutrient keys drift from `@life/nutrition` | Medium | Task 8's drift assertion imports `NUTRIENTS` test-side only, so a rename fails the suite without adding a runtime dependency. |
| One big task hides the vocabulary change inside a module and blocks the other modules | Medium | Tasks 1-3 land E2 with its own suites before any module exists; modules depend on Task 6, not on each other. |
| `tasks/plan.md`/`tasks/todo.md` (the shadcn plan, 40 unchecked boxes) get clobbered | Low | Neither file is edited by this plan; the conflict is recorded as Open Question 6.2. |
| A cut route leaks back in via a "harmless" resource (e.g. `push`) | Medium | Task 12 asserts all 11 cut routes absent; spec §9.4 reserves the `push` name only if push routes ever return. |
| Stub fixtures grow into a shared mutable harness that makes two suites order-dependent | Low | Seeds are per-suite in `test/support/stub-api.ts`, and each module suite seeds its own services. |

## Open Questions

- **6.1 `POST /api/feedback` in or out.** Spec Open Question 10.1 / §9.3: excluded, making feedback 2 routes and the surface 36. Ruling it back in adds one `create` op to Task 11 and changes Task 12's count. Default: out.
- **6.2 Mirror this run's checklist into `tasks/todo.md`?** That file holds an unrelated, incomplete shadcn/ui migration checklist that may be mid-build elsewhere; this plan records its tasks and checkpoints here instead of overwriting it. A human decides whether these 15 tasks also appear there as a new heading.
- **6.3 `tasks/plan.md` is another plan's document.** Same reason: not overwritten. Downstream automation that assumes `tasks/plan.md` needs to be pointed at `tasks/plan-ops-all-services.md`.
- **6.4 §4 `core/registry.ts → untouched` vs §1.1.1 nested `properties` (spec-gate item, needs a human ruling).** `normalizeField` (`registry.ts:52-59`) constructs each `FieldSpec` key by key (`type`, `required`, `description`, optional `enum`) and `normalizeOp` runs it for every op, so a `properties` map declared by a module cannot survive `defineResource`. Tasks 1-2 therefore implement E2 strictly inside §4's extended files (`types.ts`, `validate.ts`, `wire.ts`, `schema.ts`), and `registry.ts` stays byte-untouched. Consequence: nested validation applies to whatever descriptor table an adapter receives; whether module-declared nested fields reach it intact is exactly the question this row asks. Options for the human, spec unchanged either way in this run: (a) amend §4 to allow one `properties`-carrying line in `normalizeField` (spec edit, human run), or (b) confirm §1.1.1 is satisfied by the validator/schema/wire layer alone and accept that `object`/`object[]` declarations currently reach the adapters without their `properties`. Not resolved here — a pinned file is not edited to make the plan pass, and Task 8's nested-body acceptance criterion depends on the ruling. **Run outcome:** option (a) was taken and is recorded in Task 1's spec-gate note and in the spec's §10.3: `normalizeField` normalises nested `properties`, §4's row now reads `extended`, and `meal` declares its four resources through `defineResource` like its siblings. The ruling stays the human's — option (b) is still available, and taking it reverts that one line plus `meal`'s normalisation.
