---

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).
title: MCP protocol best practice — delta against @life/ops
status: research (read-only lane output, not a decision)
date: 2026-10-18
sources: modelcontextprotocol spec 2025-06-18 / 2025-11-25 / 2026-07-28 (raw.githubusercontent.com),
         @modelcontextprotocol/sdk@1.32.1 (registry.npmjs.org)
evidence: every claim carries a URL#section or path:line citation
---

# MCP protocol best practice — delta package for `@life/ops`

Scope: read-only research lane. Repo worktree `/home/night/WebstormProjects/personal-life/.pi/worktrees/ops-shared-package`, adapter `packages/ops/src/mcp/{server.ts,tools.ts}`, SPEC `SPEC.md` (§8 Boundaries, §10 Open Questions). Every claim carries a `URL#section` citation or a `path:line` citation into our code / the resolved SDK.

SDK resolved: `@modelcontextprotocol/sdk@1.32.1` (published 2026-10-05) → extracted to `/tmp/sdk/package`.

---

## 1. Lifecycle / `initialize` handshake

**Spec (legacy/current generation):**
- "The initialization phase **MUST** be the first interaction between client and server" — `https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization` (local copy `/tmp/mcp-lifecycle.mdx:40`).
- Client **MUST** send `initialize` with `protocolVersion`, `capabilities`, `clientInfo`; server **MUST** respond with `protocolVersion`, `capabilities`, `serverInfo`, optional `instructions` (`/tmp/mcp-lifecycle.mdx:47-105`).
- After a successful response the client **MUST** send `notifications/initialized` (`/tmp/mcp-lifecycle.mdx:107-115`).
- "The client **SHOULD NOT** send requests other than pings before the server has responded to the `initialize` request" (`/tmp/mcp-lifecycle.mdx:119-121`); the server **SHOULD NOT** send requests other than ping/logging before `initialized` (`/tmp/mcp-lifecycle.mdx:122-124`).
- Version negotiation: the server responds with the requested version when it supports it, otherwise its own supported version (client retries/aborts) — `https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation`.

**Our code:** `packages/ops/src/mcp/server.ts:92-97` dispatches only `tools/list` and `tools/call`; everything else, including `initialize`, falls to `unhandledMethodAnswer` → `-32601` (`server.ts:134-139`). No `protocolVersion`, no `capabilities`, no `serverInfo`, no session state. `notifications/initialized` is silently dropped by the notification rule (`server.ts:93`), which is correct behaviour for a notification.

**Consequence (measured, not theoretical):** every SDK-based client calls `initialize` first. `Client.connect()` issues the request and rejects on an error response (`/tmp/sdk/package/dist/esm/shared/protocol.js:487` `new McpError(response.error.code, …)`), then closes the transport. Server-info access (`client.getServerVersion()`) reads the stored result. So today **no real MCP client can connect at all** — the tools are unreachable, not merely imperfectly described.

**Verdict:** P0. This is the whole delta.

---

## 2. Transports / stdio framing

**Spec** (`https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio`, local `/tmp/mcp-transports.mdx:20-32`):
- Client launches server as a subprocess; JSON-RPC messages on stdin/stdout.
- "Messages are delimited by newlines, and **MUST NOT** contain embedded newlines."
- Server **MAY** write UTF-8 to stderr for logging.
- Server **MUST NOT** write anything to stdout that is not a valid MCP message.
- Client **MUST NOT** write anything to the server's stdin that is not a valid MCP message.

**Our code:** `server.ts:56` writes exactly `JSON.stringify(response)` + `\n` to stdout, and `server.ts:58` sends all failures to stderr — conformant on both MUSTs. Framing: `server.ts:68-79` buffers stdin on `\n` and keeps a partial tail — correct; `JSON.stringify` never emits embedded newlines (JSON escapes them), so the no-embedded-newline MUST holds. `server.ts:80` exits 0 on stdin `end`, which is the standard subprocess-shutdown path. `LIFE_OPS_*` env is inherited.

