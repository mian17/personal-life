# Implementation Plan: notes service module in `@life/ops` (ops-notes-service)

*Produced by planning-and-task-breakdown; source spec: `/home/night/WebstormProjects/personal-life/.pi/worktrees/ops-notes-service/docs/specs/SPEC-ops-notes-service.md`; confirmed intent: `docs/intent/ops-notes-service.md`*

## Overview

`@life/ops` ships only `src/fixtures/sample.ts`; it has never spoken to a real service. This plan adds the first real service module — a six-op `notes` registry mirroring the `note-service` HTTP contract one-for-one — plus the two core vocabulary extensions that module needs: `restore` as a sixth kind in the closed op set and `number[]` as a fifth `FieldSpec` type. One sequential slice: core vocabulary, then the module that consumes it, then the loader that resolves it by bare name, then the suites that prove adapter parity, `tools/list` parity, and validation parity. Both front-ends (`life-ops` CLI and the MCP server) must render identical results for the same call against identically seeded stubs.

Ordering note: tasks run in numeric order, one working slice each. `packages/ops/src/fixtures/sample.ts` and everything under `apps/` stay untouched; no task adds a runtime dependency, a UI change, or a seventh op kind (spec §7).

## Architecture Decisions

- **`restore` is a kind, not an override.** `OpSpec['kind']` gains `'restore'`; `DESTRUCTIVE_KINDS` gains `restore: true`; `wire.ts` stays the single owner of method/path derivation (`POST <basePath>/:id/restore`, no body). Reasoning is in the confirmed intent: `apps/todo-service` carries the identical route, so the kind is shared vocabulary, and both adapters stay free of logic the core does not own. No per-operation `path`/`method` field is introduced (spec §1.2, §7).
- **`number[]` is a field type, not a per-field coercion.** `UpdateNoteDto.tagIds` is `@IsInt({each: true})` server-side, so a `string[]` wire value is rejected by the service; the closed type set carries it and every derivation (validator, MCP `inputSchema`, CLI repeated flag) follows from the type (spec §1.2).
- **The registry is the only notes artifact.** One `defineResource` call, no `apiBase` override, no restated validation/schema/wire logic, no `isDestructive` overrides — the kind default decides. Ports and hosts come from `LIFE_OPS_API_BASE` (repo hard line).
- **One resolver.** `loadService` is the single place that turns `LIFE_OPS_SERVICE` into a registry; the CLI bin and the MCP stdio entry both read it (spec §9.2).
- **Task list target for this run is this file.** `tasks/plan.md` and `tasks/todo.md` hold a different, incomplete plan (the shadcn/ui primitive migration). Per the skill's "never overwrite an incomplete plan / tell you where the new plan should go" conflict rule, that plan's files are left exactly as they are and this run records its tasks and checkpoints in the `## Task List` section below. Mirroring the checklist into `tasks/todo.md` alongside the untouched shadcn items is a human call — carried as Open Question 6.2, not taken here.
- **Commands stay spec §3.** Typecheck and one focused jest suite per task, at most two runs. No build step: spec §3 declares none, so every task records the build slot as not applicable rather than widening the command set.
- **No command outside the declared tooling.** `packages/ops` has no `ts-node` in `devDependencies` and no `node_modules/.bin/ts-node`, and `npx` would fetch from the registry (blocked by network policy). Every check in this plan therefore runs as `npm run typecheck`, `npm run test:unit -- <file>` (jest/ts-jest over `test/**/*.test.ts`), the `life-ops` bin, or shell `git`/`grep`. Ad-hoc TypeScript evaluation is a case inside the focused suite, never a `ts-node` one-liner.

## Task List

### Phase 1: Foundation and the notes module
- [ ] Task 1: `restore` as the sixth op kind in core vocabulary
- [ ] Task 2: `number[]` as the fifth `FieldSpec` type
- [ ] Task 3: The `notes` service module

### Checkpoint: After Tasks 1-3
- [ ] All tests pass
- [ ] Application builds without errors (repo profile declares no build command; the typecheck is the build evidence — spec §3)
- [ ] Core flow works end-to-end: `loadService` reaches the notes registry and one notes op compiles to its §1.1 request
- [ ] Review with human before proceeding

### Phase 2: Resolution and parity proof
- [ ] Task 4: Bare-name service resolution in `loadService`
- [ ] Task 5: Adapter parity for the six notes ops
- [ ] Task 6: `tools/list` and validation parity over the notes registry

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Ready for review

