Produced by planning-and-task-breakdown; source spec: docs/specs/SPEC-ops-agent-contract.md

# Implementation Plan: `@life/ops` agent-ready MCP contract

Work is package-only in `/home/night/WebstormProjects/personal-life/.pi/worktrees/ops-agent-contract/packages/ops`: source, tests, `package.json`. The spec is frozen and nothing here edits it, `SPEC.md`, `README.md`, `src/cli/**`, `apps/*`, or `apps/idp`.

Six contract changes land in dependency order: the registry's frozen destructiveness flag plus the `title`/`annotations` projection (§3.2), the `initialize`/`ping`/`-32700`/`-32600` lifecycle (§3.1), additive `structuredContent` (§3.3), an MCP-only per-call deadline with a new `timeout` code (§3.4), an MCP-only single-flight token provider (§3.5), and the `exports` map (§3.6). The exports map is second because it is independent and cheap to prove early. A seventh task adds the spec's test-only official-SDK conformance suite (§3.8, §10.9), which is the only thing that touches `devDependencies`; `dependencies` stays absent and no `src/` module imports the SDK.

Dependency chain: `core/types.ts` → `core/registry.ts` → `core/schema.ts` → `mcp/tools.ts` → `mcp/server.ts` on one side, and `auth/token-store.ts` → `auth/refresh.ts` → `auth/token-provider.ts` → `mcp/server.ts` on the other. Tasks 3–6 all touch `mcp/server.ts`, so they stay sequential; each one adds one seam. Repo testing policy applies: one suite per `npm run test:unit -- <file>` command, at most 2 runs per task.

Checkpoints, as review gates rather than extra work: after Tasks 1–2 the two independent surfaces (hint projection, exports) are proved before anything touches `mcp/server.ts`; after Task 4 the whole MCP wire contract is settled, so `npm run typecheck` plus `npm run test:unit -- test/parity.test.ts` confirms adapter text parity before the failure-path tasks begin; after Task 7, `npm run typecheck` plus the regression suites no task changed (`test/parity.test.ts`, `test/auth.test.ts`) close the run, with `src/cli/**` unmodified and `packages/ops/package.json` `dependencies` still absent.

## Task 1: Destructiveness flag and `tools/list` title/annotations

**Description:** Add `OpSpec.isDestructive` with the `kindIsDestructive` default table to the core types, freeze the resolved boolean inside `normalizeOp`, and project `title` plus all four annotation hints into every `tools/list` entry, so a consuming HITL gate reads `annotations.destructiveHint` instead of keeping its own dangerous-tool-name list. Hints come from the same registry the CLI validates against, so there is one source of truth.

**Acceptance criteria:**

- [ ] `kindIsDestructive` is `true` for `create`/`update`/`delete` and `false` for `get`/`list`, and the §3.2 table is asserted row by row over the closed kind set.
- [ ] `normalizeOp` resolves `isDestructive: operation.isDestructive ?? kindIsDestructive(operation.kind)` and the frozen registry carries it on every op; `name`/`description`/`inputSchema` are unchanged and the registry stays deep-frozen.
- [ ] An op with `isDestructive: false` on a mutating kind reports `destructiveHint: false`; an op with `isDestructive: true` on `get` reports `true` — the override wins in both directions.
- [ ] Every `listTools(sampleRegistry)` entry carries `title` of the form `"<Verb> <registry.name>"` (`Get sample`, `Delete sample`) and all four hints stated explicitly, never omitted in favour of protocol defaults.
- [ ] No `outputSchema` is declared and no dependency is added (spec §9 Ask first, §11 open question 3).

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/validation-schema.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: inspect the `tools/list` JSON printed by the suite and confirm every op shows a `<Verb> <registry.name>` `title` plus all four `annotations` hints, and that no `outputSchema` key appears.

**Dependencies:** None

**Files likely touched:**

- `packages/ops/src/core/types.ts`
- `packages/ops/src/core/registry.ts`
- `packages/ops/src/core/schema.ts`
- `packages/ops/src/mcp/tools.ts`
- `packages/ops/test/validation-schema.test.ts`

**Estimated scope:** Medium (5 files)

## Task 2: Package `exports` map

**Description:** Declare the package's public subpaths — `.` (the programmatic surface), `./mcp/server` (the stdio entry), and `./package.json` — so a consumer imports `@life/ops` normally while deep `src`/`dist` imports stop resolving, with `main`, `types`, and `bin` retained so non-`exports`-aware resolution keeps working. The acceptance is the resolver, not the JSON: resolution is asserted on resolved path strings, and no `dist` is built or probed (spec §3.6, §5).