Two residual stdio risks:
1. Any future code path that writes to `process.stdout` (e.g. the login URL printer at `packages/ops/src/auth/login.ts:293` writes to `process.stdout`) would corrupt the stream. That is not reachable from the MCP entry today, but it is the classic failure mode and worth a comment/test.
2. A low-level SDK client (`StdioClientTransport`) parses each line through `JSONRPCMessageSchema.parse` and calls `onerror` + `close()` on a parse failure (`/tmp/sdk/package/dist/esm/client/stdio.js:95-97`, `138-139`), so any stray stdout byte kills the session rather than degrading.

**Verdict:** already conformant; add a regression guard, don't rewrite.

---

## 3. `tools/list` + `tools/call` result shape

**Spec** (`https://modelcontextprotocol.io/specification/2025-11-25/server/tools`):
- `tools/list` returns `{ tools: [...] }`; each tool has `name` (required), `description`, `inputSchema` — a JSON Schema object with `type: "object"` at the root, `properties`, `required`. `outputSchema`, `title`, `annotations`, `icons`, `_meta` are optional. `nextCursor` is optional pagination.
- `tools/call` returns `{ content: [...] }` with `isError?: boolean`; text content is `{ "type": "text", "text": "…" }`.
- SDK mirrors this: `ToolSchema` requires `inputSchema.type === 'object'` with a `catchall` for the rest (`/tmp/sdk/package/dist/esm/types.js:1229-1246`); `ListToolsResultSchema = PaginatedResultSchema.extend({ tools })` (`:1283-1285`); `CallToolResultSchema` requires `content` (defaults `[]`) and allows `structuredContent` (`:1289-1302`).

**Our code:** `listAnswer` returns `{ tools: listTools(registry) }` (`server.ts:99-101`), each tool `{ name, description, inputSchema }` (`tools.ts:12-16`), schema derived from the same `FieldSpec` table the validator uses (`tools.ts:28-34`, `core/schema.ts`). `callAnswer` returns `{ content: [{ type: 'text', text }], isError? }` (`server.ts:103-109`). Names are `<resource>_<op>` (`sample_create`, …), asserted in `test/validation-schema.test.ts:120-127` and SPEC §9 criterion 3.

This matches the SDK's schemas field-for-field, including `type: 'object'` root and `additionalProperties: false`. Text-only content is the forward-compatible choice: `structuredContent` is optional, and omitting it is legal when no `outputSchema` is declared.

**Gaps, ranked by client-visible value:**
1. No `title` or `annotations` (`readOnlyHint` / `destructiveHint` / `idempotentHint`). Clients (Claude Desktop, VS Code, Cursor) use `annotations` to decide whether to prompt for confirmation; `delete` should be `destructiveHint: true`, `get`/`list` `readOnlyHint: true`. Cheap, advisory-only.
2. Descriptions are generated ("create sample record through /samples", `tools.ts:36-38`), which is thin for LLM tool selection. A hand-written per-op hint beats a template.
3. All tools are exposed in one page with no `nextCursor` — legal, and correct for a bounded CRUD registry.
4. `tools/call` treats unknown tool as `-32602` (`server.ts:117-121`) — see §4.

---

## 4. Error semantics

**Spec:** protocol errors → JSON-RPC error objects (`-32700` parse, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal). Tool execution errors → a normal result with `isError: true` and actionable text so the model can self-correct. Notably the 2025-11-25 spec moved *input validation errors* into the execution-error bucket (SEP-1303): the model can fix a bad argument, so it must come back as `isError: true`, not `-32602` (`/tmp/mcp-tools-2026-07-28.mdx:737-780`; SDK does exactly this at `/tmp/sdk/package/dist/esm/server/mcp.js:200`).
Unknown tool stays a protocol error: `-32602 "Unknown tool: invalid_tool_name"`.