## Task 1: `restore` as the sixth op kind in core vocabulary

**Description:** Extend the closed op set so `restore` is a first-class kind instead of a per-operation `path`/`method` override (spec §1.2). `OpSpec['kind']` gains `'restore'`; `DESTRUCTIVE_KINDS` gains `restore: true`, so `kindIsDestructive('restore') === true` and the notes registry never needs an override; `wire.ts` stays the single owner of method/path derivation and compiles `restore` to `POST <basePath>/:id/restore` with no body; `HINTS_BY_KIND` in `src/mcp/tools.ts` gains the `restore` hints (non-read-only, destructive, idempotent, closed-world) because that table is keyed by the same union and would otherwise fail typecheck. The five existing kinds keep compiling exactly today's requests, asserted by a wire regression table so the kind addition is provably additive.

**Acceptance criteria:**
- [ ] `OpSpec['kind']` includes `'restore'` and its doc comment names the six kinds.
- [ ] `kindIsDestructive('restore')` returns `true`; `defineResource` fills that default when a `restore` op declares no `isDestructive`.
- [ ] `wireFor` on a `restore` op yields method `POST`, path `<basePath>/<id>/restore` (id percent-encoded as today), empty query, `body: undefined`.
- [ ] `listTools` on a registry carrying `restore` emits a tool named `<resource>_restore`, title `Restore <resource>`, with `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: false`.
- [ ] A regression table asserts `create`/`get`/`list`/`update`/`delete` over `sampleRegistry` compile byte-identical method, path, query, and body to the current implementation.
- [ ] `OpSpec` exposes no per-operation `path`, `method`, or route-override field.

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/wire.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: review `git diff packages/ops/src/core packages/ops/src/mcp` — `restore` appears only in the kind union, `DESTRUCTIVE_KINDS`, the `wire.ts` method/address tables, and `HINTS_BY_KIND`; no route string is hardcoded in an adapter.

**Dependencies:** None

**Files likely touched:**
- `packages/ops/src/core/types.ts`
- `packages/ops/src/core/registry.ts`
- `packages/ops/src/core/wire.ts`
- `packages/ops/src/mcp/tools.ts`
- `packages/ops/test/wire.test.ts`

**Estimated scope:** Medium: 5 files

## Task 2: `number[]` as the fifth `FieldSpec` type

**Description:** Add the array-of-numbers field type the notes `tagIds` field needs (spec §1.2, §9.4). `FieldSpec['type']` gains `'number[]'`; `validate.ts` accepts an array whose every entry is a finite number and rejects scalars, string arrays, and non-finite entries; `schema.ts` derives `{ type: 'array', items: { type: 'number' } }` from the element type rather than a hardcoded `string`; `cli/parse.ts` treats both array types as repeatable flags and coerces each `number[]` entry with `Number` while leaving `string[]` entries as text, so `--tagIds 1 --tagIds 2` arrives as `[1, 2]`. The core validator still owns accept/reject: a non-numeric entry is rejected there, not in the parser. The focused suite gains both the `number[]` validator/schema rows and the parser cases for the flag shapes.

**Acceptance criteria:**
- [ ] `FieldSpec['type']` includes `'number[]'`; the union's doc comment lists all five types.
- [ ] Validator accepts `[]`, `[1, 2]`, and `[1.5]` for a `number[]` field; rejects `[1, '2']`, `[Number.NaN]`, `[Number.POSITIVE_INFINITY]`, `1`, and `'1'`.
- [ ] `deriveInputSchema` emits `items: { type: 'number' }` for `number[]` and still `items: { type: 'string' }` for `string[]`.
- [ ] CLI parsing turns repeated numeric flags into a number array (`--tagIds 1 --tagIds 2` → `[1, 2]`), a single occurrence into a one-element array, and repeated string flags into a string array exactly as today.
- [ ] A non-numeric `number[]` entry produces the canonical validation failure (`invalid input for <resource>.<kind>: <field>: expected number[]`), never a wire call.
- [ ] Every existing `string[]`, `number`, `boolean`, and `string` case in the shared table keeps its current verdict.
- [ ] `test/validation-schema.test.ts` carries the `parseCallCommand` cases for those flag shapes, so the CLI coercion is asserted by the focused suite rather than by an ad-hoc script.

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/validation-schema.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: run `npm run test:unit -- test/validation-schema.test.ts` (run in `packages/ops`, the single focused run above) and read the two parser assertions in its output — the repeated `--tagIds 1 --tagIds 2` case expects a two-element number array, the single-occurrence case a one-element array.

