# Spec: `ops` — shared data-operations platform package (`@life/ops`)

Status: IMPLEMENTATION CONTRACT. Serves `docs/intent/ops-shared-package.md`
(confirmed 2026-10-16). Single-capability spec (see §1); stored at the project root
per the spec skill's convention — this file's location is part of the contract.

## 1. Scope check (Phase 0 verdict: ONE capability)

The request bundles five named pieces (operation-registry core, CLI adapter, MCP
adapter, auth/IdP-token plumbing, HTTP transport), but they are not independently
testable capabilities: the confirmed success criterion is a single property —
**parity** between two adapters rendering one registry against one stub API — and
cutting or replacing any piece rewrites that criterion rather than leaving the rest
verifiable. The adapters have no consumers without the core, the core's contract is
only proven through the adapters, and the plumbing is shared infrastructure, not a
shipped capability. Per the skill's detection rules (acceptance criteria that could
ship and be verified separately), these do not cluster separately. Verdict: one
capability, one spec, no capability map. The five pieces are internal layers with a
one-way dependency (core ← transport/auth ← adapters); module ids are not minted.

## 2. ASSUMPTIONS I'M MAKING

1. One capability, one spec at `SPEC.md` (§1). If a reviewer wants per-piece module
   specs instead, stop now — that decision is expensive to reverse.
2. Package is `packages/ops`, workspace name `@life/ops`, private, added to the root
   `package.json` `workspaces` list. The name is provisional (intent: "up for grabs").
3. Node 22 + TypeScript ~5.7 + jest/ts-jest, `testEnvironment: node` — exactly the
   `packages/cache` toolchain (`typecheck`, `test:unit`, `build` scripts).
4. CLI entry point `life-ops` via a workspace `bin`, consumed with `npx`/`npm run`
   inside the workspace. No publishing of any kind.
5. Auth = OIDC authorization code + PKCE with loopback redirect against the existing
   IdP (discovery, token endpoint, refresh-token rotation), single audience
   `life-api` (SPEC-service-kernel token model). No device flow — the IdP does not
   enable it and `apps/` is untouchable.
6. The CLI reuses an already-registered IdP client via config
   (`LIFE_OPS_CLIENT_ID`, default `dev`) with a loopback redirect URI. Registering a
   dedicated CLI client touches `apps/idp` and is out of scope (§10).
7. "The services' existing HTTP API contract" is the uniform contract in
   `docs/specs/SPEC-service-kernel.md`: `Authorization: Bearer <JWT>`, owner-scoped
   by `sub`, `401` unauthenticated, `404` byte-identical for foreign and missing ids,
   `409` on stale `expectedVersion`, `version` int concurrency, cursor pagination.
   The transport consumes it as-is; it never negotiates a new shape.
8. Zero runtime npm dependencies. CLI parsing = `node:util` `parseArgs`; HTTP =
   global `fetch`; PKCE = `node:crypto`; stub API = `node:http`; MCP = a minimal
   stdio JSON-RPC framing (tools/list + tools/call only). A dependency (e.g.
   `@modelcontextprotocol/sdk`) is added only after Ask-first approval (§8).
9. The sample registry and stub API are in-package test fixtures standing in for
   future per-service modules; no real service is contacted by any test.

→ Correct me now or I proceed with these.

## 3. Objective

One package so a future per-service module registers its resources once and gets
full CRUD on both front-ends — terminal CLI and MCP AI clients — with no adapter
code. Validation, JSON-Schema derivation, auth, transport, and the error shape live
in the core exactly once; adapters only render the registry (the DRY constraint).

User stories / acceptance criteria:

- As a terminal user, I run `life-ops <resource> <op> [flags]` and the operation is
  validated locally, sent to the service's existing HTTP API with my IdP token, and
  rendered as one canonical output/error shape.
- As an AI client, I connect an MCP stdio client and see the same registry as tools
  named `<resource>_<op>` (e.g. `sample_create`) with JSON-Schema `inputSchema`
  derived from the same field descriptors the CLI validates against.
- As a future integrator, I write a thin `register(...)` module per service pointing
  at that service's API base — and both front-ends gain the full CRUD set with zero
  adapter changes. (No such per-service module ships in this change.)
- The package proves the contract on its own: the in-package sample registry
  exercises create/get/list/update/delete through **both** adapters against the
  **same** stub API, and the tests prove parity.

Core contract (single-definition DRY):

- **Registry core** (`src/core/`): `defineResource({ name, basePath, ops })` with per-op
  field descriptors (`FieldSpec` §6). From these the core derives, once: a runtime
  validator, a JSON Schema per op input, and the wire mapping (method/path/body) to
  the service HTTP contract. Adapters never restate any of the three.