**Our code:**
- Unknown tool / missing name string → `nameOf` throws (`server.ts:186-192`) → `-32602` with the canonical rendered message (`server.ts:117-121`). Conformant.
- Execution failure (validator failure, `401`, `404`, `409`, `409` conflict) → `runTool` catches and returns `{ failed: true }` (`server.ts:124-131`) → `isError: true` result with the canonical `renderFailure` string. Conformant with SEP-1303, and it is what makes `parity.test.ts`'s error-parity assertions pass.
- **Not conformant:** malformed JSON is not answered at all. `parseLine` (`server.ts:163`) throws inside `respondToLine`, which catches and writes to **stderr only** (`server.ts:84-89`). JSON-RPC requires `-32700` with `id: null`; the client hangs until its request timeout.
- **Not conformant:** a JSON object with no `method` string (`asRequest`, `server.ts:166-171`) is likewise stderr-only. Requires `-32600` with `id: null`.
- Unhandled method → `-32601` (`server.ts:136-137`). Conformant, but currently this is what swallows `initialize` and `ping`.

**Verdict:** the tool-level split is right; the transport-level error replies (`-32700`/`-32600`) are missing and are a 10-line fix.

---

## 5. Auth (MCP)

**Spec** (`https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`):
- Authorization is OPTIONAL. HTTP-based transports **SHOULD** conform to the OAuth profile (protected-resource metadata, `WWW-Authenticate`, PKCE, resource indicators).
- "Implementations using an STDIO transport **SHOULD NOT** follow this specification, and instead retrieve credentials from the environment." (`/tmp/mcp-authz.mdx:20-21`).

**Our code:** stdio only. The token comes from `readToken()` (`server.ts:38`, `auth/token-store.ts:35-36`), i.e. the file `~/.config/life-ops/credentials.json` (override `LIFE_OPS_CREDENTIALS_PATH`), written `0600` by `life-ops login`. So we are on the stdio side of the fork: no OAuth machinery in the MCP path, no `WWW-Authenticate`, none required. The OAuth/PKCE resource-indicator machinery lives on the *CLI* side (`auth/login.ts`), where it is a client of our own IdP — a different role, and RFC 8707 applies there, not here.

Two deviations worth recording rather than fixing:
1. The spec's stdio advice is "retrieve credentials from the environment". We retrieve them from a file store, with an env *path* override. A file at `0600` in the user's config dir is a defensible reading, but it means the MCP server depends on a prior out-of-band `life-ops login`. An env-token escape hatch (`LIFE_OPS_TOKEN`) would remove that coupling — optional, and it would touch the token-store format contract (SPEC §8 "Ask first").
2. MCP-side login is deliberately out of scope (SPEC §10 open question 5); the server returns a canonical "run `life-ops login` first" message as a tool execution error (`MISSING_TOKEN_MESSAGE` in `parity.test.ts:27`). That is the right shape under SEP-1303 — the user-facing fix is in the text, not in a protocol error.

---

## 6. SDK vs hand-rolled verdict

**Hand-rolled, with two additions.** The SDK would fix exactly one thing we can't fix cheaply ourselves — the `initialize` handshake — and it costs a dependency that the repo's own success criteria forbid.

Cost of adopting `@modelcontextprotocol/sdk@1.32.1`:
- SPEC §9 criterion 7 requires an empty `dependencies` block, and SPEC §2.8 / §8 list "adding any npm dependency (incl. `@modelcontextprotocol/sdk`)" as Ask-first (`SPEC.md:206`, `:238`, `:247`). SPEC §10 open question 2 is literally this decision, unresolved.
- 17 runtime deps transitively, including `express`, `hono`, `ajv`, `zod`, `jose`, `express-rate-limit`, `cors` — a web-server stack for a stdio CLI adapter.
- `zod` is a **mandatory** peer dep (`^3.25 || ^4.0`), so it is not avoided by "just the low-level API" (`/tmp/sdk/package/package.json:122-131`).
- The package is ESM-only (`"type": "module"`) with a `dist/cjs` build; our `tsconfig.base.json` targets CommonJS, so consuming it forces interop changes in the build.
- It solves `initialize` and nothing else we need: `tools/list`/`tools/call` are already conformant, and adopting the SDK would mean using its low-level `Server.setRequestHandler` with hand-supplied JSON Schema anyway — the DRY derivation from `FieldSpec` (`tools.ts:28-34`) stays ours either way.