**Dependencies:** Task 1 (both tasks edit `src/core/types.ts`; sequential avoids a conflicting rewrite of the same file)

**Files likely touched:**
- `packages/ops/src/core/types.ts`
- `packages/ops/src/core/validate.ts`
- `packages/ops/src/core/schema.ts`
- `packages/ops/src/cli/parse.ts`
- `packages/ops/test/validation-schema.test.ts`

**Estimated scope:** Medium: 5 files

## Task 3: The `notes` service module

**Description:** Add the first real service module, `packages/ops/src/services/notes.ts`, as one `defineResource` call whose six ops mirror the `note-service` HTTP contract one-for-one (spec §1.1): `create` (`body` required, `tagIds`), `get` (`id`), `list` (`tagId`, `q`, `limit`, `cursor`), `update` (`id` required, `body`, `tagIds`, `expectedVersion`), `delete` (`id`), `restore` (`id`). It exports `service` with no `apiBase` override — the base comes from `LIFE_OPS_API_BASE` — declares no `isDestructive` overrides, and restates no validation, schema, or wire logic; every field description states the service-side contract. The permanent-delete and empty-trash routes are deliberately absent (spec §7, §9.7). The wire suite gains a per-op notes table asserting the compiled request for each of the six kinds, plus a declaration-order case that names the six kinds, so the module's request shape and op order are proven rather than assumed.

**Acceptance criteria:**
- [ ] `src/services/notes.ts` exports `service` with `registry.name === 'notes'`, `basePath === '/api/notes'`, and exactly the six ops of the §1.1 table in declaration order (`create`, `get`, `list`, `update`, `delete`, `restore`).
- [ ] Field names, types, and required flags match the table exactly: `create.body` string required, `create.tagIds` `number[]`; `get.id` string required; `list.tagId` number, `list.q` string, `list.limit` number, `list.cursor` string; `update.id` required, `update.body` string, `update.tagIds` `number[]`, `update.expectedVersion` number; `delete.id` required; `restore.id` required.
- [ ] `service.apiBase` is undefined and no source file hardcodes a host or port.
- [ ] No op declares `isDestructive`; all four mutating ops (and `restore`) resolve to `true` from the kind default, `get`/`list` to `false`.
- [ ] The wire table asserts per op: `create` → `POST /api/notes` with a JSON body, `get` → `GET /api/notes/:id`, `list` → `GET /api/notes` with every supplied field as a query parameter and an opaque `cursor`, `update` → `PATCH /api/notes/:id` with body, `delete` → `DELETE /api/notes/:id` with no body, `restore` → `POST /api/notes/:id/restore` with no body.
- [ ] Absent optional fields never reach the wire (a `create` with only `body` sends no `tagIds`; an `update` with only `id` sends an empty body object as `PATCH` does today).
- [ ] `POST /api/notes/:id/permanent` and `DELETE /api/notes/trash` appear in no registry op.
- [ ] `test/wire.test.ts` asserts the notes op declaration order is `create`, `get`, `list`, `update`, `delete`, `restore`.

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/wire.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: run `npm run test:unit -- test/wire.test.ts` (run in `packages/ops`, the single focused run above) and confirm the six-kind declaration-order assertion in the output; a human then spot-checks that table against `apps/note-service/src/notes/notes.controller.ts` and the three DTOs.

**Dependencies:** Task 1, Task 2

**Files likely touched:**
- `packages/ops/src/services/notes.ts`
- `packages/ops/test/wire.test.ts`

**Estimated scope:** Small: 2 files

## Checkpoint: After Tasks 1-3
- [ ] All tests pass
- [ ] Application builds without errors (repo profile declares no build command; the typecheck is the build evidence — spec §3)
- [ ] Core flow works end-to-end: the `notes` registry compiles each of the six ops to its §1.1 request and the five pre-existing kinds still compile unchanged
- [ ] Review with human before proceeding

## Task 4: Bare-name service resolution in `loadService`

**Description:** Make `LIFE_OPS_SERVICE=notes` resolve to the in-package notes module (spec §9.2) without changing how external paths load. `loadService` classifies the env value: a value with no path separator is a bare service name, resolved to `../services/<name>`, and an unknown name fails with a message naming the module; a path-like value keeps the current dynamic-import behaviour for any module exporting `service` or `registry`/`apiBase`. `LIFE_OPS_SERVICE` stays the single selector that both the CLI bin and the MCP stdio entry read, so the same resolution serves both adapters. A loader suite proves bare-name resolution and path-like loading still work in one run.

