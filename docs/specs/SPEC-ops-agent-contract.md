# Spec: `@life/ops` agent-ready contract

Status: DRAFT for user confirmation. Serves `docs/intent/ops-agent-contract.md`
(confirmed 2026-10-18). Single-capability spec (§1). Supersedes nothing in the
original `SPEC.md` — that file remains the contract for the package's existing
core, CLI, and MCP surface; this one amends the MCP wire contract and the auth and
transport seams an in-repo agent needs.

## 1. Scope check

The ask names six pieces: `initialize` handshake, tool annotations, structured
tool output, a package `exports` map, a per-call deadline, and token expiry with
refresh. They share one property that cannot be verified piecewise: **a conformant
MCP client can connect to this package and drive it safely under a human-in-the-loop
gate, and a failed or expired call degrades to a recoverable error rather than a
wedged process**. Remove the handshake and no client connects; remove the
annotations and the HITL gate has nothing to decide on; remove the deadline or the
refresh and a single bad call wedges the run the other four exist to serve.

Verdict: one capability, one spec, no capability map. The pieces are layers with a
one-way dependency (core registry ← schema projection ← MCP adapter; token store ←
token provider ← executor ← adapters), so no module ids are minted.

## 2. Assumptions I'm making

1. `packages/ops` source, tests, and docs only. No `LIFE_OPS_SERVICE` registry
   modules for the domain services, no `apps/*`, no `apps/idp`. The package is a
   client of the existing service HTTP contract; it does not learn a new one.
2. Transport stays stdio. One MCP server per service stays. No gateway, no
   Streamable HTTP, no OAuth protected-resource metadata.
3. Zero new runtime dependencies. The handshake, annotations, and structured
   output are JSON the existing hand-rolled loop already emits; `@modelcontextprotocol/sdk`
   remains deferred and still needs Ask-first approval (original SPEC §8).
4. Supported protocol versions are `2025-06-18` and `2025-11-25`. The server echoes
   the client's request when it is one of those two, and answers its own highest
   otherwise.
5. The registry models *requests*, never responses, so there is no response shape
   to derive an `outputSchema` from. `tools/call` therefore returns
   `structuredContent` carrying the parsed service body when that body is a JSON
   object or array, and omits the key when it is not. No `outputSchema` is declared
   (§10.1).
6. The deadline applies at the one executor, which the CLI also calls. A hung CLI
   call therefore now fails after the deadline instead of hanging. This is a
   failure-path-only change, and forking the executor to spare the CLI is the worse
   trade (§8, deviates from "no CLI behaviour change" in the narrowest possible
   way — flag if you disagree).
7. Token refresh is wired into the shared token read, not into either adapter, so
   MCP and CLI get it identically. Refresh happens before a call when the stored
   token is inside a skew window, never reactively after a `401`.
8. Concurrent tool calls may happen (a LangGraph turn can fan out), so at most one
   refresh is in flight at a time and concurrent readers await that one.
9. The credential file format (`accessToken`, `refreshToken`, `expiresAt`) is
   unchanged — `expiresAt` already exists and is currently never read.

Correct me now or I proceed on these.

## 3. Objective

Make the package's MCP surface conformant enough that a real MCP client connects,
and make the transport and auth seams robust enough that an agent loop cannot be
wedged by a hung backend or a stale token — without adding a dependency, changing
the CLI's argument surface, or moving the package's boundary.

### 3.1 Lifecycle

- `initialize` answers `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version } }`.
  Version negotiation per assumption 4. `capabilities` declares only `tools` — the
  server has no resources, prompts, or logging surface to advertise.
- `serverInfo.name` is `life-ops`; `serverInfo.version` is a module constant equal
  to the package version, with a test asserting the two agree (§9.1).
- `notifications/initialized` stays inert: a notification still gets no answer.
- `ping` answers `{ result: {} }`.
- An unparseable line answers JSON-RPC `-32700` with `id: null`. A parseable line
  that is not a request answers `-32600` with `id: null`. stderr logging stays as a
  side channel; it is never the only trace of a bad line.
- An unknown method keeps answering `-32601`.

### 3.2 Tool annotations, and the destructiveness flag

Every `tools/list` entry gains `title` and `annotations`. The hints derive from the
op kind already in the registry, with one per-op override; no new descriptor for
annotations themselves:

| kind | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|---|---|---|---|
| `get` | `true` | `false` | `true` |
| `list` | `true` | `false` | `true` |
| `create` | `false` | **`true`** | `false` |
| `update` | `false` | **`true`** | `true` |
| `delete` | `false` | **`true`** | `true` |

A mutating op is destructive unless the resource author says otherwise:

