# Spec: `notes` service module in `@life/ops` (`ops-notes-service`)

Status: DRAFT for user confirmation. Serves `docs/intent/ops-notes-service.md`
(confirmed 2026-10-28). Single-capability spec (§1). Module id: `ops-notes-service`.
The package's existing contracts stay as they are (`SPEC.md` core/CLI/MCP surface,
`SPEC-ops-agent-contract` MCP wire and auth/transport seams); this spec adds the
first real service module and the two core vocabulary extensions it needs.

## 1. Objective

Make `@life/ops` speak to a real service for the first time: a `notes` service
module that drives `note-service` data through the one shared registry and the one
shared HTTP executor, so `life-ops` (CLI) and the MCP server expose the same six
operations and render identical results for the same call.

**Scope check (Phase 0 verdict: ONE capability).** The ask bundles a service
module and two core contract changes (`restore` as a sixth op kind, `number[]` as a
fifth `FieldSpec` type), but they are not independently testable capabilities: the
success criterion is one parity property — six notes ops through both adapters
against one registry — and cutting any piece rewrites that criterion rather than
leaving the rest verifiable. The two core extensions have no consumer besides the
notes module in this run; they are layers with one-way dependency (core vocabulary
← notes registry ← adapters), exactly the class the intent already sanctioned for
`restore`. The "every existing op compiles unchanged" invariant (§8.3) is a
regression guard inside this spec, not a shippable capability. Verdict: one
capability, one spec, no capability map. If the reviewer wants a map instead
(core-vocabulary + notes modules), stop now — that decision is expensive to
reverse. It is not taken unilaterally here: it is carried as **Open Question
10.1**, the single place it is decided.

### 1.1 The notes registry

One `defineResource` call; fields mirror `apps/note-service/src/notes/dto/*`
one-for-one. The registry models requests only, never responses.

| kind | fields | wire request (what `note-service` receives) |
|---|---|---|
| `create` | `body` (string, required), `tagIds` (number[]) | `POST /api/notes`, JSON body `{body, tagIds}` — absent optionals never sent |
| `get` | `id` (string, required) | `GET /api/notes/:id` |
| `list` | `tagId` (number), `q` (string), `limit` (number), `cursor` (string) | `GET /api/notes` — every supplied field as a query parameter, `cursor` passes through opaque |
| `update` | `id` (string, required), `body` (string), `tagIds` (number[]), `expectedVersion` (number) | `PATCH /api/notes/:id`, JSON body `{body, tagIds, expectedVersion}` |
| `delete` | `id` (string, required) | `DELETE /api/notes/:id` |
| `restore` | `id` (string, required) | `POST /api/notes/:id/restore`, no body |

This table is exactly `notes.controller.ts` + its DTOs: `body` is
`NOTE_BODY_MAX`-bounded server-side, `tagIds` are registry-owned TagRef ids,
`expectedVersion` rides in the body and a stale value yields `409`. The registry
declares no `isDestructive` overrides: every mutating kind, `restore` included,
is destructive by kind default.

### 1.2 Core vocabulary extensions (the intent's constraint)

- **`restore` is the sixth kind in the closed op set** (`OpSpec['kind']` gains
  `'restore'`), not a per-operation `path`/`method` override. `wire.ts` remains the
  single place deriving method and path: `restore` addresses one row via `id` and
  compiles to `POST <basePath>/:id/restore` with no body — the identical route
  `apps/todo-service/src/todos/todos.controller.ts` already carries, so the kind is
  shared vocabulary, not a notes one-off. `restore` is a mutating kind:
  `kindIsDestructive('restore') === true`. Every existing kind compiles to exactly
  the request it compiles to today.
- **`number[]` is the fifth `FieldSpec` type** (after `string`, `number`,
  `boolean`, `string[]`). `UpdateNoteDto.tagIds` is `@IsInt({each: true})` under a
  `ValidationPipe` with `transform: true` and no implicit conversion, so a
  `string[]` wire value is rejected by the service — id arrays are shared
  vocabulary across services and belong in the closed type set, not in a
  per-field coercion. Derivations follow: validator accepts arrays of finite
  numbers and rejects scalar or string entries; the MCP `inputSchema` advertises
  `type: array` with `items: {type: 'number'}`; the CLI parses `--tagIds` as a
  repeated flag with numeric entries (`--tagIds 1 --tagIds 2`).

### 1.3 User stories

- Terminal user: `LIFE_OPS_SERVICE=notes life-ops notes create --body "hello"`,
  `life-ops notes list --limit 20`, `life-ops notes restore --id <id>` … perform
  the operation against `note-service` and render the one canonical output shape.
- AI agent (MCP): the server exposes `notes_create`, `notes_get`, `notes_list`,
  `notes_update`, `notes_delete`, `notes_restore`; `tools/call` runs the same
  executor the CLI runs and renders the same canonical shape.