**Acceptance criteria:**

- [ ] `packages/ops/package.json` declares exactly three export keys — `.` → `./dist/index.js`, `./mcp/server` → `./dist/mcp/server.js`, `./package.json` → `./package.json` — with `types` conditions on the two `dist` entries, and no other subpath.
- [ ] `.` agrees with `main` (`dist/index.js`) and `types` (`dist/index.d.ts`); `bin.life-ops` stays `dist/cli/run.js`; `./mcp/server` targets the `dist` path `tsconfig.build.json` emits for `src/mcp/server.ts` (`rootDir: src`, `outDir: dist`).
- [ ] From a temp directory holding a `node_modules/@life/ops` link to the package, a `node --input-type=module` child's `import.meta.resolve` resolves `@life/ops` → `.../dist/index.js`, `@life/ops/mcp/server` → `.../dist/mcp/server.js`, `@life/ops/package.json` → the manifest, and fails `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@life/ops/dist/core/registry.js`.
- [ ] No dependency is added, `dependencies` stays absent, and no `dist` is created by the suite.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/package-surface.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: read `packages/ops/package.json` by eye — exactly the three `exports` keys with `types` conditions, and `git diff` shows `main`, `types`, `bin`, `dependencies` unchanged.

**Dependencies:** None

**Files likely touched:**

- `packages/ops/package.json`
- `packages/ops/test/package-surface.test.ts` (new)

**Estimated scope:** Small (2 files)

## Task 3: Lifecycle handshake, version negotiation, parse-error replies

**Description:** Answer `initialize` with protocol-version negotiation, answer `ping`, answer `-32700` for an unparseable line and `-32600` for a parseable non-request, and keep `notifications/initialized` inert, so an MCP client completes a handshake and receives the tool list while every stdout line stays JSON-RPC. `serverInfo.version` is a module constant kept equal to the package version by test, and a bad line is both answered and logged on the injected `stderr` — logging is a side channel, never the only trace.

**Acceptance criteria:**

- [ ] `initialize` echoes `2025-06-18` when requested, answers the highest supported version (`2025-11-25`) for an unknown one, and returns `capabilities: { tools: {} }` plus `serverInfo { name: 'life-ops', version: SERVER_VERSION }`.
- [ ] `SERVER_VERSION` equals the `version` field parsed from `packages/ops/package.json` (0.1.0), so the constant cannot drift from the published package.
- [ ] `ping` answers `{ result: {} }`; `notifications/initialized` and every other notification get no answer and write nothing to stdout.
- [ ] An unparseable line returns `-32700` with `id: null`; a parseable line that is not a request (e.g. `{ "id": 1 }`) returns `-32600` with `id: null`; neither throws; an unknown method still answers `-32601` and a malformed `tools/call` still answers `-32602`.
- [ ] A full `initialize` → `tools/list` → `tools/call` sequence handed to `createMcpServer({ ...options, stdout, stderr })` one parsed request at a time via `McpServer.handle` produces only JSON-RPC objects on the injected `stdout`, in arrival order, so the login URL printer never reaches the stream.
- [ ] `answerRequestsUntilStdinCloses` still binds `process.stdin` with a synchronous `data` callback, and `McpServerOptions` gains no line source; the suite drives every response through the existing production seams of spec §10.1 — `createMcpServer` with injected `stdout`/`stderr` writers, then `McpServer.handle(request: unknown): Promise<unknown>` per request — and adds no new exported entry point to `src/mcp/server.ts`. The seeded-store fixture (`LIFE_OPS_CREDENTIALS_PATH` + `storeTokens` at `now + 3_600_000`, as `test/parity.test.ts` does) keeps `tools/call` reaching the stub API rather than failing in `requireToken`.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/mcp-lifecycle.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: feed one handwritten valid pair and one unparseable line through the injected writers and confirm the replies are JSON-RPC on `stdout` while the bad-line diagnostic appears only on `stderr`.

**Dependencies:** Tasks 1-2

**Files likely touched:**

- `packages/ops/src/mcp/server.ts`
- `packages/ops/test/mcp-lifecycle.test.ts` (new)

**Estimated scope:** Small (2 files)

## Task 4: `structuredContent` on `tools/call`

**Description:** Carry a JSON object service body verbatim as `structuredContent` beside the existing `content` text, and a bare array body wrapped as `{ items: [...] }`, so a graph node branches on returned data instead of parsing a rendered sentence, while the canonical `renderOpsResult` rendering and adapter parity stay byte-identical. The key is additive and omitted — never invented — for an empty or scalar body, and a failed call gains nothing.