```ts
export interface OpSpec {
  kind: 'create' | 'get' | 'list' | 'update' | 'delete';
  fields: Record<string, FieldSpec>;
  /** Overrides the kind default. Defaults: true for create/update/delete,
   *  false for get/list. `false` on a mutating op is an explicit statement
   *  that this write may run without human approval. */
  isDestructive?: boolean;
}
```

The override wins where stated; an unstated op keeps the kind default. Both are
frozen into the registry by `normalizeOp`, so a projection never re-derives it.

Rationale: the resource author is the only one who knows whether a `delete` is a
recoverable trash or a hard purge. A global kind table cannot, and a hand-maintained
tool-name list in the consumer would drift. Defaulting mutating ops to destructive
gives the fail-safe reading — writes interrupt until someone deliberately says
they do not — and makes the opt-out the one place to review when auditing what an
agent may do unattended.

`title` is `"<Verb> <resource>"` (`Get note`, `Delete note`). All four hints are
stated explicitly rather than relying on protocol defaults, so a consumer never has
to know the defaults to gate a call.

This is a **flag, not an enforcement**. The package publishes what a call may do;
the human-in-the-loop gate that acts on it lives in the consuming agent, out of
scope per §8. A consumer gates on `annotations.destructiveHint`, so it needs no
name list of its own.

### 3.3 Structured tool output

- `tools/call` keeps `content: [{ type: 'text', text }]` — the existing canonical
  rendering is unchanged, so adapter output parity remains a string comparison.
- When the service body is a JSON object or array, the result additionally carries
  `structuredContent` with that value verbatim. When the body is absent or is a
  scalar, the key is omitted rather than invented.
- A failed call keeps `isError: true` and gains no `structuredContent`.

### 3.4 Per-call deadline

- `ExecutorOptions` gains `deadlineMs`, default `30_000`, overridable by
  `LIFE_OPS_DEADLINE_MS`, and disabled by `0`.
- The deadline is applied with `AbortSignal.timeout` on the one `fetch` in
  `transport/executor.ts`. No polling, no timers to clean up.
- Exceeding it raises `OpsError` with a new `timeout` code and a detail naming the
  operation and the deadline. Both adapters render it through the existing
  `renderOpsError`, so the CLI needs no change to surface it.

### 3.5 Token expiry and refresh

A new `auth/token-provider.ts` exports `currentAccessToken()`, which becomes the
default `readToken` both adapters use:

1. No stored tokens → `undefined` (unchanged: "run `life-ops login`").
2. Stored token outside the skew window → its access token, unchanged.
3. Stored token inside the skew window → `refresh()` once, store the rotated pair,
   return the new access token.
4. `refresh()` reports "login required" → `undefined`, so the canonical
   `run \`life-ops login\`` hint surfaces.
5. `refresh()` fails at the network or protocol level → `undefined` as well: a
   stale token is worth no retry, and the actionable fix is the same.
6. Concurrent callers share one in-flight rotation; the memo is cleared on
   settle so a later call can rotate again.

Skew window: `60_000` ms, overridable by `LIFE_OPS_REFRESH_SKEW_MS`.

### 3.6 Package `exports`

`packages/ops/package.json` gains an `exports` map covering exactly what a consumer
needs: `.` (the programmatic surface), `./mcp/server` (the stdio entry), and
`./package.json`. `main`, `types`, and `bin` stay so non-`exports`-aware resolution
keeps working. No other subpath is exported; deep imports into `src` stop resolving,
which is the point.

### 3.7 User stories / acceptance criteria

1. As an MCP client author, I connect with the official SDK and receive a tool list.
2. As a HITL gate author, I read `annotations.destructiveHint` and know without a
   name list whether to interrupt.
3. As a graph node author, I read `structuredContent` and branch on a value.
4. As a package consumer, `import { defineResource } from '@life/ops'` resolves.
5. As an agent operator, a backend that never answers fails the turn in 30s.
6. As an agent operator, a turn longer than the token lifetime survives it.

## 4. Commands

Run from `packages/ops` unless noted.

```
npm run typecheck          # tsc --noEmit
npm run test:unit -- <file> # jest, one suite per invocation
npm run build              # tsc -p tsconfig.build.json
```

Repo testing policy applies: one suite per command, at most two runs.

## 5. Project structure

Existing files change; two are new.

```
packages/ops/
  package.json                       # + exports map
  src/
    auth/token-provider.ts           # NEW: expiry check + single-flight refresh
    core/schema.ts                   # + toolTitle, annotations per kind
    mcp/server.ts                    # + initialize, ping, -32700/-32600, structuredContent
    mcp/tools.ts                     # + title, annotations in McpTool
    transport/errors.ts              # + 'timeout' code
    transport/executor.ts            # + deadlineMs / AbortSignal.timeout
    index.ts                         # + export of the new provider
  test/
    mcp-lifecycle.test.ts            # NEW: handshake, ping, parse errors, stdout purity
    token-provider.test.ts           # NEW: expiry, skew, single-flight, fallbacks
```