- Both front-ends cover `create`, `get`, `list`, `update`, `delete`, `restore` and
  render identical results for the same call (parity proven, §6).

## 2. Tech Stack

- Node 22 + TypeScript ~5.7.3; the `packages/ops` toolchain unchanged
  (tsc, jest 29.7.0, ts-jest 29.2.6, `testEnvironment: node`).
- Zero runtime npm dependencies — `packages/ops/package.json` `dependencies` stays
  empty. Test-only devDeps already present (`@modelcontextprotocol/sdk` 1.32.1,
  `zod` 3.25.76); no new dependency of any kind.
- Consumed service (read-only): `apps/note-service` (NestJS ^11.0.11,
  `@life/service-kit` auth). Its HTTP contract is consumed as-is:
  `Authorization: Bearer <JWT>`, owner-scoped, `401` unauthenticated, `404`
  byte-identical for foreign/missing ids, `409` on stale `expectedVersion`,
  cursor pagination. Domain bounds (`body` ≤ `NOTE_BODY_MAX` = 20000 from
  `@life/shared`, `tagId` ≥ 1, `limit` 1–200) stay server-enforced.
- Reused in-package: core registry/validate/schema/wire, transport executor,
  auth token store/refresh, CLI and MCP adapters — all extended at the seams
  named in §4, none forked or re-stated.

## 3. Commands

```text
Typecheck: npm run typecheck              # run in packages/ops (workspace-aware)
Unit test: npm run test:unit -- <file>    # from packages/ops, one suite per command
E2E:       npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

- Testing policy: **at most 2 runs** (`max-test-runs: 2`), each targeted at the
  file(s) that prove the change — never the whole workspace speculatively.
- The e2e command is in the repo profile but is not used for this capability (no
  UI is touched; parity is proven in jest against the stub API).
- No build step: the workflow's repo profile declares no build command, so none
  is written here. Do not widen any command beyond these.

## 4. Project Structure

```text
packages/ops/src/services/notes.ts  → NEW: the notes service module (one defineResource, 6 ops)
packages/ops/src/core/types.ts      → extended: OpSpec['kind'] + 'restore'; FieldSpec type + 'number[]'
packages/ops/src/core/registry.ts   → extended: DESTRUCTIVE_KINDS gains restore: true
packages/ops/src/core/wire.ts       → extended: restore → POST <basePath>/:id/restore (single owner of method/path)
packages/ops/src/core/validate.ts   → extended: number[] shape check
packages/ops/src/core/schema.ts     → extended: array items type follows the element type
packages/ops/src/cli/parse.ts       → extended: number[] flags (repeated, numeric entries)
packages/ops/src/cli/run.ts         → extended: bare-name resolution in loadService ('notes' → the in-package module)
packages/ops/src/fixtures/sample.ts → untouched; still the contract-proof stand-in
packages/ops/test/                  → suites (§6); stubs stay in test/support/ (node:http)
docs/specs/SPEC-ops-notes-service.md → this spec (module id: ops-notes-service)
docs/intent/ops-notes-service.md     → confirmed intent (read-only input)
apps/                                → NOT TOUCHED
```

`ServiceModule` shape: the module exports `service` (registry + optional
`apiBase`); it declares **no** `apiBase` override — `LIFE_OPS_API_BASE` points at
note-service, and ports are repo hard lines, never compiled in.

## 5. Code Style

The repo writes TypeScript with spec-referencing block comments, exported typed
contracts, and single quotes. The module in one real snippet (the shape the
contract comments and the DRY rule demand — it defines nothing the core derives):

```ts
/**
 * The `notes` service module (SPEC-ops-notes-service §1.1): the first real
 * registry, one field per note-service DTO field. Validation, JSON Schema, and
 * the wire mapping derive from this table in core — a module that restated any
 * of them would be a bug (SPEC.md §3, DRY rule).
 */
import { defineResource } from '../core/registry';
import type { ServiceModule } from '../cli/run';

