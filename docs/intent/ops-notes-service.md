# Intent — `notes` service module in `@life/ops`

## Outcome
A `notes` service module inside `@life/ops`, so `life-ops` (CLI) and the MCP server both
drive real `note-service` data through the one shared registry and the one shared HTTP
executor.

## User
The repository owner, from a terminal (`life-ops`) and from an AI agent over MCP.

## Why now
`@life/ops` is complete — core registry, wire mapping, validation, transport executor,
auth (login/refresh/token store), CLI adapter, MCP adapter, and their suites — but it
ships only `src/fixtures/sample.ts`. It has never spoken to a real service. `note-service`
is the first real consumer.

## Success
`LIFE_OPS_SERVICE=notes life-ops notes <op> …` performs the operation against
`note-service`. The MCP server exposes the same operations. Both cover
`create`, `get`, `list`, `update`, `delete`, and `restore`, and both render identical
results for the same call.

## Constraint
`restore` is added as a **sixth kind in the closed op set**, not as per-operation
`path`/`method` overrides. Reasoning: `apps/todo-service/src/todos/todos.controller.ts`
carries the identical `@Post(':id/restore')` route, so the kind is shared vocabulary
rather than a notes one-off; `wire.ts` remains the single place that derives method and
path, and both adapters stay free of any logic the core does not own (the package's own
DRY rule).

The contract's invariants hold unchanged: `isDestructive` still defaults by kind,
`restore` is a mutating op, and every existing op compiles to exactly the request it
compiles to today.

## Out of scope
- `DELETE /api/notes/:id/permanent` and `DELETE /api/notes/trash` — permanent deletion and
  emptying the trash stay human-only operations.
- `tags`, `todo`, and `meal` service modules.
- Any UI change in `apps/app`.
- New runtime dependencies.

## Confirmation
Confirmed: yes — the user answered "yes" to the six-line restate, 2026-10-28.