## 6. Code style

`code-as-prose`: intention-revealing names, one job per function, top-to-bottom
narrative, no comments restating the code. Every new module opens with a short
paragraph naming the contract it implements and the SPEC section, matching the
existing files' convention. No new abstraction unless a second caller exists.

## 7. Testing strategy

Hand-rolled stubs, no network, no framework beyond the package's existing jest.

- **Lifecycle.** `initialize` echoes a supported version, falls back to our highest
  for an unknown one, and returns the declared capabilities and `serverInfo`. `ping`
  returns an empty result. A notification gets no answer.
- **Parse errors.** A garbage line yields `-32700` with `id: null`; `{ "id": 1 }`
  without a method yields `-32600`; both keep stdout to JSON-RPC lines only.
- **Stdout purity.** A full `initialize` → `tools/list` → `tools/call` sequence
  produces only JSON-RPC objects on stdout, asserted by parsing every line. This is
  the guard against the login URL printer reaching the stream.
- **Annotations.** All five kinds mapped, asserted as a table so a new kind cannot
  be added without a decision. An op with `isDestructive: false` reports
  `destructiveHint: false`; an op with `isDestructive: true` on `get` reports
  `true`, proving the override wins in both directions.
- **Structured output.** Object body → `structuredContent` deep-equals the parsed
  body; empty body and scalar body → key absent; failure → `isError` and no
  `structuredContent`.
- **Deadline.** A stub server that never responds produces `OpsError` code
  `timeout` within the deadline, and `LIFE_OPS_DEADLINE_MS=0` leaves the call
  unbounded (asserted with a short artificial delay, not a real hang).
- **Token provider.** Fresh token → used as-is, no refresh call. Inside skew →
  exactly one refresh, new token returned, store overwritten. Refresh says "login
  required" and refresh throws → both `undefined`. Ten concurrent reads → one
  rotation.
- **Exports.** `package.json` declares `.`, `./mcp/server`, `./package.json`, and
  every target file exists after `build`.

## 8. Boundaries

- **Never:** add a runtime dependency; change the credential file format; change
  CLI arguments or output for the success path; reach into `apps/*` or `apps/idp`;
  add a second MCP method beyond the ones named here.
- **Ask first:** adding `@modelcontextprotocol/sdk`; declaring an `outputSchema`;
  raising or removing the default deadline; making the skew window configurable by
  anything other than the env var above.
- **Deviation, recorded:** the deadline changes CLI failure behaviour on a hang
  (assumption 6). The alternative — an unbounded CLI and a bounded MCP — forks the
  one executor the package exists to keep single.
- **Deviation, recorded:** no `outputSchema`, because the registry has no response
  shape to derive one from (assumption 5). A consumer that wants validation gets
  `structuredContent` and validates it itself.

## 9. Success criteria

1. An official MCP SDK client (`StdioClientTransport`) completes `initialize` and
   lists tools against the built `dist` entry.
2. `tools/list` carries `title` plus all four annotation hints for every op, with
   `destructiveHint` true for every mutating op that did not opt out.
3. `tools/call` returns `structuredContent` for an object body and the existing
   text rendering unchanged, so adapter parity still holds.
4. `import { defineResource } from '@life/ops'` resolves from another workspace.
5. A non-answering backend yields `OpsError` code `timeout` at the deadline, in
   both adapters, with no leaked timer or socket.
6. An expired stored token is rotated transparently by a single refresh; a token
   that cannot be rotated surfaces the canonical login hint.
7. `npm run typecheck`, the new suites, and the existing four suites are green.
8. The original `SPEC.md` behaviour is unchanged except where this spec states a
   change: success output, error rendering, CLI arguments, credential format.

## 10. Open questions

1. **`outputSchema`.** Deferred per assumption 5. Revisit only when the registry
   grows a response descriptor; inventing one now would restate the service
   contract this package deliberately does not own.
2. **Annotations override.** The per-op `isDestructive` override is the first thing
   a consumer's policy depends on. Revisit only if resources need a third state
   ("destructive but pre-approved"); a boolean does not express that, and two
   booleans would drift.
3. **Gateway.** Still out of scope, as in the original SPEC §10. An in-repo agent
   that needs several services registers several servers; the fan-out belongs to
   the agent's client config, not to this package.
4. **Deadline default.** `30_000` is a guess sized for interactive CLI use. If agent
   turns routinely exceed it, the number moves — it is one constant and one env var.