**Acceptance criteria:**

- [ ] An object body returns `structuredContent` deep-equal to that parsed body, alongside unchanged `content: [{ type: 'text', text }]`; an empty JSON object counts as an object. A bare array body returns `{ items: <parsed array> }`, not the array itself: `structuredContent` is typed as a record at the root (`CallToolResultSchema` in `@modelcontextprotocol/sdk`), and an array there makes a conformant client reject the result with `$ZodError` instead of returning data.
- [ ] An absent body and a scalar body (JSON string, number, boolean; also raw non-JSON text) return no `structuredContent` key at all.
- [ ] A failed call keeps `isError: true` and gains no `structuredContent`.
- [ ] `content[0].text` stays byte-identical to `renderOpsResult` for the same body, so `test/parity.test.ts` remains a string comparison; `src/cli/render.ts` is unmodified and no `outputSchema` is declared.
- [ ] Every case runs with the seeded-store fixture in place, so an authenticated call reached the stub rather than failing in `requireToken`.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/mcp-lifecycle.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: eyeball one `structuredContent` reply and its `content[0].text` side by side and confirm the nested values match the stub body while the text is the same one `renderOpsResult` prints for the CLI.

**Dependencies:** Task 3

**Files likely touched:**

- `packages/ops/src/mcp/server.ts`
- `packages/ops/test/mcp-lifecycle.test.ts`

**Estimated scope:** Small (2 files)

## Task 5: MCP per-call deadline and `timeout` error code

**Description:** Give the single executor an optional `deadlineMs` (default `0`, unbounded) applied with `AbortSignal.timeout` on its one `fetch`, raise an `OpsError` with the new `timeout` code when it fires, and let `mcp/server` alone opt in at `30_000`, overridable by `LIFE_OPS_DEADLINE_MS` and disabled by `0`. The env var is read by the adapter through one named pure function, never by the executor, so `cli/run.ts` — which constructs the executor without the option — keeps today's unbounded behaviour and the CLI changes nothing.

**Acceptance criteria:**

- [ ] `OpsErrorCode` includes `'timeout'`; a deadline failure names the operation and the deadline in its detail, carries no HTTP status, and renders through the existing `renderOpsError` shape (one line, no stack).
- [ ] `deadlineMs > 0` passes `AbortSignal.timeout(deadlineMs)` to the one `fetch`; an abort (`TimeoutError`/`AbortError`) becomes the `timeout` `OpsError` instead of an escaping DOM exception; `deadlineMs === 0` passes no signal; a `!response.ok` response still maps through `failureFromResponse`.
- [ ] `resolveDeadlineMs({})` is `30_000`, `'5000'` is `5000`, `'0'` is `0`, and an unparseable or negative value falls back to `30_000`; `createMcpServer` passes it and reads no env itself.
- [ ] A non-answering backend on the MCP adapter path yields the `(timeout)` rendered failure within the configured deadline, while the same construction with `LIFE_OPS_DEADLINE_MS=0` is still pending after a short delay (asserted as "in flight", not a real hang); stub servers close and no timer or socket leaks.
- [ ] An executor built the way `cli/run.ts` builds it (no `deadlineMs`) stays in flight over the same interval, `src/cli/run.ts` is unmodified, and every existing `test/transport.test.ts` case still passes.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/transport.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — run 1
- [ ] Focused unit tests pass: `npm run test:unit -- test/mcp-lifecycle.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — run 2, the task's whole budget
- [ ] Manual check: run the transport failure path with a short `LIFE_OPS_DEADLINE_MS` against a stub that never answers and confirm the rendered line says the operation and deadline timed out, with no stack and no HTTP status.

**Dependencies:** Task 4

**Files likely touched:**

- `packages/ops/src/transport/errors.ts`
- `packages/ops/src/transport/executor.ts`
- `packages/ops/src/mcp/server.ts`
- `packages/ops/test/transport.test.ts`
- `packages/ops/test/mcp-lifecycle.test.ts`

**Estimated scope:** Medium (5 files)

## Task 6: Token expiry check with single-flight refresh

**Description:** Add `auth/token-provider.ts` exporting the parameterless `currentAccessToken()` — no stored tokens or a token inside the 60 s skew window rotates once through the existing `refresh()` (which persists the rotated pair itself) and returns the new access token, while "login required" and any refresh failure return `undefined` so the canonical `run \`life-ops login\`` hint surfaces. Concurrent readers share one in-flight rotation and the memo clears on settle. `mcp/server` makes it the default `readToken`; `cli/run.ts` keeps `readToken` from `auth/token-store.ts`, so the CLI's stale-token `401` path is unchanged.