**Acceptance criteria:**
- [ ] `loadService({ LIFE_OPS_SERVICE: 'notes' })` resolves `src/services/notes.ts` and returns its `service` object (`registry.name === 'notes'`).
- [ ] A path-like value (absolute path, `./`-relative path, or anything containing a separator) still loads an external module exporting `service`, or `registry` plus `apiBase`, exactly as today.
- [ ] An unknown bare name (e.g. `tags`) rejects with a message naming the unknown service and the value of `LIFE_OPS_SERVICE`; it never falls through to a dynamic import of the literal string.
- [ ] An unset or whitespace-only `LIFE_OPS_SERVICE` keeps the current `LIFE_OPS_SERVICE is not set; point it at a registry module` failure.
- [ ] The MCP stdio entry and the `life-ops` bin both obtain their registry through this one function; no second resolver exists.
- [ ] The existing conformance module path (`test/support/service-module.ts`) still loads unchanged.

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/loader.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: with `LIFE_OPS_SERVICE=notes LIFE_OPS_API_BASE=http://127.0.0.1:1`, invoking `life-ops notes list` fails on the connection to that base rather than on service resolution — proving the bare name resolved and the executor ran.

**Dependencies:** Task 3

**Files likely touched:**
- `packages/ops/src/cli/run.ts`
- `packages/ops/test/loader.test.ts`

**Estimated scope:** Small: 2 files

## Task 5: Adapter parity for the six notes ops

**Description:** Prove the spec's centerpiece success criterion (§8.4): one notes call, run through the CLI adapter and through MCP `tools/call` against identically seeded stubs, produces the same recorded HTTP request (method, path, query, JSON body) and byte-identical rendered output for all six kinds, `restore` included (spec §6). The recording stub in `test/support/stub-api.ts` grows just enough to serve the notes contract — a configurable collection path and a trashed-state row field so `restore` and `delete` mean something — while its default keeps every existing `parity.test.ts` expectation intact. Error parity extends to the notes registry: validator failure, missing token, `401`, `404` (foreign and missing ids byte-identical), and `409` on a stale `expectedVersion` render the same canonical message through both adapters. No test contacts a real service or IdP.

**Acceptance criteria:**
- [ ] A notes parity suite drives all six kinds through both adapters and asserts equal recorded method, path, query, and parsed JSON body per kind.
- [ ] Rendered success output is byte-identical between adapters for each of the six kinds on the same seed.
- [ ] `notes_delete` marks the row trashed on the stub and `notes_restore` returns it to the active set; both adapters observe the same resulting row state.
- [ ] Error parity holds through both adapters with byte-identical messages for: a validator failure (`notes.create` without `body`), a missing token, a `401`, a `404` for a foreign id and for a missing id, and a `409` from a stale `expectedVersion`.
- [ ] The stub records requests only; it performs no encryption and stores no plaintext derived from a real service.
- [ ] `test/parity.test.ts` passes unchanged against the extended stub (sample behaviour is preserved by default).

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/notes-parity.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: read the suite's request log dump for one failing-then-fixed case and confirm the CLI and MCP entries differ only in transport headers the comparison already excludes.

**Dependencies:** Task 1, Task 2, Task 3

**Files likely touched:**
- `packages/ops/test/support/stub-api.ts`
- `packages/ops/test/notes-parity.test.ts`

**Estimated scope:** Small: 2 files

## Task 6: `tools/list` and validation parity over the notes registry

**Description:** Close the remaining success criteria that assert the MCP surface and the shared validator agree over the notes registry (spec §8.5), and record the package-boundary evidence spec §8.9 requires. `tools.list` exposes exactly the six `notes_*` tools with titles and behavior hints that follow the kind defaults, and each advertised `inputSchema` accepts and rejects the same case table the core validator does — including `tagIds` as an array of numbers and the required `body`/`id` fields. This extends the existing validation/schema suite with notes cases rather than starting a competing harness, so the validator/schema drift guard stays one table. The task also asserts the boundary itself, since no source change in this plan may cross it.