- **Transport** (`src/transport/`): one HTTP executor — Bearer token, owner context,
  cursor pagination passthrough, and one error mapping (HTTP status + service error
  body → typed `OpsError` with the canonical message). Both adapters render
  `OpsError` identically.
- **Auth** (`src/auth/`): `login` (auth code + PKCE, loopback `http://127.0.0.1:<port>/callback`),
  refresh-token rotation, and a local token store written `0600` (chmod 600) at
  `~/.config/life-ops/credentials.json` (path overridable by env). Tokens are never
  logged and never printed. Both adapters read the same store; `life-ops login` is
  the single login path.
- **CLI adapter** (`src/cli/`): `life-ops <resource> <op> [flags]` + `life-ops login` |
  `logout`. Flags derive from field specs; validation failures render the canonical
  error shape before any network call.
- **MCP adapter** (`src/mcp/`): stdio server; `tools/list` renders `<resource>_<op>`
  tools with core-derived `inputSchema`; `tools/call` runs the same executor the CLI
  runs. Missing token → the canonical auth error telling the user to run
  `life-ops login`. Parity with the CLI is a tested property, not a convention.
- **Sample registry** (`src/fixtures/`): one resource (`sample`, five ops) — the
  in-package stand-in for a future per-service module.

Out of scope (from intent, binding): per-service registry modules (note/todo/meal/
feedback/tags), any edit under `apps/`, cross-service gateway, non-CRUD ops
(health/cache/admin), idp resources, UI changes, HTTP API shape changes, publishing.

## 4. Commands

```
Typecheck: npm run typecheck          # run in packages/ops (workspace-aware)
Unit test: npm run test:unit -- <file>  # from the owning workspace, e.g.
                                     # cd packages/ops && npm run test:unit -- parity.test.ts
Build:     npm run build              # run in packages/ops (tsc -p tsconfig.build.json)
```

- Testing policy: **at most 2 test runs** total (`max-test-runs: 2`) — run the
  targeted file(s) that prove the change, not the whole workspace speculatively.
- E2E (`npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"`)
  is permitted by the repo profile but **not used for this capability**: it exercises
  the web app's UI, and this package touches no UI. Parity is proven in jest against
  the stub API. Do not widen commands beyond these.

## 5. Project Structure

```
packages/ops/                → the whole capability (workspace `@life/ops`)
  src/core/                  → registry: FieldSpec, defineResource, validator, JSON-Schema derivation, wire mapping
  src/transport/             → HTTP executor: fetch, Bearer auth, cursor pagination, OpsError mapping
  src/auth/                  → IdP login (PKCE + loopback), refresh rotation, token store (0600)
  src/cli/                   → `life-ops` adapter: parseArgs → registry → transport → canonical render
  src/mcp/                   → MCP stdio adapter: tools/list + tools/call → same executor → same render
  src/fixtures/              → sample resource registry (in-package contract proof)
  src/index.ts               → programmatic surface (register + core types) for future per-service modules
  test/                      → jest suites (*.test.ts): parity, validation, auth, transport
  test/support/              → stub API (node:http) implementing the service HTTP contract + stub IdP token endpoint
docs/intent/ops-shared-package.md  → the confirmed intent (read-only input)
SPEC.md                      → this file (project root by skill convention; do not move or edit after freeze)
tasks/plan.md                → the implementation plan, written by the later planning phase (not part of this change's code)
apps/                        → NOT TOUCHED, by contract
```

No files outside `packages/ops/`, the root `package.json` `workspaces` entry, and
`package-lock.json` change.

## 6. Code Style

The repo writes TypeScript with spec-referencing block comments, exported typed
contracts, and single quotes. The style in one real snippet — the core definition
both adapters consume (this is the shape future registry modules write against):

```ts
/**
 * The one definition both adapters render (SPEC.md §3, DRY rule).
 * Validation, JSON Schema, and the wire mapping all derive from these
 * descriptors — an adapter that restates any of them is a bug.
 */
export interface FieldSpec {
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required?: boolean;
  enum?: readonly string[];
  description: string;
}

export interface OpSpec {
  /** create | get | list | update | delete — the closed op set (SPEC.md §3). */
  kind: 'create' | 'get' | 'list' | 'update' | 'delete';
  fields: Record<string, FieldSpec>;
}

export function defineResource(spec: ResourceSpec): ResourceRegistry {
  return { ...spec, ops: spec.ops.map((op) => normalizeOp(op)) };
}
```

Conventions: intention-revealing names; comments state the contract and cite the
spec section; no `any` in exported signatures; zero runtime dependencies (§2.8).

## 7. Testing Strategy

- Framework: jest + ts-jest, `testEnvironment: node`, suites at
  `packages/ops/test/*.test.ts` (the `packages/cache` pattern).