export const service: ServiceModule = {
  registry: defineResource({
    name: 'notes',
    basePath: '/api/notes',
    ops: [
      {
        kind: 'restore',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the trashed note to restore',
          },
        },
      },
      // create, get, list, update, delete per the §1.1 table
    ],
  }),
};
```

Conventions: intention-revealing names; comments state the contract and cite the
spec section; no `any` in exported signatures; zero runtime dependencies.

## 6. Testing Strategy

- Framework: jest + ts-jest, `testEnvironment: node`, suites at
  `packages/ops/test/*.test.ts` (the `packages/cache` pattern). All fakes are
  `node:http` in `test/support/`; no test contacts a real service or the real IdP.
- Levels:
  - **Parity (centerpiece):** the notes registry driven through the CLI adapter
    and MCP `tools/call` against identically seeded stub APIs; the recorded HTTP
    requests (method, path, query, JSON body) and normalized outputs must match
    for all six kinds, `restore` included. Error parity as strings: validator
    failure, `401`, `404`, `409` render the same canonical message through both
    adapters (reuse the existing parity harness).
  - **Wire/registry suite:** the §1.1 table asserted op by op, plus a regression
    table proving the five existing kinds still compile to exactly their current
    requests against the untouched sample registry.
  - **Validation/schema suite:** the shared accept/reject case table must pass in
    the core validator and against the MCP `inputSchema` identically — extended
    with `number[]` (finite-number arrays accepted; string arrays, scalars, and
    non-finite numbers rejected) and the notes required fields (`body`, `id`).
  - **Loader suite:** `loadService` with `LIFE_OPS_SERVICE=notes` resolves the
    in-package notes registry; path-like values keep loading external modules
    exporting `service`/`registry` as today.
- Coverage expectations: every notes op exercised through both adapters; every
  `FieldSpec` type including `number[]` exercised in the case table; `restore`
  asserted to default `isDestructive: true`.
- Policy: targeted runs only — `npm run test:unit -- <file>` from `packages/ops`,
  one suite per command, at most 2 runs.

## 7. Boundaries

- **Always do:** keep the DRY rule — adapters render the registry and never
  restate validation, schema derivation, or wire mapping; derive method and path
  in `wire.ts` only; validate in core before any network call; keep every
  existing op's compiled request byte-identical; cite spec sections in contract
  comments; tests green before commit; keep the registry request-shaped only.
- **Ask first:** any npm dependency (runtime or dev); editing anything under
  `apps/` (including `note-service`); widening the closed `FieldSpec` type set
  beyond `number[]` or the op set beyond `restore`; per-operation `path`/`method`
  overrides; adding length/range validation concepts to core; declaring
  `isDestructive` overrides in the notes registry (flipping `restore` to a safe
  write is a human decision); changing the token-store path/format; widening the
  Commands in §3; renaming the module id `ops-notes-service`.
- **Never do:** expose `DELETE /api/notes/:id/permanent` or `DELETE /api/notes/trash`
  (permanent deletion and emptying the trash are human-only); add `tags`, `todo`,
  or `meal` service modules; change any UI in `apps/app`; add any runtime
  dependency; edit anything under `apps/` or change `note-service`'s HTTP API
  contract; duplicate validation/schema/wire/auth/transport/error shape in an
  adapter; hardcode service ports or URLs; rename or move this spec.

## 8. Success Criteria

1. `npm run typecheck` in `packages/ops` exits 0.
2. Every notes op compiles to exactly its §1.1 wire request, asserted per op —
   `restore` → `POST /api/notes/:id/restore` with no body, `list` → `GET /api/notes`
   with supplied fields as query params.
3. Regression: the five existing kinds compile to exactly the requests they
   compile to today against the untouched sample registry (asserted table).
4. Parity in one jest run of the parity suite: for all six kinds the stub-API
   request recorded from the CLI adapter equals the one from the MCP adapter
   (method, path, query, JSON body) and the normalized outputs are byte-identical;
   validator failure, `401`, `404`, `409` render byte-identical messages through
   both adapters.
5. MCP `tools/list` over the notes registry exposes exactly `notes_create`,
   `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `notes_restore`,
   and each `inputSchema` accepts/rejects the shared case table identically to
   the core validator (including `tagIds` as an array of numbers).
6. `LIFE_OPS_SERVICE=notes` resolves the in-package notes module via bare name,
   so `LIFE_OPS_SERVICE=notes life-ops notes <op> …` performs the operation
   against `note-service` (proven in-suite by request-shape equality with the
   table in §1.1; an optional manual smoke against a local `note-service` with
   `LIFE_OPS_API_BASE` set confirms it end-to-end at review time).
7. `restore` is a mutating kind with `isDestructive` default `true` and no
   override in the notes registry (asserted in the registry suite).
8. The two human-only routes (`DELETE /api/notes/:id/permanent`,
   `DELETE /api/notes/trash`) appear nowhere in the registry or wire output.
9. `git diff --name-only HEAD` shows zero paths under `apps/`;
   `grep -rln "@life/ops\|life-ops" apps` returns zero hits; and
   `packages/ops/package.json` keeps an empty (or absent) `dependencies` block.

## 9. Assumptions

1. **One capability, one spec**, module id `ops-notes-service` (matches the
   branch and intent), stored at `docs/specs/SPEC-ops-notes-service.md`. No
   capability map. Reasoning is the §1 scope check; the alternative split
   (core-vocabulary module + notes module) exists and is reversible only by
   rewriting both specs. That call is not taken unilaterally here: it is
   carried as **Open Question 10.1**, the single place it is decided.
2. **`LIFE_OPS_SERVICE=notes` is literal.** `loadService` gains bare-name
   resolution: a value without path separators maps to the package's own service
   module (`notes` → `src/services/notes`), while path-like values keep loading
   any module exporting `service`/`registry` exactly as today. Alternative
   reading — the intent's `=notes` as shorthand for a module path — is rejected
   because the Success criterion quotes the command verbatim.
3. **`restore` semantics:** `POST <basePath>/:id/restore`, no body, addresses one
   row via the `id` field; mutating kind, `kindIsDestructive('restore') === true`
   per the intent's "isDestructive still defaults by kind"; no override in the
   notes registry. If restoring from trash should run without human approval,
   that is an explicit `isDestructive: false` decision for a later, human-approved
   change; until a human makes it, it is carried as **Open Question 10.2** and
   the kind default stands.
4. **`number[]` is the sanctioned way to type `tagIds`.** The service DTO
   requires JSON numbers (`@IsInt({each: true})`, no implicit conversion), so
   `string[]` would be rejected on the wire and a per-field coercion would be the
   override style the intent forbids. `tagId` (singular) stays `number`.
5. **Local validation stays shape-level** (type/required/enum, as the closed core
   defines it). Domain bounds — `body` ≤ 20000, `tagId` ≥ 1, `limit` 1–200 —
   remain `note-service`'s enforcement; `FieldSpec` gains no length/range concept
   in this run.
6. **`id` fields are `string`** (UUID primary keys in `note.entity.ts`) and the
   addressing field name stays `id` — the wire convention `wire.ts` already owns.
7. **`expectedVersion` rides in the `PATCH` body** (`UpdateNoteDto`), stale value
   → `409`; no change to the wire conventions beyond the two vocabulary
   extensions.
8. **`list` covers active notes only** (`GET /api/notes`). `GET /api/notes/trash`
   (trash listing) and `GET /api/notes/:id/tags` are not representable in the
   closed six-kind set without a seventh kind or a per-op path override — both
   rejected by the intent's constraint — so they are excluded this run alongside
   the two human-only DELETE routes. Adding them needs a human vocabulary
   decision.
9. **No `apiBase` override** in the notes module; `LIFE_OPS_API_BASE` points at
   `note-service`. Ports and data directories are repo hard lines and are never
   compiled into the package.
10. **`q` has no local semantics**: it passes through as a query parameter; the
    service performs content matching post-decrypt, per the notes at-rest
    contract. The registry never interprets `q` or `cursor`.

## 10. Open Questions

Unresolved decisions that need human input. These are not assumptions: §9 records the
reading this spec proceeds on, and the questions below record where that reading can
still be overruled. Neither blocks implementation — in both cases the spec ships on the
stated default and the answer changes a later revision, not this one.

### 10.1 Capability map vs single spec — awaiting the reviewer

§1 concludes ONE capability (one spec, no capability map), and this document is written
as that single spec. The alternative — a capability map plus a `SPEC-ops-notes-service`
module spec, with `restore` and `number[]` specified separately — is reachable only by
rewriting both documents, so the choice is expensive to reverse once implementation
starts. §9.1 states the default; this question is where the reviewer rules on it.

- **Owner:** the human reviewer at the spec gate.
- **Default if unanswered:** proceed as one spec (§1, §9.1). Implementation is not
  blocked and nothing in §8 changes.
- **What an answer changes:** whether the `packages/ops/src/core/*` extensions get their
  own spec and module id, and therefore whether §1.2 stays in this document.
- **Needed before:** the plan is written from this spec. Answering after that point
  leaves the plan's provenance pointing at a document that no longer exists in that
  shape.

### 10.2 Restore approval semantics — human-owned, deliberately deferred

`restore` is a mutating kind and `kindIsDestructive('restore') === true` (§1.2, §8.7), so
it inherits today's destructive-write handling. The intent's constraint fixes that
default ("`isDestructive` still defaults by kind") and it is not in question here. What
is unresolved is a separate, later decision: whether restoring from trash should travel
without human approval, which would need an explicit `isDestructive: false` override in
the notes registry.

- **Owner:** the human. §7 lists the override under **Ask first**, so no agent may make
  it.
- **Default if unanswered:** none is set — the override does not exist in this run and
  `true` stands (§9.3). §8.7 asserts the absence of the override.
- **What an answer changes:** a later, human-approved change to the registry only. No
  §8 criterion and no wire shape in §1.1 moves with it.

### 10.3 Nothing else is open

Every other reading this spec takes is recorded as an assumption in §9 with its
reasoning, and each one is settled by the intent, by the consumed `note-service`
contract, or by a repo hard line. If a reviewer disagrees with one of them, it becomes
an open question on the next revision rather than being re-argued here.