**Acceptance criteria:**

- [ ] A stored token outside the window is returned as-is with no rotation; a token inside the window triggers exactly one `refresh()`, returns the rotated access token, and leaves the rotated pair persisted (the write is `refresh()`'s, not the provider's).
- [ ] No stored tokens, no refresh token, a "login required" report, and a throwing refresh all return `undefined` with no retry.
- [ ] Ten concurrent reads on one expiring entry produce exactly one rotation, and a later call after settle can rotate again (memo cleared).
- [ ] `LIFE_OPS_REFRESH_SKEW_MS='0'` disables the window and an unparseable value falls back to `60_000`; the window is configurable by that env var alone — `currentAccessToken()` takes no parameter and no options interface.
- [ ] The provider is exported from `src/index.ts`, `mcp/server` uses it as the default `readToken`, an executor wired as `cli/run.ts` wires it never rotates, the credential file shape (`accessToken`/`refreshToken`/`expiresAt`) is unchanged, and the suite runs against the stub IdP via `IDP_ISSUER` with no real network.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/token-provider.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: inspect the credential file before and after a windowed read and confirm the pair persisted is the rotated one written by `refresh()`, and that `cli/run.ts` still imports `readToken` from `auth/token-store.ts`.

**Dependencies:** Task 5

**Files likely touched:**

- `packages/ops/src/auth/token-provider.ts` (new)
- `packages/ops/src/mcp/server.ts`
- `packages/ops/src/index.ts`
- `packages/ops/test/token-provider.test.ts` (new)

**Estimated scope:** Medium (4 files)

## Task 7: Official-SDK conformance suite

**Description:** Add the spec's test-only conformance harness: `@modelcontextprotocol/sdk` `1.32.1` plus its peer `zod` `^3.25.76` as `devDependencies`, a `.ts` require hook, a `LIFE_OPS_SERVICE` fixture module, and `test/sdk-client.test.ts`, which spawns the stdio entry through the SDK's `StdioClientTransport` and asserts `connect()` completes `initialize`, `listTools()` returns every registered tool with `title` and all four hints, one `callTool()` round-trips the stub service, and teardown leaves no child process behind. `dependencies` stays absent, no `src/` module imports the SDK, and the child runs from source with no build.

**Acceptance criteria:**

- [ ] `packages/ops/package.json` `devDependencies` gains `@modelcontextprotocol/sdk` pinned to `1.32.1` and `zod` `^3.25.76`; `dependencies` stays absent, `main`/`types`/`bin`/`exports`/`scripts` otherwise unchanged, and root `package-lock.json` is the only file outside `packages/ops` this task rewrites.
- [ ] `test/support/transpile-require.cjs` compiles `.ts` with the repo's own `typescript`, so `node --require test/support/transpile-require.cjs src/mcp/server.ts` loads the entry with the fixture and no `dist`, and writes nothing to stdout.
- [ ] `test/support/service-module.ts` exports `registry` (the sample-registry-equivalent fixture) for `LIFE_OPS_SERVICE`, with `LIFE_OPS_API_BASE` and `LIFE_OPS_CREDENTIALS_PATH` pointed at the suite's stubs.
- [ ] `Client.connect()` resolves, `listTools()` returns every registered tool with its `title` and all four hints, and one `callTool()` against the stub service succeeds; the only network is the suite's `node:http` stubs.
- [ ] The child is killed and awaited in teardown, so the run leaves no process behind and the spawn is asserted exited; the suite is the only place the SDK is imported.

**Verification:**

- [ ] Typecheck passes: `npm run typecheck` (workspace-aware; run in touched workspace — `packages/ops`)
- [ ] Focused unit tests pass: `npm run test:unit -- test/sdk-client.test.ts` (owning workspace `packages/ops`; jest; workspace exposes `typecheck`/`test:unit`) — 1 run, 2 at most
- [ ] Manual check: confirm `git diff packages/ops/package.json` touches only `devDependencies`, and that `ps` shows no leftover child after the suite exits.

**Dependencies:** Task 6

**Files likely touched:**

- `packages/ops/package.json`
- `packages/ops/test/sdk-client.test.ts` (new)
- `packages/ops/test/support/transpile-require.cjs` (new)
- `packages/ops/test/support/service-module.ts` (new)
- `package-lock.json`

**Estimated scope:** Medium (5 files)