**Acceptance criteria:**
- [ ] `listTools(notesRegistry)` yields exactly `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `notes_restore` in registry order, with titles `Create notes`, `Get notes`, `List notes`, `Update notes`, `Delete notes`, `Restore notes`.
- [ ] Hint assertions: `notes_get` and `notes_list` are read-only and non-destructive; `notes_create`, `notes_update`, `notes_delete`, `notes_restore` are destructive and non-read-only; every tool is closed-world.
- [ ] The notes `create`/`update` schemas advertise `tagIds` as `{ type: 'array', items: { type: 'number' } }`, and required lists match the registry (`create` → `['body']`, `get`/`delete`/`restore` → `['id']`, `update` → `['id']`, `list` → `[]`).
- [ ] Every notes case in the shared table yields the same accept/reject verdict from `validateInput` and from the derived schema: `tagIds: [1, 2]` accepted, `tagIds: ['1']` rejected, `tagIds: 1` rejected, `body` omitted on `create` rejected, `id` omitted on `get`/`delete`/`restore` rejected.
- [ ] The table additions leave every existing sample and enum case verdict unchanged.
- [ ] Boundary check (spec §8.9): `git diff --name-only HEAD` shows zero paths under `apps/`; `grep -rln "@life/ops\|life-ops" apps` returns zero hits; `packages/ops/package.json` keeps an empty (or absent) `dependencies` block (it has none today, and this change adds no runtime dependency).

**Verification:**
- [ ] Tests pass — typecheck: `npm run typecheck` (run in `packages/ops`)
- [ ] Tests pass — focused unit suite: `npm run test:unit -- test/validation-schema.test.ts` (run in `packages/ops`; 1 run)
- [ ] Build succeeds: not applicable — spec §3 declares no build step; the typecheck line above is the build evidence
- [ ] Manual check: read `listTools(notesRegistry)` output from that suite and compare each `inputSchema` against the §1.1 table by eye — field names, types, and required lists only, no descriptions.
- [ ] Manual check: run the two shell commands and the one file read of the boundary criterion above in the worktree root and confirm all three are clean.

**Dependencies:** Task 2, Task 3

**Files likely touched:**
- `packages/ops/test/validation-schema.test.ts`

**Estimated scope:** Small: 1 file

## Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Application builds without errors (repo profile declares no build command; the typecheck is the build evidence — spec §3)
- [ ] Core flow works end-to-end: all six notes ops driven through CLI and MCP against the same stub seed, `restore` included
- [ ] Boundary holds (spec §8.9): zero `apps/` paths in `git diff --name-only HEAD`, zero `@life/ops`/`life-ops` hits under `apps/`, `packages/ops/package.json` still has no `dependencies`
- [ ] Ready for review

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `restore` leaks into adapters as a special case | Medium | Task 1 asserts `wire.ts`/`HINTS_BY_KIND` own it; the manual check greps the diff for hardcoded routes. |
| The `number[]` CLI coercion drifts from the core validator (parser silently accepts `abc`) | Medium | Task 2 keeps accept/reject in `validate.ts` and asserts the canonical failure message; the case table holds both verdicts. |
| Bare-name resolution breaks external module loading (`test/support/service-module.ts`) | Low | Task 4 asserts path-like values keep today's dynamic-import path in the same run. |
| Parity suite passes for symmetry reasons rather than real behaviour (both adapters mocked the same way) | Medium | Task 5 drives both adapters against one recording stub and asserts the recorded HTTP request, not just rendered output. |
| The extended stub changes default behaviour and breaks `test/parity.test.ts` | Low | Task 5's last criterion requires the existing suite to pass unchanged; new behaviour is opt-in. |
| Two tasks rewrite `src/core/types.ts` and conflict | High if parallel | Task 2 declares Task 1 as a dependency; the run is sequential (ordering note). |
| A verification command needs tooling the repo does not install (`ts-node` via `npx`) | Low | Every check uses `npm run`, jest, the `life-ops` bin, or shell `git`/`grep`; ad-hoc evaluation lives inside the focused suite (architecture decision "No command outside the declared tooling"). |

## Open Questions

- **6.1 Capability map instead of one spec?** Spec Open Question 10.1: if the reviewer wants separate core-vocabulary and notes specs, stop before Task 1. Not taken unilaterally here.
- **6.2 Mirror this run's checklist into `tasks/todo.md`?** That file holds an unrelated, incomplete shadcn/ui migration checklist that may be mid-build elsewhere; this plan records its tasks and checkpoints here instead of overwriting it. A human decides whether the six tasks should also appear there as a new heading.
- **6.3 Task list target for downstream tooling.** The default `/build` target is `tasks/todo.md`; this run's artifact is `tasks/plan-ops-notes-service.md`. Any downstream automation that assumes the default path needs to be told otherwise.