- Levels:
  - **Parity suite (`test/parity.test.ts`) — the centerpiece.** The stub API records
    requests. For each of create/get/list/update/delete: drive the same input through
    the CLI adapter and through the MCP adapter (`tools/call`), assert the recorded
    HTTP requests are identical (method, path, JSON body) and the normalized outputs
    are identical. Error parity too: a validator failure, `401`, `404`, `409` render
    the same canonical message through both adapters.
  - **Validation/schema suite:** a shared accept/reject case table must pass/fail
    identically in the core validator and against the JSON Schema the MCP tools
    expose (the schema never drifts from the validator).
  - **Auth suite:** login against a stub IdP token endpoint; credentials file created
    with mode `0600`; token never present in stdout/stderr; refresh rotation replaces
    the stored token.
  - **Transport suite:** error mapping table (status → `OpsError`) and cursor
    pagination passthrough against the stub API.
- Coverage expectations: every op of the sample registry exercised through both
  adapters; every error class in §3 mapped and asserted; every `FieldSpec` type
  exercised in the case table.
- No test contacts a real service or the real IdP; all fakes are `node:http` in
  `test/support/`.

## 8. Boundaries

- **Always do:** validate in the core before any network call; derive JSON Schema
  from the one `FieldSpec` table; write the token store `0600` and never log tokens;
  render errors from the single canonical shape; keep both adapters rendering the
  registry, never defining it; tests green before commit; spec section cited in
  contract comments.
- **Ask first:** adding any npm dependency (incl. `@modelcontextprotocol/sdk`);
  changing the token-store path/format; any op beyond the closed CRUD set; widening
  the Commands in §4; registering a new IdP client; moving/renaming this spec.
- **Never do:** edit anything under `apps/` (services are being changed in parallel
  and must not need any change); duplicate validation, schema derivation, auth,
  transport, or error shape in an adapter; store tokens world-readable or print
  them; change or work around the services' HTTP API contract; add per-service
  registry modules (note/todo/meal/feedback/tags) or idp resources; add non-CRUD
  ops (health/cache/admin); publish to any registry; touch secrets, data
  directories, or ports (repo hard lines).

## 9. Success Criteria

1. `npm run typecheck` (in `packages/ops`) exits 0; `npm run build` (in
   `packages/ops`) exits 0.
2. Parity proven in one jest run of `parity.test.ts`: for all five ops
   (create/get/list/update/delete), the stub-API request recorded from the CLI
   adapter equals the one from the MCP adapter (method, path, JSON body) and the
   normalized outputs are equal.
3. MCP `tools/list` over the sample registry exposes exactly the five tools named
   `sample_create`, `sample_get`, `sample_list`, `sample_update`, `sample_delete`,
   and their `inputSchema` accepts/rejects the shared case table identically to the
   core validator.
4. Error parity asserted as strings: validator failure, `401`, `404` (foreign/missing
   identical), `409` (`expectedVersion`) render byte-identical messages through both
   adapters.
5. After `login` against the stub IdP, `~/.config/life-ops/credentials.json` exists
   with file mode `0600` (asserted in the auth suite), and a normal CLI/MCP run emits
   no token bytes on stdout/stderr.
6. `git diff --name-only HEAD` shows zero paths under `apps/`, and
   `grep -rln "@life/ops\|life-ops" apps` returns zero hits.
7. `packages/ops/package.json` has an empty (or absent) `dependencies` block — no
   runtime npm dependency added without Ask-first approval.
8. All of the above hold with only `packages/ops/**`, the root `workspaces` entry,
   and `package-lock.json` changed.

## 10. Open Questions

1. **Package name.** `packages/ops` / `@life/ops` is provisional ("name up for grabs").
   Decide before the workspace entry lands; after implementation starts it is frozen.
2. **MCP dependency.** Hand-rolled minimal stdio JSON-RPC (assumption §2.8) vs
   `@modelcontextprotocol/sdk` for future-proof MCP client compatibility. Ask-first.
3. **CLI OAuth client.** Reusing the `dev` client (assumption §2.6) works today but a
   dedicated `cli` client is the correct end state — that touches `apps/idp`, so it
   is deferred to the per-service integration step. Confirm the interim reuse is
   acceptable.
4. **Token store location.** `~/.config/life-ops/credentials.json` vs honoring
   `XDG_CONFIG_HOME`. Minor, but the path is part of the auth contract once shipped.
5. **MCP-side login.** This spec makes `life-ops login` the single login path and the
   MCP server fail with a canonical "run `life-ops login`" error when unauthenticated.
   If MCP-only users must be able to log in without a terminal, an `auth_login` tool
   (URL + loopback capture) is a scope addition — needs a human decision.
