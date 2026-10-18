# Intent — `@life/ops` agent-ready contract

Captured 2026-10-18 from a one-question-at-a-time interview. The user's own words
are preserved where they differ from the phrasing below.

## Outcome

`packages/ops` becomes a contract an in-repo LangGraph agent can actually use: an
official MCP SDK client connects and receives tools, and a human-in-the-loop gate
can tell a safe read from a data-destroying call. The package's job ends at its own
boundary.

## User

The user, wiring agents that live inside this repository (Hermes / LangChain /
LangGraph with HITL). Not a third party, not a hosted service.

## Why now

The agent is going to be in-repo rather than external, so both ends of the contract
are ours. That means the package must emit what the graph actually needs — not
merely what reads well in a human terminal. Today neither end can see the other:
`langchain-mcp-adapters` cannot connect at all.

## Success

- An official MCP SDK client completes the `initialize` handshake and receives the
  tool list.
- HITL gating works from protocol data, not from a hand-maintained list of
  dangerous tool names.
- A graph node branches on returned data rather than parsing a human sentence.
- A hung call or an expired token fails recoverably instead of wedging the node.
- A consumer can `import` the package normally, without reaching into its internals.

## Constraint

Package code only — `packages/ops` source, tests, and spec. No service wiring (no
`LIFE_OPS_SERVICE` registry modules for the domain services), no `apps/*` changes,
no IdP changes. Transport stays stdio. One server per service stays as it is.

## Out of scope

Merging the per-service servers into one gateway. Streamable HTTP transport and
OAuth protected-resource metadata. Any CLI behaviour change. The agent app itself.

## Delivery items (six)

1. `initialize` handshake (plus `notifications/initialized` and protocol-version
   negotiation) so a conformant SDK client connects.
2. Read/write annotations in `tools/list`, derived from the registry's existing op
   kinds, so a HITL gate can distinguish read from mutating calls.
3. `structuredContent` (with `outputSchema` where it holds) on `tools/call`, so a
   graph node can branch on data.
4. A package `exports` map, so a consumer imports without subpath hacks.
5. A per-call deadline, so a non-answering backend cannot wedge an agent node.
6. Token expiry check plus refresh wiring, so a long agent turn does not die
   mid-flight.

## Confirmation

Confirmed: yes — the user explicitly answered "yes" to the six-line restate above
(2026-10-18), after confirming the scope reduction "packages ops only".