Cost of the hand-rolled additions: roughly 60 lines in `server.ts` plus tests. Rung 6 of the ladder beats rung 4 here, and the repo has already paid for the parity property (one `renderFailure` string through both adapters) that an SDK adds risk to.

**Verdict:** stay hand-rolled. Revisit only if we later need server-initiated features (sampling, elicitation, resources, subscriptions) — those are where the SDK earns its dependency.

---

## 7. Version currency

- **Published spec revisions:** `2024-10-07`, `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28` (newest, with a `draft` line on `main`).
- **SDK:** `LATEST_PROTOCOL_VERSION = '2025-11-25'`, `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07']` (`/tmp/sdk/package/dist/esm/types.js:2-4`). The SDK's server picks the requested version if supported, else `LATEST` (`/tmp/sdk/package/dist/esm/server/index.js:263`). The SDK does **not** implement the `2026-07-28` stateless model (`resultType`, `ttlMs`, `cacheScope`, `server/discover` are absent from its type surface).
- **What `2026-07-28` changes:** it removes the handshake. "There is no negotiation handshake. Every request carries its protocol version" — version/identity/capabilities ride in per-request `_meta`; `server/discover` replaces `initialize` for capability discovery; unsupported versions answer `-32022 UnsupportedProtocolVersionError` with a `supported` list (`/tmp/mcp-2026-versioning.mdx:11-72`). `stdio` itself is unchanged.
- **Practical target:** the installed/installing client base speaks the legacy generation (`initialize` + `2025-06-18`/`2025-11-25`). Implement the handshake and answer with the version we actually support; the 2026 stateless model is a future, additive path (a dual-era server answers `initialize` *and* tolerates `_meta`-stamped per-request versions).

**Verdict:** implement the legacy `initialize` handshake; note dual-era support as deferred, not as a gap. Do not target `2026-07-28`.

---

## 8. Delta summary — ranked integration pain

| # | Gap | Pain | Fix size |
|---|---|---|---|
| 1 | No `initialize` → no client can connect | Blocker; makes the adapter unusable | ~40 lines in `server.ts` + test |
| 2 | No `ping` → `-32601` | Spec MUST: "receiver **MUST** respond promptly with an empty response" (`/tmp/mcp-ping.mdx:23-30`); clients use it for liveness | 3 lines |
| 3 | `-32700` / `-32600` never sent (stderr only) | Client hangs to timeout on a malformed line | ~10 lines |
| 4 | No `title` / `annotations` on tools | Clients can't gate destructive ops on `delete` | ~10 lines in `tools.ts` |
| 5 | TBW token acquisition from file, not env | stdio spec advice deviation; requires prior `life-ops login` | optional |
| 6 | Generated one-line descriptions | Weaker LLM tool selection | optional |

## 9. Conformant-minimum task list

1. Add `initialize` to `answer()`: respond `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version }, instructions? }`, echoing the requested version when we support it (`2025-06-18` and `2025-11-25`), else our highest supported one. Ignore `notifications/initialized` (already inert).
2. Add `ping` → `{ result: {} }`.
3. Answer `-32700` (unparseable line) and `-32600` (valid JSON, not a request) with `id: null`; keep stderr logging as a side channel.
4. Add `title` (human name) and `annotations` (`readOnlyHint` for get/list, `destructiveHint` for delete, `idempotentHint` for delete/update where true) to `McpTool`.
5. Regression guard: a test asserting stdout carries only JSON-RPC lines (nothing from `login.ts`'s URL printer), and one asserting `initialize` → `tools/list` → `tools/call` succeeds end-to-end in order.
6. Update SPEC §10 open question 2 with the recorded decision (hand-rolled + handshake, SDK deferred) and add a `## Lifecycle` note to §3.
